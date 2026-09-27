-- Three-state deterministic/AI/human ingestion review pipeline.

alter table public.pdf_imports
  add column deterministic_review_status text not null default 'pending'
    check (deterministic_review_status in ('pending', 'passed', 'failed')),
  add column deterministic_policy_version text,
  add column deterministic_major_risks jsonb not null default '[]'::jsonb,
  add column deterministic_warnings jsonb not null default '[]'::jsonb,
  add column deterministic_reviewed_at timestamptz;

alter table public.draft_questions
  add column review_state text check (review_state in ('complete', 'review', 'failed')),
  add column deterministic_risks jsonb not null default '[]'::jsonb,
  add column parser_original_snapshot jsonb,
  add column ai_repair_snapshot jsonb,
  add column review_source_image_path text;

update public.draft_questions set review_state = case review_route
  when 'batch_ready' then 'complete'
  when 'individual_review' then 'review'
  when 'blocked' then 'review'
  else null end
where review_state is null;

create index draft_questions_review_state_idx
  on public.draft_questions(pdf_import_id, review_state, status);

alter table public.ai_ingestion_review_findings
  add column applied_automatically boolean not null default false,
  add column applied_at timestamptz;

create table public.ai_ingestion_review_revisions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_ingestion_review_jobs(id) on delete cascade,
  pdf_import_id uuid not null references public.pdf_imports(id) on delete cascade,
  draft_question_id uuid not null references public.draft_questions(id) on delete cascade,
  draft_snapshot_hash text not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  applied_fields jsonb not null default '[]'::jsonb,
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

create index ai_ingestion_review_revisions_draft_idx
  on public.ai_ingestion_review_revisions(draft_question_id, created_at desc);
alter table public.ai_ingestion_review_revisions enable row level security;
create policy "ai_ingestion_review_revisions_admin_all"
on public.ai_ingestion_review_revisions for all
using (public.is_admin()) with check (public.is_admin());

-- Content edits invalidate automated completion and require a fresh review.
create or replace function public.invalidate_ai_ingestion_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.prompt is distinct from new.prompt
     or old.passage_text is distinct from new.passage_text
     or old.section is distinct from new.section
     or old.question_type is distinct from new.question_type
     or old.suggested_answer is distinct from new.suggested_answer
     or old.page_number is distinct from new.page_number
     or old.source_question_number is distinct from new.source_question_number
     or old.source_module_name is distinct from new.source_module_name
     or old.parser_metadata is distinct from new.parser_metadata
     or old.has_visual_stimulus is distinct from new.has_visual_stimulus
     or old.stimulus_image_path is distinct from new.stimulus_image_path
     or old.stimulus_source_image_path is distinct from new.stimulus_source_image_path
     or old.stimulus_crop_rect is distinct from new.stimulus_crop_rect
     or old.stimulus_crop_status is distinct from new.stimulus_crop_status then
    new.review_state := 'review';
    new.review_route := 'individual_review';
    new.review_snapshot_hash := null;
    new.review_policy_version := null;
    new.review_job_id := null;
    new.review_risks := '[]'::jsonb;
    new.review_error_category := null;
    new.reviewed_at := null;
    update public.ai_ingestion_review_findings set status = 'superseded'
      where draft_question_id = old.id and status = 'open';
  end if;
  return new;
end; $$;

create or replace function public.invalidate_ai_review_from_child()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_draft_id uuid := coalesce(new.draft_question_id, old.draft_question_id);
begin
  update public.ai_ingestion_review_findings set status = 'superseded'
    where draft_question_id = v_draft_id and status = 'open';
  update public.draft_questions set
    review_state = 'review', review_route = 'individual_review', review_snapshot_hash = null,
    review_policy_version = null, review_job_id = null, review_risks = '[]'::jsonb,
    review_error_category = null, reviewed_at = null
    where id = v_draft_id;
  return coalesce(new, old);
end; $$;

-- Complete means automated review is finished. Publication still requires
-- the existing approved status and human audit fields.
create or replace function public.batch_sign_off_ingestion_drafts(
  p_import_id uuid, p_draft_ids uuid[], p_snapshot_hashes text[], p_admin_id uuid
) returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if coalesce(array_length(p_draft_ids, 1), 0) = 0
     or array_length(p_draft_ids, 1) <> array_length(p_snapshot_hashes, 1)
     or array_length(p_draft_ids, 1) > 200 then raise exception 'invalid batch selection'; end if;
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin') then raise exception 'admin required'; end if;
  select count(*) into v_count
  from unnest(p_draft_ids, p_snapshot_hashes) requested(id, snapshot_hash)
  join public.draft_questions d on d.id = requested.id
  where d.pdf_import_id = p_import_id and d.review_state = 'complete'
    and d.review_snapshot_hash = requested.snapshot_hash and d.status <> 'rejected'
    and coalesce(d.has_visual_stimulus, false) = false
    and nullif(btrim(d.suggested_answer), '') is not null
    and not exists (select 1 from public.ai_ingestion_review_findings f where f.draft_question_id = d.id and f.status = 'open');
  if v_count <> array_length(p_draft_ids, 1) then raise exception 'one or more drafts are stale or ineligible'; end if;
  update public.draft_questions d set status = 'approved', human_review_mode = 'batch', human_reviewed_by = p_admin_id, human_reviewed_at = now()
  from unnest(p_draft_ids, p_snapshot_hashes) requested(id, snapshot_hash)
  where d.id = requested.id and d.review_snapshot_hash = requested.snapshot_hash;
  update public.draft_answer_keys set status = 'approved' where draft_question_id = any(p_draft_ids) and status = 'suggested';
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  select p_admin_id, 'draft_question.batch_signed_off', 'draft_question', selected.id, jsonb_build_object('pdf_import_id', p_import_id)
  from unnest(p_draft_ids) selected(id);
  return v_count;
end; $$;

revoke all on function public.batch_sign_off_ingestion_drafts(uuid, uuid[], text[], uuid) from public, anon, authenticated;
grant execute on function public.batch_sign_off_ingestion_drafts(uuid, uuid[], text[], uuid) to service_role;
