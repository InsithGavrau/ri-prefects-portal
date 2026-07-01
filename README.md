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
2. In **SQL Editor**, run these files in order:
   - `supabase/schema.sql`
   - `supabase/rls-policies.sql`
   - `supabase/seed-duty-options.sql`
   - `sql/remove-bag-checking-and-checkpoint-locations.sql` if this database already had the earlier prototype data
   - `sql/update-floor-duty-permanent-assignments.sql`
   - `sql/make-coordinator-attendance-official.sql`

   The same SQL files are mirrored under `sql/` because the original prompt requested that folder name.
3. In **Project Settings > API**, copy the browser-safe publishable key (or legacy anon key). Never use the secret/service-role key.
4. Paste that key into `js/config.js` as `SUPABASE_ANON_KEY`. The project URL is already set.
5. Install and start the site:

   ```powershell
   npm install
   npm run dev
   ```

6. Open `http://127.0.0.1:5173/signup.html` and create the intended first administrator account.
7. Edit the email placeholder in `supabase/sample-admin-setup.sql`, run it in SQL Editor, then sign out and back in.

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
- Prefects can read their own data, add/remove pending duty selections, and cannot promote or approve themselves.
- Coordinators can create official attendance sessions and records directly; no teacher/admin approval is required for absent, late, excused, or present marks.
- Teachers can correct official attendance records and manage prefect status; only admins change roles and duty configuration.
- Weekends are rejected both in the browser and by a database check constraint.
- Checkpoint Duty stores `duty_location_id = null`; Floor Duty stores `assignment_scope = 'permanent'` and `assigned_day = null`.
- The frontend contains no service-role key.

## Files

- `js/app.js`: page controllers, redirects, queries, forms, and CSV export.
- `js/auth.js`, `js/router.js`, `js/quotes.js`, `js/webglBackground.js`: shared auth, routing, quote, and background helpers.
- `js/config.js`: project URL and browser-safe key.
- `css/styles.css`: active Royal Institute themed stylesheet.
- `supabase/schema.sql`: tables, constraints, indexes, signup/audit triggers, and prompt-compatible column aliases.
- `supabase/rls-policies.sql`: explicit grants, RLS, and privilege-protection triggers.
- `supabase/seed-duty-options.sql`: active duty seed with Checkpoint, Floor, and Canteen. Checkpoint intentionally has no stored location rows.
- `sql/remove-bag-checking-and-checkpoint-locations.sql`: cleanup migration for old prototype duty/location data.
- `sql/update-floor-duty-permanent-assignments.sql`: migration that makes Floor Duty permanent and validates assignment scope.
- `sql/make-coordinator-attendance-official.sql`: migration that changes attendance session state from approval-based to directly recorded/corrected.
