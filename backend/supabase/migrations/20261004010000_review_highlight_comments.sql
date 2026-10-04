-- Private, explicitly saved teaching boards; never exposed to students.
create or replace function public.valid_review_annotation(v jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare s jsonb; p jsonb; c jsonb; r jsonb;
begin
  if v is null or jsonb_typeof(v) <> 'object' or octet_length(v::text) > 1000000
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
  if v ? 'comments' then
    if jsonb_typeof(v->'comments') <> 'array' or jsonb_array_length(v->'comments') > 100 then return false; end if;
    if (select count(distinct value->>'id') from jsonb_array_elements(v->'comments')) <> jsonb_array_length(v->'comments') then return false; end if;
    for c in select value from jsonb_array_elements(v->'comments') loop
      if jsonb_typeof(c) <> 'object' or not (c ?& array['id','text','x','y','highlights'])
        or jsonb_typeof(c->'id') <> 'string' or (c->>'id') !~ '^[a-zA-Z0-9-]{1,64}$'
        or jsonb_typeof(c->'text') <> 'string' or length(c->>'text') > 2000
        or jsonb_typeof(c->'x') <> 'number' or (c->>'x')::numeric not between 0 and 700
        or jsonb_typeof(c->'y') <> 'number' or (c->>'y')::numeric not between 0 and (v->>'height')::numeric - 180
        or jsonb_typeof(c->'highlights') <> 'array' or jsonb_array_length(c->'highlights') not between 1 and 100 then return false; end if;
      for r in select value from jsonb_array_elements(c->'highlights') loop
        if jsonb_typeof(r) <> 'object' or not (r ?& array['x','y','width','height'])
          or jsonb_typeof(r->'x') <> 'number' or jsonb_typeof(r->'y') <> 'number'
          or jsonb_typeof(r->'width') <> 'number' or jsonb_typeof(r->'height') <> 'number'
          or (r->>'x')::numeric < 0 or (r->>'y')::numeric < 0
          or (r->>'width')::numeric <= 0 or (r->>'height')::numeric <= 0
          or (r->>'x')::numeric + (r->>'width')::numeric > 960
          or (r->>'y')::numeric + (r->>'height')::numeric > (v->>'height')::numeric then return false; end if;
      end loop;
    end loop;
  end if;
  return true;
exception when others then return false;
end $$;
