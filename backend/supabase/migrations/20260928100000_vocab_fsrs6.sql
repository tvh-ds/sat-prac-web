-- Migrate vocabulary scheduling from the legacy SM-2 fields to persisted FSRS-6 state.
alter table public.vocab_card_state
  add column fsrs_difficulty double precision,
  add column fsrs_stability double precision,
  add column fsrs_state text not null default 'new'
    check (fsrs_state in ('new', 'learning', 'review', 'relearning')),
  add column learning_steps integer not null default 0 check (learning_steps >= 0),
  add column scheduled_days integer not null default 0 check (scheduled_days >= 0),
  add column scheduler_version smallint not null default 0 check (scheduler_version >= 0),
  add column state_version bigint not null default 0 check (state_version >= 0),
  add column legacy_lapses integer not null default 0 check (legacy_lapses >= 0);

alter table public.vocab_reviews
  add column submission_id uuid,
  add column scheduler_version smallint,
  add column state_before jsonb,
  add column state_after jsonb,
  add column predicted_recall numeric(7, 6)
    check (predicted_recall is null or (predicted_recall >= 0 and predicted_recall <= 1));

create unique index vocab_reviews_student_submission_unique
  on public.vocab_reviews (student_id, submission_id)
  where submission_id is not null;

create index vocab_reviews_student_card_created_idx
  on public.vocab_reviews (student_id, card_id, created_at)
  where mode = 'study';

-- Keep the old schedule fields in this restricted snapshot so a rollout can be reverted.
create table public.vocab_schedule_migration_snapshots (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  card_id uuid not null references public.vocab_cards (id) on delete cascade,
  migration_version smallint not null,
  ease_factor numeric(4, 2) not null,
  interval_days integer not null,
  repetitions integer not null,
  lapses integer not null,
  status text not null,
  due_at timestamptz not null,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (student_id, card_id, migration_version)
);

alter table public.vocab_schedule_migration_snapshots enable row level security;
revoke all on public.vocab_schedule_migration_snapshots from anon, authenticated;
grant all on public.vocab_schedule_migration_snapshots to service_role;

create policy "vocab_schedule_snapshots_service_only"
  on public.vocab_schedule_migration_snapshots for all to service_role
  using (true) with check (true);

-- Calculate FSRS in the Edge Function, then persist the result transactionally.
-- Only service_role can call this function; it rechecks deck access and state version.
create or replace function public.record_student_vocab_review_fsrs(
  p_student_id uuid,
  p_card_id uuid,
  p_rating integer,
  p_mode text,
  p_response_ms integer,
  p_reviewed_on date,
  p_submission_id uuid,
  p_expected_version bigint,
  p_scheduler_version smallint,
  p_state_before jsonb,
  p_next_state jsonb,
  p_predicted_recall numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deck public.vocab_decks%rowtype;
  v_state public.vocab_card_state%rowtype;
  v_existing public.vocab_reviews%rowtype;
  v_next jsonb;
  v_legacy_lapses integer;
  v_status text;
begin
  if p_student_id is null or p_card_id is null
     or p_rating is null or p_rating < 1 or p_rating > 4
     or coalesce(p_mode, '') not in ('study', 'sprint')
     or p_reviewed_on is null or p_submission_id is null
     or (p_response_ms is not null and p_response_ms < 0)
     or (p_predicted_recall is not null and (p_predicted_recall < 0 or p_predicted_recall > 1)) then
    raise exception 'Invalid vocabulary review payload' using errcode = '22023';
  end if;

  if p_mode = 'study' then
    if p_expected_version is null or p_scheduler_version is distinct from 6
       or p_state_before is null or p_next_state is null or jsonb_typeof(p_next_state) <> 'object'
       or not (p_next_state ?& array[
         'due_at', 'stability', 'difficulty', 'learning_steps', 'scheduled_days',
         'repetitions', 'lapses', 'fsrs_state', 'last_reviewed_at'
       ])
       or p_next_state->>'last_reviewed_at' is null
       or p_next_state->>'fsrs_state' not in ('new', 'learning', 'review', 'relearning')
       or coalesce((p_next_state->>'stability')::double precision, 0) <= 0
       or coalesce((p_next_state->>'difficulty')::double precision, -1) < 0
       or coalesce((p_next_state->>'difficulty')::double precision, 11) > 10
       or coalesce((p_next_state->>'learning_steps')::integer, -1) < 0
       or coalesce((p_next_state->>'scheduled_days')::integer, -1) < 0
       or coalesce((p_next_state->>'repetitions')::integer, -1) < 0
       or coalesce((p_next_state->>'lapses')::integer, -1) < 0 then
      raise exception 'Invalid FSRS state' using errcode = '22023';
    end if;
  elsif p_next_state is not null or p_state_before is not null
        or p_expected_version is not null or p_scheduler_version is not null
        or p_predicted_recall is not null then
    raise exception 'Sprint reviews cannot change FSRS state' using errcode = '22023';
  end if;

  select deck.* into v_deck
  from public.vocab_cards card
  join public.vocab_decks deck on deck.id = card.deck_id
  where card.id = p_card_id
  for share of deck;
  if not found then
    raise exception 'Vocabulary card not found' using errcode = 'P0002';
  end if;

  if v_deck.student_id is distinct from p_student_id
     and (v_deck.status <> 'active' or not exists (
       select 1 from public.vocab_deck_assignments assignment
       where assignment.deck_id = v_deck.id and assignment.student_id = p_student_id
     )) then
    raise exception 'Vocabulary deck is not assigned to this student' using errcode = '42501';
  end if;

  select review.* into v_existing
  from public.vocab_reviews review
  where review.student_id = p_student_id and review.submission_id = p_submission_id;
  if found then
    if v_existing.card_id <> p_card_id or v_existing.rating <> p_rating or v_existing.mode <> p_mode then
      raise exception 'Submission identifier was already used' using errcode = '23505';
    end if;
    return jsonb_build_object('next_state', v_existing.state_after, 'replayed', true);
  end if;

  if p_mode = 'study' then
    insert into public.vocab_card_state(student_id, card_id)
    values (p_student_id, p_card_id)
    on conflict (student_id, card_id) do nothing;

    select state.* into v_state
    from public.vocab_card_state state
    where state.student_id = p_student_id and state.card_id = p_card_id
    for update;

    -- Recheck after locking: a concurrent retry may have committed while this call waited.
    select review.* into v_existing
    from public.vocab_reviews review
    where review.student_id = p_student_id and review.submission_id = p_submission_id;
    if found then
      if v_existing.card_id <> p_card_id or v_existing.rating <> p_rating or v_existing.mode <> p_mode then
        raise exception 'Submission identifier was already used' using errcode = '23505';
      end if;
      return jsonb_build_object('next_state', v_existing.state_after, 'replayed', true);
    end if;

    if v_state.state_version <> p_expected_version then
      raise exception 'Vocabulary schedule changed; reload the card and try again' using errcode = '40001';
    end if;

    v_legacy_lapses := v_state.legacy_lapses + case when p_rating = 1 then 1 else 0 end;
    v_status := case
      when v_legacy_lapses >= 4 then 'leech'
      when p_next_state->>'fsrs_state' in ('learning', 'relearning') then 'learning'
      else p_next_state->>'fsrs_state'
    end;
    v_next := p_next_state || jsonb_build_object(
      'state_version', v_state.state_version + 1,
      'legacy_lapses', v_legacy_lapses,
      'status', v_status,
      'scheduler_version', p_scheduler_version
    );

    update public.vocab_card_state
    set fsrs_difficulty = (p_next_state->>'difficulty')::double precision,
        fsrs_stability = (p_next_state->>'stability')::double precision,
        fsrs_state = p_next_state->>'fsrs_state',
        learning_steps = (p_next_state->>'learning_steps')::integer,
        scheduled_days = (p_next_state->>'scheduled_days')::integer,
        repetitions = (p_next_state->>'repetitions')::integer,
        lapses = (p_next_state->>'lapses')::integer,
        due_at = (p_next_state->>'due_at')::timestamptz,
        last_reviewed_at = nullif(p_next_state->>'last_reviewed_at', '')::timestamptz,
        status = v_status,
        legacy_lapses = v_legacy_lapses,
        scheduler_version = p_scheduler_version,
        state_version = v_state.state_version + 1
    where student_id = p_student_id and card_id = p_card_id;
  end if;

  insert into public.vocab_reviews(
    student_id, card_id, rating, mode, response_ms, reviewed_on,
    submission_id, scheduler_version, state_before, state_after, predicted_recall
  ) values (
    p_student_id, p_card_id, p_rating, p_mode, p_response_ms, p_reviewed_on,
    p_submission_id, p_scheduler_version, p_state_before, v_next, p_predicted_recall
  );

  insert into public.vocab_daily_activity(student_id, activity_date, cards_reviewed, cards_correct)
  values (p_student_id, p_reviewed_on, 1, case when p_rating >= 3 then 1 else 0 end)
  on conflict (student_id, activity_date)
  do update set
    cards_reviewed = public.vocab_daily_activity.cards_reviewed + 1,
    cards_correct = public.vocab_daily_activity.cards_correct + excluded.cards_correct,
    updated_at = now();

  return jsonb_build_object('next_state', v_next, 'replayed', false);
end;
$$;

revoke all on function public.record_student_vocab_review_fsrs(
  uuid, uuid, integer, text, integer, date, uuid, bigint, smallint, jsonb, jsonb, numeric
) from public, anon, authenticated;
grant execute on function public.record_student_vocab_review_fsrs(
  uuid, uuid, integer, text, integer, date, uuid, bigint, smallint, jsonb, jsonb, numeric
) to service_role;

-- Ensure no stale caller can keep using the retired SM-2 scheduling RPC.
revoke all on function public.record_student_vocab_review(uuid, uuid, integer, text, integer, date)
  from public, anon, authenticated, service_role;
