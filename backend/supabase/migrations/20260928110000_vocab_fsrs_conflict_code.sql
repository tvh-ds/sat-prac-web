-- The database uses a retryable SQLSTATE only for transaction serialization.
-- Return an application error for stale client state to avoid infrastructure retries.
do $migration$
declare
  v_definition text;
  v_updated text;
  v_old text := $$using errcode = '40001'$$;
  v_new text := $$using errcode = 'P0001'$$;
begin
  select pg_get_functiondef(
    'public.record_student_vocab_review_fsrs(uuid, uuid, integer, text, integer, date, uuid, bigint, smallint, jsonb, jsonb, numeric)'::regprocedure
  ) into v_definition;
  if v_definition is null then raise exception 'FSRS review function is missing'; end if;
  if length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) then
    raise exception 'Expected exactly one retryable stale-state error in FSRS review function';
  end if;
  v_updated := replace(v_definition, v_old, v_new);
  execute v_updated;
end;
$migration$;
