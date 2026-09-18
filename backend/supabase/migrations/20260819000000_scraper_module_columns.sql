-- SAT scraper: track module provenance for draft questions so repeated
-- question numbers across modules can be distinguished, and keys can be
-- matched per module.

alter table public.draft_questions
  add column if not exists source_module_name text,
  add column if not exists source_module_position int;

create index if not exists draft_questions_module_idx on public.draft_questions (pdf_import_id, source_module_name);