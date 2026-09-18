-- Question-bank import metadata and rendered stimulus assets.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-assets', 'question-assets', false, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.draft_questions
add column if not exists source_question_id text,
add column if not exists explanation text,
add column if not exists has_visual_stimulus boolean not null default false,
add column if not exists stimulus_image_path text,
add column if not exists parser_metadata jsonb not null default '{}';

alter table public.questions
add column if not exists source_question_id text,
add column if not exists stimulus_image_path text;

create unique index if not exists draft_questions_import_source_question_unique
on public.draft_questions (pdf_import_id, source_question_id)
where source_question_id is not null;

create unique index if not exists questions_source_question_unique
on public.questions (source_question_id)
where source_question_id is not null;

create index if not exists draft_questions_visual_idx
on public.draft_questions (has_visual_stimulus);

drop policy if exists "question_assets_admin_insert" on storage.objects;
drop policy if exists "question_assets_admin_select" on storage.objects;
drop policy if exists "question_assets_admin_update" on storage.objects;
drop policy if exists "question_assets_admin_delete" on storage.objects;

create policy "question_assets_admin_insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'question-assets' and public.is_admin());

create policy "question_assets_admin_select"
on storage.objects for select to authenticated
using (bucket_id = 'question-assets' and public.is_admin());

create policy "question_assets_admin_update"
on storage.objects for update to authenticated
using (bucket_id = 'question-assets' and public.is_admin())
with check (bucket_id = 'question-assets' and public.is_admin());

create policy "question_assets_admin_delete"
on storage.objects for delete to authenticated
using (bucket_id = 'question-assets' and public.is_admin());
