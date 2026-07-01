begin;

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (char_length(trim(first_name)) between 1 and 80),
  email text not null,
  phone text not null check (char_length(trim(phone)) between 3 and 30),
  current_class text not null check (char_length(trim(current_class)) between 1 and 40),
  role text not null default 'prefect' check (role in ('prefect','coordinator','teacher','admin')),
  account_status text not null default 'pending' check (account_status in ('pending','active','rejected','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.duty_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 100),
  description text,
  default_start_time time,
  default_end_time time,
  active boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.duty_locations (
  id uuid primary key default gen_random_uuid(),
  duty_type_id uuid not null references public.duty_types(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 160),
  location_name text not null check (char_length(trim(location_name)) between 1 and 160),
  building text,
  floor_name text,
  class_name text,
  location_category text not null default 'other' check (location_category in ('canteen','class','floor','corridor','staircase','other')),
  notes text,
  group_name text,
  sort_order integer not null default 100,
  active boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (duty_type_id, name, group_name)
);

create table if not exists public.prefect_duty_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  prefect_profile_id uuid not null references public.profiles(id) on delete cascade,
  duty_type_id uuid not null references public.duty_types(id) on delete restrict,
  duty_location_id uuid references public.duty_locations(id) on delete restrict,
  assigned_day text check (assigned_day is null or assigned_day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Any')),
  assignment_scope text not null default 'weekday' check (assignment_scope in ('weekday','permanent')),
  assignment_status text not null default 'pending' check (assignment_status in ('pending','active','rejected','inactive')),
  note text check (note is null or char_length(note) <= 500),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  attendance_date date not null check (extract(isodow from attendance_date) between 1 and 5),
  duty_type_id uuid not null references public.duty_types(id) on delete restrict,
  duty_location_id uuid references public.duty_locations(id) on delete restrict,
  coordinator_profile_id uuid not null references public.profiles(id) on delete restrict,
  session_status text not null default 'submitted' check (session_status in ('draft','submitted')),
  submitted_at timestamptz not null default now(),
  review_status text not null default 'recorded' check (review_status in ('recorded','corrected','flagged')),
  teacher_note text check (teacher_note is null or char_length(teacher_note) <= 1000),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  attendance_session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  prefect_profile_id uuid not null references public.profiles(id) on delete restrict,
  status text not null check (status in ('present','absent','late','excused')),
  note text check (note is null or char_length(note) <= 500),
  marked_by uuid references public.profiles(id) on delete set null,
  teacher_note text check (teacher_note is null or char_length(teacher_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, prefect_profile_id),
  unique (attendance_session_id, prefect_profile_id)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id uuid,
  details jsonb,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

alter table if exists public.duty_types
  add column if not exists description text,
  add column if not exists default_start_time time,
  add column if not exists default_end_time time,
  add column if not exists active boolean not null default true;

alter table if exists public.duty_locations
  add column if not exists location_name text,
  add column if not exists building text,
  add column if not exists floor_name text,
  add column if not exists class_name text,
  add column if not exists location_category text not null default 'other',
  add column if not exists notes text,
  add column if not exists active boolean not null default true;

alter table if exists public.prefect_duty_assignments
  add column if not exists profile_id uuid references public.profiles(id) on delete cascade,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists assignment_scope text not null default 'weekday';

alter table if exists public.attendance_sessions
  add column if not exists session_status text not null default 'submitted',
  add column if not exists submitted_at timestamptz not null default now(),
  add column if not exists review_status text not null default 'recorded',
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz;

alter table if exists public.attendance_records
  add column if not exists session_id uuid references public.attendance_sessions(id) on delete cascade,
  add column if not exists marked_by uuid references public.profiles(id) on delete set null;

alter table if exists public.audit_logs
  add column if not exists user_id uuid references public.profiles(id) on delete set null,
  add column if not exists details jsonb;

update public.duty_types set active = coalesce(active, is_active, true);
update public.duty_locations set
  location_name = coalesce(nullif(trim(location_name), ''), name),
  active = coalesce(active, is_active, true),
  location_category = case when location_category = concat('bag', '_', 'checking') then 'other' else coalesce(location_category, 'other') end;
update public.prefect_duty_assignments set
  profile_id = coalesce(profile_id, prefect_profile_id),
  approved_by = coalesce(approved_by, reviewed_by),
  approved_at = coalesce(approved_at, reviewed_at),
  assignment_scope = coalesce(assignment_scope, 'weekday');
alter table if exists public.attendance_sessions drop constraint if exists attendance_sessions_session_status_check;
alter table if exists public.attendance_sessions drop constraint if exists attendance_sessions_review_status_check;
update public.attendance_sessions set
  session_status = case when session_status in ('draft','submitted') then session_status else 'submitted' end,
  review_status = case
    when review_status in ('recorded','corrected','flagged') then review_status
    when review_status = 'approved' then 'corrected'
    when review_status = 'rejected' then 'flagged'
    else 'recorded'
  end,
  approved_by = coalesce(approved_by, reviewed_by),
  approved_at = coalesce(approved_at, reviewed_at);
update public.attendance_records set session_id = coalesce(session_id, attendance_session_id);

alter table if exists public.duty_locations alter column location_name set not null;
alter table if exists public.prefect_duty_assignments alter column profile_id set not null;
alter table if exists public.prefect_duty_assignments alter column duty_location_id drop not null;
alter table if exists public.prefect_duty_assignments alter column assigned_day drop not null;
alter table if exists public.attendance_sessions alter column duty_location_id drop not null;
alter table if exists public.attendance_records alter column session_id set not null;

alter table if exists public.duty_locations drop constraint if exists duty_locations_location_category_check;
alter table if exists public.duty_locations
  add constraint duty_locations_location_category_check check (location_category in ('canteen','class','floor','corridor','staircase','other'));
alter table if exists public.prefect_duty_assignments drop constraint if exists prefect_duty_assignments_assigned_day_check;
alter table if exists public.prefect_duty_assignments
  add constraint prefect_duty_assignments_assigned_day_check check (assigned_day is null or assigned_day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Any'));
alter table if exists public.prefect_duty_assignments drop constraint if exists prefect_duty_assignments_assignment_scope_check;
alter table if exists public.prefect_duty_assignments
  add constraint prefect_duty_assignments_assignment_scope_check check (assignment_scope in ('weekday','permanent'));
alter table if exists public.attendance_sessions alter column review_status set default 'recorded';
alter table if exists public.attendance_sessions drop constraint if exists attendance_sessions_session_status_check;
alter table if exists public.attendance_sessions
  add constraint attendance_sessions_session_status_check check (session_status in ('draft','submitted'));
alter table if exists public.attendance_sessions drop constraint if exists attendance_sessions_review_status_check;
alter table if exists public.attendance_sessions
  add constraint attendance_sessions_review_status_check check (review_status in ('recorded','corrected','flagged'));

alter table if exists public.prefect_duty_assignments
  drop constraint if exists prefect_duty_assignments_profile_id_duty_type_id_duty_location_id_assigned_day_key,
  drop constraint if exists prefect_duty_assignments_prefect_profile_id_duty_type_id_duty_location_id_assigned_day_key;
alter table if exists public.attendance_sessions
  drop constraint if exists attendance_sessions_attendance_date_duty_type_id_duty_location_id_key;

create index if not exists idx_profiles_role_status on public.profiles(role, account_status);
create index if not exists idx_assignments_lookup on public.prefect_duty_assignments(duty_type_id, duty_location_id, assigned_day, assignment_scope, assignment_status);
create index if not exists idx_sessions_date_status on public.attendance_sessions(attendance_date, review_status);
create index if not exists idx_records_prefect_status on public.attendance_records(prefect_profile_id, status);

create unique index if not exists uniq_prefect_active_assignment
  on public.prefect_duty_assignments (
    prefect_profile_id,
    duty_type_id,
    coalesce(duty_location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(assigned_day, '__permanent__'),
    assignment_scope
  )
  where assignment_status in ('pending','active');

create unique index if not exists uniq_attendance_session_submitted
  on public.attendance_sessions (
    attendance_date,
    duty_type_id,
    coalesce(duty_location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coordinator_profile_id
  )
  where session_status <> 'draft';

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, first_name, email, phone, current_class, role, account_status)
  values (
    new.id,
    trim(coalesce(new.raw_user_meta_data ->> 'first_name','')),
    coalesce(new.email,''),
    trim(coalesce(new.raw_user_meta_data ->> 'phone','')),
    trim(coalesce(new.raw_user_meta_data ->> 'current_class','')),
    'prefect',
    'pending'
  );
  return new;
end; $$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

create or replace function private.audit_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare old_row jsonb; new_row jsonb; row_id uuid;
begin
  old_row := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  new_row := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  row_id := coalesce(new_row->>'id', old_row->>'id')::uuid;
  insert into public.audit_logs(user_id, actor_profile_id, action, table_name, record_id, details, old_data, new_data)
  values (
    (select auth.uid()),
    (select auth.uid()),
    tg_op,
    tg_table_name,
    row_id,
    jsonb_build_object('operation', tg_op, 'table', tg_table_name, 'record_id', row_id),
    old_row,
    new_row
  );
  return coalesce(new, old);
end; $$;
revoke all on function private.audit_change() from public, anon, authenticated;

create or replace function private.sync_duty_type_compat()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
    and new.is_active is distinct from old.is_active
    and new.active is not distinct from old.active then
    new.active := new.is_active;
  elsif tg_op = 'UPDATE'
    and new.active is distinct from old.active
    and new.is_active is not distinct from old.is_active then
    new.is_active := new.active;
  else
    new.active := coalesce(new.active, new.is_active, true);
    new.is_active := coalesce(new.is_active, new.active, true);
  end if;
  return new;
end; $$;

create or replace function private.sync_duty_location_compat()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.name := nullif(trim(coalesce(new.name, new.location_name, '')), '');
  new.location_name := nullif(trim(coalesce(new.location_name, new.name, '')), '');
  if new.name is null or new.location_name is null then
    raise exception 'Duty location name is required';
  end if;

  if tg_op = 'UPDATE'
    and new.is_active is distinct from old.is_active
    and new.active is not distinct from old.active then
    new.active := new.is_active;
  elsif tg_op = 'UPDATE'
    and new.active is distinct from old.active
    and new.is_active is not distinct from old.is_active then
    new.is_active := new.active;
  else
    new.active := coalesce(new.active, new.is_active, true);
    new.is_active := coalesce(new.is_active, new.active, true);
  end if;

  if new.location_category is null or new.location_category not in ('canteen','class','floor','corridor','staircase','other') then
    new.location_category := case
      when new.name ilike '%canteen%' then 'canteen'
      when new.name ilike '%staircase%' then 'staircase'
      when new.group_name ilike '%corridor%' then 'corridor'
      when new.group_name is not null then 'class'
      else 'other'
    end;
  end if;
  return new;
end; $$;

create or replace function private.sync_assignment_compat()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.prefect_profile_id := coalesce(new.prefect_profile_id, new.profile_id);
  new.profile_id := coalesce(new.profile_id, new.prefect_profile_id);
  new.assignment_scope := coalesce(new.assignment_scope, 'weekday');
  new.reviewed_by := coalesce(new.reviewed_by, new.approved_by);
  new.approved_by := coalesce(new.approved_by, new.reviewed_by);
  new.reviewed_at := coalesce(new.reviewed_at, new.approved_at);
  new.approved_at := coalesce(new.approved_at, new.reviewed_at);
  return new;
end; $$;

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

create or replace function private.sync_record_compat()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.attendance_session_id := coalesce(new.attendance_session_id, new.session_id);
  new.session_id := coalesce(new.session_id, new.attendance_session_id);
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

drop trigger if exists sync_duty_type_compat on public.duty_types;
create trigger sync_duty_type_compat before insert or update on public.duty_types
for each row execute function private.sync_duty_type_compat();

drop trigger if exists sync_duty_location_compat on public.duty_locations;
create trigger sync_duty_location_compat before insert or update on public.duty_locations
for each row execute function private.sync_duty_location_compat();

drop trigger if exists sync_assignment_compat on public.prefect_duty_assignments;
create trigger sync_assignment_compat before insert or update on public.prefect_duty_assignments
for each row execute function private.sync_assignment_compat();

drop trigger if exists validate_assignment_scope on public.prefect_duty_assignments;
create trigger validate_assignment_scope before insert or update on public.prefect_duty_assignments
for each row execute function private.validate_prefect_duty_assignment_scope();

drop trigger if exists sync_session_compat on public.attendance_sessions;
create trigger sync_session_compat before insert or update on public.attendance_sessions
for each row execute function private.sync_session_compat();

drop trigger if exists sync_record_compat on public.attendance_records;
create trigger sync_record_compat before insert or update on public.attendance_records
for each row execute function private.sync_record_compat();

do $$ declare t text; begin
  foreach t in array array['profiles','duty_types','duty_locations','prefect_duty_assignments','attendance_sessions','attendance_records'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['profiles','duty_types','duty_locations','prefect_duty_assignments','attendance_sessions','attendance_records'] loop
    execute format('drop trigger if exists audit_change on public.%I', t);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()', t);
  end loop;
end $$;

commit;
