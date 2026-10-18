-- Delete one assignment action atomically without deleting its source template.
create function public.delete_assignment_batch(p_kind text, p_id uuid, p_admin_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_snapshot uuid; v_source uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_kind = 'practice' then
    select snapshot_test_id, source_test_id into v_snapshot, v_source
      from public.practice_assignment_batches where id = p_id for update;
    if not found then return false; end if;
    -- A snapshot must belong only to this batch and never be a source template.
    if v_snapshot = v_source
      or exists (select 1 from public.practice_assignment_batches where id <> p_id and snapshot_test_id = v_snapshot)
      or exists (select 1 from public.practice_assignment_batches where source_test_id = v_snapshot)
      or exists (select 1 from public.full_test_assignment_batches where source_test_id = v_snapshot) then
      raise exception 'Cannot delete a shared assignment snapshot';
    end if;
    delete from public.tests where id = v_snapshot;
    -- Foreign keys cascade through the snapshot, batch, assignments and attempts.
  elsif p_kind = 'full' then
    perform 1 from public.full_test_assignment_batches where id = p_id for update;
    if not found then return false; end if;
    delete from public.attempts where assignment_id in
      (select id from public.test_assignments where assignment_batch_id = p_id);
    delete from public.test_assignments where assignment_batch_id = p_id;
    delete from public.full_test_assignment_batches where id = p_id;
  else
    raise exception 'Invalid assignment kind' using errcode = '22023';
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (p_admin_id, 'assignment.deleted', 'assignment_batch', p_id, jsonb_build_object('kind', p_kind));
  return true;
end;
$$;
revoke all on function public.delete_assignment_batch(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_assignment_batch(text, uuid, uuid) to service_role;
