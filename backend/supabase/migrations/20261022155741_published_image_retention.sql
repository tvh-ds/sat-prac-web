-- Published questions must use final stimuli, never importer full-page evidence.
create or replace function public.is_import_source_image(p_path text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_path ~ '^imports/[^/]+/(review-sources/|stimuli/[^/]*-page-[0-9]+[.])', false);
$$;

-- Resolve provenance from both question metadata and storage paths. Legacy
-- imports and practice snapshots do not always have generated_test_id set.
create or replace function public.published_image_imports(p_test_id uuid)
returns table(import_id uuid) language sql stable security invoker set search_path = public as $$
  with linked as (
    select q.id, q.source_pdf_id, q.stimulus_image_path
    from public.questions q join public.test_module_questions l on l.question_id=q.id
    join public.test_modules m on m.id=l.module_id
    join public.test_sections s on s.id=m.section_id
    join public.tests t on t.id=s.test_id
    where t.id=p_test_id and t.status='published'
  )
  select p.id from public.pdf_imports p
  where p.generated_test_id=p_test_id and exists(select 1 from public.tests t where t.id=p_test_id and t.status='published')
     or exists(select 1 from linked q where q.source_pdf_id=p.id or q.stimulus_image_path like 'imports/' || p.id::text || '/%')
     or exists(select 1 from public.draft_questions d join linked q on d.question_id=q.id or d.stimulus_image_path=q.stimulus_image_path where d.pdf_import_id=p.id);
$$;
revoke all on function public.published_image_imports(uuid) from public, anon, authenticated;
grant execute on function public.published_image_imports(uuid) to service_role;

create or replace function public.published_import_cleanup_state(p_import_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'eligible', exists(select 1 from public.tests t cross join lateral public.published_image_imports(t.id) i where t.status='published' and i.import_id=p_import_id),
    'whole_import', exists(select 1 from public.pdf_imports p join public.tests t on t.id=p.generated_test_id where p.id=p_import_id and t.status='published')
  );
$$;
revoke all on function public.published_import_cleanup_state(uuid) from public, anon, authenticated;
grant execute on function public.published_import_cleanup_state(uuid) to service_role;

-- Replace temporary evidence with the actual question image. The existing
-- transaction-local flag preserves the completed human/AI review record.
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
      else d.stimulus_image_path end as final_path
    from public.draft_questions d where d.pdf_import_id=p_import_id
    and ((v_state->>'whole_import')::boolean or exists(select 1 from published_questions q where q.id=d.question_id or q.stimulus_image_path=d.stimulus_image_path))
  )
  update public.draft_questions d set stimulus_image_path=t.final_path,
    stimulus_source_image_path=t.final_path, review_source_image_path=null,
    stimulus_crop_rect=null from targets t where d.id=t.id;
  perform set_config('sat.import_storage_cleanup', v_previous, true);
end; $$;
revoke all on function public.release_import_source_images(uuid) from public, anon, authenticated;
grant execute on function public.release_import_source_images(uuid) to service_role;

-- Allow the service-only metadata release for legacy published bank imports
-- too; no generated_test_id is required when their questions are published.
create or replace function public.invalidate_ai_ingestion_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role()='service_role' and current_setting('sat.import_storage_cleanup',true)=old.pdf_import_id::text
    and (public.published_import_cleanup_state(old.pdf_import_id)->>'eligible')::boolean then return new; end if;
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

-- Database guards cover Publish, status PATCH, assignment activation, practice
-- snapshots, and later edits/links, even when a caller bypasses an Edge route.
create or replace function public.guard_published_question_images()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_test uuid; v_path text;
begin
  if tg_table_name='tests' then
    if new.status <> 'published' then return new; end if;
    v_test:=new.id;
    select q.stimulus_image_path into v_path from public.test_sections s
      join public.test_modules m on m.section_id=s.id join public.test_module_questions l on l.module_id=m.id
      join public.questions q on q.id=l.question_id where s.test_id=v_test and public.is_import_source_image(q.stimulus_image_path) limit 1;
  elsif tg_table_name='test_module_questions' then
    select s.test_id into v_test from public.test_modules m join public.test_sections s on s.id=m.section_id
      join public.tests t on t.id=s.test_id where m.id=new.module_id and t.status='published';
    if v_test is not null then select stimulus_image_path into v_path from public.questions where id=new.question_id; end if;
  else
    if public.is_import_source_image(new.stimulus_image_path) and exists(select 1 from public.test_module_questions l
      join public.test_modules m on m.id=l.module_id join public.test_sections s on s.id=m.section_id
      join public.tests t on t.id=s.test_id where l.question_id=new.id and t.status='published') then v_path:=new.stimulus_image_path; end if;
  end if;
  if public.is_import_source_image(v_path) then
    raise exception 'Crop the question image before publishing; full-page source images cannot be used in published questions' using errcode='23514';
  end if;
  return new;
end; $$;
create trigger guard_test_publication_images before insert or update of status on public.tests for each row execute function public.guard_published_question_images();
create trigger guard_published_image_links before insert or update of question_id,module_id on public.test_module_questions for each row execute function public.guard_published_question_images();
create trigger guard_published_image_edits before update of stimulus_image_path on public.questions for each row execute function public.guard_published_question_images();

-- Queue state is transactional with publication. The Edge route runs cleanup
-- immediately; the worker retries if storage is temporarily unavailable.
create or replace function public.queue_published_image_cleanup()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_test uuid;
begin
  if tg_table_name='tests' then
    if new.status <> 'published' then return new; end if; v_test:=new.id;
  elsif tg_table_name='questions' then
    for v_test in select distinct s.test_id from public.test_module_questions l
      join public.test_modules m on m.id=l.module_id join public.test_sections s on s.id=m.section_id
      join public.tests t on t.id=s.test_id where l.question_id=new.id and t.status='published'
    loop
      update public.pdf_imports p set text_quality=jsonb_set(coalesce(p.text_quality,'{}'::jsonb),'{storage_cleanup}',
        coalesce(p.text_quality->'storage_cleanup','{}'::jsonb) || '{"status":"pending","policy_version":2}'::jsonb)
        where p.status='completed' and p.id in (select import_id from public.published_image_imports(v_test));
    end loop;
    return new;
  else
    select s.test_id into v_test from public.test_modules m join public.test_sections s on s.id=m.section_id where m.id=new.module_id;
  end if;
  update public.pdf_imports p set text_quality=jsonb_set(coalesce(p.text_quality,'{}'::jsonb),'{storage_cleanup}',
    coalesce(p.text_quality->'storage_cleanup','{}'::jsonb) || '{"status":"pending","policy_version":2}'::jsonb)
    where p.status='completed' and p.id in (select import_id from public.published_image_imports(v_test));
  return new;
end; $$;
create trigger queue_test_publication_cleanup after insert or update of status on public.tests for each row execute function public.queue_published_image_cleanup();
create trigger queue_published_question_cleanup after insert or update of question_id,module_id on public.test_module_questions for each row execute function public.queue_published_image_cleanup();

create trigger queue_published_image_edits after update of stimulus_image_path on public.questions for each row execute function public.queue_published_image_cleanup();
