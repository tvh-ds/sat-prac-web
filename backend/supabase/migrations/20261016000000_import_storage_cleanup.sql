create or replace function public.invalidate_ai_ingestion_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only the service-only cleanup RPC sets this transaction-local flag.
  if auth.role() = 'service_role'
     and current_setting('sat.import_storage_cleanup', true) = old.pdf_import_id::text
     and exists (select 1 from public.pdf_imports i where i.id = old.pdf_import_id and i.generated_test_id is not null) then
    return new;
  end if;
  if old.prompt is distinct from new.prompt
     or old.passage_text is distinct from new.passage_text
     or old.section is distinct from new.section
     or old.question_type is distinct from new.question_type
     or old.suggested_answer is distinct from new.suggested_answer
     or old.page_number is distinct from new.page_number
     or old.source_question_number is distinct from new.source_question_number
     or old.source_module_name is distinct from new.source_module_name
     or old.parser_metadata is distinct from new.parser_metadata
     or old.has_visual_stimulus is distinct from new.has_visual_stimulus
     or old.stimulus_image_path is distinct from new.stimulus_image_path
     or old.stimulus_source_image_path is distinct from new.stimulus_source_image_path
     or old.stimulus_crop_rect is distinct from new.stimulus_crop_rect
     or old.stimulus_crop_status is distinct from new.stimulus_crop_status then
    new.review_state := 'review';
    new.review_route := 'individual_review';
    new.review_snapshot_hash := null;
    new.review_policy_version := null;
    new.review_job_id := null;
    new.review_risks := '[]'::jsonb;
    new.review_error_category := null;
    new.reviewed_at := null;
    update public.ai_ingestion_review_findings set status = 'superseded'
      where draft_question_id = old.id and status = 'open';
  end if;
  return new;
end; $$;

-- Source-page evidence is disposable only after the complete test is saved.
-- Keep each draft's active image and its approval/review history intact.
create or replace function public.release_import_source_images(p_import_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_import public.pdf_imports; v_previous text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  select * into v_import from public.pdf_imports where id = p_import_id for update;
  if not found or v_import.status <> 'completed' or v_import.generated_test_id is null then
    raise exception 'generated test required';
  end if;
  if exists (select 1 from public.ai_ingestion_review_jobs where pdf_import_id = p_import_id and status in ('queued', 'running')) then
    raise exception 'source review is still running';
  end if;
  v_previous := coalesce(current_setting('sat.import_storage_cleanup', true), '');
  perform set_config('sat.import_storage_cleanup', p_import_id::text, true);
  update public.draft_questions set
    stimulus_source_image_path = stimulus_image_path,
    review_source_image_path = null,
    stimulus_crop_rect = null
  where pdf_import_id = p_import_id;
  perform set_config('sat.import_storage_cleanup', v_previous, true);
end; $$;

revoke all on function public.release_import_source_images(uuid) from public, anon, authenticated;
grant execute on function public.release_import_source_images(uuid) to service_role;
