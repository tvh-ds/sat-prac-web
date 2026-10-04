-- All fixtures roll back. Target only verified staging.
begin;
do $$
declare actor uuid; imp uuid:=gen_random_uuid(); draft uuid:=gen_random_uuid(); job uuid; repeated uuid; suggestion uuid;
begin
  select id into actor from public.profiles where role='admin' limit 1;
  if actor is null then raise exception 'Staging admin fixture required'; end if;
  insert into public.pdf_imports(id,storage_path,original_filename,status,content_scope,text_quality,deterministic_review_status)
    values(imp,'classification-test.pdf','classification test','completed','full_test','{"document_family":"full_test"}','passed');
  insert into public.draft_questions(id,pdf_import_id,page_number,section,question_type,prompt,review_state,status)
    values(draft,imp,1,'math','student_produced','Solve 2x=10','complete','needs_review');
  job:=public.enqueue_classification(imp,actor,'fixture-model',array[draft]);
  repeated:=public.enqueue_classification(imp,actor,'fixture-model',array[draft]);
  if job<>repeated then raise exception 'Duplicate submission created another job'; end if;
  select id into suggestion from public.classification_suggestions where job_id=job;
  update public.classification_suggestions set status='ready',prediction='{}' where id=suggestion;
  perform public.decide_classification(suggestion,actor,'accept','{"domain":"Algebra","skill":"Linear equations in one variable","difficulty":3}',false);
  if not exists(select 1 from public.draft_questions where id=draft and domain='Algebra' and difficulty=3 and review_state='complete' and status='needs_review' and question_id is null) then raise exception 'Acceptance changed publication or failed'; end if;
  update public.classification_jobs set status='completed' where id=job;
  job:=public.enqueue_classification(imp,actor,'fixture-model',array[draft]);
  select id into suggestion from public.classification_suggestions where job_id=job;
  update public.classification_suggestions set status='ready',prediction='{}' where id=suggestion;
  begin
    perform public.decide_classification(suggestion,actor,'accept','{"difficulty":5}',false);
    raise exception 'Replacement unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%replacement confirmation%' then raise; end if;
  end;
  update public.draft_questions set prompt='Edited question' where id=draft;
  begin
    perform public.decide_classification(suggestion,actor,'accept','{"difficulty":3}',false);
    raise exception 'Stale acceptance unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%Stale suggestion%' then raise; end if;
  end;
  if has_function_privilege('authenticated','public.enqueue_classification(uuid,uuid,text,uuid[])','execute') then raise exception 'Unprivileged enqueue exposed'; end if;
  if has_function_privilege('anon','public.decide_classification(uuid,uuid,text,jsonb,boolean)','execute') then raise exception 'Anonymous mutation exposed'; end if;
end $$;
rollback;
select 'PASS: duplicate prevention, accepted labels, publication unchanged, replacement guard, stale rejection, RPC privileges' as result;
