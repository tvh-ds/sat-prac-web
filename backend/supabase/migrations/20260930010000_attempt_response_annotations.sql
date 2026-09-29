alter table public.attempt_responses
  add column if not exists annotations jsonb not null default '[]'::jsonb;

alter table public.attempt_responses
  add constraint attempt_responses_annotations_array_check
  check (jsonb_typeof(annotations) = 'array');
