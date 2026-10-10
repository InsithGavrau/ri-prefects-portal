begin;

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

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
grant execute on function private.current_role() to authenticated;

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.timetable_versions (
  id uuid primary key default gen_random_uuid(),
  version_label text not null,
  source_month text,
  source_document text,
  generated_by uuid references public.profiles(id) on delete set null,
  status text not null default 'draft',
  notes text,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.timetable_versions
  add column if not exists version_label text,
  add column if not exists source_month text,
  add column if not exists source_document text,
  add column if not exists generated_by uuid references public.profiles(id) on delete set null,
  add column if not exists status text not null default 'draft',
  add column if not exists notes text,
  add column if not exists generated_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.timetable_versions
set
  version_label = coalesce(nullif(trim(version_label), ''), 'Prefects Duty Timetable'),
  status = case when status in ('draft','active','archived') then status else 'archived' end,
  generated_at = coalesce(generated_at, created_at, now()),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.timetable_versions alter column version_label set not null;
alter table public.timetable_versions alter column status set not null;
alter table public.timetable_versions alter column status set default 'draft';
alter table public.timetable_versions drop constraint if exists timetable_versions_status_check;
alter table public.timetable_versions
  add constraint timetable_versions_status_check check (status in ('draft','active','archived'));
alter table public.timetable_versions drop constraint if exists timetable_versions_label_not_empty;
alter table public.timetable_versions
  add constraint timetable_versions_label_not_empty check (char_length(trim(version_label)) > 0);

create table if not exists public.timetable_cells (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.timetable_versions(id) on delete cascade,
  table_type text not null,
  cell_key text not null,
  cell_group text not null,
  row_label text not null,
  column_label text,
  floor_label text,
  class_label text,
  assigned_profile_id uuid references public.profiles(id) on delete set null,
  coordinator_profile_id uuid references public.profiles(id) on delete set null,
  display_name text,
  display_class text,
  coordinator_display_name text,
  coordinator_display_class text,
  display_order integer not null default 1,
  sort_order integer not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (version_id, cell_key)
);

alter table if exists public.timetable_cells
  add column if not exists version_id uuid references public.timetable_versions(id) on delete cascade,
  add column if not exists table_type text,
  add column if not exists cell_key text,
  add column if not exists cell_group text,
  add column if not exists row_label text,
  add column if not exists column_label text,
  add column if not exists floor_label text,
  add column if not exists class_label text,
  add column if not exists assigned_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists coordinator_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists display_name text,
  add column if not exists display_class text,
  add column if not exists coordinator_display_name text,
  add column if not exists coordinator_display_class text,
  add column if not exists display_order integer not null default 1,
  add column if not exists sort_order integer not null default 1,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.timetable_cells
set
  table_type = coalesce(nullif(trim(table_type), ''), 'floor-detail'),
  cell_key = coalesce(nullif(trim(cell_key), ''), id::text),
  cell_group = coalesce(nullif(trim(cell_group), ''), 'default'),
  row_label = coalesce(nullif(trim(row_label), ''), 'Unlabelled'),
  display_order = coalesce(display_order, 1),
  sort_order = coalesce(sort_order, 1),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.timetable_cells alter column version_id set not null;
alter table public.timetable_cells alter column table_type set not null;
alter table public.timetable_cells alter column cell_key set not null;
alter table public.timetable_cells alter column cell_group set not null;
alter table public.timetable_cells alter column row_label set not null;
alter table public.timetable_cells alter column display_order set not null;
alter table public.timetable_cells alter column sort_order set not null;
alter table public.timetable_cells drop constraint if exists timetable_cells_table_type_check;
alter table public.timetable_cells
  add constraint timetable_cells_table_type_check check (table_type in ('floor-detail','checkpoint','corridor','canteen'));
alter table public.timetable_cells drop constraint if exists timetable_cells_display_order_check;
alter table public.timetable_cells
  add constraint timetable_cells_display_order_check check (display_order > 0 and sort_order > 0);

create table if not exists public.timetable_locks (
  id uuid primary key default gen_random_uuid(),
  version_id uuid references public.timetable_versions(id) on delete cascade,
  locked_by uuid references public.profiles(id) on delete set null,
  reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.timetable_locks
  add column if not exists version_id uuid references public.timetable_versions(id) on delete cascade,
  add column if not exists locked_by uuid references public.profiles(id) on delete set null,
  add column if not exists reason text,
  add column if not exists expires_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists uniq_timetable_active_version
  on public.timetable_versions ((status))
  where status = 'active';
create index if not exists idx_timetable_versions_status on public.timetable_versions(status, generated_at desc);
create index if not exists idx_timetable_cells_version on public.timetable_cells(version_id, table_type, sort_order);
create index if not exists idx_timetable_cells_assigned on public.timetable_cells(assigned_profile_id);
create index if not exists idx_timetable_cells_coordinator on public.timetable_cells(coordinator_profile_id);

drop trigger if exists set_updated_at on public.timetable_versions;
create trigger set_updated_at before update on public.timetable_versions
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at on public.timetable_cells;
create trigger set_updated_at before update on public.timetable_cells
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at on public.timetable_locks;
create trigger set_updated_at before update on public.timetable_locks
for each row execute function private.set_updated_at();

do $$
begin
  if to_regprocedure('private.audit_change()') is not null then
    drop trigger if exists audit_change on public.timetable_versions;
    create trigger audit_change after insert or update or delete on public.timetable_versions
    for each row execute function private.audit_change();

    drop trigger if exists audit_change on public.timetable_cells;
    create trigger audit_change after insert or update or delete on public.timetable_cells
    for each row execute function private.audit_change();
  end if;
end $$;

alter table public.timetable_versions enable row level security;
alter table public.timetable_cells enable row level security;
alter table public.timetable_locks enable row level security;

drop policy if exists timetable_versions_select on public.timetable_versions;
drop policy if exists timetable_versions_insert_staff on public.timetable_versions;
drop policy if exists timetable_versions_update_staff on public.timetable_versions;
drop policy if exists timetable_versions_delete_admin on public.timetable_versions;
drop policy if exists timetable_cells_select on public.timetable_cells;
drop policy if exists timetable_cells_insert_staff on public.timetable_cells;
drop policy if exists timetable_cells_update_staff on public.timetable_cells;
drop policy if exists timetable_cells_delete_staff on public.timetable_cells;
drop policy if exists timetable_locks_staff_all on public.timetable_locks;

create policy timetable_versions_select
on public.timetable_versions
for select
to authenticated
using (status = 'active' or private.current_role() in ('teacher','admin'));

create policy timetable_versions_insert_staff
on public.timetable_versions
for insert
to authenticated
with check (private.current_role() in ('teacher','admin') and generated_by = (select auth.uid()));

create policy timetable_versions_update_staff
on public.timetable_versions
for update
to authenticated
using (private.current_role() in ('teacher','admin'))
with check (private.current_role() in ('teacher','admin'));

create policy timetable_versions_delete_admin
on public.timetable_versions
for delete
to authenticated
using (private.current_role() = 'admin');

create policy timetable_cells_select
on public.timetable_cells
for select
to authenticated
using (
  private.current_role() in ('teacher','admin')
  or exists (
    select 1
    from public.timetable_versions v
    where v.id = timetable_cells.version_id
      and v.status = 'active'
  )
);

create policy timetable_cells_insert_staff
on public.timetable_cells
for insert
to authenticated
with check (private.current_role() in ('teacher','admin'));

create policy timetable_cells_update_staff
on public.timetable_cells
for update
to authenticated
using (private.current_role() in ('teacher','admin'))
with check (private.current_role() in ('teacher','admin'));

create policy timetable_cells_delete_staff
on public.timetable_cells
for delete
to authenticated
using (private.current_role() in ('teacher','admin'));

create policy timetable_locks_staff_all
on public.timetable_locks
for all
to authenticated
using (private.current_role() in ('teacher','admin'))
with check (private.current_role() in ('teacher','admin'));

revoke all on public.timetable_versions, public.timetable_cells, public.timetable_locks from anon;
grant select, insert, update, delete on public.timetable_versions to authenticated;
grant select, insert, update, delete on public.timetable_cells to authenticated;
grant select, insert, update, delete on public.timetable_locks to authenticated;

notify pgrst, 'reload schema';

commit;
