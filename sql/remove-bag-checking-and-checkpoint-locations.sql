begin;

-- Permanently remove legacy prototype duty options from live data.
-- This deletes dependent attendance data first so foreign keys are respected.

alter table if exists public.attendance_records
  add column if not exists session_id uuid references public.attendance_sessions(id) on delete cascade;

update public.attendance_records
set session_id = attendance_session_id
where session_id is null
  and attendance_session_id is not null;

with legacy_sessions as (
  select s.id
  from public.attendance_sessions s
  join public.duty_types t on t.id = s.duty_type_id
  where t.name = 'Bag Checking Duty'
)
delete from public.attendance_records r
using legacy_sessions s
where r.attendance_session_id = s.id or r.session_id = s.id;

delete from public.attendance_sessions s
using public.duty_types t
where s.duty_type_id = t.id
  and t.name = 'Bag Checking Duty';

delete from public.prefect_duty_assignments a
using public.duty_types t
where a.duty_type_id = t.id
  and t.name = 'Bag Checking Duty';

delete from public.duty_locations l
using public.duty_types t
where l.duty_type_id = t.id
  and t.name = 'Bag Checking Duty';

delete from public.duty_types
where name = 'Bag Checking Duty';

with removed_checkpoint_locations as (
  select l.id
  from public.duty_locations l
  join public.duty_types t on t.id = l.duty_type_id
  where t.name = 'Checkpoint Duty'
    and l.name in ('Front Entrance', 'Back Entrance')
),
removed_checkpoint_sessions as (
  select s.id
  from public.attendance_sessions s
  join removed_checkpoint_locations l on l.id = s.duty_location_id
)
delete from public.attendance_records r
using removed_checkpoint_sessions s
where r.attendance_session_id = s.id or r.session_id = s.id;

delete from public.attendance_sessions s
using public.duty_locations l, public.duty_types t
where s.duty_location_id = l.id
  and l.duty_type_id = t.id
  and t.name = 'Checkpoint Duty'
  and l.name in ('Front Entrance', 'Back Entrance');

delete from public.prefect_duty_assignments a
using public.duty_locations l, public.duty_types t
where a.duty_location_id = l.id
  and l.duty_type_id = t.id
  and t.name = 'Checkpoint Duty'
  and l.name in ('Front Entrance', 'Back Entrance');

delete from public.duty_locations l
using public.duty_types t
where l.duty_type_id = t.id
  and t.name = 'Checkpoint Duty'
  and l.name in ('Front Entrance', 'Back Entrance');

commit;
