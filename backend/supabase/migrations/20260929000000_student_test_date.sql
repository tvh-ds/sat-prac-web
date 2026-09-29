-- Optional student-owned scheduling preference, independent of profile approval.
alter table public.student_profiles add column test_date date;
comment on column public.student_profiles.test_date is 'Student SAT test date for the GMT+7 dashboard countdown; nullable. Account deletion removes this preference with the profile.';
