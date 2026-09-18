-- Remove OCR columns / statuses — Phase 0 hard drop (see plan).
-- pdf_imports: was ('uploaded','extracting','extracted','needs_ocr','ocr_pending','ocr_running','ocr_completed','parsing','parsed','needs_review','completed','failed','cancelled')
-- Now only uploaded/extracting/parsing/completed/failed/cancelled (extracted/parsed/needs_review were unused states kept for display).
-- pdf_import_pages: drop needs_ocr, ocr_status, ocr_text. extraction_method: was ('text','ocr','mixed') → now ('text') single value.

-- 1. pdf_import_pages: drop OCR columns (if exists)
alter table public.pdf_import_pages drop column if exists needs_ocr;
alter table public.pdf_import_pages drop column if exists ocr_status;
alter table public.pdf_import_pages drop column if exists ocr_text;

-- 2. pdf_imports: migrate existing OCR-state rows to failed with hint
update public.pdf_imports
set status = 'failed',
    error_message = coalesce(error_message, '') || ' [OCR removed — re-upload required]'
where status in ('needs_ocr','ocr_pending','ocr_running','ocr_completed');

update public.pdf_imports
set extraction_method = 'text'
where extraction_method in ('ocr','mixed');

-- Remove ocr key from text_quality jsonb if present
update public.pdf_imports
set text_quality = text_quality - 'ocr'
where text_quality ? 'ocr';

-- 3. Replace status check: keep minimal set
alter table public.pdf_imports drop constraint if exists pdf_imports_status_check;
alter table public.pdf_imports add constraint pdf_imports_status_check
  check (status in ('uploaded','extracting','parsing','completed','failed','cancelled'));

-- 4. Replace extraction_method check: text only
alter table public.pdf_imports drop constraint if exists pdf_imports_extraction_method_check;
alter table public.pdf_imports add constraint pdf_imports_extraction_method_check
  check (extraction_method is null or extraction_method in ('text'));
