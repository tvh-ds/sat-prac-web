-- Editorial placement is separate from immutable PDF source numbering.
alter table public.draft_questions
  add column assigned_module_name text,
  add column display_order integer;

update public.draft_questions set assigned_module_name =
  case when source_module_name in (
    'Reading and Writing Module 1', 'Reading and Writing Module 2',
    'Math Module 1', 'Math Module 2'
  ) then source_module_name
  when section = 'math' then 'Math Module 1'
  else 'Reading and Writing Module 1' end;

with ranked as (
  select id, row_number() over (
    partition by pdf_import_id, assigned_module_name
    order by page_number nulls last, source_question_number nulls last, created_at, id
  )::integer as position
  from public.draft_questions
)
update public.draft_questions d set display_order = ranked.position
from ranked where d.id = ranked.id;

alter table public.draft_questions
  alter column assigned_module_name set not null,
  alter column display_order set not null,
  add constraint draft_assigned_module_valid check (assigned_module_name in (
    'Reading and Writing Module 1', 'Reading and Writing Module 2',
    'Math Module 1', 'Math Module 2'
  )),
  add constraint draft_display_order_positive check (display_order > 0);

create index draft_questions_editorial_order_idx
  on public.draft_questions (pdf_import_id, assigned_module_name, display_order, id);

create function public.assign_new_draft_placement()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform 1 from public.pdf_imports where id = new.pdf_import_id for update;
  new.assigned_module_name := case when new.source_module_name in (
    'Reading and Writing Module 1', 'Reading and Writing Module 2',
    'Math Module 1', 'Math Module 2'
  ) then new.source_module_name
  when new.section = 'math' then 'Math Module 1'
  else 'Reading and Writing Module 1' end;
  select coalesce(max(display_order), 0) + 1 into new.display_order
  from public.draft_questions
  where pdf_import_id = new.pdf_import_id
    and assigned_module_name = new.assigned_module_name;
  return new;
end; $$;

create trigger draft_questions_assign_new_placement
before insert on public.draft_questions
for each row execute function public.assign_new_draft_placement();

-- Called only through the admin Edge Function. Placement and the editor's
-- question fields/choices commit or roll back together.
create function public.save_import_draft_editor(
  p_import_id uuid,
  p_draft_id uuid,
  p_actor_id uuid,
  p_expected_updated_at timestamptz,
  p_module_name text,
  p_position integer,
  p_patch jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_draft public.draft_questions%rowtype;
  v_generated_test_id uuid;
  v_import_review_status text;
  v_dest_count integer;
  v_module_changed boolean;
  v_placement_changed boolean;
  v_section text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'admin') then
    raise exception 'admin required';
  end if;
  if p_module_name not in ('Reading and Writing Module 1', 'Reading and Writing Module 2',
                           'Math Module 1', 'Math Module 2') then
    raise exception 'Invalid destination module';
  end if;
  if p_position is null or p_position < 1 then raise exception 'Invalid position'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'Invalid draft patch'; end if;

  select generated_test_id, deterministic_review_status
    into v_generated_test_id, v_import_review_status
  from public.pdf_imports where id = p_import_id for update;
  if not found then raise exception 'Import not found'; end if;
  if v_import_review_status = 'failed' then raise exception 'Structurally failed imports cannot be edited'; end if;
  select * into v_draft from public.draft_questions
  where id = p_draft_id and pdf_import_id = p_import_id for update;
  if not found then raise exception 'Draft not found'; end if;
  if v_draft.updated_at is distinct from p_expected_updated_at then
    raise exception 'Draft changed since it was opened';
  end if;

  v_module_changed := v_draft.assigned_module_name <> p_module_name;
  v_placement_changed := v_module_changed or v_draft.display_order <> p_position;
  if v_placement_changed and v_generated_test_id is not null then
    raise exception 'Placement cannot change after test generation';
  end if;
  select count(*) into v_dest_count from public.draft_questions
  where pdf_import_id = p_import_id and assigned_module_name = p_module_name;
  if p_position > v_dest_count + case when v_module_changed then 1 else 0 end then
    raise exception 'Position is outside the destination module';
  end if;

  if v_placement_changed then
    if v_module_changed then
      update public.draft_questions set display_order = display_order - 1
      where pdf_import_id = p_import_id and assigned_module_name = v_draft.assigned_module_name
        and id <> p_draft_id and display_order > v_draft.display_order;
      update public.draft_questions set display_order = display_order + 1
      where pdf_import_id = p_import_id and assigned_module_name = p_module_name
        and display_order >= p_position;
    elsif p_position < v_draft.display_order then
      update public.draft_questions set display_order = display_order + 1
      where pdf_import_id = p_import_id and assigned_module_name = p_module_name
        and id <> p_draft_id and display_order >= p_position and display_order < v_draft.display_order;
    else
      update public.draft_questions set display_order = display_order - 1
      where pdf_import_id = p_import_id and assigned_module_name = p_module_name
        and id <> p_draft_id and display_order > v_draft.display_order and display_order <= p_position;
    end if;
  end if;

  v_section := case when p_module_name like 'Math%' then 'math' else 'reading_writing' end;
  update public.draft_questions set
    assigned_module_name = p_module_name,
    display_order = p_position,
    section = v_section,
    prompt = case when p_patch ? 'prompt' then p_patch->>'prompt' else prompt end,
    passage_text = case when p_patch ? 'passage_text' then p_patch->>'passage_text' else passage_text end,
    question_type = case when p_patch ? 'question_type' then p_patch->>'question_type' else question_type end,
    domain = case when p_patch ? 'domain' then p_patch->>'domain' else domain end,
    skill = case when p_patch ? 'skill' then p_patch->>'skill' else skill end,
    difficulty = case when p_patch ? 'difficulty' then (p_patch->>'difficulty')::smallint else difficulty end,
    suggested_answer = case when p_patch ? 'suggested_answer' then p_patch->>'suggested_answer' else suggested_answer end,
    explanation = case when p_patch ? 'explanation' then p_patch->>'explanation' else explanation end,
    has_visual_stimulus = case when p_patch ? 'has_visual_stimulus' then (p_patch->>'has_visual_stimulus')::boolean else has_visual_stimulus end,
    stimulus_image_path = case when p_patch ? 'stimulus_image_path' then p_patch->>'stimulus_image_path' else stimulus_image_path end,
    stimulus_source_image_path = case when p_patch ? 'stimulus_source_image_path' then p_patch->>'stimulus_source_image_path' else stimulus_source_image_path end,
    stimulus_crop_rect = case when p_patch ? 'stimulus_crop_rect' then p_patch->'stimulus_crop_rect' else stimulus_crop_rect end,
    stimulus_crop_source = case when p_patch ? 'stimulus_crop_source' then p_patch->>'stimulus_crop_source' else stimulus_crop_source end,
    stimulus_crop_status = case when p_patch ? 'stimulus_crop_status' then p_patch->>'stimulus_crop_status' else stimulus_crop_status end,
    review_state = case when v_module_changed then 'review' else review_state end,
    review_route = case when v_module_changed then 'individual_review' else review_route end
  where id = p_draft_id;

  if p_patch ? 'choices' then
    delete from public.draft_question_choices where draft_question_id = p_draft_id;
    insert into public.draft_question_choices (draft_question_id, label, text, position)
    select p_draft_id, coalesce(choice.value->>'label', chr(64 + choice.ordinality::integer)),
           choice.value->>'text', coalesce((choice.value->>'position')::smallint, choice.ordinality::smallint)
    from jsonb_array_elements(p_patch->'choices') with ordinality as choice(value, ordinality);
  end if;

  if v_draft.question_id is not null then
    if v_module_changed then
      update public.questions set section = v_section where id = v_draft.question_id;
    end if;
    if p_patch ? 'stimulus_image_path' or p_patch ? 'has_visual_stimulus' then
      update public.questions set stimulus_image_path =
        (select stimulus_image_path from public.draft_questions where id = p_draft_id)
      where id = v_draft.question_id;
    end if;
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (p_actor_id, 'draft_question.editor_saved', 'draft_question', p_draft_id,
    jsonb_build_object('old_module', v_draft.assigned_module_name,
                       'new_module', p_module_name,
                       'old_position', v_draft.display_order,
                       'new_position', p_position));
end; $$;

revoke all on function public.save_import_draft_editor(uuid, uuid, uuid, timestamptz, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_import_draft_editor(uuid, uuid, uuid, timestamptz, text, integer, jsonb)
  to service_role;
