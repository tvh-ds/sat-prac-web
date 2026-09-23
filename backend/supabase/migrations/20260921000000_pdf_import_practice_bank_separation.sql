-- =============================================================================
-- PDF import / Practice Question Bank separation.
--
-- Target ONLY questions proven to come from a PDF draft AND proven to be linked
-- into that same PDF import's generated full-length test. These records must
-- remain in public.questions because full-length tests reference them, but they
-- are not eligible for the Practice Question Bank.
-- =============================================================================

-- Hide verified full-test imported questions from the Practice Question Bank.
with imported_full_test_questions as (
  select distinct dq.question_id
  from public.draft_questions dq
  join public.pdf_imports pi on pi.id = dq.pdf_import_id
  join public.tests ft on ft.id = pi.generated_test_id and ft.kind = 'full'
  join public.test_sections fts on fts.test_id = ft.id
  join public.test_modules ftm on ftm.section_id = fts.id
  join public.test_module_questions ftmq
    on ftmq.module_id = ftm.id
   and ftmq.question_id = dq.question_id
  where dq.question_id is not null
)
update public.questions q
set status = 'archived'
where q.id in (select question_id from imported_full_test_questions)
  and q.status <> 'archived';

-- Remove only those exact imported questions from unused current practice
-- templates. Do not touch full tests, assignment snapshots, attempts, scores,
-- or practice tests that already have attempts/assignments.
with imported_full_test_questions as (
  select distinct dq.question_id
  from public.draft_questions dq
  join public.pdf_imports pi on pi.id = dq.pdf_import_id
  join public.tests ft on ft.id = pi.generated_test_id and ft.kind = 'full'
  join public.test_sections fts on fts.test_id = ft.id
  join public.test_modules ftm on ftm.section_id = fts.id
  join public.test_module_questions ftmq
    on ftmq.module_id = ftm.id
   and ftmq.question_id = dq.question_id
  where dq.question_id is not null
), removable_links as (
  select tmq.id
  from public.test_module_questions tmq
  join public.test_modules tm on tm.id = tmq.module_id
  join public.test_sections ts on ts.id = tm.section_id
  join public.tests pt on pt.id = ts.test_id and pt.kind = 'practice'
  where tmq.question_id in (select question_id from imported_full_test_questions)
    and not exists (
      select 1 from public.attempts a where a.test_id = pt.id
    )
    and not exists (
      select 1 from public.test_assignments ta where ta.test_id = pt.id
    )
    and not exists (
      select 1 from public.practice_assignment_batches pab where pab.snapshot_test_id = pt.id
    )
)
delete from public.test_module_questions tmq
where tmq.id in (select id from removable_links);
