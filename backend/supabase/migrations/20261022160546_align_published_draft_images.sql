-- Keep the final published question image, including null when a visual was removed.
create or replace function public.release_import_source_images(p_import_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_import public.pdf_imports; v_previous text; v_state jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  select * into v_import from public.pdf_imports where id=p_import_id for update;
  if not found or v_import.status <> 'completed' then raise exception 'completed import required'; end if;
  v_state := public.published_import_cleanup_state(p_import_id);
  if not (v_state->>'eligible')::boolean then raise exception 'published questions required'; end if;
  if exists(select 1 from public.ai_ingestion_review_jobs where pdf_import_id=p_import_id and status in ('queued','running')) then raise exception 'source review is still running'; end if;
  v_previous := coalesce(current_setting('sat.import_storage_cleanup', true), '');
  perform set_config('sat.import_storage_cleanup', p_import_id::text, true);
  -- Legacy bank imports can mix published questions and unfinished drafts.
  -- Release only published drafts unless the entire generated test is published.
  with published_questions as (
    select distinct q.id,q.stimulus_image_path from public.questions q
    join public.test_module_questions l on l.question_id=q.id
    join public.test_modules m on m.id=l.module_id
    join public.test_sections s on s.id=m.section_id
    join public.tests t on t.id=s.test_id where t.status='published'
  ), targets as (
    select d.id, case when (v_state->>'whole_import')::boolean
      then (select q.stimulus_image_path from public.questions q where q.id=d.question_id)
      else (select q.stimulus_image_path from published_questions q where q.id=d.question_id or q.stimulus_image_path=d.stimulus_image_path order by (q.id=d.question_id) desc nulls last limit 1) end as final_path
    from public.draft_questions d where d.pdf_import_id=p_import_id
    and ((v_state->>'whole_import')::boolean or exists(select 1 from published_questions q where q.id=d.question_id or q.stimulus_image_path=d.stimulus_image_path))
  )
  update public.draft_questions d set stimulus_image_path=t.final_path,
    stimulus_source_image_path=t.final_path, review_source_image_path=null,
    stimulus_crop_rect=null from targets t where d.id=t.id;
  perform set_config('sat.import_storage_cleanup', v_previous, true);
end; $$;
