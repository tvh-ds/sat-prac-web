-- Re-add OCR support + full-test import options (content scope, target module).
-- Reverses the Phase 0 hard-drop from 20260822000000_remove_ocr.sql, then adds
-- new columns for single-module / RW-only / math-only import scoping.

-- 1. pdf_import_pages: re-add OCR columns
alter table public.pdf_import_pages
  add column if not exists needs_ocr boolean not null default false,
  add column if not exists ocr_status text not null default 'pending'
    check (ocr_status in ('pending', 'running', 'completed', 'failed')),
  add column if not exists ocr_text text;

-- 2. pdf_imports: add scope + OCR-mode columns
alter table public.pdf_imports
  add column if not exists ocr_mode text not null default 'auto'
    check (ocr_mode in ('auto', 'all', 'none')),
  add column if not exists content_scope text not null default 'full_test'
    check (content_scope in ('full_test', 'reading_writing', 'math', 'single_module')),
  add column if not exists target_module text
    check (target_module is null or target_module in ('rw1', 'rw2', 'math1', 'math2'));

-- 3. Re-expand status check to include OCR pipeline states
alter table public.pdf_imports drop constraint if exists pdf_imports_status_check;
alter table public.pdf_imports add constraint pdf_imports_status_check
  check (status in (
    'uploaded', 'extracting', 'extracted',
    'needs_ocr', 'ocr_pending', 'ocr_running', 'ocr_completed',
    'parsing', 'parsed', 'needs_review',
    'completed', 'failed', 'cancelled'
  ));

-- 4. Re-expand extraction_method check
alter table public.pdf_imports drop constraint if exists pdf_imports_extraction_method_check;
alter table public.pdf_imports add constraint pdf_imports_extraction_method_check
  check (extraction_method is null or extraction_method in ('text', 'ocr', 'mixed'));
