begin;

-- Removes Codex/test prototype rows from the live portal database.
-- Also removes old prototype duty options that should no longer exist:
-- Bag Checking Duty, Checkpoint Duty / Front Entrance, and Checkpoint Duty / Back Entrance.
--
-- Paste this whole file into the Supabase SQL Editor. Do not paste the file name.

alter table if exists public.attendance_records
  add column if not exists session_id uuid references public.attendance_sessions(id) on delete cascade,
  add column if not exists marked_by uuid references public.profiles(id) on delete set null;

update public.attendance_records
set session_id = attendance_session_id
where session_id is null
  and attendance_session_id is not null;

create temporary table cleanup_codex_profiles on commit drop as
select distinct id
from public.profiles
where lower(trim(coalesce(first_name, ''))) like 'codex%'
   or lower(coalesce(email, '')) like '%codex%';

create temporary table cleanup_legacy_duty_types on commit drop as
select id
from public.duty_types
where name = 'Bag Checking Duty';

create temporary table cleanup_legacy_locations on commit drop as
select l.id
from public.duty_locations l
join public.duty_types t on t.id = l.duty_type_id
where t.id in (select id from cleanup_legacy_duty_types)
   or (
    t.name = 'Checkpoint Duty'
    and coalesce(l.name, l.location_name) in ('Front Entrance', 'Back Entrance')
   );

create temporary table cleanup_sessions on commit drop as
select distinct s.id
from public.attendance_sessions s
where s.coordinator_profile_id in (select id from cleanup_codex_profiles)
   or s.duty_type_id in (select id from cleanup_legacy_duty_types)
   or s.duty_location_id in (select id from cleanup_legacy_locations);

create temporary table cleanup_records on commit drop as
select distinct r.id
from public.attendance_records r
where r.attendance_session_id in (select id from cleanup_sessions)
   or r.session_id in (select id from cleanup_sessions)
   or r.prefect_profile_id in (select id from cleanup_codex_profiles)
   or r.marked_by in (select id from cleanup_codex_profiles);

create temporary table cleanup_assignments on commit drop as
select distinct a.id
from public.prefect_duty_assignments a
where a.profile_id in (select id from cleanup_codex_profiles)
   or a.prefect_profile_id in (select id from cleanup_codex_profiles)
   or a.duty_type_id in (select id from cleanup_legacy_duty_types)
   or a.duty_location_id in (select id from cleanup_legacy_locations);

delete from public.attendance_records
where id in (select id from cleanup_records);

delete from public.attendance_sessions
where id in (select id from cleanup_sessions);

delete from public.prefect_duty_assignments
where id in (select id from cleanup_assignments);

delete from public.duty_locations
where id in (select id from cleanup_legacy_locations);

delete from public.duty_types
where id in (select id from cleanup_legacy_duty_types);

delete from public.profiles
where id in (select id from cleanup_codex_profiles);

delete from auth.users
where id in (select id from cleanup_codex_profiles);

delete from public.audit_logs
where user_id in (select id from cleanup_codex_profiles)
   or actor_profile_id in (select id from cleanup_codex_profiles)
   or record_id in (select id from cleanup_codex_profiles)
   or record_id in (select id from cleanup_records)
   or record_id in (select id from cleanup_sessions)
   or record_id in (select id from cleanup_assignments)
   or record_id in (select id from cleanup_legacy_locations)
   or record_id in (select id from cleanup_legacy_duty_types)
   or old_data::text ilike '%codex%'
   or new_data::text ilike '%codex%'
   or details::text ilike '%codex%'
   or old_data::text ilike '%front entrance%'
   or new_data::text ilike '%front entrance%'
   or details::text ilike '%front entrance%'
   or old_data::text ilike '%back entrance%'
   or new_data::text ilike '%back entrance%'
   or details::text ilike '%back entrance%'
   or old_data::text ilike '%bag checking duty%'
   or new_data::text ilike '%bag checking duty%'
   or details::text ilike '%bag checking duty%';

commit;

select
  (select count(*) from public.profiles where lower(trim(coalesce(first_name, ''))) like 'codex%' or lower(coalesce(email, '')) like '%codex%') as remaining_codex_profiles,
  (select count(*) from public.duty_types where name = 'Bag Checking Duty') as remaining_bag_checking_duty_types,
  (
    select count(*)
    from public.duty_locations l
    join public.duty_types t on t.id = l.duty_type_id
    where t.name = 'Checkpoint Duty'
      and coalesce(l.name, l.location_name) in ('Front Entrance', 'Back Entrance')
  ) as remaining_checkpoint_entrance_locations;
