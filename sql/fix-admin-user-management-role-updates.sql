begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when account_status = 'active' or (role = 'prefect' and account_status = 'pending') then role
    else null
  end
  from public.profiles
  where id = (select auth.uid());
$$;

revoke all on function private.current_role() from public, anon;
grant execute on function private.current_role() to authenticated;

create or replace function private.protect_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  actor := private.current_role();

  if new.id <> old.id or new.email <> old.email then
    raise exception 'Identity fields cannot be changed here';
  end if;

  if actor = 'admin' then
    if old.id = (select auth.uid()) and new.role <> old.role then
      raise exception 'Admins cannot change their own role';
    end if;
  elsif actor = 'teacher' then
    if new.role <> old.role then
      raise exception 'Teachers cannot change roles';
    end if;
  else
    if new.role <> old.role or new.account_status <> old.account_status or new.first_name <> old.first_name then
      raise exception 'You may only update your phone and current class';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_profile_update on public.profiles;
create trigger protect_profile_update
before update on public.profiles
for each row execute function private.protect_profile_update();

alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;

create policy profiles_select
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or private.current_role() in ('coordinator', 'teacher', 'admin')
);

create policy profiles_update
on public.profiles
for update
to authenticated
using (
  id = (select auth.uid())
  or private.current_role() in ('teacher', 'admin')
)
with check (
  id = (select auth.uid())
  or private.current_role() in ('teacher', 'admin')
);

grant select, update on public.profiles to authenticated;
notify pgrst, 'reload schema';

commit;
