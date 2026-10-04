-- Optional dimensions preserve existing boards and are checked alongside the document validator.
create or replace function public.valid_review_comment_sizes(v jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare c jsonb; w numeric; h numeric;
begin
  if not (v ? 'comments') then return true; end if;
  for c in select value from jsonb_array_elements(v->'comments') loop
    if (c ? 'width' and jsonb_typeof(c->'width') <> 'number')
      or (c ? 'height' and jsonb_typeof(c->'height') <> 'number') then return false; end if;
    w := coalesce((c->>'width')::numeric,260);
    h := coalesce((c->>'height')::numeric,180);
    if w not between 180 and 600 or h not between 120 and 600
      or (c->>'x')::numeric + w > 960 or (c->>'y')::numeric + h > (v->>'height')::numeric then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;
alter table public.admin_review_annotations add constraint review_comment_sizes_valid
  check (public.valid_review_comment_sizes(document));
