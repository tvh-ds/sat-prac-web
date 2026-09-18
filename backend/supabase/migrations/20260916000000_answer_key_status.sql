-- Answer-key status for PDF imports and full-length tests.
--
-- The worker marks each parsed import as complete / partial / missing plus a
-- per-module summary (questions vs detected keys). Generated tests inherit
-- the status when assembled from an import.

alter table public.pdf_imports
  add column if not exists answer_key_status text
    check (answer_key_status in ('complete', 'partial', 'missing')),
  add column if not exists answer_key_summary jsonb not null default '{}';

alter table public.tests
  add column if not exists answer_key_status text
    check (answer_key_status in ('complete', 'partial', 'missing')),
  add column if not exists answer_key_summary jsonb not null default '{}';