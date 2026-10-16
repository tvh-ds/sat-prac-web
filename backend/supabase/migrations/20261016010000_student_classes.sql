create table public.student_classes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index student_classes_name_unique on public.student_classes(lower(btrim(name)));
create table public.student_class_members (
  class_id uuid not null references public.student_classes(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  primary key(class_id, student_id)
);
create index student_class_members_student_idx on public.student_class_members(student_id);
alter table public.student_classes enable row level security;
alter table public.student_class_members enable row level security;
create policy student_classes_admin on public.student_classes for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy student_class_members_admin on public.student_class_members for all to authenticated using(public.is_admin()) with check(public.is_admin());
grant all on public.student_classes, public.student_class_members to service_role;
grant select, insert, update, delete on public.student_classes, public.student_class_members to authenticated;

alter table public.practice_assignment_batches
  add column class_id uuid references public.student_classes(id) on delete set null,
  add column class_name text;
alter table public.full_test_assignment_batches
  add column class_id uuid references public.student_classes(id) on delete set null,
  add column class_name text;
alter table public.test_assignments
  add column class_id uuid references public.student_classes(id) on delete set null,
  add column class_name text;
create index practice_assignment_batches_class_idx on public.practice_assignment_batches(class_id);
create index full_test_assignment_batches_class_idx on public.full_test_assignment_batches(class_id);
create index test_assignments_class_idx on public.test_assignments(class_id);

-- Save roster replacements atomically: validation failures cannot erase members.
create function public.save_student_class(p_id uuid, p_name text, p_student_ids uuid[], p_admin_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ids uuid[];
begin
  if coalesce(auth.role(), '') <> 'service_role' or not exists(select 1 from public.profiles where id=p_admin_id and role='admin') then
    raise exception 'admin service role required';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 100 or p_student_ids is null or cardinality(p_student_ids)>1000 then
    raise exception 'invalid class';
  end if;
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids from unnest(p_student_ids) x;
  if exists(select 1 from unnest(v_ids) x where x is null or not exists(select 1 from public.student_profiles s join public.profiles p on p.id=s.id where s.id=x and p.role='student')) then
    raise exception 'class members must be students';
  end if;
  if p_id is null then
    insert into public.student_classes(name,created_by) values(btrim(p_name),p_admin_id) returning id into v_id;
  else
    update public.student_classes set name=btrim(p_name) where id=p_id returning id into v_id;
    if v_id is null then raise exception 'class not found'; end if;
  end if;
  delete from public.student_class_members where class_id=v_id;
  insert into public.student_class_members(class_id,student_id) select v_id,x from unnest(v_ids) x;
  return v_id;
end; $$;
revoke all on function public.save_student_class(uuid,text,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.save_student_class(uuid,text,uuid[],uuid) to service_role;
