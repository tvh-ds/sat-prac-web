-- Import approval rechecks the editor's final module assignments under the
-- same import lock used to serialize draft edits.
create or replace function public.approve_complete_ingestion_import(
  p_import_id uuid, p_admin_id uuid
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_total int;
  v_ineligible int;
  v_full_test boolean;
  v_rw1 int;
  v_rw2 int;
  v_math1 int;
  v_math2 int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin') then
    raise exception 'admin required';
  end if;

  select coalesce(text_quality->>'document_family' = 'full_test', false)
    into v_full_test from public.pdf_imports
    where id = p_import_id and deterministic_review_status = 'passed' for update;
  if not found then raise exception 'import is missing or deterministic review has not passed'; end if;
  perform 1 from public.draft_questions where pdf_import_id = p_import_id for update;

  select count(*),
         count(*) filter (where review_state is distinct from 'complete'
           or status = 'rejected' or nullif(btrim(suggested_answer), '') is null
           or (coalesce(has_visual_stimulus, false) and stimulus_crop_status is distinct from 'confirmed')),
         count(*) filter (where assigned_module_name = 'Reading and Writing Module 1'),
         count(*) filter (where assigned_module_name = 'Reading and Writing Module 2'),
         count(*) filter (where assigned_module_name = 'Math Module 1'),
         count(*) filter (where assigned_module_name = 'Math Module 2')
    into v_total, v_ineligible, v_rw1, v_rw2, v_math1, v_math2
  from public.draft_questions where pdf_import_id = p_import_id;

  if v_total = 0 then raise exception 'import has no questions'; end if;
  if v_ineligible > 0 then
    raise exception 'all questions must be Complete with answers and confirmed visual crops';
  end if;
  if v_full_test and (v_total <> 98 or v_rw1 <> 27 or v_rw2 <> 27 or v_math1 <> 22 or v_math2 <> 22) then
    raise exception 'full-test assigned module counts must be 27/27/22/22';
  end if;

  update public.draft_questions set status = 'approved', human_review_mode = 'batch',
    human_reviewed_by = p_admin_id, human_reviewed_at = now()
  where pdf_import_id = p_import_id and status <> 'approved';

  update public.draft_answer_keys k set status = 'approved'
  from public.draft_questions d
  where d.pdf_import_id = p_import_id and k.draft_question_id = d.id and k.status = 'suggested';

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (p_admin_id, 'pdf_import.approved', 'pdf_import', p_import_id,
    jsonb_build_object('question_count', v_total));
  return v_total;
end; $$;

revoke all on function public.approve_complete_ingestion_import(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_complete_ingestion_import(uuid, uuid) to service_role;
