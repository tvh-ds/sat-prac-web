-- Serialize import approval against concurrent draft edits. The Complete-state
-- check and approval update must observe the same locked set of questions.
create or replace function public.approve_complete_ingestion_import(
  p_import_id uuid,
  p_admin_id uuid
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_ineligible int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if not exists (
    select 1 from public.profiles where id = p_admin_id and role = 'admin'
  ) then
    raise exception 'admin required';
  end if;

  perform 1 from public.pdf_imports
    where id = p_import_id and deterministic_review_status = 'passed'
    for update;
  if not found then
    raise exception 'import is missing or deterministic review has not passed';
  end if;

  perform 1 from public.draft_questions
    where pdf_import_id = p_import_id
    for update;

  select count(*),
         count(*) filter (
           where review_state is distinct from 'complete'
              or status = 'rejected'
              or nullif(btrim(suggested_answer), '') is null
              or (coalesce(has_visual_stimulus, false) and stimulus_crop_status is distinct from 'confirmed')
         )
    into v_total, v_ineligible
  from public.draft_questions
  where pdf_import_id = p_import_id;

  if v_total = 0 then
    raise exception 'import has no questions';
  end if;
  if v_ineligible > 0 then
    raise exception 'all questions must be Complete with answers and confirmed visual crops';
  end if;

  update public.draft_questions
    set status = 'approved',
        human_review_mode = 'batch',
        human_reviewed_by = p_admin_id,
        human_reviewed_at = now()
  where pdf_import_id = p_import_id
    and status <> 'approved';

  update public.draft_answer_keys k
    set status = 'approved'
  from public.draft_questions d
  where d.pdf_import_id = p_import_id
    and k.draft_question_id = d.id
    and k.status = 'suggested';

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (
    p_admin_id,
    'pdf_import.approved',
    'pdf_import',
    p_import_id,
    jsonb_build_object('question_count', v_total)
  );

  return v_total;
end;
$$;

revoke all on function public.approve_complete_ingestion_import(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.approve_complete_ingestion_import(uuid, uuid)
  to service_role;
