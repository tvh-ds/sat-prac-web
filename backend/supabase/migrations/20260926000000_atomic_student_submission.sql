-- Finalize a student submission atomically. Scoring stays in the authenticated
-- Edge Function; this service-role-only RPC applies its validated result in a
-- single transaction and makes retries safe.
create or replace function public.finalize_student_attempt(
  p_attempt_id uuid,
  p_student_id uuid,
  p_raw_score numeric,
  p_total_questions integer,
  p_section_scores jsonb,
  p_module_scores jsonb,
  p_topic_performance jsonb,
  p_corrections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.attempts%rowtype;
  v_score public.scores%rowtype;
  v_correction_count integer;
  v_updated_count integer;
  v_total_points numeric := 0;
  v_accuracy numeric := 0;
begin
  if p_attempt_id is null or p_student_id is null
     or p_raw_score is null or p_raw_score < 0
     or p_total_questions is null or p_total_questions < 0
     or coalesce(jsonb_typeof(p_section_scores), '') <> 'object'
     or coalesce(jsonb_typeof(p_module_scores), '') <> 'object'
     or coalesce(jsonb_typeof(p_topic_performance), '') <> 'array'
     or coalesce(jsonb_typeof(p_corrections), '') <> 'array'
     or jsonb_array_length(p_corrections) > 500 then
    raise exception 'Invalid submission payload' using errcode = '22023';
  end if;

  -- Serialize concurrent submissions for this attempt before checking status.
  select * into v_attempt
  from public.attempts
  where id = p_attempt_id and student_id = p_student_id
  for update;
  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if v_attempt.status = 'graded' then
    select * into v_score
    from public.scores
    where attempt_id = p_attempt_id;
    if not found then
      raise exception 'Graded attempt has no score' using errcode = '23514';
    end if;
    select coalesce(sum(nullif(entry.value->>'total', '')::numeric), 0)
      into v_total_points
    from jsonb_each(v_score.section_scores) as entry;
    return jsonb_build_object(
      'already_finalized', true,
      'raw_score', v_score.raw_score,
      'total_questions', v_score.total_questions,
      'total_points', v_total_points
    );
  end if;

  if v_attempt.status <> 'in_progress' then
    raise exception 'Attempt is not in progress' using errcode = '55000';
  end if;

  select count(*)::integer, count(distinct correction.question_id)::integer
    into v_correction_count, v_updated_count
  from jsonb_to_recordset(p_corrections)
       as correction(question_id uuid, is_correct boolean);
  if v_correction_count <> v_updated_count then
    raise exception 'Duplicate question corrections' using errcode = '22023';
  end if;

  update public.attempt_responses response
  set is_correct = correction.is_correct
  from jsonb_to_recordset(p_corrections)
       as correction(question_id uuid, is_correct boolean)
  where response.attempt_id = p_attempt_id
    and response.question_id = correction.question_id
    and correction.is_correct is not null;
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> v_correction_count then
    raise exception 'A response correction did not match this attempt' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_topic_performance)
         as topic(domain text, skill text, total integer, correct integer)
    where nullif(btrim(topic.domain), '') is null
       or topic.total is null or topic.total < 0
       or topic.correct is null or topic.correct < 0 or topic.correct > topic.total
  ) then
    raise exception 'Invalid topic totals' using errcode = '22023';
  end if;
  if (
    select count(*) <> count(distinct (topic.domain, coalesce(topic.skill, '')))
    from jsonb_to_recordset(p_topic_performance)
         as topic(domain text, skill text, total integer, correct integer)
  ) then
    raise exception 'Duplicate topic totals' using errcode = '22023';
  end if;

  select coalesce(sum(nullif(entry.value->>'total', '')::numeric), 0)
    into v_total_points
  from jsonb_each(p_section_scores) as entry;
  if v_total_points > 0 then
    v_accuracy := round((p_raw_score / v_total_points * 100)::numeric, 1);
  end if;

  insert into public.scores(
    attempt_id, raw_score, total_questions, section_scores,
    module_scores, topic_performance
  ) values (
    p_attempt_id, p_raw_score, p_total_questions, p_section_scores,
    p_module_scores, p_topic_performance
  );

  update public.attempts
  set status = 'graded', submitted_at = now()
  where id = p_attempt_id and student_id = p_student_id;

  if v_attempt.assignment_id is not null then
    update public.test_assignments
    set status = 'completed'
    where id = v_attempt.assignment_id
      and student_id = p_student_id
      and test_id = v_attempt.test_id;
    if not found then
      raise exception 'Attempt assignment not found' using errcode = '23503';
    end if;
  end if;

  insert into public.topic_performance(student_id, domain, skill, attempted, correct)
  select p_student_id, topic.domain, topic.skill, topic.total, topic.correct
  from jsonb_to_recordset(p_topic_performance)
       as topic(domain text, skill text, total integer, correct integer)
  where topic.total > 0
  on conflict (student_id, domain, (coalesce(skill, ''::text)))
  do update set
    attempted = public.topic_performance.attempted + excluded.attempted,
    correct = public.topic_performance.correct + excluded.correct,
    updated_at = now();

  insert into public.attempt_events(attempt_id, event_type, payload)
  values (
    p_attempt_id,
    'attempt.submitted',
    jsonb_build_object(
      'raw_score', p_raw_score,
      'total', p_total_questions,
      'accuracy', v_accuracy
    )
  );

  return jsonb_build_object(
    'already_finalized', false,
    'raw_score', p_raw_score,
    'total_questions', p_total_questions,
    'total_points', v_total_points
  );
end;
$$;

revoke all on function public.finalize_student_attempt(uuid, uuid, numeric, integer, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_student_attempt(uuid, uuid, numeric, integer, jsonb, jsonb, jsonb, jsonb)
  to service_role;

-- Keep vocabulary review scheduling, history, and daily totals consistent in
-- one transaction; serialize repeat reviews of the same student's card.
create or replace function public.record_student_vocab_review(
  p_student_id uuid,
  p_card_id uuid,
  p_rating integer,
  p_mode text,
  p_response_ms integer,
  p_reviewed_on date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deck public.vocab_decks%rowtype;
  v_ease numeric(4, 2) := 2.5;
  v_interval integer := 0;
  v_repetitions integer := 0;
  v_lapses integer := 0;
  v_status text;
  v_due_at timestamptz;
  v_next_state jsonb := null;
begin
  if p_student_id is null or p_card_id is null
     or p_rating is null or p_rating < 1 or p_rating > 4
     or coalesce(p_mode, '') not in ('study', 'sprint')
     or p_reviewed_on is null
     or (p_response_ms is not null and p_response_ms < 0) then
    raise exception 'Invalid vocabulary review payload' using errcode = '22023';
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

  if p_mode = 'study' then
    insert into public.vocab_card_state(student_id, card_id)
    values (p_student_id, p_card_id)
    on conflict (student_id, card_id) do nothing;

    select state.ease_factor, state.interval_days, state.repetitions, state.lapses
      into v_ease, v_interval, v_repetitions, v_lapses
    from public.vocab_card_state state
    where state.student_id = p_student_id and state.card_id = p_card_id
    for update;

    -- Preserve the application's existing Anki-style SM-2 button semantics.
    if p_rating = 1 then
      v_repetitions := 0;
      v_interval := 0;
      v_lapses := v_lapses + 1;
      v_ease := greatest(1.3, v_ease - 0.2);
    elsif p_rating = 2 then
      v_repetitions := v_repetitions + 1;
      v_interval := case when v_repetitions = 1 then 1 else greatest(1, ceil(v_interval * 1.2)::integer) end;
      v_ease := greatest(1.3, v_ease - 0.15);
    elsif p_rating = 3 then
      v_repetitions := v_repetitions + 1;
      v_interval := case
        when v_repetitions = 1 then 1
        when v_repetitions = 2 then 6
        else ceil(v_interval * v_ease)::integer
      end;
    else
      v_repetitions := v_repetitions + 1;
      v_interval := case
        when v_repetitions = 1 then 1
        when v_repetitions = 2 then 7
        else ceil(v_interval * v_ease * 1.3)::integer
      end;
      v_ease := least(3.0, v_ease + 0.15);
    end if;

    v_ease := round(v_ease, 2);
    v_status := case when v_lapses >= 4 then 'leech' when v_interval <= 1 then 'learning' else 'review' end;
    v_due_at := clock_timestamp() + make_interval(days => v_interval);

    update public.vocab_card_state
    set ease_factor = v_ease,
        interval_days = v_interval,
        repetitions = v_repetitions,
        lapses = v_lapses,
        status = v_status,
        due_at = v_due_at,
        last_reviewed_at = clock_timestamp()
    where student_id = p_student_id and card_id = p_card_id;

    v_next_state := jsonb_build_object(
      'ease_factor', v_ease,
      'interval_days', v_interval,
      'repetitions', v_repetitions,
      'lapses', v_lapses,
      'status', v_status,
      'due_at', v_due_at
    );
  end if;

  insert into public.vocab_reviews(student_id, card_id, rating, mode, response_ms, reviewed_on)
  values (p_student_id, p_card_id, p_rating, p_mode, p_response_ms, p_reviewed_on);

  insert into public.vocab_daily_activity(student_id, activity_date, cards_reviewed, cards_correct)
  values (p_student_id, p_reviewed_on, 1, case when p_rating >= 3 then 1 else 0 end)
  on conflict (student_id, activity_date)
  do update set
    cards_reviewed = public.vocab_daily_activity.cards_reviewed + 1,
    cards_correct = public.vocab_daily_activity.cards_correct + excluded.cards_correct,
    updated_at = now();

  return v_next_state;
end;
$$;

revoke all on function public.record_student_vocab_review(uuid, uuid, integer, text, integer, date)
  from public, anon, authenticated;
grant execute on function public.record_student_vocab_review(uuid, uuid, integer, text, integer, date)
  to service_role;
