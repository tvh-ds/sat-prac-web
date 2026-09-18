-- =============================================================================
-- Bluebook-style SAT Practice Platform — Initial Schema
-- Roles: admin (full control) | student (practice only, admin-created)
-- All content/admin tables are protected by Row Level Security.
-- Structure: extensions/buckets -> functions -> tables -> RLS policies.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Storage bucket for PDF imports (private, admin-only access)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdf-imports', 'pdf-imports', false, 104857600, array['application/pdf'])
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Helper functions (plpgsql: bodies resolve at runtime, safe in any order)
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
end;
$$;

create or replace function public.is_student()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'student'
  );
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Auto-create profile + student profile when an auth user is created
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    'student',
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;

  insert into public.student_profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- =============================================================================
-- TABLES
-- =============================================================================

-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'student' check (role in ('admin', 'student')),
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- student_profiles
-- ----------------------------------------------------------------------------
create table public.student_profiles (
  id uuid primary key references public.profiles (id) on delete cascade,
  grade_level text,
  school text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger student_profiles_set_updated_at
before update on public.student_profiles
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- passages
-- ----------------------------------------------------------------------------
create table public.passages (
  id uuid primary key default gen_random_uuid(),
  title text,
  content text not null,
  source text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger passages_set_updated_at
before update on public.passages
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- questions
-- ----------------------------------------------------------------------------
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('reading_writing', 'math')),
  question_type text not null check (question_type in ('multiple_choice', 'student_produced')),
  passage_id uuid references public.passages (id) on delete set null,
  prompt text not null,
  domain text,
  skill text,
  difficulty smallint check (difficulty between 1 and 5),
  correct_answer text,
  explanation text,
  status text not null default 'active' check (status in ('active', 'archived')),
  source_pdf_id uuid,
  source_page int,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index questions_section_idx on public.questions (section);
create index questions_domain_idx on public.questions (domain);
create index questions_status_idx on public.questions (status);

create trigger questions_set_updated_at
before update on public.questions
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- question_choices
-- ----------------------------------------------------------------------------
create table public.question_choices (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  label text not null,
  text text not null,
  is_correct boolean not null default false,
  position smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, label),
  unique (question_id, position)
);

create index question_choices_question_idx on public.question_choices (question_id);

create trigger question_choices_set_updated_at
before update on public.question_choices
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- tests
-- ----------------------------------------------------------------------------
create table public.tests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_public boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tests_status_idx on public.tests (status);

create trigger tests_set_updated_at
before update on public.tests
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- test_sections
-- ----------------------------------------------------------------------------
create table public.test_sections (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests (id) on delete cascade,
  name text not null,
  section_type text not null check (section_type in ('reading_writing', 'math')),
  position smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (test_id, position)
);

create trigger test_sections_set_updated_at
before update on public.test_sections
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- test_modules
-- ----------------------------------------------------------------------------
create table public.test_modules (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.test_sections (id) on delete cascade,
  name text not null,
  time_limit_minutes int not null check (time_limit_minutes > 0),
  position smallint not null,
  is_adaptive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (section_id, position)
);

create trigger test_modules_set_updated_at
before update on public.test_modules
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- test_module_questions
-- ----------------------------------------------------------------------------
create table public.test_module_questions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.test_modules (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  position smallint not null,
  points numeric(4, 2) not null default 1,
  created_at timestamptz not null default now(),
  unique (module_id, question_id),
  unique (module_id, position)
);

create index test_module_questions_module_idx on public.test_module_questions (module_id);
create index test_module_questions_question_idx on public.test_module_questions (question_id);

-- ----------------------------------------------------------------------------
-- test_assignments
-- ----------------------------------------------------------------------------
create table public.test_assignments (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests (id) on delete cascade,
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  due_at timestamptz,
  status text not null default 'assigned' check (status in ('assigned', 'in_progress', 'completed', 'expired')),
  unique (test_id, student_id)
);

create index test_assignments_student_idx on public.test_assignments (student_id);

-- ----------------------------------------------------------------------------
-- attempts
-- ----------------------------------------------------------------------------
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  test_id uuid not null references public.tests (id) on delete cascade,
  assignment_id uuid references public.test_assignments (id) on delete set null,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'expired', 'graded')),
  current_module_id uuid references public.test_modules (id) on delete set null,
  current_question_position int,
  module2_difficulty text check (module2_difficulty in ('easier', 'harder')),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index attempts_student_idx on public.attempts (student_id);
create index attempts_test_idx on public.attempts (test_id);

create unique index attempts_one_active_per_test
on public.attempts (student_id, test_id)
where status in ('in_progress', 'submitted');

create trigger attempts_set_updated_at
before update on public.attempts
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- attempt_modules
-- ----------------------------------------------------------------------------
create table public.attempt_modules (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  module_id uuid not null references public.test_modules (id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  started_at timestamptz,
  completed_at timestamptz,
  time_spent_seconds int not null default 0,
  unique (attempt_id, module_id)
);

create index attempt_modules_attempt_idx on public.attempt_modules (attempt_id);

-- ----------------------------------------------------------------------------
-- attempt_responses
-- ----------------------------------------------------------------------------
create table public.attempt_responses (
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  module_id uuid not null references public.test_modules (id) on delete cascade,
  selected_choice_id uuid references public.question_choices (id) on delete set null,
  typed_answer text,
  is_correct boolean,
  marked_for_review boolean not null default false,
  eliminated_choice_ids uuid[] not null default '{}',
  notes text,
  highlights text[] not null default '{}',
  time_spent_seconds int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create index attempt_responses_attempt_idx on public.attempt_responses (attempt_id);

-- ----------------------------------------------------------------------------
-- attempt_events
-- ----------------------------------------------------------------------------
create table public.attempt_events (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index attempt_events_attempt_idx on public.attempt_events (attempt_id);

-- ----------------------------------------------------------------------------
-- scores
-- ----------------------------------------------------------------------------
create table public.scores (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.attempts (id) on delete cascade,
  raw_score numeric(6, 2) not null,
  total_questions int not null,
  section_scores jsonb not null default '{}',
  module_scores jsonb not null default '{}',
  topic_performance jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- topic_performance
-- ----------------------------------------------------------------------------
create table public.topic_performance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  domain text not null,
  skill text,
  attempted int not null default 0,
  correct int not null default 0,
  updated_at timestamptz not null default now(),
  unique (student_id, domain, skill)
);

create index topic_performance_student_idx on public.topic_performance (student_id);

-- ----------------------------------------------------------------------------
-- PDF import pipeline
-- ----------------------------------------------------------------------------
create table public.pdf_imports (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  original_filename text not null,
  file_size bigint,
  page_count int,
  status text not null default 'uploaded' check (status in (
    'uploaded', 'extracting', 'extracted', 'needs_ocr', 'ocr_pending',
    'ocr_running', 'ocr_completed', 'parsing', 'parsed', 'needs_review',
    'completed', 'failed', 'cancelled'
  )),
  extraction_method text check (extraction_method in ('text', 'ocr', 'mixed')),
  error_message text,
  text_quality jsonb not null default '{}',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pdf_imports_status_idx on public.pdf_imports (status);

create trigger pdf_imports_set_updated_at
before update on public.pdf_imports
for each row execute function public.set_updated_at();

create table public.pdf_import_pages (
  id uuid primary key default gen_random_uuid(),
  pdf_import_id uuid not null references public.pdf_imports (id) on delete cascade,
  page_number int not null,
  extracted_text text,
  needs_ocr boolean not null default false,
  ocr_status text not null default 'pending' check (ocr_status in ('pending', 'running', 'completed', 'failed')),
  ocr_text text,
  word_count int,
  created_at timestamptz not null default now(),
  unique (pdf_import_id, page_number)
);

create index pdf_import_pages_import_idx on public.pdf_import_pages (pdf_import_id);

-- ----------------------------------------------------------------------------
-- draft questions (output of PDF parsing, admin review required)
-- ----------------------------------------------------------------------------
create table public.draft_questions (
  id uuid primary key default gen_random_uuid(),
  pdf_import_id uuid references public.pdf_imports (id) on delete cascade,
  page_number int,
  section text check (section in ('reading_writing', 'math')),
  question_type text check (question_type in ('multiple_choice', 'student_produced')),
  prompt text not null,
  passage_text text,
  domain text,
  skill text,
  difficulty smallint check (difficulty between 1 and 5),
  suggested_answer text,
  answer_confidence numeric(3, 2),
  status text not null default 'needs_review' check (status in (
    'needs_review', 'missing_key', 'has_suggested_key', 'approved', 'rejected'
  )),
  source_question_number int,
  question_id uuid references public.questions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index draft_questions_import_idx on public.draft_questions (pdf_import_id);
create index draft_questions_status_idx on public.draft_questions (status);

create trigger draft_questions_set_updated_at
before update on public.draft_questions
for each row execute function public.set_updated_at();

create table public.draft_question_choices (
  id uuid primary key default gen_random_uuid(),
  draft_question_id uuid not null references public.draft_questions (id) on delete cascade,
  label text,
  text text not null,
  position smallint not null,
  created_at timestamptz not null default now(),
  unique (draft_question_id, label)
);

create index draft_question_choices_draft_idx on public.draft_question_choices (draft_question_id);

create table public.draft_answer_keys (
  id uuid primary key default gen_random_uuid(),
  draft_question_id uuid not null references public.draft_questions (id) on delete cascade,
  detected_answer text not null,
  confidence numeric(3, 2),
  source_text text,
  source_page int,
  status text not null default 'suggested' check (status in ('suggested', 'approved', 'rejected', 'manually_entered')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger draft_answer_keys_set_updated_at
before update on public.draft_answer_keys
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- question_sources (traceability back to PDF)
-- ----------------------------------------------------------------------------
create table public.question_sources (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  pdf_import_id uuid references public.pdf_imports (id) on delete set null,
  page_number int,
  raw_text text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- audit_logs
-- ----------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index audit_logs_actor_idx on public.audit_logs (actor_id);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

-- =============================================================================
-- GRANTS (tables created after Supabase's init grants need explicit grants)
-- =============================================================================
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.student_profiles enable row level security;
alter table public.passages enable row level security;
alter table public.questions enable row level security;
alter table public.question_choices enable row level security;
alter table public.tests enable row level security;
alter table public.test_sections enable row level security;
alter table public.test_modules enable row level security;
alter table public.test_module_questions enable row level security;
alter table public.test_assignments enable row level security;
alter table public.attempts enable row level security;
alter table public.attempt_modules enable row level security;
alter table public.attempt_responses enable row level security;
alter table public.attempt_events enable row level security;
alter table public.scores enable row level security;
alter table public.topic_performance enable row level security;
alter table public.pdf_imports enable row level security;
alter table public.pdf_import_pages enable row level security;
alter table public.draft_questions enable row level security;
alter table public.draft_question_choices enable row level security;
alter table public.draft_answer_keys enable row level security;
alter table public.question_sources enable row level security;
alter table public.audit_logs enable row level security;

-- profiles -------------------------------------------------------------------
create policy "profiles_select_own_or_admin"
on public.profiles for select
using (auth.uid() = id or public.is_admin());

create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (
  auth.uid() = id
  and role = (select role from public.profiles where id = auth.uid())
);

-- student_profiles ------------------------------------------------------------
create policy "student_profiles_select_own_or_admin"
on public.student_profiles for select
using (auth.uid() = id or public.is_admin());

create policy "student_profiles_insert_admin"
on public.student_profiles for insert
with check (public.is_admin());

create policy "student_profiles_update_admin"
on public.student_profiles for update
using (public.is_admin())
with check (public.is_admin());

-- passages --------------------------------------------------------------------
create policy "passages_admin_all"
on public.passages for all
using (public.is_admin())
with check (public.is_admin());

create policy "passages_students_read_published"
on public.passages for select
using (
  exists (
    select 1 from public.questions q
    join public.test_module_questions tmq on tmq.question_id = q.id
    join public.test_modules tm on tm.id = tmq.module_id
    join public.test_sections ts on ts.id = tm.section_id
    join public.tests t on t.id = ts.test_id
    where q.passage_id = passages.id and t.status = 'published'
  )
);

-- questions -------------------------------------------------------------------
create policy "questions_admin_all"
on public.questions for all
using (public.is_admin())
with check (public.is_admin());

create policy "questions_students_read_published"
on public.questions for select
using (
  exists (
    select 1 from public.test_module_questions tmq
    join public.test_modules tm on tm.id = tmq.module_id
    join public.test_sections ts on ts.id = tm.section_id
    join public.tests t on t.id = ts.test_id
    where tmq.question_id = questions.id and t.status = 'published'
  )
);

-- question_choices -------------------------------------------------------------
create policy "question_choices_admin_all"
on public.question_choices for all
using (public.is_admin())
with check (public.is_admin());

create policy "question_choices_students_read_published"
on public.question_choices for select
using (
  exists (
    select 1 from public.test_module_questions tmq
    join public.test_modules tm on tm.id = tmq.module_id
    join public.test_sections ts on ts.id = tm.section_id
    join public.tests t on t.id = ts.test_id
    where tmq.question_id = question_choices.question_id and t.status = 'published'
  )
);

-- tests ------------------------------------------------------------------------
create policy "tests_admin_all"
on public.tests for all
using (public.is_admin())
with check (public.is_admin());

create policy "tests_students_read_published_or_assigned"
on public.tests for select
using (
  status = 'published'
  or exists (
    select 1 from public.test_assignments ta
    where ta.test_id = tests.id and ta.student_id = auth.uid()
  )
);

-- test_sections ----------------------------------------------------------------
create policy "test_sections_admin_all"
on public.test_sections for all
using (public.is_admin())
with check (public.is_admin());

create policy "test_sections_students_read_published"
on public.test_sections for select
using (
  exists (
    select 1 from public.tests t
    where t.id = test_sections.test_id and t.status = 'published'
  )
);

-- test_modules -----------------------------------------------------------------
create policy "test_modules_admin_all"
on public.test_modules for all
using (public.is_admin())
with check (public.is_admin());

create policy "test_modules_students_read_published"
on public.test_modules for select
using (
  exists (
    select 1 from public.test_sections ts
    join public.tests t on t.id = ts.test_id
    where ts.id = test_modules.section_id and t.status = 'published'
  )
);

-- test_module_questions ---------------------------------------------------------
create policy "test_module_questions_admin_all"
on public.test_module_questions for all
using (public.is_admin())
with check (public.is_admin());

create policy "test_module_questions_students_read_published"
on public.test_module_questions for select
using (
  exists (
    select 1 from public.test_modules tm
    join public.test_sections ts on ts.id = tm.section_id
    join public.tests t on t.id = ts.test_id
    where tm.id = test_module_questions.module_id and t.status = 'published'
  )
);

-- test_assignments --------------------------------------------------------------
create policy "test_assignments_admin_all"
on public.test_assignments for all
using (public.is_admin())
with check (public.is_admin());

create policy "test_assignments_students_select_own"
on public.test_assignments for select
using (student_id = auth.uid());

-- attempts ----------------------------------------------------------------------
create policy "attempts_admin_all"
on public.attempts for all
using (public.is_admin())
with check (public.is_admin());

create policy "attempts_students_select_own"
on public.attempts for select
using (student_id = auth.uid());

create policy "attempts_students_insert_own"
on public.attempts for insert
with check (student_id = auth.uid());

create policy "attempts_students_update_own"
on public.attempts for update
using (student_id = auth.uid())
with check (student_id = auth.uid());

-- attempt_modules ----------------------------------------------------------------
create policy "attempt_modules_admin_all"
on public.attempt_modules for all
using (public.is_admin())
with check (public.is_admin());

create policy "attempt_modules_students_own"
on public.attempt_modules for all
using (
  exists (
    select 1 from public.attempts a
    where a.id = attempt_modules.attempt_id and a.student_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.attempts a
    where a.id = attempt_modules.attempt_id and a.student_id = auth.uid()
  )
);

-- attempt_responses --------------------------------------------------------------
create policy "attempt_responses_admin_all"
on public.attempt_responses for all
using (public.is_admin())
with check (public.is_admin());

create policy "attempt_responses_students_own"
on public.attempt_responses for all
using (
  exists (
    select 1 from public.attempts a
    where a.id = attempt_responses.attempt_id and a.student_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.attempts a
    where a.id = attempt_responses.attempt_id and a.student_id = auth.uid()
  )
);

-- attempt_events ------------------------------------------------------------------
create policy "attempt_events_admin_all"
on public.attempt_events for all
using (public.is_admin())
with check (public.is_admin());

create policy "attempt_events_students_own"
on public.attempt_events for all
using (
  exists (
    select 1 from public.attempts a
    where a.id = attempt_events.attempt_id and a.student_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.attempts a
    where a.id = attempt_events.attempt_id and a.student_id = auth.uid()
  )
);

-- scores --------------------------------------------------------------------------
create policy "scores_admin_all"
on public.scores for all
using (public.is_admin())
with check (public.is_admin());

create policy "scores_students_select_own"
on public.scores for select
using (
  exists (
    select 1 from public.attempts a
    where a.id = scores.attempt_id and a.student_id = auth.uid()
  )
);

-- topic_performance ---------------------------------------------------------------
create policy "topic_performance_admin_all"
on public.topic_performance for all
using (public.is_admin())
with check (public.is_admin());

create policy "topic_performance_students_select_own"
on public.topic_performance for select
using (student_id = auth.uid());

-- pdf_imports ----------------------------------------------------------------------
create policy "pdf_imports_admin_all"
on public.pdf_imports for all
using (public.is_admin())
with check (public.is_admin());

-- pdf_import_pages -----------------------------------------------------------------
create policy "pdf_import_pages_admin_all"
on public.pdf_import_pages for all
using (public.is_admin())
with check (public.is_admin());

-- draft_questions ------------------------------------------------------------------
create policy "draft_questions_admin_all"
on public.draft_questions for all
using (public.is_admin())
with check (public.is_admin());

-- draft_question_choices -----------------------------------------------------------
create policy "draft_question_choices_admin_all"
on public.draft_question_choices for all
using (public.is_admin())
with check (public.is_admin());

-- draft_answer_keys ----------------------------------------------------------------
create policy "draft_answer_keys_admin_all"
on public.draft_answer_keys for all
using (public.is_admin())
with check (public.is_admin());

-- question_sources -----------------------------------------------------------------
create policy "question_sources_admin_all"
on public.question_sources for all
using (public.is_admin())
with check (public.is_admin());

-- audit_logs ------------------------------------------------------------------------
create policy "audit_logs_admin_all"
on public.audit_logs for all
using (public.is_admin())
with check (public.is_admin());