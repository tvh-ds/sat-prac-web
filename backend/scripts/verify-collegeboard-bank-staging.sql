-- Run only against wgkggknyndgaoyazdhdf. Every publication below is rolled back.
begin;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare
  deck constant uuid := '5a255e65-742d-41e1-ba7c-ca0379257ebc';
  admin_id uuid;
  draft_count int;
  before_tests bigint;
  before_questions bigint;
  before_passages bigint;
  before_other text;
  before_existing text;
  before_audits bigint;
  first_result jsonb;
  second_result jsonb;
begin
  select id into admin_id from public.profiles where role='admin' limit 1;
  if admin_id is null then raise exception 'A staging admin is required'; end if;
  select count(*) into draft_count from public.draft_questions where pdf_import_id=deck;
  if draft_count<>132 then raise exception 'Expected the real 132-question staging deck'; end if;
  select count(*) into before_tests from public.tests;
  select count(*) into before_questions from public.questions;
  select count(*) into before_passages from public.passages;
  select count(*) into before_audits from public.audit_logs where action='question_bank.published' and entity_id=deck;
  select md5(string_agg(to_jsonb(q)::text,'' order by id)) into before_other
    from public.questions q where source_pdf_id is distinct from deck;
  select md5(string_agg(to_jsonb(q)::text,'' order by id)) into before_existing
    from public.questions q where source_pdf_id=deck;

  if has_function_privilege('anon','public.publish_collegeboard_rw_bank(uuid)','execute')
    or has_function_privilege('authenticated','public.publish_collegeboard_rw_bank(uuid)','execute') then
    raise exception 'Publisher must be service-role-only';
  end if;
  begin
    perform public.publish_collegeboard_rw_bank('00000000-0000-0000-0000-000000000000');
    raise exception 'Expected admin rejection';
  exception when others then
    if sqlerrm <> 'admin required' then raise; end if;
  end;
  if exists(select 1 from public.pdf_imports where id=deck and text_quality->'bank_publication'->>'status'='published') then
    first_result := public.publish_collegeboard_rw_bank(admin_id);
    if first_result->>'already_published'<>'true'
      or (select count(*) from public.questions)<>before_questions
      or (select count(*) from public.tests)<>before_tests
      or (select count(*) from public.passages)<>before_passages
      or (select count(*) from public.audit_logs where action='question_bank.published' and entity_id=deck)<>before_audits
      or exists(select 1 from public.draft_questions d left join public.questions q on q.id=d.question_id
        where d.pdf_import_id=deck and (q.id is null or q.status<>'active' or q.stimulus_image_path is distinct from d.stimulus_image_path)) then
      raise exception 'Published deck retry changed content';
    end if;
    return;
  end if;
  begin
    update public.draft_questions set stimulus_crop_status='pending'
      where id=(select id from public.draft_questions where pdf_import_id=deck limit 1);
    perform public.publish_collegeboard_rw_bank(admin_id);
    raise exception 'Expected crop rejection';
  exception when others then
    if sqlerrm not like 'Every bank draft needs%' then raise; end if;
  end;
  -- A conflict partway through the loop must roll back all earlier inserts.
  begin
    insert into public.questions(section,question_type,prompt,status,source_question_id)
      values('reading_writing','multiple_choice','Synthetic rollback conflict','active','bank-publication-rollback-conflict');
    update public.draft_questions set source_question_id='bank-publication-rollback-conflict'
      where id=(select id from public.draft_questions where pdf_import_id=deck order by id desc limit 1);
    perform public.publish_collegeboard_rw_bank(admin_id);
    raise exception 'Expected provenance conflict';
  exception when others then
    if sqlerrm not like 'Source question % already belongs to another publication' then raise; end if;
  end;
  if (select count(*) from public.questions)<>before_questions
    or (select count(*) from public.passages)<>before_passages then
    raise exception 'A failed publication left partial content';
  end if;

  first_result := public.publish_collegeboard_rw_bank(admin_id);
  if (first_result->>'question_count')::int<>draft_count or first_result->>'already_published'<>'false' then
    raise exception 'Unexpected publication result: %',first_result;
  end if;
  if (select count(*) from public.tests)<>before_tests
    or (select generated_test_id from public.pdf_imports where id=deck) is not null then
    raise exception 'Bank publishing created a test';
  end if;
  if exists(
    select 1 from public.draft_questions d
    left join public.questions q on q.id=d.question_id
    left join public.passages p on p.id=q.passage_id
    where d.pdf_import_id=deck and (
      q.id is null or q.status<>'active' or d.status<>'approved'
      or q.source_pdf_id is distinct from deck or q.difficulty is null
      or q.prompt is distinct from d.prompt or q.explanation is distinct from d.explanation
      or q.stimulus_image_path is distinct from d.stimulus_image_path
      or q.correct_answer is distinct from upper(btrim(d.suggested_answer))
      or (nullif(btrim(d.passage_text),'') is not null and p.content is distinct from d.passage_text)
      or (select count(*) from public.question_choices c where c.question_id=q.id)<>4
      or (select count(*) from public.question_choices c where c.question_id=q.id and c.is_correct)<>1
      or exists(select 1 from public.draft_question_choices dc left join public.question_choices qc
        on qc.question_id=q.id and qc.label=upper(btrim(dc.label))
        where dc.draft_question_id=d.id and (qc.id is null or qc.text is distinct from dc.text))
    )
  ) then raise exception 'Published content differs from source drafts'; end if;
  if (select md5(string_agg(to_jsonb(q)::text,'' order by id)) from public.questions q where source_pdf_id is distinct from deck)
    is distinct from before_other then raise exception 'Another import was changed'; end if;
  if (select md5(string_agg(to_jsonb(q)::text,'' order by id)) from public.questions q where source_pdf_id=deck and id not in
    (select question_id from public.draft_questions where pdf_import_id=deck)) is distinct from before_existing then
    raise exception 'Previously published bank questions were changed';
  end if;
  second_result := public.publish_collegeboard_rw_bank(admin_id);
  if second_result->>'already_published'<>'true'
    or (select count(*) from public.questions)<>before_questions+draft_count
    or (select count(*) from public.audit_logs where action='question_bank.published' and entity_id=deck)<>before_audits+1 then
    raise exception 'Retry duplicated publication';
  end if;
  raise notice 'PASS: 132 real visual questions published with exact content, zero tests, unchanged other imports, safe retry and atomic failure';
end $$;
select 'PASS: deck publication assertions completed; changes are rolled back' as result;
rollback;
