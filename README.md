# RI Prefects Attendance Portal

A responsive multi-page Vanilla JavaScript prototype backed by Supabase Auth, Postgres, and Row Level Security.

## Free cloud deployment

Best free setup for school use:

- **Cloudflare Pages** for the website
- **Supabase Free** for Auth/Postgres
- **GitHub Free** for source hosting and automatic deployments

Detailed deployment steps are in [`DEPLOYMENT.md`](DEPLOYMENT.md).

Build settings for Cloudflare Pages:

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
```

## Setup

1. Open the Supabase project at `https://btwphzfdfgmnfekzrntv.supabase.co`.
2. In **SQL Editor**, open each file locally, copy the SQL inside it, and run the contents in this order. Do not paste the filename itself into Supabase:
   - `supabase/schema.sql`
   - `supabase/rls-policies.sql`
   - `supabase/seed-duty-options.sql`
   - `sql/remove-bag-checking-and-checkpoint-locations.sql` if this database already had the earlier prototype data
   - `sql/update-floor-duty-permanent-assignments.sql`
   - `sql/make-coordinator-attendance-official.sql`
   - `sql/add-hall-of-fame.sql`
   - `sql/update-hall-of-fame-delete-permissions.sql`
   - `sql/add-hall-of-fame-photo-upload.sql`
   - `sql/add-timetable-feature.sql`
   - `sql/add-announcements-feature.sql`
   - `sql/allow-coordinators-normal-duties.sql`
   - `sql/repair-live-supabase-api-grants.sql`

   The same SQL files are mirrored under `sql/` because the original prompt requested that folder name.
   If the site reports a Supabase schema-cache/table/RLS error after this, first confirm `js/config.js` points at the same project you opened in Supabase. Then open `sql/repair-live-supabase-api-grants.sql`, copy its SQL contents, paste those contents into SQL Editor, and run them. Do not paste only the filename. Reload the deployed site after the SQL succeeds.
   If only **Confirm and submit attendance** is failing, run the smaller targeted file first: open `sql/fix-attendance-submit-rls.sql`, copy its SQL contents, paste those contents into SQL Editor, and run them.
   If only **Announcements** posting, editing, deleting, reacting, or read receipts are failing, run the smaller targeted file first: open `sql/fix-announcements-rls.sql`, copy its SQL contents, paste those contents into SQL Editor, and run them.
   If coordinators cannot open Duty Selection or save their own normal duties, open `sql/allow-coordinators-normal-duties.sql`, copy all of its SQL contents into SQL Editor, run it once, then reload the site. Do not paste only the filename.
3. In **Project Settings > API**, copy the browser-safe publishable key (or legacy anon key). Never use the secret/service-role key.
4. Paste that key into `js/config.js` as `SUPABASE_ANON_KEY`. The project URL is already set.
5. Install and start the site:

   ```powershell
   npm install
   npm run dev
   ```

6. Open `http://127.0.0.1:5173/signup.html` and create the intended first administrator account.
7. Edit the email placeholder in `supabase/sample-admin-setup.sql`, run it in SQL Editor, then sign out and back in.
8. Open `timetable.html` as a teacher/admin, generate a preview, and click **Save active timetable** to publish the global timetable.

If email confirmation is enabled in Supabase Auth, confirm the signup email before logging in. Add `http://127.0.0.1:5173/**` to the Auth redirect URL allow list while developing.

## End-to-end test order

1. Sign up a prefect. Confirm that a pending `profiles` row is created automatically.
2. As a teacher/admin, activate the prefect account.
3. As the prefect, select a duty and confirm it appears as pending. Checkpoint and Canteen use weekdays; Floor Duty is permanent until changed.
4. As a teacher/admin, approve the duty assignment.
5. As a coordinator, load the duty session, mark every prefect, and submit. Checkpoint has no location; Floor Duty loads permanent assignments for the selected floor/class.
6. As a teacher/admin, confirm the submitted statuses already appear in dashboards, reports, and the top-four absence list. Use Attendance Corrections only if a status or note must be corrected.
7. Filter reports, export CSV, sign out, and verify protected pages redirect to login.

## Security model

- Signup metadata is used only by the database trigger to create a pending prefect profile. Authorization reads the protected `profiles.role` column, never editable user metadata.
- RLS is enabled on every public table. Explicit grants and policies work together.
- Prefects and coordinators can read and manage their own pending normal-duty selections; coordinator status adds attendance privileges and does not automatically create a normal duty assignment.
- Coordinators can create official attendance sessions and records directly; no teacher/admin approval is required for absent, late, excused, or present marks.
- Teachers can correct official attendance records and manage prefect status; only admins change roles and duty configuration.
- Teachers/admins can generate, save, and edit the global duty timetable. Prefects/coordinators can view it read-only.
- Teachers/admins can post and manage plain-text announcements. Active prefects/coordinators/teachers/admins can read and react; announcement reads and reactions are protected by RLS.
- Teachers/admins can remove Wall of Honor cards from the public page by archiving them; the record stays available for audit history.
- Weekends are rejected both in the browser and by a database check constraint.
- Checkpoint Duty stores `duty_location_id = null`; Floor Duty stores `assignment_scope = 'permanent'` and `assigned_day = null`.
- The frontend contains no service-role key.

## Social preview

Shared links use `assets/social/hi.png` for Open Graph and Twitter previews at the live Cloudflare URL `https://ri-prefects-portal.insithgavrau.workers.dev/assets/social/hi.png`. The source image is kept as `assets/social/hi-original.png`.

## Files

- `js/app.js`: page controllers, redirects, queries, forms, and CSV export.
- `js/auth.js`, `js/router.js`, `js/quotes.js`, `js/webglBackground.js`: shared auth, routing, quote, and background helpers.
- `js/config.js`: project URL and browser-safe key.
- `js/timetable.js`: global timetable generation, read-only viewing, teacher/admin cell edits, and Supabase persistence.
- `js/announcements.js`: announcement feed, unread indicator, sanitized text rendering, reactions, and read receipts.
- `css/styles.css`: active Royal Institute themed stylesheet.
- `supabase/schema.sql`: tables, constraints, indexes, signup/audit triggers, and prompt-compatible column aliases.
- `supabase/rls-policies.sql`: explicit grants, RLS, and privilege-protection triggers.
- `supabase/seed-duty-options.sql`: active duty seed with Checkpoint, Floor, and Canteen. Checkpoint intentionally has no stored location rows.
- `sql/remove-bag-checking-and-checkpoint-locations.sql`: cleanup migration for old prototype duty/location data.
- `sql/update-floor-duty-permanent-assignments.sql`: migration that makes Floor Duty permanent and validates assignment scope.
- `sql/make-coordinator-attendance-official.sql`: migration that changes attendance session state from approval-based to directly recorded/corrected.
- `sql/add-hall-of-fame.sql`: Wall of Honor table, seed records, request/review policies, and audit hook.
- `sql/update-hall-of-fame-delete-permissions.sql`: teacher/admin soft-remove support for Wall of Honor entries.
- `sql/add-hall-of-fame-photo-upload.sql`: Supabase Storage bucket, policies, and image columns for Wall of Honor request photos.
- `sql/add-timetable-feature.sql`: timetable versions, cells, locks, RLS, grants, indexes, and audit hooks.
- `sql/add-announcements-feature.sql`: announcements, reactions, read receipts, grants, indexes, and RLS policies.
- `sql/fix-attendance-submit-rls.sql`: targeted coordinator attendance submit RLS/Data API repair.
- `sql/fix-announcements-rls.sql`: targeted announcement post/edit/delete/reaction/read RLS and grant repair.
- `sql/allow-coordinators-normal-duties.sql`: additive role/RLS migration that lets coordinators separately hold normal prefect-duty assignments.
- `sql/repair-live-supabase-api-grants.sql`: production repair for Data API grants and PostgREST schema-cache reloads.
