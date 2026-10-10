begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter table if exists public.hall_of_fame_entries
  add column if not exists status text not null default 'pending',
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text,
  add column if not exists profile_image_path text,
  add column if not exists profile_image_url text,
  add column if not exists updated_at timestamptz default now();

alter table if exists public.hall_of_fame_entries drop constraint if exists hall_of_fame_entries_status_check;
alter table if exists public.hall_of_fame_entries
  add constraint hall_of_fame_entries_status_check check (status in ('pending','approved','declined','archived'));

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
      raise exception 'Teachers can only review or archive Hall of Fame records';
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
      raise exception 'Teachers cannot review their own Hall of Fame request';
    end if;
    if old.is_seeded or old.status <> 'pending' then
      raise exception 'Teachers can only approve or decline pending non-seeded Hall of Fame requests';
    end if;
    if new.status not in ('approved','declined') then
      raise exception 'Teachers can only approve, decline, or archive Hall of Fame records';
    end if;

    new.updated_at := now();
    return new;
  end if;

  raise exception 'Only teachers and admins can update Hall of Fame entries';
end;
$$;

drop trigger if exists protect_hall_of_fame_update on public.hall_of_fame_entries;
create trigger protect_hall_of_fame_update before update on public.hall_of_fame_entries
for each row execute function private.protect_hall_of_fame_update();

alter table if exists public.hall_of_fame_entries enable row level security;

drop policy if exists hall_of_fame_staff_update on public.hall_of_fame_entries;
create policy hall_of_fame_staff_update
on public.hall_of_fame_entries
for update
to authenticated
using (private.current_role() in ('teacher','admin'))
with check (private.current_role() in ('teacher','admin'));

alter table if exists public.audit_logs enable row level security;
grant insert on public.audit_logs to authenticated;

drop policy if exists audit_staff_insert on public.audit_logs;
create policy audit_staff_insert
on public.audit_logs
for insert
to authenticated
with check (
  private.current_role() in ('teacher','admin')
  and coalesce(actor_profile_id, user_id) = (select auth.uid())
);

notify pgrst, 'reload schema';

commit;
