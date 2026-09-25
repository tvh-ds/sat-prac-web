-- Required student and parent contact details, with an admin approval gate.
alter table public.student_profiles
  add column if not exists phone_number text,
  add column if not exists parent_name text,
  add column if not exists parent_phone_number text,
  add column if not exists profile_status text not null default 'incomplete'
    check (profile_status in ('incomplete', 'pending', 'approved')),
  add column if not exists profile_submitted_at timestamptz,
  add column if not exists profile_approved_at timestamptz,
  add column if not exists profile_approved_by uuid references public.profiles(id) on delete set null;

alter table public.student_profiles
  add constraint student_profiles_approved_contacts_present
  check (
    profile_status <> 'approved'
    or (
      nullif(btrim(phone_number), '') is not null
      and nullif(btrim(parent_name), '') is not null
      and nullif(btrim(parent_phone_number), '') is not null
    )
  );

create index if not exists student_profiles_profile_status_idx
  on public.student_profiles (profile_status, created_at desc);

-- Profile changes must go through the validated submission endpoint so edits
-- to an approved student's name cannot bypass the approval state.
drop policy if exists "profiles_update_own" on public.profiles;
