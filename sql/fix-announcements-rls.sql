begin;

-- Targeted fix for Announcements post/edit/delete/reaction/read RLS.
-- Paste this SQL content into the Supabase SQL Editor.
-- Do not paste the filename itself.

create schema if not exists private;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema private to authenticated, service_role;

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

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as '
begin
  new.updated_at = now();
  return new;
end;
';

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

revoke all on public.announcements, public.announcement_reactions, public.announcement_reads from anon;
grant select, insert, update, delete on public.announcements to authenticated;
grant select, insert, update, delete on public.announcement_reactions to authenticated;
grant select, insert, update, delete on public.announcement_reads to authenticated;
grant all privileges on public.announcements, public.announcement_reactions, public.announcement_reads to service_role;

notify pgrst, 'reload schema';

commit;
