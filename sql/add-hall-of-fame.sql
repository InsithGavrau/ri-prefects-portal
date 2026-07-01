begin;

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.hall_of_fame_entries (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid references public.profiles(id) on delete set null,
  display_name text not null,
  display_class text,
  title text not null default 'Prefect',
  contribution_years text,
  contribution_summary text,
  leadership_impact text,
  status text not null default 'pending',
  is_seeded boolean not null default false,
  submitted_at timestamptz default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists public.hall_of_fame_entries
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null,
  add column if not exists display_class text,
  add column if not exists contribution_years text,
  add column if not exists contribution_summary text,
  add column if not exists leadership_impact text,
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
  display_name = coalesce(nullif(trim(display_name), ''), 'Untitled Hall of Fame Entry'),
  title = coalesce(nullif(trim(title), ''), 'Prefect'),
  status = case when status in ('pending','approved','declined','archived') then status else 'pending' end,
  is_seeded = coalesce(is_seeded, false),
  submitted_at = coalesce(submitted_at, created_at, now()),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.hall_of_fame_entries alter column display_name set not null;
alter table public.hall_of_fame_entries alter column title set not null;
alter table public.hall_of_fame_entries alter column title set default 'Prefect';
alter table public.hall_of_fame_entries alter column status set not null;
alter table public.hall_of_fame_entries alter column status set default 'pending';
alter table public.hall_of_fame_entries alter column is_seeded set not null;
alter table public.hall_of_fame_entries alter column is_seeded set default false;

alter table public.hall_of_fame_entries drop constraint if exists hall_of_fame_entries_status_check;
alter table public.hall_of_fame_entries
  add constraint hall_of_fame_entries_status_check check (status in ('pending','approved','declined','archived'));
alter table public.hall_of_fame_entries drop constraint if exists hall_of_fame_entries_display_name_not_empty;
alter table public.hall_of_fame_entries
  add constraint hall_of_fame_entries_display_name_not_empty check (char_length(trim(display_name)) > 0);
alter table public.hall_of_fame_entries drop constraint if exists hall_of_fame_entries_title_not_empty;
alter table public.hall_of_fame_entries
  add constraint hall_of_fame_entries_title_not_empty check (char_length(trim(title)) > 0);

create index if not exists idx_hall_of_fame_status on public.hall_of_fame_entries(status);
create index if not exists idx_hall_of_fame_submitted_by on public.hall_of_fame_entries(submitted_by);
create index if not exists idx_hall_of_fame_submitted_at on public.hall_of_fame_entries(submitted_at);
create index if not exists idx_hall_of_fame_is_seeded on public.hall_of_fame_entries(is_seeded);
create unique index if not exists uniq_hall_of_fame_seeded_name
  on public.hall_of_fame_entries (lower(display_name))
  where is_seeded;

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

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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
    if old.submitted_by = (select auth.uid()) then
      raise exception 'Teachers cannot review their own Hall of Fame request';
    end if;
    if old.is_seeded or old.status <> 'pending' then
      raise exception 'Teachers can only review pending non-seeded Hall of Fame requests';
    end if;
    if new.submitted_by is distinct from old.submitted_by
      or new.display_name is distinct from old.display_name
      or new.display_class is distinct from old.display_class
      or new.title is distinct from old.title
      or new.contribution_years is distinct from old.contribution_years
      or new.contribution_summary is distinct from old.contribution_summary
      or new.leadership_impact is distinct from old.leadership_impact
      or new.is_seeded is distinct from old.is_seeded
      or new.submitted_at is distinct from old.submitted_at
      or new.created_at is distinct from old.created_at then
      raise exception 'Teachers can only review Hall of Fame requests';
    end if;
    if new.status not in ('approved','declined') then
      raise exception 'Teachers can only approve or decline Hall of Fame requests';
    end if;
    if new.reviewed_by is distinct from (select auth.uid()) then
      raise exception 'Review must be linked to the reviewing teacher';
    end if;
    if new.reviewed_at is null then
      raise exception 'Review time is required';
    end if;
    new.updated_at := now();
    return new;
  end if;

  raise exception 'Only teachers and admins can update Hall of Fame entries';
end;
$$;

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

drop trigger if exists set_updated_at on public.hall_of_fame_entries;
create trigger set_updated_at before update on public.hall_of_fame_entries
for each row execute function private.set_updated_at();

drop trigger if exists protect_hall_of_fame_update on public.hall_of_fame_entries;
create trigger protect_hall_of_fame_update before update on public.hall_of_fame_entries
for each row execute function private.protect_hall_of_fame_update();

do $$
begin
  if to_regprocedure('private.audit_change()') is not null then
    drop trigger if exists audit_change on public.hall_of_fame_entries;
    create trigger audit_change after insert or update or delete on public.hall_of_fame_entries
    for each row execute function private.audit_change();
  end if;
end $$;

alter table public.hall_of_fame_entries enable row level security;

drop policy if exists hall_of_fame_select on public.hall_of_fame_entries;
drop policy if exists hall_of_fame_insert_request on public.hall_of_fame_entries;
drop policy if exists hall_of_fame_admin_insert on public.hall_of_fame_entries;
drop policy if exists hall_of_fame_staff_update on public.hall_of_fame_entries;
drop policy if exists hall_of_fame_admin_delete on public.hall_of_fame_entries;

create policy hall_of_fame_select
on public.hall_of_fame_entries
for select
to authenticated
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
for insert
to authenticated
with check (private.current_role() = 'admin');

create policy hall_of_fame_staff_update
on public.hall_of_fame_entries
for update
to authenticated
using (private.current_role() in ('teacher','admin'))
with check (private.current_role() in ('teacher','admin'));

create policy hall_of_fame_admin_delete
on public.hall_of_fame_entries
for delete
to authenticated
using (private.current_role() = 'admin');

grant select, insert, update, delete on public.hall_of_fame_entries to authenticated;
notify pgrst, 'reload schema';

commit;
