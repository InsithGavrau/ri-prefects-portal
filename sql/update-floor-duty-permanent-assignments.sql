begin;

-- Floor Duty is continuous until a teacher/admin changes it. It has no assigned weekday.

alter table public.prefect_duty_assignments
  add column if not exists assignment_scope text not null default 'weekday';

alter table public.prefect_duty_assignments
  alter column assigned_day drop not null,
  alter column duty_location_id drop not null;

alter table public.attendance_sessions
  alter column duty_location_id drop not null;

alter table public.prefect_duty_assignments
  drop constraint if exists prefect_duty_assignments_assigned_day_check,
  drop constraint if exists prefect_duty_assignments_assignment_scope_check,
  drop constraint if exists prefect_duty_assignments_profile_id_duty_type_id_duty_location_id_assigned_day_key,
  drop constraint if exists prefect_duty_assignments_prefect_profile_id_duty_type_id_duty_location_id_assigned_day_key;

alter table public.prefect_duty_assignments
  add constraint prefect_duty_assignments_assigned_day_check
  check (assigned_day is null or assigned_day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Any')),
  add constraint prefect_duty_assignments_assignment_scope_check
  check (assignment_scope in ('weekday','permanent'));

drop index if exists public.uniq_prefect_active_assignment;
create unique index uniq_prefect_active_assignment
  on public.prefect_duty_assignments (
    prefect_profile_id,
    duty_type_id,
    coalesce(duty_location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(assigned_day, '__permanent__'),
    assignment_scope
  )
  where assignment_status in ('pending','active');

drop index if exists public.uniq_attendance_session_submitted;
create unique index uniq_attendance_session_submitted
  on public.attendance_sessions (
    attendance_date,
    duty_type_id,
    coalesce(duty_location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coordinator_profile_id
  )
  where session_status <> 'draft';

update public.prefect_duty_assignments a
set assignment_scope = 'permanent',
    assigned_day = null
from public.duty_types t
where t.id = a.duty_type_id
  and t.name = 'Floor Duty';

update public.prefect_duty_assignments a
set assignment_scope = 'weekday',
    assigned_day = coalesce(a.assigned_day, 'Any')
from public.duty_types t
where t.id = a.duty_type_id
  and t.name in ('Checkpoint Duty','Canteen Duty');

create or replace function private.validate_prefect_duty_assignment_scope()
returns trigger language plpgsql set search_path = '' as $$
declare duty_name text;
begin
  select name into duty_name from public.duty_types where id = new.duty_type_id and is_active;
  if duty_name is null then
    raise exception 'Selected duty type is not active';
  end if;

  if duty_name = 'Floor Duty' then
    if new.assignment_scope <> 'permanent' then
      raise exception 'Floor Duty assignments must use assignment_scope permanent';
    end if;
    if new.assigned_day is not null then
      raise exception 'Floor Duty assignments must not have an assigned day';
    end if;
    if new.duty_location_id is null then
      raise exception 'Floor Duty assignments require a floor/class location';
    end if;
  elsif duty_name = 'Checkpoint Duty' then
    if new.assignment_scope <> 'weekday' then
      raise exception 'Checkpoint Duty assignments must use assignment_scope weekday';
    end if;
    if new.assigned_day is null then
      raise exception 'Checkpoint Duty assignments require an assigned day';
    end if;
    if new.duty_location_id is not null then
      raise exception 'Checkpoint Duty assignments do not use a specific location';
    end if;
  elsif duty_name = 'Canteen Duty' then
    if new.assignment_scope <> 'weekday' then
      raise exception 'Canteen Duty assignments must use assignment_scope weekday';
    end if;
    if new.assigned_day is null then
      raise exception 'Canteen Duty assignments require an assigned day';
    end if;
    if new.duty_location_id is null then
      raise exception 'Canteen Duty assignments require the Canteen location';
    end if;
  end if;

  if new.assigned_day is not null and new.assigned_day not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Any') then
    raise exception 'Assigned day must be Monday, Tuesday, Wednesday, Thursday, Friday, or Any';
  end if;
  if new.duty_location_id is not null and not exists (
    select 1 from public.duty_locations
    where id = new.duty_location_id and duty_type_id = new.duty_type_id and is_active
  ) then
    raise exception 'Duty location does not belong to the selected active duty type';
  end if;
  return new;
end; $$;

drop trigger if exists validate_assignment_scope on public.prefect_duty_assignments;
create trigger validate_assignment_scope
before insert or update on public.prefect_duty_assignments
for each row execute function private.validate_prefect_duty_assignment_scope();

commit;
