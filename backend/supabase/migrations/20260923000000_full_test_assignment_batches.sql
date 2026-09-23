-- =============================================================================
-- Full-length assignment batches.
--
-- Practice assignments already have explicit batch rows. Full-length tests now
-- get the same grouping so one Assign action appears as one row in Admin ->
-- Assignments, with per-student results and review.
-- =============================================================================

create table if not exists public.full_test_assignment_batches (
  id uuid primary key default gen_random_uuid(),
  source_test_id uuid not null references public.tests (id) on delete cascade,
  title text not null,
  content_scope text not null default 'full_test'
    check (content_scope in ('full_test', 'reading_writing', 'math', 'custom_modules')),
  module_ids uuid[] not null default '{}',
  due_at timestamptz,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists full_test_assignment_batches_source_idx
  on public.full_test_assignment_batches (source_test_id);

alter table public.full_test_assignment_batches enable row level security;

drop policy if exists "full_test_assignment_batches_admin_all"
  on public.full_test_assignment_batches;
create policy "full_test_assignment_batches_admin_all"
  on public.full_test_assignment_batches for all
  using (public.is_admin())
  with check (public.is_admin());

alter table public.test_assignments
  add column if not exists assignment_batch_id uuid
    references public.full_test_assignment_batches (id) on delete set null;

create index if not exists test_assignments_assignment_batch_idx
  on public.test_assignments (assignment_batch_id);
