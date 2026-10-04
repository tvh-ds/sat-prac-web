-- Private, explicitly saved teaching boards; never exposed to students.
create or replace function public.valid_review_annotation(v jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare s jsonb; p jsonb;
begin
  if jsonb_typeof(v) <> 'object' or octet_length(v::text) > 1000000
    or jsonb_typeof(v->'version') <> 'number' or v->>'version' <> '1'
    or jsonb_typeof(v->'theme') <> 'string' or v->>'theme' not in ('white','black')
    or jsonb_typeof(v->'notes') <> 'string' or length(v->>'notes') > 10000
    or jsonb_typeof(v->'height') <> 'number' or (v->>'height')::numeric not between 1000 and 20000
    or jsonb_typeof(v->'strokes') <> 'array' or jsonb_array_length(v->'strokes') > 2000
    or not (v ?& array['version','theme','notes','height','strokes']) then return false; end if;
  for s in select value from jsonb_array_elements(v->'strokes') loop
    if jsonb_typeof(s) <> 'object' or not (s ?& array['color','width','opacity','points'])
      or jsonb_typeof(s->'color') <> 'string' or (s->>'color') !~ '^#[0-9a-fA-F]{6}$'
      or jsonb_typeof(s->'width') <> 'number' or (s->>'width')::numeric not between 1 and 32
      or jsonb_typeof(s->'opacity') <> 'number' or (s->>'opacity')::numeric not in (0.3,1)
      or jsonb_typeof(s->'points') <> 'array' or jsonb_array_length(s->'points') not between 1 and 10000 then return false; end if;
    for p in select value from jsonb_array_elements(s->'points') loop
      if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2
        or jsonb_typeof(p->0) <> 'number' or jsonb_typeof(p->1) <> 'number'
        or (p->>0)::numeric not between 0 and 960 or (p->>1)::numeric not between 0 and 20000 then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end $$;

create table public.admin_review_annotations (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null check (length(scope) <= 200 and scope ~ '^admin-(practice-assignments|tests/assignment-batches)/[0-9a-f-]{36}(/attempts/[0-9a-f-]{36})?$'),
  question_id uuid not null references public.questions(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  document jsonb not null check (public.valid_review_annotation(document)),
  updated_at timestamptz not null default now(),
  primary key (owner_id, scope, question_id)
);
alter table public.admin_review_annotations enable row level security;
revoke all on public.admin_review_annotations from anon;
grant select, insert, update, delete on public.admin_review_annotations to authenticated;
create policy "Administrators manage their own review boards" on public.admin_review_annotations
  for all to authenticated using (public.is_admin() and owner_id = auth.uid())
  with check (public.is_admin() and owner_id = auth.uid());
