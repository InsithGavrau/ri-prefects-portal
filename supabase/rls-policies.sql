begin;

create or replace function private.current_role()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when account_status='active' or (role='prefect' and account_status='pending') then role
    else null
  end
  from public.profiles where id = (select auth.uid());
$$;
revoke all on function private.current_role() from public, anon;
grant execute on function private.current_role() to authenticated;

create or replace function private.has_own_attendance_record(target_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.attendance_records
    where (attendance_session_id = target_session_id or session_id = target_session_id)
      and prefect_profile_id = (select auth.uid())
  );
$$;
revoke all on function private.has_own_attendance_record(uuid) from public, anon;
grant execute on function private.has_own_attendance_record(uuid) to authenticated;

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

create or replace function private.protect_profile_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor text;
begin
  if (select auth.uid()) is null then return new; end if;
  actor := private.current_role();
  if new.id <> old.id or new.email <> old.email then raise exception 'Identity fields cannot be changed here'; end if;
  if actor = 'admin' then
    if old.id = (select auth.uid()) and new.role <> old.role then raise exception 'Admins cannot change their own role'; end if;
  elsif actor = 'teacher' then
    if new.role <> old.role then raise exception 'Teachers cannot change roles'; end if;
  else
    if new.role <> old.role or new.account_status <> old.account_status or new.first_name <> old.first_name then
      raise exception 'You may only update your phone and current class';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists protect_profile_update on public.profiles;
create trigger protect_profile_update before update on public.profiles for each row execute function private.protect_profile_update();

create or replace function private.validate_assignment_location()
returns trigger language plpgsql set search_path = '' as $$
declare duty_name text;
begin
  select name into duty_name from public.duty_types where id = new.duty_type_id and is_active;
  if duty_name is null then
    raise exception 'Selected duty type is not active';
  end if;

  if duty_name = 'Checkpoint Duty' then
    if new.duty_location_id is not null then
      raise exception 'Checkpoint Duty does not use a specific location';
    end if;
    return new;
  end if;

  if duty_name in ('Floor Duty','Canteen Duty') and new.duty_location_id is null then
    raise exception 'This duty type requires an active duty location';
  end if;

  if new.duty_location_id is not null and not exists (
    select 1 from public.duty_locations
    where id = new.duty_location_id and duty_type_id = new.duty_type_id and is_active
  ) then
    raise exception 'Duty location does not belong to the selected active duty type';
  end if;

  return new;
end; $$;

create or replace function private.validate_attendance_session_location()
returns trigger language plpgsql set search_path = '' as $$
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
    raise exception 'Selected attendance duty type is not active';
  end if;

  if selected_duty_name = 'Checkpoint Duty' then
    new.duty_location_id := null;
    return new;
  end if;

  if selected_duty_name not in ('Floor Duty','Canteen Duty') then
    raise exception 'Selected attendance duty type is not supported';
  end if;

  if new.duty_location_id is null then
    raise exception '% attendance requires an active location', selected_duty_name;
  end if;

  select location.duty_type_id, trim(location_type.name)
  into location_duty_type_id, location_duty_name
  from public.duty_locations location
  join public.duty_types location_type on location_type.id = location.duty_type_id
  where location.id = new.duty_location_id
    and coalesce(location.is_active, location.active, true)
    and coalesce(location_type.is_active, location_type.active, true);

  if location_duty_type_id is null then
    raise exception 'Selected attendance location is no longer active. Reload and choose it again.';
  end if;

  if location_duty_name is distinct from selected_duty_name then
    raise exception 'Selected location is for %, not %. Reload the attendance list.', location_duty_name, selected_duty_name;
  end if;

  new.duty_type_id := location_duty_type_id;
  return new;
end; $$;
drop trigger if exists validate_assignment_location on public.prefect_duty_assignments;
create trigger validate_assignment_location before insert or update of duty_type_id,duty_location_id on public.prefect_duty_assignments for each row execute function private.validate_assignment_location();
drop trigger if exists validate_assignment_location on public.attendance_sessions;
drop trigger if exists validate_session_location on public.attendance_sessions;
drop trigger if exists validate_attendance_session_location on public.attendance_sessions;
create trigger validate_attendance_session_location before insert or update of duty_type_id,duty_location_id on public.attendance_sessions for each row execute function private.validate_attendance_session_location();

alter table public.profiles enable row level security;
alter table public.duty_types enable row level security;
alter table public.duty_locations enable row level security;
alter table public.prefect_duty_assignments enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.audit_logs enable row level security;

do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies
    where schemaname='public' and tablename in (
      'profiles','duty_types','duty_locations','prefect_duty_assignments',
      'attendance_sessions','attendance_records','audit_logs'
    ) loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create policy profiles_select on public.profiles for select to authenticated
using (id=(select auth.uid()) or private.current_role() in ('coordinator','teacher','admin'));
create policy profiles_update on public.profiles for update to authenticated
using (id=(select auth.uid()) or private.current_role() in ('teacher','admin'))
with check (id=(select auth.uid()) or private.current_role() in ('teacher','admin'));

create policy duty_types_select on public.duty_types for select to authenticated
using (is_active or private.current_role() in ('teacher','admin'));
create policy duty_types_admin_all on public.duty_types for all to authenticated
using (private.current_role()='admin') with check (private.current_role()='admin');
create policy duty_locations_select on public.duty_locations for select to authenticated
using (is_active or private.current_role() in ('teacher','admin'));
create policy duty_locations_admin_all on public.duty_locations for all to authenticated
using (private.current_role()='admin') with check (private.current_role()='admin');

create policy assignments_select on public.prefect_duty_assignments for select to authenticated
using (prefect_profile_id=(select auth.uid()) or private.current_role() in ('coordinator','teacher','admin'));
create policy assignments_insert_own on public.prefect_duty_assignments for insert to authenticated
with check (
  prefect_profile_id=(select auth.uid())
  and profile_id=(select auth.uid())
  and private.current_role() in ('prefect','coordinator')
  and assignment_status='pending'
);
create policy assignments_update_own_pending on public.prefect_duty_assignments for update to authenticated
using (
  prefect_profile_id=(select auth.uid())
  and profile_id=(select auth.uid())
  and private.current_role() in ('prefect','coordinator')
  and assignment_status='pending'
)
with check (
  prefect_profile_id=(select auth.uid())
  and profile_id=(select auth.uid())
  and private.current_role() in ('prefect','coordinator')
  and assignment_status='pending'
);
create policy assignments_staff_update on public.prefect_duty_assignments for update to authenticated
using (private.current_role() in ('teacher','admin')) with check (private.current_role() in ('teacher','admin'));
create policy assignments_delete on public.prefect_duty_assignments for delete to authenticated
using (
  (
    prefect_profile_id=(select auth.uid())
    and profile_id=(select auth.uid())
    and private.current_role() in ('prefect','coordinator')
    and assignment_status='pending'
  )
  or private.current_role()='admin'
);

create policy sessions_select on public.attendance_sessions for select to authenticated
using (
  private.current_role() in ('coordinator','teacher','admin')
  or private.has_own_attendance_record(id)
);
create policy sessions_insert on public.attendance_sessions for insert to authenticated
with check (
  private.current_role()='admin'
  or (
    private.current_role()='coordinator'
    and coordinator_profile_id=(select auth.uid())
  )
);
create policy sessions_teacher_update on public.attendance_sessions for update to authenticated
using (private.current_role() in ('teacher','admin')) with check (private.current_role() in ('teacher','admin'));
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

create policy records_select on public.attendance_records for select to authenticated
using (prefect_profile_id=(select auth.uid()) or private.current_role() in ('coordinator','teacher','admin'));
create policy records_insert on public.attendance_records for insert to authenticated
with check (
  private.current_role()='admin'
  or (
    private.current_role()='coordinator'
    and private.is_owned_recorded_session(coalesce(attendance_session_id, session_id))
  )
);
create policy records_teacher_update on public.attendance_records for update to authenticated
using (private.current_role() in ('teacher','admin')) with check (private.current_role() in ('teacher','admin'));
create policy audit_admin_select on public.audit_logs for select to authenticated using (private.current_role()='admin');

revoke all on all tables in schema public from anon;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.duty_types, public.duty_locations to authenticated;
grant insert, update, delete on public.duty_types, public.duty_locations to authenticated;
grant select, insert, update, delete on public.prefect_duty_assignments to authenticated;
grant select, insert, update, delete on public.attendance_sessions to authenticated;
grant select, insert, update on public.attendance_records to authenticated;
grant select on public.audit_logs to authenticated;

do $$ begin
  if to_regclass('public.audit_logs_id_seq') is not null then
    grant usage, select on sequence public.audit_logs_id_seq to authenticated;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
