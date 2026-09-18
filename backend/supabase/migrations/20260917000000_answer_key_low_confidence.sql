-- Structural answer-key status: allow 'low_confidence' (every question has a
-- key but alignment is suspect: positional fallback, duplicate key numbers,
-- or key entries exceeding question counts). Warnings live in
-- pdf_imports.text_quality->'answer_key_warnings'.

alter table public.pdf_imports
  drop constraint if exists pdf_imports_answer_key_status_check,
  add constraint pdf_imports_answer_key_status_check
    check (answer_key_status in ('complete', 'partial', 'missing', 'low_confidence'));

alter table public.tests
  drop constraint if exists tests_answer_key_status_check,
  add constraint tests_answer_key_status_check
    check (answer_key_status in ('complete', 'partial', 'missing', 'low_confidence'));
