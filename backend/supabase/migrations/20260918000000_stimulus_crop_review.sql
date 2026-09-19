-- =============================================================================
-- Stimulus crop review: OCR auto-crop on import + admin confirm/adjust flow.
--
-- draft_questions gains:
--   stimulus_source_image_path: immutable full-page render (recovery source
--     for the crop editor; never overwritten by crops).
--   stimulus_crop_rect: pixel {x,y,w,h} of the active crop in full-page
--     source coordinates (null when showing the full page).
--   stimulus_crop_source: 'auto' | 'manual' | 'full_page'.
--   stimulus_crop_status: 'pending' | 'confirmed'. New visual drafts start
--     pending; Full Draft approval is blocked while any non-rejected visual
--     draft is pending. Legacy rows are backfilled as full_page/confirmed so
--     existing approvability is preserved.
-- =============================================================================

alter table public.draft_questions
  add column if not exists stimulus_source_image_path text,
  add column if not exists stimulus_crop_rect jsonb,
  add column if not exists stimulus_crop_source text check (stimulus_crop_source in ('auto', 'manual', 'full_page')),
  add column if not exists stimulus_crop_status text check (stimulus_crop_status in ('pending', 'confirmed'));

-- Backfill legacy rows: they only ever had a full-page image.
update public.draft_questions
set stimulus_source_image_path = coalesce(stimulus_source_image_path, stimulus_image_path),
    stimulus_crop_source = coalesce(stimulus_crop_source, 'full_page'),
    stimulus_crop_status = coalesce(stimulus_crop_status, 'confirmed')
where has_visual_stimulus is true;

create index if not exists draft_questions_crop_status_idx
  on public.draft_questions (pdf_import_id, stimulus_crop_status)
  where has_visual_stimulus is true;
