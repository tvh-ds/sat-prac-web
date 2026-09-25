-- Edit one full-test question without mutating a question that may be shared
-- by another test or referenced by a historical student response.
create or replace function public.clone_full_test_question_for_edit(
  p_test_id uuid,
  p_link_id uuid,
  p_payload jsonb,
  p_admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.questions%rowtype;
  v_new_question_id uuid;
  v_passage_id uuid;
  v_passage_text text;
  v_correct_answer text;
  v_choice jsonb;
  v_position integer := 0;
  v_summary jsonb;
  v_total integer;
  v_keyed integer;
begin
  select q.* into v_original
  from public.test_module_questions link
  join public.test_modules module on module.id = link.module_id
  join public.test_sections section on section.id = module.section_id
  join public.tests test on test.id = section.test_id
  join public.questions q on q.id = link.question_id
  where test.id = p_test_id
    and test.kind = 'full'
    and link.id = p_link_id
  for update of link;

  if not found then
    raise exception 'Full-test question link not found';
  end if;

  v_passage_text := nullif(btrim(p_payload->>'passage_text'), '');
  if v_passage_text is not null then
    insert into public.passages(title, content, source, created_by)
    values (null, v_passage_text, 'Edited in full-length test', p_admin_id)
    returning id into v_passage_id;
  end if;

  v_correct_answer := nullif(btrim(p_payload->>'correct_answer'), '');
  insert into public.questions(
    section, question_type, passage_id, prompt, domain, skill, difficulty,
    correct_answer, explanation, status, source_pdf_id, source_page,
    stimulus_image_path, created_by
  ) values (
    v_original.section,
    v_original.question_type,
    v_passage_id,
    btrim(p_payload->>'prompt'),
    v_original.domain,
    v_original.skill,
    v_original.difficulty,
    v_correct_answer,
    nullif(p_payload->>'explanation', ''),
    'archived',
    v_original.source_pdf_id,
    v_original.source_page,
    nullif(p_payload->>'stimulus_image_path', ''),
    p_admin_id
  ) returning id into v_new_question_id;

  for v_choice in select value from jsonb_array_elements(coalesce(p_payload->'choices', '[]'::jsonb))
  loop
    v_position := v_position + 1;
    insert into public.question_choices(question_id, label, text, is_correct, position)
    values (
      v_new_question_id,
      upper(btrim(coalesce(v_choice->>'label', chr(64 + v_position)))),
      v_choice->>'text',
      upper(btrim(coalesce(v_choice->>'label', chr(64 + v_position)))) = upper(coalesce(v_correct_answer, '')),
      v_position
    );
  end loop;

  insert into public.question_sources(question_id, pdf_import_id, page_number, raw_text)
  select v_new_question_id, source.pdf_import_id, source.page_number, source.raw_text
  from public.question_sources source
  where source.question_id = v_original.id;

  update public.test_module_questions
  set question_id = v_new_question_id
  where id = p_link_id;

  select coalesce(jsonb_object_agg(module_name, jsonb_build_object(
           'questions', question_count,
           'keys', key_count,
           'status', case when key_count = 0 then 'missing'
                          when key_count >= question_count then 'complete'
                          else 'partial' end
         )), '{}'::jsonb),
         coalesce(sum(question_count), 0)::integer,
         coalesce(sum(key_count), 0)::integer
    into v_summary, v_total, v_keyed
  from (
    select module.name as module_name,
           count(link.id)::integer as question_count,
           count(question.correct_answer)::integer as key_count
    from public.test_sections section
    join public.test_modules module on module.section_id = section.id
    left join public.test_module_questions link on link.module_id = module.id
    left join public.questions question on question.id = link.question_id
    where section.test_id = p_test_id
    group by module.id, module.name, module.position
    order by module.position
  ) modules;

  update public.tests
  set answer_key_status = case when v_total = 0 or v_keyed = 0 then 'missing'
                               when v_keyed >= v_total then 'complete'
                               else 'partial' end,
      answer_key_summary = v_summary
  where id = p_test_id;

  return v_new_question_id;
end;
$$;

revoke all on function public.clone_full_test_question_for_edit(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.clone_full_test_question_for_edit(uuid, uuid, jsonb, uuid) to service_role;
