-- =============================================================================
-- Admin-managed vocabulary decks.
--
-- vocab_decks: allow admin-owned decks (student_id NULL means admin-managed).
-- vocab_cards: unchanged shape; cards belong to a deck regardless of owner.
-- vocab_deck_assignments: links an admin deck to the students it is assigned to.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- vocab_decks
-- ----------------------------------------------------------------------------
alter table public.vocab_decks
  alter column student_id drop not null;

alter table public.vocab_decks
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

alter table public.vocab_decks
  add column if not exists status text not null default 'active' check (status in ('active', 'archived'));

create index if not exists vocab_decks_status_idx on public.vocab_decks (status);

-- ----------------------------------------------------------------------------
-- vocab_deck_assignments
-- ----------------------------------------------------------------------------
create table if not exists public.vocab_deck_assignments (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.vocab_decks (id) on delete cascade,
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique (deck_id, student_id)
);

create index if not exists vocab_deck_assignments_student_idx on public.vocab_deck_assignments (student_id);
create index if not exists vocab_deck_assignments_deck_idx on public.vocab_deck_assignments (deck_id);

-- ----------------------------------------------------------------------------
-- grants
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.vocab_deck_assignments enable row level security;

create policy "vocab_deck_assignments_admin_all"
on public.vocab_deck_assignments for all
using (public.is_admin())
with check (public.is_admin());

create policy "vocab_deck_assignments_select_own"
on public.vocab_deck_assignments for select
using (auth.uid() = student_id);

-- Students may manage only decks they own directly.
drop policy if exists "vocab_decks_own" on public.vocab_decks;
create policy "vocab_decks_own"
on public.vocab_decks for all
using (auth.uid() = student_id)
with check (auth.uid() = student_id);

-- Students may read (not edit) admin decks assigned to them.
create policy "vocab_decks_select_assigned"
on public.vocab_decks for select
using (
  exists (
    select 1 from public.vocab_deck_assignments a
    where a.deck_id = vocab_decks.id and a.student_id = auth.uid()
  )
);

drop policy if exists "vocab_cards_own" on public.vocab_cards;
create policy "vocab_cards_own"
on public.vocab_cards for all
using (
  exists (
    select 1 from public.vocab_decks d
    where d.id = vocab_cards.deck_id and d.student_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.vocab_decks d
    where d.id = vocab_cards.deck_id and d.student_id = auth.uid()
  )
);

-- Students may read cards of assigned admin decks (never edit them).
create policy "vocab_cards_select_assigned"
on public.vocab_cards for select
using (
  exists (
    select 1 from public.vocab_decks d
    join public.vocab_deck_assignments a on a.deck_id = d.id
    where d.id = vocab_cards.deck_id and a.student_id = auth.uid()
  )
);