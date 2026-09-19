-- =============================================================================
-- Repeat assignments: the same test can be assigned to the same student
-- multiple times. Each assignment is its own row with its own due date,
-- status, attempts, and scores.
--
-- test_assignments: drop unique (test_id, student_id), keep a plain lookup
-- index. Endpoints change from upsert to insert.
--
-- attempts: one active attempt is now scoped per assignment instead of per
-- test. Public (unassigned) attempts keep the old per-test rule.
-- =============================================================================

alter table public.test_assignments
  drop constraint if exists test_assignments_test_id_student_id_key;

create index if not exists test_assignments_test_student_idx
  on public.test_assignments (test_id, student_id);

drop index if exists public.attempts_one_active_per_test;

create unique index if not exists attempts_one_active_per_assignment
  on public.attempts (student_id, assignment_id)
  where status in ('in_progress', 'submitted') and assignment_id is not null;

create unique index if not exists attempts_one_active_public_per_test
  on public.attempts (student_id, test_id)
  where status in ('in_progress', 'submitted') and assignment_id is null;
