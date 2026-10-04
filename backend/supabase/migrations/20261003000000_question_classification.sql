-- Optional metadata suggestions. Never changes ingestion review/publication gates.
create table public.classification_taxonomy (
  section text not null, domain text not null, skill text not null,
  primary key (section, skill)
);
alter table public.classification_taxonomy enable row level security;
create policy classification_taxonomy_admin_read on public.classification_taxonomy for select using (public.is_admin());

create table public.classification_jobs (
  id uuid primary key default gen_random_uuid(),
  pdf_import_id uuid not null references public.pdf_imports(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  model_version text not null,
  snapshot_hash text not null,
  total integer not null default 0,
  processed integer not null default 0,
  failed integer not null default 0,
  error_category text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create unique index classification_one_live_job on public.classification_jobs(pdf_import_id)
where status in ('queued','running');

create table public.classification_suggestions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.classification_jobs(id) on delete cascade,
  draft_question_id uuid not null references public.draft_questions(id) on delete cascade,
  input_snapshot jsonb not null,
  snapshot_hash text not null,
  prediction jsonb,
  status text not null default 'queued' check (status in ('queued','ready','failed','accepted','dismissed','stale')),
  error_category text,
  created_at timestamptz not null default now(),
  unique(job_id,draft_question_id)
);
create table public.classification_decisions (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.classification_suggestions(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  decision text not null check (decision in ('accept','dismiss')),
  accepted_labels jsonb not null default '{}',
  replaced_existing boolean not null default false,
  created_at timestamptz not null default now(),
  unique(suggestion_id)
);
create index classification_suggestion_draft_idx on public.classification_suggestions(draft_question_id,created_at desc);
alter table public.classification_jobs enable row level security;
alter table public.classification_suggestions enable row level security;
alter table public.classification_decisions enable row level security;
create policy classification_jobs_admin_read on public.classification_jobs for select using (public.is_admin());
create policy classification_suggestions_admin_read on public.classification_suggestions for select using (public.is_admin());
create policy classification_decisions_admin_read on public.classification_decisions for select using (public.is_admin());

create function public.classification_snapshot(p_draft_id uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'content', jsonb_build_object('section',d.section,'question_type',coalesce(d.question_type,'multiple_choice'),
      'prompt',d.prompt,'passage',coalesce(d.passage_text,''),
      'choices',coalesce((select jsonb_agg(c.text order by c.position,c.id) from public.draft_question_choices c where c.draft_question_id=d.id),'[]'::jsonb),
      'requires_image',coalesce(d.has_visual_stimulus,false)),
    'image_path',d.stimulus_image_path,'crop_status',d.stimulus_crop_status,
    'domain',d.domain,'skill',d.skill,'difficulty',d.difficulty,
    'updated_at',d.updated_at,'review_state',d.review_state,'status',d.status,'question_id',d.question_id)
  from public.draft_questions d where d.id=p_draft_id;
$$;

create function public.enqueue_classification(p_import_id uuid,p_actor_id uuid,p_model_version text,p_draft_ids uuid[] default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_job uuid; v_snapshot jsonb; v_hash text; v_draft record; v_count int := 0; v_imp record;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then raise exception 'Admin required'; end if;
  select * into v_imp from public.pdf_imports where id=p_import_id for update;
  if not found then raise exception 'Import not found'; end if;
  if coalesce(v_imp.text_quality->>'document_family',v_imp.content_scope) <> 'full_test'
     or v_imp.deterministic_review_status is distinct from 'passed' then raise exception 'Reviewed full-length import required'; end if;
  update public.classification_jobs set status='failed',error_category='worker_timeout',finished_at=now()
    where pdf_import_id=p_import_id and status in ('queued','running') and coalesce(started_at,created_at)<now()-interval '30 minutes';
  select id into v_job from public.classification_jobs where pdf_import_id=p_import_id and status in ('queued','running');
  if v_job is not null then return v_job; end if;
  insert into public.classification_jobs(pdf_import_id,requested_by,model_version,snapshot_hash)
    values(p_import_id,p_actor_id,p_model_version,'pending') returning id into v_job;
  for v_draft in select id from public.draft_questions where pdf_import_id=p_import_id
    and review_state='complete' and status not in ('approved','rejected') and question_id is null
    and (not coalesce(has_visual_stimulus,false) or stimulus_crop_status='confirmed')
    and (p_draft_ids is null or id=any(p_draft_ids)) order by id
  loop
    v_snapshot := public.classification_snapshot(v_draft.id);
    v_hash := encode(digest(v_snapshot::text,'sha256'),'hex');
    insert into public.classification_suggestions(job_id,draft_question_id,input_snapshot,snapshot_hash)
      values(v_job,v_draft.id,v_snapshot,v_hash);
    v_count := v_count+1;
    if v_count > 150 then raise exception 'At most 150 eligible drafts per classification job'; end if;
  end loop;
  if v_count=0 then raise exception 'No eligible unpublished drafts'; end if;
  update public.classification_jobs set total=v_count,snapshot_hash=(select encode(digest(string_agg(snapshot_hash,'' order by draft_question_id),'sha256'),'hex') from public.classification_suggestions where job_id=v_job) where id=v_job;
  return v_job;
end; $$;

create function public.claim_classification_job() returns setof public.classification_jobs
language plpgsql security definer set search_path=public as $$
begin
  update public.classification_jobs set status='failed',error_category='worker_timeout',finished_at=now()
    where status='running' and started_at<now()-interval '30 minutes';
  return query update public.classification_jobs set status='running',started_at=now()
    where id=(select id from public.classification_jobs where status='queued' order by created_at for update skip locked limit 1)
    returning *;
end; $$;

create function public.decide_classification(p_suggestion_id uuid,p_actor_id uuid,p_decision text,p_labels jsonb,p_replace_existing boolean default false)
returns void language plpgsql security definer set search_path=public,extensions as $$
declare v_s public.classification_suggestions; v_d public.draft_questions; v_domain text; v_skill text; v_difficulty int;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then raise exception 'Admin required'; end if;
  select * into v_s from public.classification_suggestions where id=p_suggestion_id for update;
  if not found or v_s.status<>'ready' then raise exception 'Suggestion is not ready'; end if;
  select * into v_d from public.draft_questions where id=v_s.draft_question_id for update;
  if v_s.snapshot_hash <> encode(digest(public.classification_snapshot(v_d.id)::text,'sha256'),'hex')
     or v_d.question_id is not null or v_d.status in ('approved','rejected') or v_d.review_state<>'complete'
     then raise exception 'Stale suggestion; classify again'; end if;
  if p_decision not in ('accept','dismiss') then raise exception 'Invalid decision'; end if;
  if p_decision='accept' then
    if p_labels is null or jsonb_typeof(p_labels)<>'object' or exists(select 1 from jsonb_object_keys(p_labels) k where k not in ('domain','skill','difficulty')) then raise exception 'Invalid label fields'; end if;
    v_domain := coalesce(nullif(p_labels->>'domain',''),v_d.domain);
    v_skill := coalesce(nullif(p_labels->>'skill',''),v_d.skill);
    v_difficulty := coalesce((p_labels->>'difficulty')::int,v_d.difficulty);
    if v_domain is not null and not exists(select 1 from public.classification_taxonomy where section=v_d.section and domain=v_domain) then raise exception 'Invalid domain'; end if;
    if v_skill is not null and not exists(select 1 from public.classification_taxonomy where section=v_d.section and domain=v_domain and skill=v_skill) then raise exception 'Invalid domain/skill pair'; end if;
    if v_difficulty is not null and v_difficulty not in (1,3,5) then raise exception 'Invalid difficulty'; end if;
    if not p_replace_existing and ((v_d.domain is not null and v_domain is distinct from v_d.domain)
       or (v_d.skill is not null and v_skill is distinct from v_d.skill)
       or (v_d.difficulty is not null and v_difficulty is distinct from v_d.difficulty)) then raise exception 'Explicit replacement confirmation required'; end if;
    update public.draft_questions set domain=v_domain,skill=v_skill,difficulty=v_difficulty where id=v_d.id;
  end if;
  insert into public.classification_decisions(suggestion_id,actor_id,decision,accepted_labels,replaced_existing)
    values(p_suggestion_id,p_actor_id,p_decision,coalesce(p_labels,'{}'),p_replace_existing);
  update public.classification_suggestions set status=case when p_decision='accept' then 'accepted' else 'dismissed' end where id=v_s.id;
end; $$;

revoke all on function public.classification_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.enqueue_classification(uuid,uuid,text,uuid[]) from public,anon,authenticated;
revoke all on function public.claim_classification_job() from public,anon,authenticated;
revoke all on function public.decide_classification(uuid,uuid,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.classification_snapshot(uuid),public.enqueue_classification(uuid,uuid,text,uuid[]),public.claim_classification_job(),public.decide_classification(uuid,uuid,text,jsonb,boolean) to service_role;

insert into public.classification_taxonomy(section,domain,skill) values
('reading_writing','Information and Ideas','Central Ideas and Details'),
('reading_writing','Information and Ideas','Command of Evidence'),
('reading_writing','Information and Ideas','Inferences'),
('reading_writing','Craft and Structure','Words in Context'),
('reading_writing','Craft and Structure','Text Structure and Purpose'),
('reading_writing','Craft and Structure','Cross-Text Connections'),
('reading_writing','Expression of Ideas','Rhetorical Synthesis'),
('reading_writing','Expression of Ideas','Transitions'),
('reading_writing','Standard English Conventions','Boundaries'),
('reading_writing','Standard English Conventions','Form, Structure, and Sense'),
('math','Algebra','Linear equations in one variable'),
('math','Algebra','Linear functions in one variable'),
('math','Algebra','Linear equations in two variables'),
('math','Algebra','Systems of two linear equations in two variables'),
('math','Algebra','Linear inequalities in one or two variables'),
('math','Advanced Math','Equivalent expressions'),
('math','Advanced Math','Nonlinear equations in one variable and systems of equations in two variables'),
('math','Advanced Math','Nonlinear functions'),
('math','Problem-Solving and Data Analysis','Ratios, rates, proportional relationships, and units'),
('math','Problem-Solving and Data Analysis','Percentages'),
('math','Problem-Solving and Data Analysis','One-variable data—Distributions and measures of center and spread'),
('math','Problem-Solving and Data Analysis','Two-variable data—Models and scatterplots'),
('math','Problem-Solving and Data Analysis','Probability and conditional probability'),
('math','Problem-Solving and Data Analysis','Inference from sample statistics and margin of error'),
('math','Problem-Solving and Data Analysis','Evaluating statistical claims—Observational studies and experiments'),
('math','Geometry and Trigonometry','Area and volume'),
('math','Geometry and Trigonometry','Lines, angles, and triangles'),
('math','Geometry and Trigonometry','Right triangles and trigonometry'),
('math','Geometry and Trigonometry','Circles');
