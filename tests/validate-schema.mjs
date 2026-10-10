import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { canMarkAttendance, canPerformNormalPrefectDuties } from "../js/roles.js";

if (!canPerformNormalPrefectDuties("prefect") || !canPerformNormalPrefectDuties("coordinator")) {
  throw new Error("Prefects and coordinators must both be normal-duty-capable roles.");
}
if (canPerformNormalPrefectDuties("teacher") || canPerformNormalPrefectDuties("admin")) {
  throw new Error("Teacher/admin roles must not automatically become duty-performing prefects.");
}
if (canMarkAttendance("prefect") || !canMarkAttendance("coordinator")) {
  throw new Error("Attendance-marking capability is not separated from normal duty capability.");
}

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
  "../sql/update-hall-of-fame-delete-permissions.sql",
  "../sql/add-timetable-feature.sql",
  "../sql/add-announcements-feature.sql",
  "../sql/fix-announcements-rls.sql",
  "../sql/allow-coordinators-normal-duties.sql",
]) {
  const sql = (await readFile(new URL(path, import.meta.url), "utf8"))
    .replace(/^create extension if not exists pgcrypto;$/m, "");
  await db.exec(sql);
}

// Recreate the exact legacy production constraint before applying the targeted
// repair. Running the repair twice also proves it is safe after partial runs.
await db.exec("alter table public.attendance_sessions alter column duty_location_id set not null;");
const attendanceRepairSql = (await readFile(new URL("../sql/fix-attendance-submit-rls.sql", import.meta.url), "utf8"))
  .replace(/^create extension if not exists pgcrypto;$/m, "");
await db.exec(attendanceRepairSql);
await db.exec(attendanceRepairSql);

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

await db.exec(`
  insert into auth.users(id,email,raw_user_meta_data) values (
    '22222222-2222-4222-8222-222222222222',
    'coordinator@example.com',
    '{"first_name":"Kamal","phone":"0720000000","current_class":"11NB"}'::jsonb
  );
  update public.profiles
  set role = 'coordinator', account_status = 'active'
  where id = '22222222-2222-4222-8222-222222222222';

  insert into public.prefect_duty_assignments(
    profile_id, prefect_profile_id, duty_type_id, duty_location_id,
    assignment_scope, assigned_day, assignment_status
  )
  select
    '22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222',
    id, null, 'weekday', 'Monday', 'pending'
  from public.duty_types
  where name = 'Checkpoint Duty';
`);

const coordinatorDuty = await db.query(`
  select profile.role, assignment.assignment_scope, assignment.assigned_day
  from public.prefect_duty_assignments assignment
  join public.profiles profile on profile.id = assignment.prefect_profile_id
  where assignment.prefect_profile_id = '22222222-2222-4222-8222-222222222222'
`);
if (
  coordinatorDuty.rows[0]?.role !== "coordinator" ||
  coordinatorDuty.rows[0]?.assignment_scope !== "weekday" ||
  coordinatorDuty.rows[0]?.assigned_day !== "Monday"
) {
  throw new Error(`Coordinator normal-duty assignment failed: ${JSON.stringify(coordinatorDuty.rows[0])}`);
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
    and table_name in ('duty_types','duty_locations','prefect_duty_assignments','attendance_sessions','attendance_records','audit_logs','hall_of_fame_entries','timetable_versions','timetable_cells','timetable_locks','announcements','announcement_reactions','announcement_reads')
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
  "hall_of_fame_entries.profile_image_path",
  "hall_of_fame_entries.profile_image_url",
  "hall_of_fame_entries.status",
  "hall_of_fame_entries.is_seeded",
  "hall_of_fame_entries.reviewed_by",
  "hall_of_fame_entries.review_note",
  "timetable_versions.version_label",
  "timetable_versions.status",
  "timetable_versions.generated_by",
  "timetable_cells.version_id",
  "timetable_cells.table_type",
  "timetable_cells.assigned_profile_id",
  "timetable_cells.coordinator_profile_id",
  "timetable_cells.display_name",
  "timetable_cells.coordinator_display_name",
  "timetable_locks.version_id",
  "announcements.author_id",
  "announcements.message",
  "announcements.status",
  "announcement_reactions.announcement_id",
  "announcement_reactions.user_id",
  "announcement_reactions.reaction_type",
  "announcement_reads.announcement_id",
  "announcement_reads.user_id",
  "announcement_reads.read_at",
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

const attendanceLocationSmoke = await db.query(`
  with floor_choice as (
    select t.id as type_id, l.id as location_id
    from public.duty_types t
    join public.duty_locations l on l.duty_type_id = t.id
    where t.name = 'Floor Duty'
    order by l.sort_order
    limit 1
  ),
  checkpoint_choice as (
    select id as type_id from public.duty_types where name = 'Checkpoint Duty'
  ),
  canteen_choice as (
    select t.id as type_id, l.id as location_id
    from public.duty_types t
    join public.duty_locations l on l.duty_type_id = t.id
    where t.name = 'Canteen Duty'
    limit 1
  ),
  floor_session as (
    insert into public.attendance_sessions(attendance_date,duty_type_id,duty_location_id,coordinator_profile_id)
    select date '2026-06-23', type_id, location_id, '22222222-2222-4222-8222-222222222222'
    from floor_choice
    returning duty_type_id, duty_location_id
  ),
  canteen_session as (
    insert into public.attendance_sessions(attendance_date,duty_type_id,duty_location_id,coordinator_profile_id)
    select date '2026-06-24', type_id, location_id, '22222222-2222-4222-8222-222222222222'
    from canteen_choice
    returning duty_type_id, duty_location_id
  ),
  checkpoint_normalized as (
    insert into public.attendance_sessions(attendance_date,duty_type_id,duty_location_id,coordinator_profile_id)
    select date '2026-06-25', checkpoint.type_id, floor.location_id, '22222222-2222-4222-8222-222222222222'
    from checkpoint_choice checkpoint cross join floor_choice floor
    returning duty_type_id, duty_location_id
  )
  select
    (select duty_location_id is not null from floor_session) as floor_has_location,
    (select duty_location_id is not null from canteen_session) as canteen_has_location,
    (select duty_location_id is null from checkpoint_normalized) as checkpoint_location_cleared;
`);
if (
  attendanceLocationSmoke.rows[0]?.floor_has_location !== true ||
  attendanceLocationSmoke.rows[0]?.canteen_has_location !== true ||
  attendanceLocationSmoke.rows[0]?.checkpoint_location_cleared !== true
) {
  throw new Error(`Attendance location trigger failed: ${JSON.stringify(attendanceLocationSmoke.rows[0])}`);
}

const attendanceLocationTrigger = await db.query(`
  select trigger_proc.proname as function_name
  from pg_trigger trigger
  join pg_proc trigger_proc on trigger_proc.oid = trigger.tgfoid
  where trigger.tgrelid = 'public.attendance_sessions'::regclass
    and not trigger.tgisinternal
    and trigger.tgname = 'validate_attendance_session_location'
`);
if (
  attendanceLocationTrigger.rows.length !== 1 ||
  attendanceLocationTrigger.rows[0].function_name !== "validate_attendance_session_location"
) {
  throw new Error(`Attendance session validator is not installed correctly: ${JSON.stringify(attendanceLocationTrigger.rows)}`);
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
  insert into public.attendance_sessions(attendance_date,duty_type_id,duty_location_id,coordinator_profile_id)
  select date '2026-06-26', canteen.id, floor_location.id, '22222222-2222-4222-8222-222222222222'
  from public.duty_types canteen
  cross join lateral (
    select location.id
    from public.duty_locations location
    join public.duty_types floor on floor.id = location.duty_type_id
    where floor.name = 'Floor Duty'
    order by location.sort_order
    limit 1
  ) floor_location
  where canteen.name = 'Canteen Duty';
`, "Cross-duty attendance location");

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

await expectReject(`
  insert into public.announcements(author_id,message,status)
  values ('11111111-1111-4111-8111-111111111111', 'Bad status', 'published');
`, "Announcement invalid status");

await expectReject(`
  insert into public.announcement_reactions(announcement_id,user_id,reaction_type)
  values ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'clap');
`, "Announcement invalid reaction");

const announcementSmoke = await db.query(`
  with announcement as (
    insert into public.announcements(author_id, message, status)
    values ('11111111-1111-4111-8111-111111111111', 'Assembly at 7.15am. Bring duty notebooks.', 'active')
    returning id, status
  ),
  reaction as (
    insert into public.announcement_reactions(announcement_id, user_id, reaction_type)
    select id, '11111111-1111-4111-8111-111111111111', 'heart'
    from announcement
    returning reaction_type
  ),
  read_receipt as (
    insert into public.announcement_reads(announcement_id, user_id)
    select id, '11111111-1111-4111-8111-111111111111'
    from announcement
    returning read_at
  )
  select
    (select status from announcement) as status,
    (select reaction_type from reaction) as reaction_type,
    (select read_at is not null from read_receipt) as has_read;
`);
if (announcementSmoke.rows[0].status !== "active" || announcementSmoke.rows[0].reaction_type !== "heart" || announcementSmoke.rows[0].has_read !== true) {
  throw new Error(`Announcement migration failed: ${JSON.stringify(announcementSmoke.rows[0])}`);
}

const announcementPolicies = await db.query(`
  select policyname
  from pg_policies
  where schemaname = 'public'
    and tablename in ('announcements','announcement_reactions','announcement_reads')
`);
const policyNames = new Set(announcementPolicies.rows.map(row => row.policyname));
for (const policy of [
  "announcements_visible_select",
  "announcements_staff_insert",
  "announcements_staff_update",
  "announcements_staff_delete",
  "announcement_reactions_select",
  "announcement_reactions_insert_own",
  "announcement_reactions_update_own",
  "announcement_reactions_delete_own",
  "announcement_reads_select",
  "announcement_reads_insert_own",
  "announcement_reads_update_own",
  "announcement_reads_delete_own",
]) {
  if (!policyNames.has(policy)) throw new Error(`Missing announcement RLS policy: ${policy}`);
}

const assignmentPolicies = await db.query(`
  select policyname, coalesce(qual, '') as using_expression, coalesce(with_check, '') as check_expression
  from pg_policies
  where schemaname = 'public' and tablename = 'prefect_duty_assignments'
`);
const assignmentPolicyByName = new Map(assignmentPolicies.rows.map(row => [row.policyname, row]));
for (const policy of ["assignments_select", "assignments_insert_own", "assignments_update_own_pending", "assignments_staff_update", "assignments_delete"]) {
  if (!assignmentPolicyByName.has(policy)) throw new Error(`Missing duty assignment RLS policy: ${policy}`);
}
for (const policy of ["assignments_insert_own", "assignments_update_own_pending", "assignments_delete"]) {
  const definition = `${assignmentPolicyByName.get(policy).using_expression} ${assignmentPolicyByName.get(policy).check_expression}`;
  if (!definition.includes("coordinator") || !definition.includes("prefect")) {
    throw new Error(`Duty assignment policy does not allow both normal-duty roles: ${policy}`);
  }
}

const timetable = await db.query(`
  with version as (
    insert into public.timetable_versions(version_label, source_month, generated_by, status)
    values ('June 2026 generated timetable', '2026-06', '11111111-1111-4111-8111-111111111111', 'active')
    returning id, status
  ),
  cell as (
    insert into public.timetable_cells(version_id, table_type, cell_key, cell_group, row_label, floor_label, class_label, assigned_profile_id, coordinator_profile_id, display_name, coordinator_display_name)
    select id, 'floor-detail', 'floor-1', 'floor:Ground Floor', '1NA', 'Ground Floor (Old Building)', '1NA',
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
      'Nimal',
      'Nimal'
    from version
    returning table_type, row_label
  )
  select
    (select status from version) as version_status,
    (select table_type from cell) as table_type,
    (select row_label from cell) as row_label;
`);
if (timetable.rows[0].version_status !== "active" || timetable.rows[0].table_type !== "floor-detail" || timetable.rows[0].row_label !== "1NA") {
  throw new Error(`Timetable migration failed: ${JSON.stringify(timetable.rows[0])}`);
}

console.log(`Schema verified: ${options.rows[0].types} duty types, ${options.rows[0].locations} locations, coordinator normal-duty roles/RLS, Hall of Fame seeds, timetable tables, announcements tables, recorded attendance sessions, Checkpoint null location, Floor permanent assignment trigger, signup trigger, and weekday constraint passed.`);
await db.close();
