-- The service-only release RPC verifies publication once before setting its
-- transaction-local scope. Avoid re-running the full publication graph for
-- every draft row in the same cleanup transaction.
create or replace function public.invalidate_ai_ingestion_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role()='service_role' and current_setting('sat.import_storage_cleanup',true)=old.pdf_import_id::text
    and exists(select 1 from public.pdf_imports p where p.id=old.pdf_import_id and p.status='completed') then return new; end if;
  if old.prompt is distinct from new.prompt or old.passage_text is distinct from new.passage_text
    or old.section is distinct from new.section or old.question_type is distinct from new.question_type
    or old.suggested_answer is distinct from new.suggested_answer or old.page_number is distinct from new.page_number
    or old.source_question_number is distinct from new.source_question_number or old.source_module_name is distinct from new.source_module_name
    or old.parser_metadata is distinct from new.parser_metadata or old.has_visual_stimulus is distinct from new.has_visual_stimulus
    or old.stimulus_image_path is distinct from new.stimulus_image_path or old.stimulus_source_image_path is distinct from new.stimulus_source_image_path
    or old.stimulus_crop_rect is distinct from new.stimulus_crop_rect or old.stimulus_crop_status is distinct from new.stimulus_crop_status then
    new.review_state:='review'; new.review_route:='individual_review'; new.review_snapshot_hash:=null;
    new.review_policy_version:=null; new.review_job_id:=null; new.review_risks:='[]'::jsonb;
    new.review_error_category:=null; new.reviewed_at:=null;
    update public.ai_ingestion_review_findings set status='superseded' where draft_question_id=old.id and status='open';
  end if;
  return new;
end; $$;
