-- Full-test generation from PDF imports + scoped test assignments.
--
-- 1. pdf_imports: link an approved import to the full-length test assembled
--    from its drafts (one test per PDF, named after the PDF).
alter table public.pdf_imports
  add column if not exists generated_test_id uuid references public.tests (id) on delete set null;

create index pdf_imports_generated_test_idx on public.pdf_imports (generated_test_id);

-- 2. test_assignments: an assignment can now target the full test, one
--    section, or an arbitrary subset of the test's modules. For
--    section/full scopes the student runtime derives module ids from the
--    test structure at request time.
alter table public.test_assignments
  add column if not exists content_scope text not null default 'full_test'
    check (content_scope in ('full_test', 'reading_writing', 'math', 'custom_modules')),
  add column if not exists module_ids uuid[] not null default '{}';