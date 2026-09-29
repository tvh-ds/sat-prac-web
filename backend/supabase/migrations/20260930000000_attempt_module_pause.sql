alter table public.attempt_modules
  add column if not exists remaining_seconds integer
  check (remaining_seconds is null or remaining_seconds >= 0);

create or replace function public.pause_current_student_attempt(
  p_attempt_id uuid,
  p_student_id uuid
)
returns table (
  ok boolean,
  module_id uuid,
  seconds_left integer,
  error_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.attempts%rowtype;
  v_module public.attempt_modules%rowtype;
  v_limit_seconds integer;
  v_elapsed numeric;
  v_remaining integer;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_attempt
  from public.attempts
  where id = p_attempt_id and student_id = p_student_id
  for update;

  if not found then
    return query select false, null::uuid, null::integer, 'not_found'::text;
    return;
  end if;

  if v_attempt.status <> 'in_progress' or v_attempt.current_module_id is null then
    return query select false, v_attempt.current_module_id, null::integer, 'not_in_progress'::text;
    return;
  end if;

  select am.*
  into v_module
  from public.attempt_modules am
  where am.attempt_id = v_attempt.id
    and am.module_id = v_attempt.current_module_id
  for update of am;

  if not found or v_module.status <> 'in_progress' then
    return query select false, v_attempt.current_module_id, null::integer, 'module_not_in_progress'::text;
    return;
  end if;

  select greatest(0, tm.time_limit_minutes * 60)
  into v_limit_seconds
  from public.test_modules tm
  where tm.id = v_module.module_id;

  if v_module.started_at is null then
    v_remaining := coalesce(v_module.remaining_seconds, v_limit_seconds);
    return query select true, v_module.module_id, v_remaining, null::text;
    return;
  end if;

  v_elapsed := greatest(0, extract(epoch from (v_now - v_module.started_at)));
  v_remaining := greatest(
    0,
    ceil(coalesce(v_module.remaining_seconds, v_limit_seconds)::numeric - v_elapsed)::integer
  );

  update public.attempt_modules
  set remaining_seconds = v_remaining,
      started_at = null,
      time_spent_seconds = time_spent_seconds + floor(v_elapsed)::integer
  where id = v_module.id;

  return query select true, v_module.module_id, v_remaining, null::text;
end;
$$;

revoke all on function public.pause_current_student_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pause_current_student_attempt(uuid, uuid) to service_role;
