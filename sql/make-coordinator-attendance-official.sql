begin;

-- Coordinator-marked attendance is official immediately.
-- This migration replaces the old attendance approval workflow with record states:
-- recorded = coordinator submitted official attendance
-- corrected = teacher/admin corrected a status or added notes
-- flagged = retained compatibility state for records that were previously rejected

alter table if exists public.attendance_sessions
  add column if not exists review_status text not null default 'recorded',
  add column if not exists session_status text not null default 'submitted';

alter table if exists public.attendance_sessions
  alter column review_status set default 'recorded';

alter table if exists public.attendance_sessions
  drop constraint if exists attendance_sessions_review_status_check;
alter table if exists public.attendance_sessions
  drop constraint if exists attendance_sessions_session_status_check;

update public.attendance_sessions
set
  session_status = case
    when session_status in ('draft','submitted') then session_status
    else 'submitted'
  end,
  review_status = case
    when review_status in ('recorded','corrected','flagged') then review_status
    when review_status = 'approved' then 'corrected'
    when review_status = 'rejected' then 'flagged'
    else 'recorded'
  end;

alter table if exists public.attendance_sessions
  add constraint attendance_sessions_session_status_check
  check (session_status in ('draft','submitted'));
alter table if exists public.attendance_sessions
  add constraint attendance_sessions_review_status_check
  check (review_status in ('recorded','corrected','flagged'));

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

drop trigger if exists sync_session_compat on public.attendance_sessions;
create trigger sync_session_compat before insert or update on public.attendance_sessions
for each row execute function private.sync_session_compat();

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

drop policy if exists sessions_cleanup_delete on public.attendance_sessions;
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

drop policy if exists records_insert on public.attendance_records;
create policy records_insert on public.attendance_records for insert to authenticated
with check (
  private.current_role() in ('coordinator','admin')
  and private.is_owned_recorded_session(attendance_session_id)
);

commit;
