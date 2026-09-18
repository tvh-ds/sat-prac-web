-- =============================================================================
-- Student vocabulary: decks, cards, spaced-repetition state, review log,
-- daily activity (for GitHub-style streaks / heatmap). Student-owned data.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- vocab_decks
-- ----------------------------------------------------------------------------
create table public.vocab_decks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  name text not null,
  description text,
  color text not null default '#7f1d1d',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vocab_decks_student_idx on public.vocab_decks (student_id);

create trigger vocab_decks_set_updated_at
before update on public.vocab_decks
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- vocab_cards
-- ----------------------------------------------------------------------------
create table public.vocab_cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.vocab_decks (id) on delete cascade,
  word text not null,
  definition text not null,
  example_sentence text,
  part_of_speech text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vocab_cards_deck_idx on public.vocab_cards (deck_id);

create unique index vocab_cards_word_deck_unique
on public.vocab_cards (deck_id, lower(word));

create trigger vocab_cards_set_updated_at
before update on public.vocab_cards
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- vocab_card_state (SM-2 style per-student schedule)
-- ----------------------------------------------------------------------------
create table public.vocab_card_state (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  card_id uuid not null references public.vocab_cards (id) on delete cascade,
  ease_factor numeric(4, 2) not null default 2.5,
  interval_days int not null default 0,
  repetitions int not null default 0,
  lapses int not null default 0,
  status text not null default 'new' check (status in ('new', 'learning', 'review', 'leech')),
  due_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (student_id, card_id)
);

create index vocab_card_state_due_idx on public.vocab_card_state (student_id, due_at);

create trigger vocab_card_state_set_updated_at
before update on public.vocab_card_state
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- vocab_reviews (history log)
-- ----------------------------------------------------------------------------
create table public.vocab_reviews (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  card_id uuid not null references public.vocab_cards (id) on delete cascade,
  rating smallint not null check (rating between 1 and 4),
  mode text not null check (mode in ('study', 'sprint')),
  response_ms int,
  reviewed_on date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);

create index vocab_reviews_student_date_idx on public.vocab_reviews (student_id, reviewed_on);

-- ----------------------------------------------------------------------------
-- vocab_daily_activity (streaks / heatmap)
-- ----------------------------------------------------------------------------
create table public.vocab_daily_activity (
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  activity_date date not null,
  cards_reviewed int not null default 0,
  cards_correct int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (student_id, activity_date)
);

-- ----------------------------------------------------------------------------
-- GRANTS (tables created after the init migration's blanket grant)
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.vocab_decks enable row level security;
alter table public.vocab_cards enable row level security;
alter table public.vocab_card_state enable row level security;
alter table public.vocab_reviews enable row level security;
alter table public.vocab_daily_activity enable row level security;

create policy "vocab_decks_admin_all"
on public.vocab_decks for all
using (public.is_admin())
with check (public.is_admin());

create policy "vocab_decks_own"
on public.vocab_decks for all
using (auth.uid() = student_id)
with check (auth.uid() = student_id);

create policy "vocab_cards_admin_all"
on public.vocab_cards for all
using (public.is_admin())
with check (public.is_admin());

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

create policy "vocab_card_state_admin_all"
on public.vocab_card_state for all
using (public.is_admin())
with check (public.is_admin());

create policy "vocab_card_state_own"
on public.vocab_card_state for all
using (auth.uid() = student_id)
with check (auth.uid() = student_id);

create policy "vocab_reviews_admin_all"
on public.vocab_reviews for all
using (public.is_admin())
with check (public.is_admin());

create policy "vocab_reviews_own"
on public.vocab_reviews for all
using (auth.uid() = student_id)
with check (auth.uid() = student_id);

create policy "vocab_daily_activity_admin_all"
on public.vocab_daily_activity for all
using (public.is_admin())
with check (public.is_admin());

create policy "vocab_daily_activity_own"
on public.vocab_daily_activity for all
using (auth.uid() = student_id)
with check (auth.uid() = student_id);
