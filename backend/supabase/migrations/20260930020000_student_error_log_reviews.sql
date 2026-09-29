create table public.student_error_log_reviews (
  student_id uuid not null references public.student_profiles (id) on delete cascade,
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  note_text text not null default '' check (char_length(note_text) <= 3000),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, attempt_id, question_id)
);

create index student_error_log_reviews_student_idx
  on public.student_error_log_reviews (student_id, reviewed_at, updated_at desc);

create trigger student_error_log_reviews_set_updated_at
before update on public.student_error_log_reviews
for each row execute function public.set_updated_at();

alter table public.student_error_log_reviews enable row level security;
revoke all on table public.student_error_log_reviews from anon, authenticated;
grant all on table public.student_error_log_reviews to service_role;

create or replace function public.get_student_error_log_page(
  p_student_id uuid,
  p_domain text default null,
  p_skill text default null,
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  with all_questions as (
    select
      a.id as attempt_id,
      a.submitted_at,
      t.title as test_title,
      t.kind as test_kind,
      ts.name as section_name,
      ts.section_type,
      ts.position as section_position,
      tm.name as module_name,
      tm.position as module_position,
      tmq.position as module_question_position,
      q.id as question_id,
      q.section,
      q.question_type,
      q.prompt,
      q.domain,
      q.skill,
      q.difficulty,
      q.correct_answer,
      q.stimulus_image_path,
      case when pas.id is null then null else
        jsonb_build_object('id', pas.id, 'title', pas.title, 'content', pas.content)
      end as passage,
      coalesce(choice_data.choices, '[]'::jsonb) as choices,
      coalesce(choice_data.correct_answers, '[]'::jsonb) as correct_answers,
      r.selected_choice_id,
      r.typed_answer,
      r.is_correct,
      case
        when r.selected_choice_id is not null then
          nullif(concat_ws('. ', choice_data.selected_label, choice_data.selected_text), '')
        else nullif(btrim(r.typed_answer), '')
      end as your_answer,
      (r.question_id is null or (
        r.selected_choice_id is null and nullif(btrim(r.typed_answer), '') is null
      )) as unanswered,
      coalesce(r.marked_for_review, false) as marked_for_review,
      coalesce(review.note_text, '') as note_text,
      review.reviewed_at,
      row_number() over (
        partition by a.id
        order by ts.position, tm.position, tmq.position
      )::integer as question_number
    from public.attempts a
    join public.tests t on t.id = a.test_id
    join public.attempt_modules am on am.attempt_id = a.id
    join public.test_modules tm on tm.id = am.module_id
    join public.test_sections ts on ts.id = tm.section_id and ts.test_id = a.test_id
    join public.test_module_questions tmq on tmq.module_id = tm.id
    join public.questions q on q.id = tmq.question_id
    left join public.passages pas on pas.id = q.passage_id
    left join public.attempt_responses r
      on r.attempt_id = a.id and r.question_id = q.id
    left join public.student_error_log_reviews review
      on review.student_id = p_student_id
      and review.attempt_id = a.id
      and review.question_id = q.id
    left join lateral (
      select
        jsonb_agg(jsonb_build_object(
          'id', qc.id,
          'label', qc.label,
          'text', qc.text,
          'is_correct', qc.is_correct
        ) order by qc.position) as choices,
        jsonb_agg(jsonb_build_object(
          'label', qc.label,
          'text', qc.text
        ) order by qc.position) filter (where qc.is_correct) as correct_answers,
        max(qc.label) filter (where qc.id = r.selected_choice_id) as selected_label,
        max(qc.text) filter (where qc.id = r.selected_choice_id) as selected_text
      from public.question_choices qc
      where qc.question_id = q.id
    ) choice_data on true
    where a.student_id = p_student_id
      and a.status = 'graded'
  ),
  errors as (
    select *
    from all_questions
    where unanswered or is_correct is distinct from true
  ),
  filtered as (
    select *
    from errors
    where (nullif(btrim(p_domain), '') is null or domain = nullif(btrim(p_domain), ''))
      and (nullif(btrim(p_skill), '') is null or skill = nullif(btrim(p_skill), ''))
  ),
  page_items as (
    select *
    from filtered
    order by submitted_at desc nulls last, attempt_id desc, section_position, module_position, module_question_position
    limit least(greatest(coalesce(p_page_size, 10), 1), 10)
    offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 10), 1), 10)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id', page_items.attempt_id::text || ':' || page_items.question_id::text,
        'attempt_id', page_items.attempt_id,
        'question_id', page_items.question_id,
        'attempt_title', page_items.test_title,
        'attempt_kind', page_items.test_kind,
        'submitted_at', page_items.submitted_at,
        'question_number', page_items.question_number,
        'section', page_items.section,
        'section_name', page_items.section_name,
        'section_type', page_items.section_type,
        'module_name', page_items.module_name,
        'prompt', page_items.prompt,
        'question_type', page_items.question_type,
        'domain', page_items.domain,
        'skill', page_items.skill,
        'difficulty', page_items.difficulty,
        'explanation', null,
        'correct_answer', page_items.correct_answer,
        'stimulus_image_path', page_items.stimulus_image_path,
        'passage', page_items.passage,
        'choices', page_items.choices,
        'correct_answers', page_items.correct_answers,
        'selected_choice_id', page_items.selected_choice_id,
        'typed_answer', page_items.typed_answer,
        'your_answer', page_items.your_answer,
        'is_correct', page_items.is_correct,
        'unanswered', page_items.unanswered,
        'marked_for_review', page_items.marked_for_review,
        'note_text', page_items.note_text,
        'reviewed_at', page_items.reviewed_at
      ) order by page_items.submitted_at desc nulls last, page_items.attempt_id desc,
        page_items.section_position, page_items.module_position, page_items.module_question_position)
      from page_items
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'needs_review_count', (select count(*) from errors where reviewed_at is null),
    'domains', coalesce((
      select jsonb_agg(options.domain order by options.domain)
      from (select distinct domain from errors where domain is not null) options
    ), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_agg(options.skill order by options.skill)
      from (select distinct skill from errors where skill is not null) options
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.get_student_error_log_page(uuid, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_student_error_log_page(uuid, text, text, integer, integer)
  to service_role;
