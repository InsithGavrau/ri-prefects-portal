begin;

-- Emergency patch for live Supabase databases that still have the old
-- attendance_sessions.review_status check constraint.
-- This lets coordinator-submitted attendance save as "recorded" immediately.

create schema if not exists private;

alter table if exists public.attendance_records
  add column if not exists session_id uuid references public.attendance_sessions(id) on delete cascade,
  add column if not exists marked_by uuid references public.profiles(id) on delete set null;

update public.attendance_records
set session_id = attendance_session_id
where session_id is null
  and attendance_session_id is not null;

alter table if exists public.attendance_sessions
  add column if not exists review_status text default 'recorded',
  add column if not exists session_status text default 'submitted';

alter table if exists public.attendance_sessions
  drop constraint if exists attendance_sessions_review_status_check;

alter table if exists public.attendance_sessions
  drop constraint if exists attendance_sessions_session_status_check;

update public.attendance_sessions
set
  review_status = case
    when review_status in ('recorded','corrected','flagged') then review_status
    when review_status = 'approved' then 'corrected'
    when review_status = 'rejected' then 'flagged'
    else 'recorded'
  end,
  session_status = case
    when session_status in ('draft','submitted') then session_status
    else 'submitted'
  end;

alter table if exists public.attendance_sessions
  alter column review_status set default 'recorded',
  alter column review_status set not null,
  alter column session_status set default 'submitted',
  alter column session_status set not null;

alter table if exists public.attendance_sessions
  add constraint attendance_sessions_review_status_check
  check (review_status in ('recorded','corrected','flagged'));

alter table if exists public.attendance_sessions
  add constraint attendance_sessions_session_status_check
  check (session_status in ('draft','submitted'));

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
      and review_status in (''recorded'',''pending'')
      and session_status = ''submitted''
  );
';

revoke all on function private.is_owned_recorded_session(uuid) from public, anon;
grant execute on function private.is_owned_recorded_session(uuid) to authenticated;

drop policy if exists records_insert on public.attendance_records;
create policy records_insert on public.attendance_records for insert to authenticated
with check (
  private.current_role() in ('coordinator','admin')
  and private.is_owned_recorded_session(attendance_session_id)
);

drop policy if exists sessions_cleanup_delete on public.attendance_sessions;
create policy sessions_cleanup_delete on public.attendance_sessions for delete to authenticated
using (
  private.current_role()='admin'
  or (
    coordinator_profile_id=(select auth.uid())
    and review_status = 'recorded'
    and not exists (
      select 1
      from public.attendance_records
      where attendance_session_id = attendance_sessions.id
         or session_id = attendance_sessions.id
    )
  )
);

commit;
