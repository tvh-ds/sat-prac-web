-- Harden the public API surface for production.
-- Student/admin mutations should go through Edge Functions or SECURITY DEFINER RPCs,
-- not direct PostgREST table writes from browser clients.

-- Remove direct table access to test content, attempts, scores, imports, and audit data.
-- Edge Functions use service_role and continue to bypass RLS for authorized operations.
revoke all on table
  public.passages,
  public.questions,
  public.question_choices,
  public.tests,
  public.test_sections,
  public.test_modules,
  public.test_module_questions,
  public.test_assignments,
  public.attempts,
  public.attempt_modules,
  public.attempt_responses,
  public.attempt_events,
  public.scores,
  public.topic_performance,
  public.pdf_imports,
  public.pdf_import_pages,
  public.draft_questions,
  public.draft_question_choices,
  public.draft_answer_keys,
  public.question_sources,
  public.audit_logs
from anon, authenticated;

-- Keep the minimal profile access needed by frontend auth guards and Edge Function role checks.
grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;
grant select on table public.student_profiles to authenticated;

-- Direct student writes to attempt internals are not safe. Keep read policies only for
-- diagnostic/direct-profile use; service_role-backed functions perform writes.
drop policy if exists "attempts_students_insert_own" on public.attempts;
drop policy if exists "attempts_students_update_own" on public.attempts;

drop policy if exists "attempt_modules_students_own" on public.attempt_modules;
create policy "attempt_modules_students_select_own"
on public.attempt_modules for select
using (
  exists (
    select 1 from public.attempts a
    where a.id = attempt_modules.attempt_id and a.student_id = auth.uid()
  )
);

drop policy if exists "attempt_responses_students_own" on public.attempt_responses;
create policy "attempt_responses_students_select_own"
on public.attempt_responses for select
using (
  exists (
    select 1 from public.attempts a
    where a.id = attempt_responses.attempt_id and a.student_id = auth.uid()
  )
);

drop policy if exists "attempt_events_students_own" on public.attempt_events;
create policy "attempt_events_students_select_own"
on public.attempt_events for select
using (
  exists (
    select 1 from public.attempts a
    where a.id = attempt_events.attempt_id and a.student_id = auth.uid()
  )
);

-- If direct read grants are ever reintroduced, preserve assignment/private-test boundaries.
drop policy if exists "passages_students_read_published" on public.passages;
create policy "passages_students_read_visible_tests"
on public.passages for select
using (
  exists (
    select 1 from public.questions q
    join public.test_module_questions tmq on tmq.question_id = q.id
    join public.test_modules tm on tm.id = tmq.module_id
    join public.test_sections ts on ts.id = tm.section_id
    join public.tests t on t.id = ts.test_id
    where q.passage_id = passages.id
      and t.status = 'published'
      and (
        t.is_public = true
        or exists (
          select 1 from public.test_assignments ta
          where ta.test_id = t.id and ta.student_id = auth.uid()
        )
      )
  )
);

drop policy if exists "questions_students_read_published" on public.questions;
create policy "questions_students_read_visible_tests"
on public.questions for select
using (
  exists (
    select 1 from public.test_module_questions tmq
    join public.test_modules tm on tm.id = tmq.module_id
    join public.test_sections ts on ts.id = tm.section_id
    join public.tests t on t.id = ts.test_id
    where tmq.question_id = questions.id
      and t.status = 'published'
      and (
        t.is_public = true
        or exists (
          select 1 from public.test_assignments ta
          where ta.test_id = t.id and ta.student_id = auth.uid()
        )
      )
  )
);

drop policy if exists "question_choices_students_read_published" on public.question_choices;
create policy "question_choices_students_read_visible_tests"
on public.question_choices for select
using (
  exists (
    select 1 from public.test_module_questions tmq
    join public.test_modules tm on tm.id = tmq.module_id
    join public.test_sections ts on ts.id = tm.section_id
    join public.tests t on t.id = ts.test_id
    where tmq.question_id = question_choices.question_id
      and t.status = 'published'
      and (
        t.is_public = true
        or exists (
          select 1 from public.test_assignments ta
          where ta.test_id = t.id and ta.student_id = auth.uid()
        )
      )
  )
);

drop policy if exists "tests_students_read_published_or_assigned" on public.tests;
create policy "tests_students_read_public_or_assigned"
on public.tests for select
using (
  status = 'published'
  and (
    is_public = true
    or exists (
      select 1 from public.test_assignments ta
      where ta.test_id = tests.id and ta.student_id = auth.uid()
    )
  )
);

drop policy if exists "test_sections_students_read_published" on public.test_sections;
create policy "test_sections_students_read_visible_tests"
on public.test_sections for select
using (
  exists (
    select 1 from public.tests t
    where t.id = test_sections.test_id
      and t.status = 'published'
      and (
        t.is_public = true
        or exists (
          select 1 from public.test_assignments ta
          where ta.test_id = t.id and ta.student_id = auth.uid()
        )
      )
  )
);

drop policy if exists "test_modules_students_read_published" on public.test_modules;
create policy "test_modules_students_read_visible_tests"
on public.test_modules for select
using (
  exists (
    select 1 from public.test_sections ts
    join public.tests t on t.id = ts.test_id
    where ts.id = test_modules.section_id
      and t.status = 'published'
      and (
        t.is_public = true
        or exists (
          select 1 from public.test_assignments ta
          where ta.test_id = t.id and ta.student_id = auth.uid()
        )
      )
  )
);

drop policy if exists "test_module_questions_students_read_published" on public.test_module_questions;
create policy "test_module_questions_students_read_visible_tests"
on public.test_module_questions for select
using (
  exists (
    select 1 from public.test_modules tm
    join public.test_sections ts on ts.id = tm.section_id
    join public.tests t on t.id = ts.test_id
    where tm.id = test_module_questions.module_id
      and t.status = 'published'
      and (
        t.is_public = true
        or exists (
          select 1 from public.test_assignments ta
          where ta.test_id = t.id and ta.student_id = auth.uid()
        )
      )
  )
);

-- Direct browser uploads to the private PDF bucket are admin-only.
drop policy if exists "pdf_imports_admin_insert" on storage.objects;
drop policy if exists "pdf_imports_admin_select" on storage.objects;
drop policy if exists "pdf_imports_admin_update" on storage.objects;
drop policy if exists "pdf_imports_admin_delete" on storage.objects;

create policy "pdf_imports_admin_insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'pdf-imports' and public.is_admin());

create policy "pdf_imports_admin_select"
on storage.objects for select to authenticated
using (bucket_id = 'pdf-imports' and public.is_admin());

create policy "pdf_imports_admin_update"
on storage.objects for update to authenticated
using (bucket_id = 'pdf-imports' and public.is_admin())
with check (bucket_id = 'pdf-imports' and public.is_admin());

create policy "pdf_imports_admin_delete"
on storage.objects for delete to authenticated
using (bucket_id = 'pdf-imports' and public.is_admin());

-- Postgres treats NULL values as distinct in a normal unique constraint. Topic
-- rows use nullable skill, so enforce uniqueness on coalesced skill values.
alter table public.topic_performance
drop constraint if exists topic_performance_student_id_domain_skill_key;

create unique index if not exists topic_performance_student_domain_skill_unique
on public.topic_performance (student_id, domain, coalesce(skill, ''));
