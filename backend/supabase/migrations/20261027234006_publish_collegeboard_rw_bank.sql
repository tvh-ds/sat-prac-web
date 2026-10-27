-- One-deck exception. Do not change generic PDF approval or full-test generation.
-- Invoker permissions + service-role-only EXECUTE keep this off the public API.
create or replace function public.publish_collegeboard_rw_bank(p_admin_id uuid)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_import_id constant uuid := '5a255e65-742d-41e1-ba7c-ca0379257ebc';
  v_import public.pdf_imports%rowtype;
  v_draft public.draft_questions%rowtype;
  v_existing public.questions%rowtype;
  v_question_id uuid;
  v_passage_id uuid;
  v_published int := 0;
  v_total int;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin') then
    raise exception 'admin required';
  end if;

  select * into v_import from public.pdf_imports where id = v_import_id for update;
  if not found then raise exception 'College Board R&W deck not found'; end if;
  if v_import.generated_test_id is not null then raise exception 'This deck already has a generated test'; end if;
  if v_import.status <> 'completed' then raise exception 'Wait for PDF processing to finish before publishing'; end if;
  if exists (select 1 from public.ai_ingestion_review_jobs where pdf_import_id = v_import_id and status in ('queued','running')) then
    raise exception 'Wait for source review to finish before publishing';
  end if;

  -- A retry returns the saved result without duplicating questions or passages.
  if v_import.text_quality->'bank_publication'->>'status' = 'published' then
    return v_import.text_quality->'bank_publication' || jsonb_build_object('already_published', true);
  end if;
  perform 1 from public.draft_questions where pdf_import_id = v_import_id for update;
  if not found then raise exception 'This deck has no remaining drafts to publish'; end if;

  -- This legacy bank predates AI review states. Validate the actual content,
  -- official keys, and confirmed figures instead of requiring a new AI run.
  if exists (
    select 1 from public.draft_questions d
    where d.pdf_import_id = v_import_id and (
      d.section is distinct from 'reading_writing'
      or d.question_type is distinct from 'multiple_choice'
      or d.status = 'rejected'
      or nullif(btrim(d.prompt), '') is null
      or nullif(btrim(d.source_question_id), '') is null
      or upper(btrim(d.suggested_answer)) not in ('A','B','C','D')
      or nullif(btrim(d.suggested_answer), '') is null
      or (select count(*) from public.draft_question_choices c where c.draft_question_id=d.id) <> 4
      or (select count(distinct upper(btrim(c.label))) from public.draft_question_choices c
          where c.draft_question_id=d.id and upper(btrim(c.label)) in ('A','B','C','D') and nullif(btrim(c.text),'') is not null) <> 4
      or (d.has_visual_stimulus and (
        d.stimulus_crop_status is distinct from 'confirmed'
        or not exists(select 1 from storage.objects o where o.bucket_id='question-assets' and o.name=d.stimulus_image_path)
      ))
    )
  ) then raise exception 'Every bank draft needs readable content, four choices, an official answer and a confirmed available figure'; end if;

  for v_draft in select * from public.draft_questions where pdf_import_id = v_import_id order by id loop
    v_question_id := null;
    v_passage_id := null;
    select * into v_existing from public.questions
      where id = v_draft.question_id or source_question_id = v_draft.source_question_id
      order by (id = v_draft.question_id) desc nulls last limit 1;
    if found then
      if v_existing.source_pdf_id is distinct from v_import_id or v_existing.status <> 'active'
        or v_existing.section <> 'reading_writing' then
        raise exception 'Source question % already belongs to another publication', v_draft.source_question_id;
      end if;
      v_question_id := v_existing.id;
    else
      if nullif(btrim(v_draft.passage_text), '') is not null then
        insert into public.passages(content,source,created_by)
          values (v_draft.passage_text,v_import_id::text,p_admin_id) returning id into v_passage_id;
      end if;
      insert into public.questions(section,question_type,passage_id,prompt,domain,skill,difficulty,
        correct_answer,explanation,source_pdf_id,source_page,source_question_id,stimulus_image_path,status,created_by)
      values ('reading_writing','multiple_choice',v_passage_id,v_draft.prompt,v_draft.domain,v_draft.skill,
        coalesce(v_draft.difficulty,3),upper(btrim(v_draft.suggested_answer)),v_draft.explanation,
        v_import_id,v_draft.page_number,v_draft.source_question_id,v_draft.stimulus_image_path,'active',p_admin_id)
      returning id into v_question_id;
      insert into public.question_choices(question_id,label,text,is_correct,position)
        select v_question_id,upper(btrim(label)),text,
          upper(btrim(label))=upper(btrim(v_draft.suggested_answer)),position
        from public.draft_question_choices where draft_question_id=v_draft.id;
      insert into public.question_sources(question_id,pdf_import_id,page_number,raw_text)
        values (v_question_id,v_import_id,v_draft.page_number,v_draft.prompt);
      v_published := v_published + 1;
    end if;
    update public.draft_questions set question_id=v_question_id,status='approved',human_review_mode='batch',
      human_reviewed_by=p_admin_id,human_reviewed_at=now() where id=v_draft.id;
  end loop;
  update public.draft_answer_keys k set status='approved' from public.draft_questions d
    where d.pdf_import_id=v_import_id and k.draft_question_id=d.id and k.status='suggested';
  select count(*) into v_total from public.questions where source_pdf_id=v_import_id and status='active';
  v_result := jsonb_build_object('status','published','published_at',now(),'question_count',v_published,'bank_total',v_total);
  update public.pdf_imports set text_quality=coalesce(text_quality,'{}'::jsonb)||jsonb_build_object('bank_publication',v_result)
    where id=v_import_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
    values (p_admin_id,'question_bank.published','pdf_import',v_import_id,v_result);
  return v_result || jsonb_build_object('already_published',false);
end; $$;

revoke all on function public.publish_collegeboard_rw_bank(uuid) from public, anon, authenticated;
grant execute on function public.publish_collegeboard_rw_bank(uuid) to service_role;
