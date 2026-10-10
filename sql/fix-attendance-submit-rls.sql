begin;

-- Targeted fix for Coordinator > Confirm and submit attendance.
-- Paste this SQL content into the Supabase SQL Editor.
-- Do not paste the filename itself.
-- This file avoids DO $$ blocks so partial selection/paste errors are easier to avoid.

create schema if not exists private;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema private to authenticated, service_role;

alter table public.prefect_duty_assignments
  add column if not exists assignment_scope text not null default 'weekday';

alter table public.prefect_duty_assignments
  alter column assigned_day drop not null,
  alter column duty_location_id drop not null;

drop trigger if exists validate_assignment_scope on public.prefect_duty_assignments;

update public.prefect_duty_assignments assignment
set
  assignment_scope = 'permanent',
  assigned_day = null
from public.duty_types duty
where assignment.duty_type_id = duty.id
  and duty.name = 'Floor Duty'
  and (
    assignment.assignment_scope is distinct from 'permanent'
    or assignment.assigned_day is not null
  );

update public.prefect_duty_assignments assignment
set
  assignment_scope = 'weekday',
  assigned_day = coalesce(assignment.assigned_day, 'Any')
from public.duty_types duty
where assignment.duty_type_id = duty.id
  and duty.name in ('Checkpoint Duty','Canteen Duty')
  and (
    assignment.assignment_scope is distinct from 'weekday'
    or assignment.assigned_day is null
  );

create or replace function private.validate_prefect_duty_assignment_scope()
returns trigger
language plpgsql
set search_path = ''
as '
declare
  duty_name text;
begin
  select name into duty_name
  from public.duty_types
  where id = new.duty_type_id and is_active;

  if duty_name is null then
    raise exception ''Selected duty type is not active'';
  end if;

  if duty_name = ''Floor Duty'' then
    if new.assignment_scope <> ''permanent'' then
      raise exception ''Floor Duty assignments must use assignment_scope permanent'';
    end if;
    if new.assigned_day is not null then
      raise exception ''Floor Duty assignments must not have an assigned day'';
    end if;
    if new.duty_location_id is null then
      raise exception ''Floor Duty assignments require a floor/class location'';
    end if;
  elsif duty_name = ''Checkpoint Duty'' then
    if new.assignment_scope <> ''weekday'' then
      raise exception ''Checkpoint Duty assignments must use assignment_scope weekday'';
    end if;
    if new.assigned_day is null then
      raise exception ''Checkpoint Duty assignments require an assigned day'';
    end if;
    if new.duty_location_id is not null then
      raise exception ''Checkpoint Duty assignments do not use a specific location'';
    end if;
  elsif duty_name = ''Canteen Duty'' then
    if new.assignment_scope <> ''weekday'' then
      raise exception ''Canteen Duty assignments must use assignment_scope weekday'';
    end if;
    if new.assigned_day is null then
      raise exception ''Canteen Duty assignments require an assigned day'';
    end if;
    if new.duty_location_id is null then
      raise exception ''Canteen Duty assignments require the Canteen location'';
    end if;
  end if;

  if new.assigned_day is not null and new.assigned_day not in (''Monday'',''Tuesday'',''Wednesday'',''Thursday'',''Friday'',''Any'') then
    raise exception ''Assigned day must be Monday, Tuesday, Wednesday, Thursday, Friday, or Any'';
  end if;

  if new.duty_location_id is not null and not exists (
    select 1
    from public.duty_locations
    where id = new.duty_location_id
      and duty_type_id = new.duty_type_id
      and is_active
  ) then
    raise exception ''Duty location does not belong to the selected active duty type'';
  end if;

  return new;
end;
';

create trigger validate_assignment_scope
before insert or update on public.prefect_duty_assignments
for each row execute function private.validate_prefect_duty_assignment_scope();

-- The legacy RLS file attached the assignment validator to attendance_sessions.
-- Replace it with a session-specific validator that treats the selected
-- location as authoritative and normalizes legacy same-named duty type IDs.
create or replace function private.validate_attendance_session_location()
returns trigger
language plpgsql
set search_path = ''
as '
declare
  selected_duty_name text;
  location_duty_type_id uuid;
  location_duty_name text;
begin
  select trim(name) into selected_duty_name
  from public.duty_types
  where id = new.duty_type_id
    and coalesce(is_active, active, true);

  if selected_duty_name is null then
    raise exception ''Selected attendance duty type is not active'';
  end if;

  if selected_duty_name = ''Checkpoint Duty'' then
    new.duty_location_id := null;
    return new;
  end if;

  if selected_duty_name not in (''Floor Duty'',''Canteen Duty'') then
    raise exception ''Selected attendance duty type is not supported'';
  end if;

  if new.duty_location_id is null then
    raise exception ''% attendance requires an active location'', selected_duty_name;
  end if;

  select location.duty_type_id, trim(location_type.name)
  into location_duty_type_id, location_duty_name
  from public.duty_locations location
  join public.duty_types location_type on location_type.id = location.duty_type_id
  where location.id = new.duty_location_id
    and coalesce(location.is_active, location.active, true)
    and coalesce(location_type.is_active, location_type.active, true);

  if location_duty_type_id is null then
    raise exception ''Selected attendance location is no longer active. Reload and choose it again.'';
  end if;

  if location_duty_name is distinct from selected_duty_name then
    raise exception ''Selected location is for %, not %. Reload the attendance list.'', location_duty_name, selected_duty_name;
  end if;

  new.duty_type_id := location_duty_type_id;
  return new;
end;
';

drop trigger if exists validate_assignment_location on public.attendance_sessions;
drop trigger if exists validate_session_location on public.attendance_sessions;
drop trigger if exists validate_attendance_session_location on public.attendance_sessions;
create trigger validate_attendance_session_location
before insert or update of duty_type_id, duty_location_id on public.attendance_sessions
for each row execute function private.validate_attendance_session_location();

alter table public.attendance_sessions
  add column if not exists session_status text not null default 'submitted',
  add column if not exists submitted_at timestamptz not null default now(),
  add column if not exists review_status text not null default 'recorded',
  add column if not exists teacher_note text,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

-- Checkpoint Duty intentionally has no location. Older live schemas made this
-- column NOT NULL, which prevents otherwise valid Checkpoint submissions.
alter table public.attendance_sessions
  alter column duty_location_id drop not null;

alter table public.attendance_sessions
  drop constraint if exists attendance_sessions_session_status_check,
  drop constraint if exists attendance_sessions_review_status_check;

update public.attendance_sessions
set
  session_status = case when session_status in ('draft','submitted') then session_status else 'submitted' end,
  review_status = case
    when review_status in ('recorded','corrected','flagged') then review_status
    when review_status = 'approved' then 'corrected'
    when review_status = 'rejected' then 'flagged'
    else 'recorded'
  end,
  submitted_at = coalesce(submitted_at, now());

alter table public.attendance_sessions
  add constraint attendance_sessions_session_status_check
  check (session_status in ('draft','submitted')),
  add constraint attendance_sessions_review_status_check
  check (review_status in ('recorded','corrected','flagged'));

alter table public.attendance_records
  add column if not exists attendance_session_id uuid references public.attendance_sessions(id) on delete cascade,
  add column if not exists session_id uuid references public.attendance_sessions(id) on delete cascade,
  add column if not exists marked_by uuid references public.profiles(id) on delete set null,
  add column if not exists teacher_note text;

update public.attendance_records
set
  attendance_session_id = coalesce(attendance_session_id, session_id),
  session_id = coalesce(session_id, attendance_session_id);

create or replace function private.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as '
  select case
    when account_status = ''active'' or (role = ''prefect'' and account_status = ''pending'') then role
    else null
  end
  from public.profiles
  where id = (select auth.uid());
';

revoke all on function private.current_role() from public, anon;
grant execute on function private.current_role() to authenticated;

create or replace function private.has_own_attendance_record(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as '
  select exists (
    select 1
    from public.attendance_records
    where (attendance_session_id = target_session_id or session_id = target_session_id)
      and prefect_profile_id = (select auth.uid())
  );
';

revoke all on function private.has_own_attendance_record(uuid) from public, anon;
grant execute on function private.has_own_attendance_record(uuid) to authenticated;

create or replace function private.is_owned_recorded_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as '
  select exists (
    select 1
    from public.attendance_sessions
    where id = target_session_id
      and coordinator_profile_id = (select auth.uid())
      and review_status in (''recorded'', ''pending'')
      and session_status = ''submitted''
  );
';

revoke all on function private.is_owned_recorded_session(uuid) from public, anon;
grant execute on function private.is_owned_recorded_session(uuid) to authenticated;

alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;

drop policy if exists sessions_select on public.attendance_sessions;
drop policy if exists sessions_insert on public.attendance_sessions;
drop policy if exists sessions_teacher_update on public.attendance_sessions;
drop policy if exists sessions_cleanup_delete on public.attendance_sessions;

create policy sessions_select
on public.attendance_sessions
for select
to authenticated
using (
  private.current_role() in ('coordinator','teacher','admin')
  or private.has_own_attendance_record(id)
);

create policy sessions_insert
on public.attendance_sessions
for insert
to authenticated
with check (
  private.current_role() = 'admin'
  or (
    private.current_role() = 'coordinator'
    and coordinator_profile_id = (select auth.uid())
  )
);

create policy sessions_teacher_update
on public.attendance_sessions
for update
to authenticated
using (private.current_role() in ('teacher','admin'))
with check (private.current_role() in ('teacher','admin'));

create policy sessions_cleanup_delete
on public.attendance_sessions
for delete
to authenticated
using (
  private.current_role() = 'admin'
  or (
    coordinator_profile_id = (select auth.uid())
    and review_status in ('recorded','pending')
    and not exists (
      select 1
      from public.attendance_records
      where attendance_session_id = attendance_sessions.id
         or session_id = attendance_sessions.id
    )
  )
);

drop policy if exists records_select on public.attendance_records;
drop policy if exists records_insert on public.attendance_records;
drop policy if exists records_teacher_update on public.attendance_records;

create policy records_select
on public.attendance_records
for select
to authenticated
using (
  prefect_profile_id = (select auth.uid())
  or private.current_role() in ('coordinator','teacher','admin')
);

create policy records_insert
on public.attendance_records
for insert
to authenticated
with check (
  private.current_role() = 'admin'
  or (
    private.current_role() = 'coordinator'
    and private.is_owned_recorded_session(coalesce(attendance_session_id, session_id))
  )
);

create policy records_teacher_update
on public.attendance_records
for update
to authenticated
using (private.current_role() in ('teacher','admin'))
with check (private.current_role() in ('teacher','admin'));

grant select, update on public.profiles to authenticated;
grant select on public.duty_types to authenticated;
grant select on public.duty_locations to authenticated;
grant select, insert, update, delete on public.prefect_duty_assignments to authenticated;
grant select, insert, update, delete on public.attendance_sessions to authenticated;
grant select, insert, update on public.attendance_records to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public
grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
grant usage, select on sequences to authenticated;

notify pgrst, 'reload schema';

commit;
