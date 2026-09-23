-- =============================================================================
-- Assigned practice sets: admin-only templates + immutable assignment batches.
--
-- Practice sets become an admin library (is_public = false). Assigning a set
-- clones its structure into a published, assigned-only snapshot test so later
-- template edits never change existing assignments. Each Assign action is one
-- batch row (unlimited repeats); one test_assignments row per student.
-- Explanations stay hidden from students until the batch is released.
-- =============================================================================

create table if not exists public.practice_assignment_batches (
  id uuid primary key default gen_random_uuid(),
  source_test_id uuid references public.tests (id) on delete set null,
  snapshot_test_id uuid not null references public.tests (id) on delete cascade,
  title text not null,
  timer_minutes int not null check (timer_minutes > 0),
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  explanations_released_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists practice_assignment_batches_source_idx
  on public.practice_assignment_batches (source_test_id);
create index if not exists practice_assignment_batches_snapshot_idx
  on public.practice_assignment_batches (snapshot_test_id);

alter table public.practice_assignment_batches enable row level security;

drop policy if exists "practice_assignment_batches_admin_all"
  on public.practice_assignment_batches;
create policy "practice_assignment_batches_admin_all"
  on public.practice_assignment_batches for all
  using (public.is_admin())
  with check (public.is_admin());

-- Practice templates are admin-only from here on: students only ever see
-- assignment snapshots (via their test_assignments rows).
update public.tests
  set is_public = false
  where kind = 'practice' and is_public = true;
