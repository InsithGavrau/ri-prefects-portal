begin;

-- Paste this file's SQL contents into the Supabase SQL Editor.
-- Do not paste this filename by itself:
-- sql/repair-live-supabase-api-grants.sql
--
-- This live repair is intentionally idempotent. It repairs:
-- - Supabase Data API grants and PostgREST schema-cache reloads
-- - duty selection tables, compatibility columns, seeds, RLS, and grants
-- - Hall of Fame / Wall of Honor table, grants, RLS, and photo storage policies

create extension if not exists pgcrypto;
create schema if not exists private;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema private to anon, authenticated, service_role;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default 'Unknown',
  email text not null default '',
  phone text not null default '',
  current_class text not null default '',
  role text not null default 'prefect',
  account_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists first_name text not null default 'Unknown',
  add column if not exists email text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists current_class text not null default '',
  add column if not exists role text not null default 'prefect',
  add column if not exists account_status text not null default 'pending',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.profiles
set
  role = case when role in ('prefect','coordinator','teacher','admin') then role else 'prefect' end,
  account_status = case when account_status in ('pending','active','rejected','inactive') then account_status else 'pending' end,
  first_name = coalesce(nullif(trim(first_name), ''), 'Unknown'),
  email = coalesce(email, ''),
  phone = coalesce(nullif(trim(phone), ''), '000'),
  current_class = coalesce(nullif(trim(current_class), ''), 'Unknown'),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('prefect','coordinator','teacher','admin'));
alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check check (account_status in ('pending','active','rejected','inactive'));

create table if not exists public.duty_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  default_start_time time,
  default_end_time time,
  active boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.duty_types
  add column if not exists description text,
  add column if not exists default_start_time time,
  add column if not exists default_end_time time,
  add column if not exists active boolean not null default true,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.duty_types
set
  name = coalesce(nullif(trim(name), ''), 'Unnamed Duty Type'),
  active = coalesce(active, is_active, true),
  is_active = coalesce(is_active, active, true),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.duty_types alter column name set not null;
alter table public.duty_types alter column active set not null;
alter table public.duty_types alter column active set default true;
alter table public.duty_types alter column is_active set not null;
alter table public.duty_types alter column is_active set default true;

create table if not exists public.duty_locations (
  id uuid primary key default gen_random_uuid(),
  duty_type_id uuid not null references public.duty_types(id) on delete restrict,
  name text not null,
  location_name text not null,
  building text,
  floor_name text,
  class_name text,
  location_category text not null default 'other',
  notes text,
  group_name text,
  sort_order integer not null default 100,
  active boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.duty_locations
  add column if not exists name text,
  add column if not exists location_name text,
  add column if not exists building text,
  add column if not exists floor_name text,
  add column if not exists class_name text,
  add column if not exists location_category text not null default 'other',
  add column if not exists notes text,
  add column if not exists group_name text,
  add column if not exists sort_order integer not null default 100,
  add column if not exists active boolean not null default true,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.duty_locations
set
  name = coalesce(nullif(trim(name), ''), nullif(trim(location_name), ''), 'Unnamed location'),
  location_name = coalesce(nullif(trim(location_name), ''), nullif(trim(name), ''), 'Unnamed location'),
  location_category = case
    when location_category in ('canteen','class','floor','corridor','staircase','other') then location_category
    when coalesce(name, location_name, '') ilike '%canteen%' then 'canteen'
    when coalesce(name, location_name, '') ilike '%staircase%' then 'staircase'
    when group_name is not null then 'class'
    else 'other'
  end,
  sort_order = coalesce(sort_order, 100),
  active = coalesce(active, is_active, true),
  is_active = coalesce(is_active, active, true),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.duty_locations alter column name set not null;
alter table public.duty_locations alter column location_name set not null;
alter table public.duty_locations alter column sort_order set not null;
alter table public.duty_locations alter column sort_order set default 100;
alter table public.duty_locations alter column active set not null;
alter table public.duty_locations alter column active set default true;
alter table public.duty_locations alter column is_active set not null;
alter table public.duty_locations alter column is_active set default true;
alter table public.duty_locations drop constraint if exists duty_locations_location_category_check;
alter table public.duty_locations
  add constraint duty_locations_location_category_check check (location_category in ('canteen','class','floor','corridor','staircase','other'));

create table if not exists public.prefect_duty_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  prefect_profile_id uuid references public.profiles(id) on delete cascade,
  duty_type_id uuid not null references public.duty_types(id) on delete restrict,
  duty_location_id uuid references public.duty_locations(id) on delete restrict,
  assigned_day text,
  assignment_scope text not null default 'weekday',
  assignment_status text not null default 'pending',
  note text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.prefect_duty_assignments
  add column if not exists profile_id uuid references public.profiles(id) on delete cascade,
  add column if not exists prefect_profile_id uuid references public.profiles(id) on delete cascade,
  add column if not exists duty_type_id uuid references public.duty_types(id) on delete restrict,
  add column if not exists duty_location_id uuid references public.duty_locations(id) on delete restrict,
  add column if not exists assigned_day text,
  add column if not exists assignment_scope text not null default 'weekday',
  add column if not exists assignment_status text not null default 'pending',
  add column if not exists note text,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists validate_assignment_scope on public.prefect_duty_assignments;

update public.prefect_duty_assignments
set
  prefect_profile_id = coalesce(prefect_profile_id, profile_id),
  profile_id = coalesce(profile_id, prefect_profile_id),
  assignment_scope = case when assignment_scope in ('weekday','permanent') then assignment_scope else 'weekday' end,
  assignment_status = case when assignment_status in ('pending','active','rejected','inactive') then assignment_status else 'pending' end,
  approved_by = coalesce(approved_by, reviewed_by),
  approved_at = coalesce(approved_at, reviewed_at),
  reviewed_by = coalesce(reviewed_by, approved_by),
  reviewed_at = coalesce(reviewed_at, approved_at),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

update public.prefect_duty_assignments assignment
set
  assignment_scope = 'permanent',
  assigned_day = null
from public.duty_types duty
where assignment.duty_type_id = duty.id
  and duty.name = 'Floor Duty';

update public.prefect_duty_assignments assignment
set
  assignment_scope = 'weekday',
  assigned_day = coalesce(assignment.assigned_day, 'Any')
from public.duty_types duty
where assignment.duty_type_id = duty.id
  and duty.name in ('Checkpoint Duty','Canteen Duty');

alter table public.prefect_duty_assignments alter column duty_location_id drop not null;
alter table public.prefect_duty_assignments alter column assigned_day drop not null;
alter table public.prefect_duty_assignments alter column assignment_scope set not null;
alter table public.prefect_duty_assignments alter column assignment_scope set default 'weekday';
alter table public.prefect_duty_assignments alter column assignment_status set not null;
alter table public.prefect_duty_assignments alter column assignment_status set default 'pending';
alter table public.prefect_duty_assignments drop constraint if exists prefect_duty_assignments_assigned_day_check;
alter table public.prefect_duty_assignments
  add constraint prefect_duty_assignments_assigned_day_check check (assigned_day is null or assigned_day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Any'));
alter table public.prefect_duty_assignments drop constraint if exists prefect_duty_assignments_assignment_scope_check;
alter table public.prefect_duty_assignments
  add constraint prefect_duty_assignments_assignment_scope_check check (assignment_scope in ('weekday','permanent'));
alter table public.prefect_duty_assignments drop constraint if exists prefect_duty_assignments_assignment_status_check;
alter table public.prefect_duty_assignments
  add constraint prefect_duty_assignments_assignment_status_check check (assignment_status in ('pending','active','rejected','inactive'));

alter table public.prefect_duty_assignments
  drop constraint if exists prefect_duty_assignments_profile_id_duty_type_id_duty_location_id_assigned_day_key,
  drop constraint if exists prefect_duty_assignments_prefect_profile_id_duty_type_id_duty_location_id_assigned_day_key;

create index if not exists idx_profiles_role_status on public.profiles(role, account_status);
create index if not exists idx_duty_locations_type_active on public.duty_locations(duty_type_id, is_active, sort_order);
create index if not exists idx_assignments_lookup on public.prefect_duty_assignments(duty_type_id, duty_location_id, assigned_day, assignment_scope, assignment_status);
create index if not exists idx_assignments_prefect on public.prefect_duty_assignments(prefect_profile_id, created_at);
create index if not exists idx_prefect_duty_assignments_profile_id on public.prefect_duty_assignments(profile_id);
create index if not exists idx_prefect_duty_assignments_prefect_profile_id on public.prefect_duty_assignments(prefect_profile_id);
create index if not exists idx_prefect_duty_assignments_duty_type on public.prefect_duty_assignments(duty_type_id);
create index if not exists idx_prefect_duty_assignments_day on public.prefect_duty_assignments(assigned_day);
create index if not exists idx_prefect_duty_assignments_location on public.prefect_duty_assignments(duty_location_id);

create or replace function private.current_role()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when account_status = 'active' or (role = 'prefect' and account_status = 'pending') then role
    else null
  end
  from public.profiles
  where id = (select auth.uid());
$$;
revoke all on function private.current_role() from public, anon;
grant execute on function private.current_role() to anon, authenticated;

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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
end;
$$;

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
end;
$$;

create or replace function private.sync_assignment_compat()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.prefect_profile_id := coalesce(new.prefect_profile_id, new.profile_id);
  new.profile_id := coalesce(new.profile_id, new.prefect_profile_id);
  new.assignment_scope := coalesce(new.assignment_scope, 'weekday');
  new.assignment_status := coalesce(new.assignment_status, 'pending');
  new.reviewed_by := coalesce(new.reviewed_by, new.approved_by);
  new.approved_by := coalesce(new.approved_by, new.reviewed_by);
  new.reviewed_at := coalesce(new.reviewed_at, new.approved_at);
  new.approved_at := coalesce(new.approved_at, new.reviewed_at);
  return new;
end;
$$;

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
    select 1
    from public.duty_locations
    where id = new.duty_location_id
      and duty_type_id = new.duty_type_id
      and is_active
  ) then
    raise exception 'Duty location does not belong to the selected active duty type';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_duty_type_compat on public.duty_types;
create trigger sync_duty_type_compat before insert or update on public.duty_types
for each row execute function private.sync_duty_type_compat();

drop trigger if exists sync_duty_location_compat on public.duty_locations;
create trigger sync_duty_location_compat before insert or update on public.duty_locations
for each row execute function private.sync_duty_location_compat();

drop trigger if exists sync_assignment_compat on public.prefect_duty_assignments;
create trigger sync_assignment_compat before insert or update on public.prefect_duty_assignments
for each row execute function private.sync_assignment_compat();

drop trigger if exists validate_assignment_location on public.prefect_duty_assignments;
drop trigger if exists validate_assignment_scope on public.prefect_duty_assignments;
create trigger validate_assignment_scope before insert or update on public.prefect_duty_assignments
for each row execute function private.validate_prefect_duty_assignment_scope();

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
end;
$$;

drop trigger if exists validate_assignment_location on public.attendance_sessions;
drop trigger if exists validate_session_location on public.attendance_sessions;
drop trigger if exists validate_attendance_session_location on public.attendance_sessions;
create trigger validate_attendance_session_location
before insert or update of duty_type_id, duty_location_id on public.attendance_sessions
for each row execute function private.validate_attendance_session_location();

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
drop trigger if exists set_updated_at on public.duty_types;
create trigger set_updated_at before update on public.duty_types
for each row execute function private.set_updated_at();
drop trigger if exists set_updated_at on public.duty_locations;
create trigger set_updated_at before update on public.duty_locations
for each row execute function private.set_updated_at();
drop trigger if exists set_updated_at on public.prefect_duty_assignments;
create trigger set_updated_at before update on public.prefect_duty_assignments
for each row execute function private.set_updated_at();

insert into public.duty_types(name) values
  ('Checkpoint Duty'),
  ('Floor Duty'),
  ('Canteen Duty')
on conflict (name) do update
set is_active = true, active = true, updated_at = now();

with seed(type_name, location_name, group_name, sort_order) as (values
  ('Canteen Duty','Canteen',null,10),
  ('Floor Duty','1NA','Ground Floor - Old Building',101),
  ('Floor Duty','1NB','Ground Floor - Old Building',102),
  ('Floor Duty','2N','Ground Floor - Old Building',103),
  ('Floor Duty','3NA','Ground Floor - Old Building',104),
  ('Floor Duty','3NB','Ground Floor - Old Building',105),
  ('Floor Duty','3CA','1st Floor - Old Building',201),
  ('Floor Duty','3CB','1st Floor - Old Building',202),
  ('Floor Duty','3CC','1st Floor - Old Building',203),
  ('Floor Duty','4NA','1st Floor - Old Building',204),
  ('Floor Duty','4NB','1st Floor - Old Building',205),
  ('Floor Duty','5NA','1st Floor - Old Building',206),
  ('Floor Duty','5NB','1st Floor - Old Building',207),
  ('Floor Duty','Staircase','1st Floor - Old Building',208),
  ('Floor Duty','10NA','1st Floor - New Building',301),
  ('Floor Duty','10NB','1st Floor - New Building',302),
  ('Floor Duty','11NA','1st Floor - New Building',303),
  ('Floor Duty','11NB','1st Floor - New Building',304),
  ('Floor Duty','Staircase','1st Floor - New Building',305),
  ('Floor Duty','1CA','1st Floor - New New Building',401),
  ('Floor Duty','1CB','1st Floor - New New Building',402),
  ('Floor Duty','1CC','1st Floor - New New Building',403),
  ('Floor Duty','2CA','1st Floor - New New Building',404),
  ('Floor Duty','2CB','1st Floor - New New Building',405),
  ('Floor Duty','2CC','1st Floor - New New Building',406),
  ('Floor Duty','4CA','2nd Floor - Old Building',501),
  ('Floor Duty','4CB','2nd Floor - Old Building',502),
  ('Floor Duty','5CA','2nd Floor - Old Building',503),
  ('Floor Duty','5CB','2nd Floor - Old Building',504),
  ('Floor Duty','6NA','2nd Floor - Old Building',505),
  ('Floor Duty','6NB','2nd Floor - Old Building',506),
  ('Floor Duty','7NA','2nd Floor - Old Building',507),
  ('Floor Duty','7NB','2nd Floor - Old Building',508),
  ('Floor Duty','Staircase','2nd Floor - Old Building',509),
  ('Floor Duty','8NA','2nd Floor - New Building',601),
  ('Floor Duty','8NB','2nd Floor - New Building',602),
  ('Floor Duty','9NA','2nd Floor - New Building',603),
  ('Floor Duty','9NB','2nd Floor - New Building',604),
  ('Floor Duty','Staircase','2nd Floor - New Building',605),
  ('Floor Duty','11 Edexcel','2nd Floor - New New Building',701),
  ('Floor Duty','12 Edexcel','2nd Floor - New New Building',702),
  ('Floor Duty','6CA','3rd Floor - New Building',801),
  ('Floor Duty','6CB','3rd Floor - New Building',802),
  ('Floor Duty','8NC','3rd Floor - New Building',803),
  ('Floor Duty','7CB','3rd Floor - New Building',804),
  ('Floor Duty','Staircase','3rd Floor - New Building',805),
  ('Floor Duty','10CA','3rd Floor - New New Building',901),
  ('Floor Duty','9CA','3rd Floor - New New Building',902),
  ('Floor Duty','12N Art/Commerce','3rd Floor - New New Building',903),
  ('Floor Duty','12N Sci./Math','3rd Floor - New New Building',904),
  ('Floor Duty','13N Art/Commerce','3rd Floor - New New Building',905),
  ('Floor Duty','7CA','3rd Floor - New New Building',906),
  ('Floor Duty','13N Sci./Math','3rd Floor - New New Building',907),
  ('Floor Duty','Staircase','3rd Floor - New New Building',908),
  ('Floor Duty','8CA','4th Floor - New Building',1001),
  ('Floor Duty','8CB','4th Floor - New Building',1002),
  ('Floor Duty','10CB','4th Floor - New Building',1003),
  ('Floor Duty','9CB','4th Floor - New Building',1004),
  ('Floor Duty','Staircase','4th Floor - New Building',1005),
  ('Floor Duty','Old/New/New New Building 1st Floor Corridor','Special corridor',1100)
)
insert into public.duty_locations(duty_type_id, name, location_name, group_name, sort_order, location_category, active, is_active)
select
  dt.id,
  seed.location_name,
  seed.location_name,
  seed.group_name,
  seed.sort_order,
  case when seed.type_name = 'Canteen Duty' then 'canteen' else 'class' end,
  true,
  true
from seed
join public.duty_types dt on dt.name = seed.type_name
where not exists (
  select 1
  from public.duty_locations existing
  where existing.duty_type_id = dt.id
    and lower(existing.name) = lower(seed.location_name)
    and coalesce(existing.group_name, '') = coalesce(seed.group_name, '')
);

alter table public.profiles enable row level security;
alter table public.duty_types enable row level security;
alter table public.duty_locations enable row level security;
alter table public.prefect_duty_assignments enable row level security;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists duty_types_select on public.duty_types;
drop policy if exists duty_types_admin_all on public.duty_types;
drop policy if exists duty_locations_select on public.duty_locations;
drop policy if exists duty_locations_admin_all on public.duty_locations;
drop policy if exists assignments_select on public.prefect_duty_assignments;
drop policy if exists assignments_insert_own on public.prefect_duty_assignments;
drop policy if exists assignments_update_own_pending on public.prefect_duty_assignments;
drop policy if exists assignments_staff_update on public.prefect_duty_assignments;
drop policy if exists assignments_delete on public.prefect_duty_assignments;

create policy profiles_select on public.profiles
for select to authenticated
using (id = (select auth.uid()) or private.current_role() in ('coordinator','teacher','admin'));

create policy profiles_update on public.profiles
for update to authenticated
using (id = (select auth.uid()) or private.current_role() in ('teacher','admin'))
with check (id = (select auth.uid()) or private.current_role() in ('teacher','admin'));

create policy duty_types_select on public.duty_types
for select to authenticated
using (is_active or private.current_role() in ('teacher','admin'));

create policy duty_types_admin_all on public.duty_types
for all to authenticated
using (private.current_role() = 'admin')
with check (private.current_role() = 'admin');

create policy duty_locations_select on public.duty_locations
for select to authenticated
using (is_active or private.current_role() in ('teacher','admin'));

create policy duty_locations_admin_all on public.duty_locations
for all to authenticated
using (private.current_role() = 'admin')
with check (private.current_role() = 'admin');

create policy assignments_select on public.prefect_duty_assignments
for select to authenticated
using (prefect_profile_id = (select auth.uid()) or private.current_role() in ('coordinator','teacher','admin'));

create policy assignments_insert_own on public.prefect_duty_assignments
for insert to authenticated
with check (
  prefect_profile_id = (select auth.uid())
  and profile_id = (select auth.uid())
  and private.current_role() in ('prefect','coordinator')
  and assignment_status = 'pending'
);

create policy assignments_update_own_pending on public.prefect_duty_assignments
for update to authenticated
using (
  prefect_profile_id = (select auth.uid())
  and profile_id = (select auth.uid())
  and private.current_role() in ('prefect','coordinator')
  and assignment_status = 'pending'
)
with check (
  prefect_profile_id = (select auth.uid())
  and profile_id = (select auth.uid())
  and private.current_role() in ('prefect','coordinator')
  and assignment_status = 'pending'
);

create policy assignments_staff_update on public.prefect_duty_assignments
for update to authenticated
using (private.current_role() in ('teacher','admin'))
with check (private.current_role() in ('teacher','admin'));

create policy assignments_delete on public.prefect_duty_assignments
for delete to authenticated
using (
  (
    prefect_profile_id = (select auth.uid())
    and profile_id = (select auth.uid())
    and private.current_role() in ('prefect','coordinator')
    and assignment_status = 'pending'
  )
  or private.current_role() = 'admin'
);

create table if not exists public.hall_of_fame_entries (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid references public.profiles(id) on delete set null,
  display_name text not null,
  display_class text,
  title text not null default 'Prefect',
  contribution_years text,
  contribution_summary text,
  leadership_impact text,
  profile_image_path text,
  profile_image_url text,
  status text not null default 'pending',
  is_seeded boolean not null default false,
  submitted_at timestamptz default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.hall_of_fame_entries
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null,
  add column if not exists display_class text,
  add column if not exists contribution_years text,
  add column if not exists contribution_summary text,
  add column if not exists leadership_impact text,
  add column if not exists profile_image_path text,
  add column if not exists profile_image_url text,
  add column if not exists status text not null default 'pending',
  add column if not exists is_seeded boolean not null default false,
  add column if not exists submitted_at timestamptz default now(),
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

update public.hall_of_fame_entries
set
  display_name = coalesce(nullif(trim(display_name), ''), 'Untitled Wall of Honor Entry'),
  title = coalesce(nullif(trim(title), ''), 'Prefect'),
  status = case when status in ('pending','approved','declined','archived') then status else 'pending' end,
  is_seeded = coalesce(is_seeded, false),
  submitted_at = coalesce(submitted_at, created_at, now()),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.hall_of_fame_entries drop constraint if exists hall_of_fame_entries_status_check;
alter table public.hall_of_fame_entries
  add constraint hall_of_fame_entries_status_check check (status in ('pending','approved','declined','archived'));

create or replace function private.protect_hall_of_fame_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text;
begin
  if (select auth.uid()) is null then
    new.updated_at := now();
    return new;
  end if;

  actor := private.current_role();

  if actor = 'admin' then
    new.updated_at := now();
    return new;
  end if;

  if actor = 'teacher' then
    if new.submitted_by is distinct from old.submitted_by
      or new.display_name is distinct from old.display_name
      or new.display_class is distinct from old.display_class
      or new.title is distinct from old.title
      or new.contribution_years is distinct from old.contribution_years
      or new.contribution_summary is distinct from old.contribution_summary
      or new.leadership_impact is distinct from old.leadership_impact
      or new.profile_image_path is distinct from old.profile_image_path
      or new.profile_image_url is distinct from old.profile_image_url
      or new.is_seeded is distinct from old.is_seeded
      or new.submitted_at is distinct from old.submitted_at
      or new.created_at is distinct from old.created_at then
      raise exception 'Teachers can only review or archive Wall of Honor records';
    end if;

    if new.reviewed_by is distinct from (select auth.uid()) then
      raise exception 'Review must be linked to the reviewing teacher';
    end if;
    if new.reviewed_at is null then
      raise exception 'Review time is required';
    end if;

    if new.status = 'archived' then
      new.updated_at := now();
      return new;
    end if;

    if old.submitted_by = (select auth.uid()) then
      raise exception 'Teachers cannot review their own Wall of Honor request';
    end if;
    if old.is_seeded or old.status <> 'pending' then
      raise exception 'Teachers can only approve or decline pending non-seeded Wall of Honor requests';
    end if;
    if new.status not in ('approved','declined') then
      raise exception 'Teachers can only approve, decline, or archive Wall of Honor records';
    end if;

    new.updated_at := now();
    return new;
  end if;

  raise exception 'Only teachers and admins can update Wall of Honor entries';
end;
$$;

drop trigger if exists set_updated_at on public.hall_of_fame_entries;
create trigger set_updated_at before update on public.hall_of_fame_entries
for each row execute function private.set_updated_at();

drop trigger if exists protect_hall_of_fame_update on public.hall_of_fame_entries;
create trigger protect_hall_of_fame_update before update on public.hall_of_fame_entries
for each row execute function private.protect_hall_of_fame_update();

insert into public.hall_of_fame_entries(display_name, title, status, is_seeded, contribution_summary, leadership_impact, reviewed_at)
select seed.display_name, 'Head Prefect', 'approved', true, 'Honoured Leadership Record', 'Recognised for leadership, service, discipline, and contribution to the Prefects Guild.', now()
from (values
  ('Imara Idrees'),
  ('Harindu Induwara'),
  ('Insith Liyana Arachchi'),
  ('Jinuki Elvitigala')
) as seed(display_name)
where not exists (
  select 1
  from public.hall_of_fame_entries existing
  where existing.is_seeded
    and lower(existing.display_name) = lower(seed.display_name)
);

alter table public.hall_of_fame_entries enable row level security;
drop policy if exists hall_of_fame_select on public.hall_of_fame_entries;
drop policy if exists hall_of_fame_insert_request on public.hall_of_fame_entries;
drop policy if exists hall_of_fame_admin_insert on public.hall_of_fame_entries;
drop policy if exists hall_of_fame_staff_update on public.hall_of_fame_entries;
drop policy if exists hall_of_fame_admin_delete on public.hall_of_fame_entries;

create policy hall_of_fame_select
on public.hall_of_fame_entries
for select
to anon, authenticated
using (
  status = 'approved'
  or submitted_by = (select auth.uid())
  or private.current_role() in ('teacher','admin')
);

create policy hall_of_fame_insert_request
on public.hall_of_fame_entries
for insert
to authenticated
with check (
  submitted_by = (select auth.uid())
  and private.current_role() in ('prefect','coordinator')
  and status = 'pending'
  and is_seeded = false
  and reviewed_by is null
  and reviewed_at is null
  and review_note is null
  and title in ('Prefect Nominee','Prefect')
);

create policy hall_of_fame_admin_insert
on public.hall_of_fame_entries
for insert to authenticated
with check (private.current_role() = 'admin');

create policy hall_of_fame_staff_update
on public.hall_of_fame_entries
for update to authenticated
using (private.current_role() in ('teacher','admin'))
with check (private.current_role() in ('teacher','admin'));

create policy hall_of_fame_admin_delete
on public.hall_of_fame_entries
for delete to authenticated
using (private.current_role() = 'admin');

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'hall-of-fame-photos',
      'hall-of-fame-photos',
      true,
      2097152,
      array['image/jpeg', 'image/png', 'image/webp']::text[]
    )
    on conflict (id) do update
    set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

drop policy if exists "hall of fame photos are readable" on storage.objects;
drop policy if exists "prefects can upload their own hall of fame photos" on storage.objects;
drop policy if exists "prefects can replace their own hall of fame photos" on storage.objects;
drop policy if exists "prefects can delete their own hall of fame photos" on storage.objects;

create policy "hall of fame photos are readable"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'hall-of-fame-photos');

create policy "prefects can upload their own hall of fame photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'hall-of-fame-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.current_role() in ('prefect', 'coordinator')
);

create policy "prefects can replace their own hall of fame photos"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'hall-of-fame-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.current_role() in ('prefect', 'coordinator')
)
with check (
  bucket_id = 'hall-of-fame-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.current_role() in ('prefect', 'coordinator')
);

create policy "prefects can delete their own hall of fame photos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'hall-of-fame-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.current_role() in ('prefect', 'coordinator')
);

alter table if exists public.attendance_sessions
  add column if not exists session_status text not null default 'submitted',
  add column if not exists submitted_at timestamptz not null default now(),
  add column if not exists review_status text not null default 'recorded',
  add column if not exists teacher_note text,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

alter table if exists public.attendance_sessions
  alter column duty_location_id drop not null;

alter table if exists public.attendance_sessions
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
  submitted_at = coalesce(submitted_at, now())
where to_regclass('public.attendance_sessions') is not null;

alter table if exists public.attendance_sessions
  add constraint attendance_sessions_session_status_check
  check (session_status in ('draft','submitted')),
  add constraint attendance_sessions_review_status_check
  check (review_status in ('recorded','corrected','flagged'));

alter table if exists public.attendance_records
  add column if not exists attendance_session_id uuid references public.attendance_sessions(id) on delete cascade,
  add column if not exists session_id uuid references public.attendance_sessions(id) on delete cascade,
  add column if not exists marked_by uuid references public.profiles(id) on delete set null,
  add column if not exists teacher_note text;

update public.attendance_records
set
  attendance_session_id = coalesce(attendance_session_id, session_id),
  session_id = coalesce(session_id, attendance_session_id)
where to_regclass('public.attendance_records') is not null;

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

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete set null,
  message text not null check (char_length(trim(message)) between 1 and 1800),
  status text not null default 'active' check (status in ('active','edited','deleted','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.announcement_reactions (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('thumbs_up','heart')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (announcement_id, user_id)
);

create table if not exists public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (announcement_id, user_id)
);

create index if not exists idx_announcements_created_at on public.announcements(created_at desc);
create index if not exists idx_announcements_status on public.announcements(status);
create index if not exists idx_announcement_reactions_announcement_id on public.announcement_reactions(announcement_id);
create index if not exists idx_announcement_reactions_user_id on public.announcement_reactions(user_id);
create index if not exists idx_announcement_reads_announcement_id on public.announcement_reads(announcement_id);
create index if not exists idx_announcement_reads_user_id on public.announcement_reads(user_id);

drop trigger if exists set_updated_at on public.announcements;
create trigger set_updated_at
before update on public.announcements
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at on public.announcement_reactions;
create trigger set_updated_at
before update on public.announcement_reactions
for each row execute function private.set_updated_at();

alter table public.announcements enable row level security;
alter table public.announcement_reactions enable row level security;
alter table public.announcement_reads enable row level security;

drop policy if exists announcements_active_select on public.announcements;
drop policy if exists announcements_visible_select on public.announcements;
drop policy if exists announcements_staff_insert on public.announcements;
drop policy if exists announcements_staff_update on public.announcements;
drop policy if exists announcements_staff_delete on public.announcements;

create policy announcements_visible_select
on public.announcements
for select
to authenticated
using (
  status in ('active','edited')
  and private.current_role() in ('prefect','coordinator','teacher','admin')
);

create policy announcements_staff_insert
on public.announcements
for insert
to authenticated
with check (
  private.current_role() in ('teacher','admin')
  and author_id = (select auth.uid())
  and status in ('active','edited')
);

create policy announcements_staff_update
on public.announcements
for update
to authenticated
using (private.current_role() in ('teacher','admin'))
with check (
  private.current_role() in ('teacher','admin')
  and status in ('active','edited','deleted','archived')
);

create policy announcements_staff_delete
on public.announcements
for delete
to authenticated
using (private.current_role() in ('teacher','admin'));

drop policy if exists announcement_reactions_select on public.announcement_reactions;
drop policy if exists announcement_reactions_insert_own on public.announcement_reactions;
drop policy if exists announcement_reactions_update_own on public.announcement_reactions;
drop policy if exists announcement_reactions_delete_own on public.announcement_reactions;

create policy announcement_reactions_select
on public.announcement_reactions
for select
to authenticated
using (private.current_role() in ('prefect','coordinator','teacher','admin'));

create policy announcement_reactions_insert_own
on public.announcement_reactions
for insert
to authenticated
with check (
  private.current_role() in ('prefect','coordinator','teacher','admin')
  and user_id = (select auth.uid())
  and exists (
    select 1
    from public.announcements
    where id = announcement_id
      and status in ('active','edited')
  )
);

create policy announcement_reactions_update_own
on public.announcement_reactions
for update
to authenticated
using (
  private.current_role() in ('prefect','coordinator','teacher','admin')
  and user_id = (select auth.uid())
)
with check (
  private.current_role() in ('prefect','coordinator','teacher','admin')
  and user_id = (select auth.uid())
  and exists (
    select 1
    from public.announcements
    where id = announcement_id
      and status in ('active','edited')
  )
);

create policy announcement_reactions_delete_own
on public.announcement_reactions
for delete
to authenticated
using (
  private.current_role() in ('prefect','coordinator','teacher','admin')
  and user_id = (select auth.uid())
);

drop policy if exists announcement_reads_select on public.announcement_reads;
drop policy if exists announcement_reads_insert_own on public.announcement_reads;
drop policy if exists announcement_reads_update_own on public.announcement_reads;
drop policy if exists announcement_reads_delete_own on public.announcement_reads;

create policy announcement_reads_select
on public.announcement_reads
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.current_role() in ('teacher','admin')
);

create policy announcement_reads_insert_own
on public.announcement_reads
for insert
to authenticated
with check (
  private.current_role() in ('prefect','coordinator','teacher','admin')
  and user_id = (select auth.uid())
  and exists (
    select 1
    from public.announcements
    where id = announcement_id
      and status in ('active','edited')
  )
);

create policy announcement_reads_update_own
on public.announcement_reads
for update
to authenticated
using (
  private.current_role() in ('prefect','coordinator','teacher','admin')
  and user_id = (select auth.uid())
)
with check (
  private.current_role() in ('prefect','coordinator','teacher','admin')
  and user_id = (select auth.uid())
  and exists (
    select 1
    from public.announcements
    where id = announcement_id
      and status in ('active','edited')
  )
);

create policy announcement_reads_delete_own
on public.announcement_reads
for delete
to authenticated
using (
  private.current_role() in ('prefect','coordinator','teacher','admin')
  and user_id = (select auth.uid())
);

revoke all on all tables in schema public from anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.duty_types to authenticated;
grant select, insert, update, delete on public.duty_locations to authenticated;
grant select, insert, update, delete on public.prefect_duty_assignments to authenticated;
grant select on public.hall_of_fame_entries to anon;
grant select, insert, update, delete on public.hall_of_fame_entries to authenticated;

grant all privileges on public.profiles to service_role;
grant all privileges on public.duty_types to service_role;
grant all privileges on public.duty_locations to service_role;
grant all privileges on public.prefect_duty_assignments to service_role;
grant all privileges on public.hall_of_fame_entries to service_role;

do $$
declare
  table_name text;
  grant_sql text;
begin
  foreach table_name in array array[
    'attendance_sessions',
    'attendance_records',
    'audit_logs',
    'announcements',
    'announcement_reads',
    'announcement_reactions',
    'timetable_versions',
    'timetable_cells',
    'timetable_locks'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      grant_sql := case table_name
        when 'attendance_sessions' then 'select, insert, update, delete'
        when 'attendance_records' then 'select, insert, update'
        when 'audit_logs' then 'select'
        when 'announcements' then 'select, insert, update, delete'
        when 'announcement_reads' then 'select, insert, update, delete'
        when 'announcement_reactions' then 'select, insert, update, delete'
        when 'timetable_versions' then 'select, insert, update, delete'
        when 'timetable_cells' then 'select, insert, update, delete'
        when 'timetable_locks' then 'select, insert, update, delete'
        else 'select'
      end;
      execute format('grant %s on table public.%I to authenticated', grant_sql, table_name);
      execute format('grant all privileges on table public.%I to service_role', table_name);
    end if;
  end loop;
end $$;

grant usage, select on all sequences in schema public to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
