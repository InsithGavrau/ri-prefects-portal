-- Allow active coordinators to manage normal prefect-duty assignments without
-- changing their separate coordinator attendance permissions.

begin;

alter table public.prefect_duty_assignments
  add column if not exists assignment_scope text default 'weekday',
  add column if not exists assigned_day text,
  add column if not exists assignment_status text default 'pending';

update public.prefect_duty_assignments assignment
set
  assignment_scope = case
    when duty_type.name = 'Floor Duty' then 'permanent'
    else 'weekday'
  end,
  assigned_day = case
    when duty_type.name = 'Floor Duty' then null
    else coalesce(assignment.assigned_day, 'Any')
  end,
  duty_location_id = case
    when duty_type.name = 'Checkpoint Duty' then null
    else assignment.duty_location_id
  end
from public.duty_types duty_type
where duty_type.id = assignment.duty_type_id
  and (
    assignment.assignment_scope is null
    or assignment.assignment_scope not in ('weekday','permanent')
    or assignment.assigned_day not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Any')
  );

update public.prefect_duty_assignments
set assignment_status = 'pending'
where assignment_status is null
   or assignment_status not in ('pending','active','rejected','inactive');

alter table public.prefect_duty_assignments
  alter column assignment_scope set default 'weekday',
  alter column assignment_scope set not null,
  alter column assignment_status set default 'pending',
  alter column assignment_status set not null;

alter table public.prefect_duty_assignments
  drop constraint if exists prefect_duty_assignments_assigned_day_check;
alter table public.prefect_duty_assignments
  add constraint prefect_duty_assignments_assigned_day_check
  check (assigned_day is null or assigned_day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Any'));

alter table public.prefect_duty_assignments
  drop constraint if exists prefect_duty_assignments_assignment_scope_check;
alter table public.prefect_duty_assignments
  add constraint prefect_duty_assignments_assignment_scope_check
  check (assignment_scope in ('weekday','permanent'));

alter table public.prefect_duty_assignments
  drop constraint if exists prefect_duty_assignments_assignment_status_check;
alter table public.prefect_duty_assignments
  add constraint prefect_duty_assignments_assignment_status_check
  check (assignment_status in ('pending','active','rejected','inactive'));

create index if not exists idx_prefect_duty_assignments_profile_id
  on public.prefect_duty_assignments(profile_id);
create index if not exists idx_prefect_duty_assignments_prefect_profile_id
  on public.prefect_duty_assignments(prefect_profile_id);
create index if not exists idx_prefect_duty_assignments_duty_type
  on public.prefect_duty_assignments(duty_type_id);
create index if not exists idx_prefect_duty_assignments_day
  on public.prefect_duty_assignments(assigned_day);
create index if not exists idx_prefect_duty_assignments_location
  on public.prefect_duty_assignments(duty_location_id);

alter table public.prefect_duty_assignments enable row level security;

drop policy if exists assignments_select on public.prefect_duty_assignments;
drop policy if exists assignments_insert_own on public.prefect_duty_assignments;
drop policy if exists assignments_update_own_pending on public.prefect_duty_assignments;
drop policy if exists assignments_staff_update on public.prefect_duty_assignments;
drop policy if exists assignments_delete on public.prefect_duty_assignments;

create policy assignments_select
on public.prefect_duty_assignments
for select
to authenticated
using (
  prefect_profile_id = (select auth.uid())
  or private.current_role() in ('coordinator','teacher','admin')
);

create policy assignments_insert_own
on public.prefect_duty_assignments
for insert
to authenticated
with check (
  prefect_profile_id = (select auth.uid())
  and profile_id = (select auth.uid())
  and private.current_role() in ('prefect','coordinator')
  and assignment_status = 'pending'
);

create policy assignments_update_own_pending
on public.prefect_duty_assignments
for update
to authenticated
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

create policy assignments_staff_update
on public.prefect_duty_assignments
for update
to authenticated
using (private.current_role() in ('teacher','admin'))
with check (private.current_role() in ('teacher','admin'));

create policy assignments_delete
on public.prefect_duty_assignments
for delete
to authenticated
using (
  (
    prefect_profile_id = (select auth.uid())
    and profile_id = (select auth.uid())
    and private.current_role() in ('prefect','coordinator')
    and assignment_status = 'pending'
  )
  or private.current_role() = 'admin'
);

grant select, insert, update, delete on public.prefect_duty_assignments to authenticated;
grant all privileges on public.prefect_duty_assignments to service_role;

notify pgrst, 'reload schema';

commit;
