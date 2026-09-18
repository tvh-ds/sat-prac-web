-- =============================================================================
-- Seed: sample SAT-style practice test with original questions
-- Published + public so every admin-created student can take it.
-- =============================================================================

-- Passage (Reading & Writing) --------------------------------------------------
insert into public.passages (id, title, content, source)
values (
  '00000000-0000-0000-0000-000000000101',
  'The Compass Rose',
  'For centuries, mariners relied on the compass rose printed on nautical charts '
  'to orient their journeys across open water. The design, a circle marked with '
  'cardinal and intermediate directions, did more than show which way was north; '
  'it encoded centuries of accumulated navigational knowledge. As magnetic '
  'compasses spread from the Mediterranean into northern Europe, chartmakers '
  'began embellishing the rose with decorative flourishes, yet the underlying '
  'geometry remained constant. Even after satellite navigation rendered the '
  'compass rose obsolete for practical navigation, the symbol persisted as an '
  'emblem of exploration, appearing on coins, flags, and the pages of '
  'adventure literature.',
  'Seed fixture (original content)'
);

-- Reading & Writing questions --------------------------------------------------
insert into public.questions (id, section, question_type, passage_id, prompt, domain, skill, difficulty, correct_answer, explanation, status)
values
  ('00000000-0000-0000-0000-000000000201', 'reading_writing', 'multiple_choice',
   '00000000-0000-0000-0000-000000000101',
   'Which choice best states the main purpose of the passage?',
   'craft and structure', 'main idea', 2, 'B',
   'The passage traces the historical function of the compass rose and then notes its later persistence as a symbol, so B is the best fit.',
   'active'),
  ('00000000-0000-0000-0000-000000000202', 'reading_writing', 'multiple_choice',
   '00000000-0000-0000-0000-000000000101',
   'As used in the passage, "encoded" most nearly means',
   'craft and structure', 'words in context', 2, 'C',
   'The passage states the rose "encoded centuries of accumulated navigational knowledge," meaning it preserved or embedded that knowledge in its design.',
   'active'),
  ('00000000-0000-0000-0000-000000000203', 'reading_writing', 'multiple_choice',
   null,
   'Most of the world''s airports ______ bag scanners that can detect a wide range '
   'of dense materials, but the newest generation of devices also flags ordinary '
   'electronics, a change that has slowed down security lines.',
   'craft and structure', 'syntax', 3, 'A',
   'The subject is plural, so the verb must be the plural "use"; the sentence '
   'describes a present-tense general fact.',
   'active');

insert into public.question_choices (question_id, label, text, is_correct, position) values
  ('00000000-0000-0000-0000-000000000201', 'A', 'to argue that decorative elements weakened the compass rose''s practical value', false, 1),
  ('00000000-0000-0000-0000-000000000201', 'B', 'to trace the compass rose''s role in navigation and its later symbolic persistence', true, 2),
  ('00000000-0000-0000-0000-000000000201', 'C', 'to compare the compass rose with satellite navigation systems', false, 3),
  ('00000000-0000-0000-0000-000000000201', 'D', 'to explain how chartmakers produced nautical charts by hand', false, 4),
  ('00000000-0000-0000-0000-000000000202', 'A', 'translated', false, 1),
  ('00000000-0000-0000-0000-000000000202', 'B', 'concealed', false, 2),
  ('00000000-0000-0000-0000-000000000202', 'C', 'embedded', true, 3),
  ('00000000-0000-0000-0000-000000000202', 'D', 'corrected', false, 4),
  ('00000000-0000-0000-0000-000000000203', 'A', 'use', true, 1),
  ('00000000-0000-0000-0000-000000000203', 'B', 'uses', false, 2),
  ('00000000-0000-0000-0000-000000000203', 'C', 'is using', false, 3),
  ('00000000-0000-0000-0000-000000000203', 'D', 'have used', false, 4);

-- Math questions ---------------------------------------------------------------
insert into public.questions (id, section, question_type, passage_id, prompt, domain, skill, difficulty, correct_answer, explanation, status)
values
  ('00000000-0000-0000-0000-000000000301', 'math', 'multiple_choice', null,
   'If 3x + 7 = 22, what is the value of x?',
   'algebra', 'linear equations', 1, 'B',
   'Subtract 7 from both sides to get 3x = 15, then divide by 3 to find x = 5.',
   'active'),
  ('00000000-0000-0000-0000-000000000302', 'math', 'multiple_choice', null,
   'A rectangle has a length of 12 cm and a width of 5 cm. What is its area, in square centimeters?',
   'geometry and trigonometry', 'area', 1, 'C',
   'Area = length x width = 12 x 5 = 60.',
   'active'),
  ('00000000-0000-0000-0000-000000000303', 'math', 'multiple_choice', null,
   'The function f is defined by f(x) = 2x^2 - 3x + 1. What is the value of f(3)?',
   'advanced math', 'functions', 3, 'D',
   'f(3) = 2(9) - 9 + 1 = 18 - 9 + 1 = 10.',
   'active'),
  ('00000000-0000-0000-0000-000000000304', 'math', 'student_produced', null,
   'If 2(x + 3) = x + 10, what is the value of x?',
   'algebra', 'linear equations', 2, '4',
   '2x + 6 = x + 10 gives x = 4.',
   'active');

insert into public.question_choices (question_id, label, text, is_correct, position) values
  ('00000000-0000-0000-0000-000000000301', 'A', '4', false, 1),
  ('00000000-0000-0000-0000-000000000301', 'B', '5', true, 2),
  ('00000000-0000-0000-0000-000000000301', 'C', '6', false, 3),
  ('00000000-0000-0000-0000-000000000301', 'D', '7', false, 4),
  ('00000000-0000-0000-0000-000000000302', 'A', '30', false, 1),
  ('00000000-0000-0000-0000-000000000302', 'B', '48', false, 2),
  ('00000000-0000-0000-0000-000000000302', 'C', '60', true, 3),
  ('00000000-0000-0000-0000-000000000302', 'D', '72', false, 4),
  ('00000000-0000-0000-0000-000000000303', 'A', '8', false, 1),
  ('00000000-0000-0000-0000-000000000303', 'B', '9', false, 2),
  ('00000000-0000-0000-0000-000000000303', 'C', '11', false, 3),
  ('00000000-0000-0000-0000-000000000303', 'D', '10', true, 4);

-- Test structure ----------------------------------------------------------------
insert into public.tests (id, title, description, status, is_public)
values (
  '00000000-0000-0000-0000-000000000401',
  'SAT Practice Test 1',
  'Sample adaptive-style practice test: Reading & Writing (2 x 32 min) and Math (2 x 35 min).',
  'published',
  true
);

insert into public.test_sections (id, test_id, name, section_type, position) values
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000401', 'Reading and Writing', 'reading_writing', 1),
  ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000401', 'Math', 'math', 2);

insert into public.test_modules (id, section_id, name, time_limit_minutes, position, is_adaptive) values
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000501', 'Module 1', 32, 1, false),
  ('00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000501', 'Module 2', 32, 2, false),
  ('00000000-0000-0000-0000-000000000603', '00000000-0000-0000-0000-000000000502', 'Module 1', 35, 1, false),
  ('00000000-0000-0000-0000-000000000604', '00000000-0000-0000-0000-000000000502', 'Module 2', 35, 2, false);

insert into public.test_module_questions (module_id, question_id, position, points) values
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000201', 1, 1),
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000202', 2, 1),
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000203', 3, 1),
  ('00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000203', 1, 1),
  ('00000000-0000-0000-0000-000000000603', '00000000-0000-0000-0000-000000000301', 1, 1),
  ('00000000-0000-0000-0000-000000000603', '00000000-0000-0000-0000-000000000302', 2, 1),
  ('00000000-0000-0000-0000-000000000604', '00000000-0000-0000-0000-000000000303', 1, 1),
  ('00000000-0000-0000-0000-000000000604', '00000000-0000-0000-0000-000000000304', 2, 1);