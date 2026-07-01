import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
`);

for (const path of [
  "../supabase/schema.sql",
  "../supabase/rls-policies.sql",
  "../supabase/seed-duty-options.sql",
  "../supabase/seed-duty-options.sql",
  "../sql/remove-bag-checking-and-checkpoint-locations.sql",
  "../sql/update-floor-duty-permanent-assignments.sql",
  "../sql/make-coordinator-attendance-official.sql",
  "../sql/emergency-fix-attendance-status.sql",
  "../sql/remove-codex-prototype-records.sql",
  "../sql/fix-admin-user-management-role-updates.sql",
  "../sql/add-hall-of-fame.sql",
  "../sql/add-hall-of-fame.sql",
]) {
  const sql = (await readFile(new URL(path, import.meta.url), "utf8"))
    .replace(/^create extension if not exists pgcrypto;$/m, "");
  await db.exec(sql);
}

await db.exec(`
  insert into auth.users(id,email,raw_user_meta_data) values (
    '11111111-1111-4111-8111-111111111111',
    'prefect@example.com',
    '{"first_name":"Nimal","phone":"0710000000","current_class":"10NA"}'::jsonb
  );
`);

const profile = await db.query("select role,account_status from public.profiles where email=$1", ["prefect@example.com"]);
if (profile.rows[0]?.role !== "prefect" || profile.rows[0]?.account_status !== "pending") {
  throw new Error("Signup trigger did not create a pending prefect profile.");
}

const options = await db.query(`
  select
    (select count(*)::int from public.duty_types) as types,
    (select count(*)::int from public.duty_locations) as locations,
    (select count(*)::int from public.duty_locations l join public.duty_types t on t.id=l.duty_type_id where t.name='Checkpoint Duty') as checkpoint_locations
`);
if (options.rows[0].types !== 3 || options.rows[0].locations !== 60 || options.rows[0].checkpoint_locations !== 0) {
  throw new Error(`Unexpected seed counts: ${JSON.stringify(options.rows[0])}`);
}

const requiredColumns = await db.query(`
  select table_name, column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('duty_types','duty_locations','prefect_duty_assignments','attendance_sessions','attendance_records','audit_logs','hall_of_fame_entries')
`);
const have = new Set(requiredColumns.rows.map((row) => `${row.table_name}.${row.column_name}`));
for (const column of [
  "duty_types.active",
  "duty_locations.location_name",
  "duty_locations.location_category",
  "prefect_duty_assignments.profile_id",
  "prefect_duty_assignments.approved_by",
  "prefect_duty_assignments.assignment_scope",
  "attendance_sessions.session_status",
  "attendance_sessions.submitted_at",
  "attendance_records.session_id",
  "attendance_records.marked_by",
  "audit_logs.user_id",
  "audit_logs.details",
  "hall_of_fame_entries.submitted_by",
  "hall_of_fame_entries.display_name",
  "hall_of_fame_entries.display_class",
  "hall_of_fame_entries.title",
  "hall_of_fame_entries.contribution_years",
  "hall_of_fame_entries.contribution_summary",
  "hall_of_fame_entries.leadership_impact",
  "hall_of_fame_entries.status",
  "hall_of_fame_entries.is_seeded",
  "hall_of_fame_entries.reviewed_by",
  "hall_of_fame_entries.review_note",
]) {
  if (!have.has(column)) throw new Error(`Missing prompt-compatible column: ${column}`);
}

const hallSeed = await db.query(`
  select count(*)::int as total,
    count(*) filter (where status='approved')::int as approved,
    count(*) filter (where title='Head Prefect')::int as head_prefects
  from public.hall_of_fame_entries
  where is_seeded
`);
if (hallSeed.rows[0].total !== 4 || hallSeed.rows[0].approved !== 4 || hallSeed.rows[0].head_prefects !== 4) {
  throw new Error(`Hall of Fame seed data is wrong: ${JSON.stringify(hallSeed.rows[0])}`);
}

const compat = await db.query(`
  with floor_choice as (
    select t.id as type_id, l.id as location_id
    from public.duty_types t
    join public.duty_locations l on l.duty_type_id = t.id
    where t.name = 'Floor Duty'
    order by l.sort_order
    limit 1
  ),
  checkpoint_choice as (
    select id as type_id
    from public.duty_types
    where name = 'Checkpoint Duty'
  ),
  canteen_choice as (
    select t.id as type_id, l.id as location_id
    from public.duty_types t
    join public.duty_locations l on l.duty_type_id = t.id
    where t.name = 'Canteen Duty'
    limit 1
  ),
  floor_assignment as (
    insert into public.prefect_duty_assignments(prefect_profile_id, duty_type_id, duty_location_id, assignment_scope, assigned_day)
    select '11111111-1111-4111-8111-111111111111', type_id, location_id, 'permanent', null
    from floor_choice
    returning id, profile_id, assignment_scope, assigned_day
  ),
  checkpoint_assignment as (
    insert into public.prefect_duty_assignments(prefect_profile_id, duty_type_id, duty_location_id, assignment_scope, assigned_day)
    select '11111111-1111-4111-8111-111111111111', type_id, null, 'weekday', 'Monday'
    from checkpoint_choice
    returning id, duty_location_id
  ),
  canteen_assignment as (
    insert into public.prefect_duty_assignments(prefect_profile_id, duty_type_id, duty_location_id, assignment_scope, assigned_day)
    select '11111111-1111-4111-8111-111111111111', type_id, location_id, 'weekday', 'Any'
    from canteen_choice
    returning id
  ),
  checkpoint_session as (
    insert into public.attendance_sessions(attendance_date, duty_type_id, duty_location_id, coordinator_profile_id)
    select date '2026-06-22', type_id, null, '11111111-1111-4111-8111-111111111111'
    from checkpoint_choice
    returning id, session_status, review_status, duty_location_id
  ),
  record as (
    insert into public.attendance_records(attendance_session_id, prefect_profile_id, status)
    select checkpoint_session.id, '11111111-1111-4111-8111-111111111111', 'present'
    from checkpoint_session
    returning session_id
  )
  select
    (select profile_id from floor_assignment) as assignment_profile_id,
    (select assignment_scope from floor_assignment) as floor_scope,
    (select assigned_day from floor_assignment) as floor_day,
    (select duty_location_id from checkpoint_assignment) as checkpoint_assignment_location,
    (select session_status from checkpoint_session) as session_status,
    (select review_status from checkpoint_session) as review_status,
    (select duty_location_id from checkpoint_session) as checkpoint_session_location,
    (select session_id from record) as record_session_id;
`);
if (
  compat.rows[0].assignment_profile_id !== "11111111-1111-4111-8111-111111111111" ||
  compat.rows[0].floor_scope !== "permanent" ||
  compat.rows[0].floor_day !== null ||
  compat.rows[0].checkpoint_assignment_location !== null ||
  compat.rows[0].checkpoint_session_location !== null ||
  compat.rows[0].session_status !== "submitted" ||
  compat.rows[0].review_status !== "recorded" ||
  !compat.rows[0].record_session_id
) {
  throw new Error(`Prompt compatibility sync failed: ${JSON.stringify(compat.rows[0])}`);
}

async function expectReject(sql, label) {
  let rejected = false;
  try {
    await db.exec(sql);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`${label} was not rejected.`);
}

await expectReject(`
  insert into public.prefect_duty_assignments(prefect_profile_id,duty_type_id,duty_location_id,assignment_scope,assigned_day)
  select '11111111-1111-4111-8111-111111111111', t.id, l.id, 'permanent', 'Monday'
  from public.duty_types t join public.duty_locations l on l.duty_type_id=t.id
  where t.name='Floor Duty'
  limit 1;
`, "Invalid Floor Duty weekday assignment");

await expectReject(`
  insert into public.prefect_duty_assignments(prefect_profile_id,duty_type_id,assignment_scope,assigned_day)
  select '11111111-1111-4111-8111-111111111111', id, 'weekday', null
  from public.duty_types
  where name='Checkpoint Duty';
`, "Invalid Checkpoint Duty assignment without day");

await expectReject(`
  insert into public.attendance_sessions(attendance_date,duty_type_id,duty_location_id,coordinator_profile_id)
  select date '2026-06-21', id, null, '11111111-1111-4111-8111-111111111111'
  from public.duty_types
  where name='Checkpoint Duty';
`, "Weekend attendance session");

await expectReject(`
  insert into public.hall_of_fame_entries(display_name,title,status)
  values ('', 'Prefect', 'approved');
`, "Hall of Fame empty display name");

await expectReject(`
  insert into public.hall_of_fame_entries(display_name,title,status)
  values ('Valid Name', 'Prefect', 'published');
`, "Hall of Fame invalid status");

console.log(`Schema verified: ${options.rows[0].types} duty types, ${options.rows[0].locations} locations, Hall of Fame seeds, recorded attendance sessions, Checkpoint null location, Floor permanent assignment trigger, signup trigger, and weekday constraint passed.`);
await db.close();
