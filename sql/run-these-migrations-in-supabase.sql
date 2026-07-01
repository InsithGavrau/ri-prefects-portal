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

begin;

-- Coordinator-marked attendance is official immediately.
-- This migration replaces the old attendance approval workflow with record states:
-- recorded = coordinator submitted official attendance
-- corrected = teacher/admin corrected a status or added notes
-- flagged = retained compatibility state for records that were previously rejected

alter table if exists public.attendance_sessions
  add column if not exists review_status text not null default 'recorded',
  add column if not exists session_status text not null default 'submitted';

alter table if exists public.attendance_sessions
  alter column review_status set default 'recorded';

alter table if exists public.attendance_sessions
  drop constraint if exists attendance_sessions_review_status_check;
alter table if exists public.attendance_sessions
  drop constraint if exists attendance_sessions_session_status_check;

update public.attendance_sessions
set
  session_status = case
    when session_status in ('draft','submitted') then session_status
    else 'submitted'
  end,
  review_status = case
    when review_status in ('recorded','corrected','flagged') then review_status
    when review_status = 'approved' then 'corrected'
    when review_status = 'rejected' then 'flagged'
    else 'recorded'
  end;

alter table if exists public.attendance_sessions
  add constraint attendance_sessions_session_status_check
  check (session_status in ('draft','submitted'));
alter table if exists public.attendance_sessions
  add constraint attendance_sessions_review_status_check
  check (review_status in ('recorded','corrected','flagged'));

create or replace function private.sync_session_compat()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.session_status := case
    when coalesce(new.session_status, 'submitted') in ('draft','submitted') then coalesce(new.session_status, 'submitted')
    else 'submitted'
  end;
  new.review_status := case coalesce(new.review_status, 'recorded')
    when 'pending' then 'recorded'
    when 'approved' then 'corrected'
    when 'rejected' then 'flagged'
    when 'recorded' then 'recorded'
    when 'corrected' then 'corrected'
    when 'flagged' then 'flagged'
    else 'recorded'
  end;
  new.reviewed_by := coalesce(new.reviewed_by, new.approved_by);
  new.approved_by := coalesce(new.approved_by, new.reviewed_by);
  new.reviewed_at := coalesce(new.reviewed_at, new.approved_at);
  new.approved_at := coalesce(new.approved_at, new.reviewed_at);
  return new;
end; $$;

drop trigger if exists sync_session_compat on public.attendance_sessions;
create trigger sync_session_compat before insert or update on public.attendance_sessions
for each row execute function private.sync_session_compat();

create or replace function private.is_owned_recorded_session(target_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.attendance_sessions
    where id = target_session_id
      and coordinator_profile_id = (select auth.uid())
      and review_status in ('recorded','pending')
      and session_status = 'submitted'
  );
$$;
revoke all on function private.is_owned_recorded_session(uuid) from public, anon;
grant execute on function private.is_owned_recorded_session(uuid) to authenticated;

drop policy if exists sessions_cleanup_delete on public.attendance_sessions;
create policy sessions_cleanup_delete on public.attendance_sessions for delete to authenticated
using (
  private.current_role()='admin'
  or (
    coordinator_profile_id=(select auth.uid())
    and review_status in ('recorded','pending')
    and not exists (
      select 1 from public.attendance_records
      where attendance_session_id = attendance_sessions.id or session_id = attendance_sessions.id
    )
  )
);

drop policy if exists records_insert on public.attendance_records;
create policy records_insert on public.attendance_records for insert to authenticated
with check (
  private.current_role() in ('coordinator','admin')
  and private.is_owned_recorded_session(attendance_session_id)
);

commit;
