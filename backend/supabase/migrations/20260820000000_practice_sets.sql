-- =============================================================================
-- Practice sets: tests can be flagged as lightweight single-module practice.
-- Practice sets reuse the existing test/section/module/question/attempt
-- infrastructure; the only change is a `kind` marker on tests.
-- =============================================================================

alter table public.tests
  add column kind text not null default 'full' check (kind in ('full', 'practice'));

create index tests_kind_status_idx on public.tests (kind, status);

-- Seed: demo practice set (published + public) using the seeded R&W questions --
insert into public.tests (id, title, description, status, is_public, kind)
values (
  '00000000-0000-0000-0000-000000000701',
  'Reading & Writing Warm-up',
  'A 3-question Reading & Writing warm-up: main idea, words in context, and syntax. 10-minute timer.',
  'published',
  true,
  'practice'
);

insert into public.test_sections (id, test_id, name, section_type, position)
values (
  '00000000-0000-0000-0000-000000000702',
  '00000000-0000-0000-0000-000000000701',
  'Practice',
  'reading_writing',
  1
);

insert into public.test_modules (id, section_id, name, time_limit_minutes, position, is_adaptive)
values (
  '00000000-0000-0000-0000-000000000703',
  '00000000-0000-0000-0000-000000000702',
  'Practice',
  10,
  1,
  false
);

insert into public.test_module_questions (module_id, question_id, position, points) values
  ('00000000-0000-0000-0000-000000000703', '00000000-0000-0000-0000-000000000201', 1, 1),
  ('00000000-0000-0000-0000-000000000703', '00000000-0000-0000-0000-000000000202', 2, 1),
  ('00000000-0000-0000-0000-000000000703', '00000000-0000-0000-0000-000000000203', 3, 1);