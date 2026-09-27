-- AI Content Intelligence Copilot: auditable ingestion review.

create table public.ai_ingestion_review_jobs (
  id uuid primary key default gen_random_uuid(),
  pdf_import_id uuid not null references public.pdf_imports(id) on delete cascade,
  idempotency_key text not null unique,
  snapshot_hash text not null,
  risk_policy_version text not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  status text not null default 'queued' check (status in (
    'queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'stale'
  )),
  attempt_count int not null default 0 check (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  selected_drafts int not null default 0 check (selected_drafts >= 0),
  reviewed_drafts int not null default 0 check (reviewed_drafts >= 0),
  failed_drafts int not null default 0 check (failed_drafts >= 0),
  input_tokens bigint,
  output_tokens bigint,
  estimated_cost_usd numeric(12, 6),
  pricing_version text,
  latency_ms bigint,
  error_category text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_ingestion_review_jobs_import_idx
  on public.ai_ingestion_review_jobs(pdf_import_id, created_at desc);
create index ai_ingestion_review_jobs_claim_idx
  on public.ai_ingestion_review_jobs(status, lease_expires_at, created_at);

create trigger ai_ingestion_review_jobs_set_updated_at
before update on public.ai_ingestion_review_jobs
for each row execute function public.set_updated_at();

alter table public.draft_questions
  add column review_route text check (review_route in ('batch_ready', 'individual_review', 'blocked')),
  add column review_snapshot_hash text,
  add column review_policy_version text,
  add column review_job_id uuid references public.ai_ingestion_review_jobs(id) on delete set null,
  add column review_risks jsonb not null default '[]'::jsonb,
  add column review_error_category text,
  add column reviewed_at timestamptz,
  add column human_review_mode text check (human_review_mode in ('individual', 'batch')),
  add column human_reviewed_by uuid references public.profiles(id) on delete set null,
  add column human_reviewed_at timestamptz;

create index draft_questions_review_route_idx
  on public.draft_questions(pdf_import_id, review_route, status);

create table public.ai_ingestion_review_findings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_ingestion_review_jobs(id) on delete cascade,
  pdf_import_id uuid not null references public.pdf_imports(id) on delete cascade,
  draft_question_id uuid not null references public.draft_questions(id) on delete cascade,
  draft_snapshot_hash text not null,
  issue_type text not null check (issue_type in (
    'ocr_corruption', 'question_boundary', 'passage_or_prompt', 'choice_structure',
    'answer_key_conflict', 'visual_association', 'crop_problem', 'other'
  )),
  severity text not null check (severity in ('critical', 'major', 'minor')),
  source_page int not null check (source_page >= 0),
  source_evidence text not null check (char_length(source_evidence) between 1 and 2000),
  explanation text not null check (char_length(explanation) between 1 and 4000),
  proposed_field text not null check (proposed_field in (
    'passage_text', 'prompt', 'choices', 'suggested_answer', 'stimulus_crop', 'none'
  )),
  proposed_value jsonb,
  model_confidence numeric(4, 3) check (model_confidence between 0 and 1),
  status text not null default 'open' check (status in ('open', 'accepted', 'dismissed', 'superseded')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or char_length(decision_reason) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index ai_ingestion_findings_draft_idx
  on public.ai_ingestion_review_findings(draft_question_id, status, severity);
create index ai_ingestion_findings_import_idx
  on public.ai_ingestion_review_findings(pdf_import_id, status);

alter table public.ai_ingestion_review_jobs enable row level security;
alter table public.ai_ingestion_review_findings enable row level security;

create policy "ai_ingestion_review_jobs_admin_all"
on public.ai_ingestion_review_jobs for all
using (public.is_admin())
with check (public.is_admin());

create policy "ai_ingestion_review_findings_admin_all"
on public.ai_ingestion_review_findings for all
using (public.is_admin())
with check (public.is_admin());

-- Review fields are invalid whenever source content changes. Status and
-- review-only updates deliberately do not invalidate the snapshot.
create or replace function public.invalidate_ai_ingestion_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    new.review_route := null;
    new.review_snapshot_hash := null;
    new.review_policy_version := null;
    new.review_job_id := null;
    new.review_risks := '[]'::jsonb;
    new.review_error_category := null;
    new.reviewed_at := null;
    update public.ai_ingestion_review_findings
      set status = 'superseded'
      where draft_question_id = old.id and status = 'open';
  end if;
  return new;
end;
$$;

create trigger draft_questions_invalidate_ai_review
before update on public.draft_questions
for each row execute function public.invalidate_ai_ingestion_review();

revoke all on function public.invalidate_ai_ingestion_review() from public, anon, authenticated;

create or replace function public.invalidate_ai_review_from_child()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft_id uuid := coalesce(new.draft_question_id, old.draft_question_id);
begin
  update public.ai_ingestion_review_findings
    set status = 'superseded'
    where draft_question_id = v_draft_id and status = 'open';
  update public.draft_questions
    set review_route = null,
        review_snapshot_hash = null,
        review_policy_version = null,
        review_job_id = null,
        review_risks = '[]'::jsonb,
        review_error_category = null,
        reviewed_at = null
    where id = v_draft_id;
  return coalesce(new, old);
end;
$$;

create trigger draft_choices_invalidate_ai_review
after insert or update or delete on public.draft_question_choices
for each row execute function public.invalidate_ai_review_from_child();

create trigger draft_keys_invalidate_ai_review
after insert or update or delete on public.draft_answer_keys
for each row execute function public.invalidate_ai_review_from_child();

revoke all on function public.invalidate_ai_review_from_child() from public, anon, authenticated;

-- Service-role-only worker claim. SKIP LOCKED permits multiple workers.
create or replace function public.claim_ai_ingestion_review_job(
  p_worker_id text,
  p_lease_seconds int default 300
)
returns setof public.ai_ingestion_review_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  update public.ai_ingestion_review_jobs
    set status = 'failed', finished_at = now(), lease_owner = null, lease_expires_at = null,
        error_category = 'worker_crash_retry_exhausted', error_message = 'Lease expired after the maximum worker attempts.'
    where status = 'running' and lease_expires_at < now() and attempt_count >= 3;
  select id into v_id
  from public.ai_ingestion_review_jobs
  where status = 'queued'
     or (status = 'running' and lease_expires_at < now() and attempt_count < 3)
  order by created_at
  for update skip locked
  limit 1;
  if v_id is null then return; end if;
  return query
  update public.ai_ingestion_review_jobs
    set status = 'running',
        lease_owner = left(p_worker_id, 200),
        lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 3600))),
        attempt_count = attempt_count + 1,
        started_at = coalesce(started_at, now()),
        error_category = null,
        error_message = null
    where id = v_id
    returning *;
end;
$$;

revoke all on function public.claim_ai_ingestion_review_job(text, int) from public, anon, authenticated;
grant execute on function public.claim_ai_ingestion_review_job(text, int) to service_role;

-- Atomic human sign-off over an explicit, current set of text-only drafts.
create or replace function public.batch_sign_off_ingestion_drafts(
  p_import_id uuid,
  p_draft_ids uuid[],
  p_snapshot_hashes text[],
  p_admin_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  if coalesce(array_length(p_draft_ids, 1), 0) = 0
     or array_length(p_draft_ids, 1) <> array_length(p_snapshot_hashes, 1)
     or array_length(p_draft_ids, 1) > 200 then
    raise exception 'invalid batch selection';
  end if;
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin') then
    raise exception 'admin required';
  end if;

  select count(*) into v_count
  from unnest(p_draft_ids, p_snapshot_hashes) as requested(id, snapshot_hash)
  join public.draft_questions d on d.id = requested.id
  where d.pdf_import_id = p_import_id
    and d.review_route = 'batch_ready'
    and d.review_snapshot_hash = requested.snapshot_hash
    and d.status <> 'rejected'
    and coalesce(d.has_visual_stimulus, false) = false
    and nullif(btrim(d.suggested_answer), '') is not null
    and not exists (
      select 1 from public.ai_ingestion_review_findings f
      where f.draft_question_id = d.id and f.status = 'open'
    );
  if v_count <> array_length(p_draft_ids, 1) then
    raise exception 'one or more drafts are stale or ineligible';
  end if;

  update public.draft_questions d
    set status = 'approved',
        human_review_mode = 'batch',
        human_reviewed_by = p_admin_id,
        human_reviewed_at = now()
  from unnest(p_draft_ids, p_snapshot_hashes) as requested(id, snapshot_hash)
  where d.id = requested.id
    and d.review_snapshot_hash = requested.snapshot_hash;

  update public.draft_answer_keys
    set status = 'approved'
    where draft_question_id = any(p_draft_ids) and status = 'suggested';

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  select p_admin_id, 'draft_question.batch_signed_off', 'draft_question', selected.id,
    jsonb_build_object('pdf_import_id', p_import_id)
  from unnest(p_draft_ids) as selected(id);
  return v_count;
end;
$$;

revoke all on function public.batch_sign_off_ingestion_drafts(uuid, uuid[], text[], uuid) from public, anon, authenticated;
grant execute on function public.batch_sign_off_ingestion_drafts(uuid, uuid[], text[], uuid) to service_role;

-- Apply a model-proposed scalar edit and record its human decision in one
-- transaction. Complex choice/crop edits stay in the existing editor.
create or replace function public.accept_ai_ingestion_finding(
  p_import_id uuid,
  p_finding_id uuid,
  p_admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_finding public.ai_ingestion_review_findings%rowtype;
  v_current_hash text;
  v_value text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin') then
    raise exception 'admin required';
  end if;
  select * into v_finding from public.ai_ingestion_review_findings
    where id = p_finding_id and pdf_import_id = p_import_id and status = 'open'
    for update;
  if not found then raise exception 'finding not found or already decided'; end if;
  select review_snapshot_hash into v_current_hash from public.draft_questions
    where id = v_finding.draft_question_id and pdf_import_id = p_import_id for update;
  if v_current_hash is distinct from v_finding.draft_snapshot_hash then raise exception 'finding is stale'; end if;
  if v_finding.proposed_field not in ('prompt', 'passage_text', 'suggested_answer') then
    raise exception 'this correction requires the question editor';
  end if;
  v_value := case when v_finding.proposed_value = 'null'::jsonb then null else v_finding.proposed_value #>> '{}' end;
  if v_finding.proposed_field = 'prompt' and nullif(btrim(v_value), '') is null then
    raise exception 'prompt correction cannot be empty';
  end if;
  if char_length(coalesce(v_value, '')) > 20000 then raise exception 'correction is too long'; end if;

  update public.draft_questions set
    prompt = case when v_finding.proposed_field = 'prompt' then v_value else prompt end,
    passage_text = case when v_finding.proposed_field = 'passage_text' then v_value else passage_text end,
    suggested_answer = case when v_finding.proposed_field = 'suggested_answer' then v_value else suggested_answer end
    where id = v_finding.draft_question_id;
  update public.ai_ingestion_review_findings set
    status = 'accepted', decided_by = p_admin_id, decided_at = now(), decision_reason = 'Accepted proposed correction'
    where id = p_finding_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (p_admin_id, 'ai_ingestion_finding.accepted', 'draft_question', v_finding.draft_question_id,
      jsonb_build_object('finding_id', p_finding_id, 'field', v_finding.proposed_field));
  return v_finding.draft_question_id;
end;
$$;

revoke all on function public.accept_ai_ingestion_finding(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_ai_ingestion_finding(uuid, uuid, uuid) to service_role;
