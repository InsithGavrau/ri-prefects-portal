# Deploy RI Prefects Portal For Free

This portal is a static Vite website plus Supabase Auth/Postgres. The best free setup is:

- Website: Cloudflare Pages Free
- Database/Auth: Supabase Free
- Code storage/deploy trigger: GitHub Free

Cloudflare Pages is the best fit because the site is static, bandwidth is generous, builds are free for normal school usage, and there is no server to keep awake.

## 1. Database Setup

Open your Supabase project:

https://supabase.com/dashboard/project/btwphzfdfgmnfekzrntv

In SQL Editor, run these files in order:

1. `supabase/schema.sql`
2. `supabase/rls-policies.sql`
3. `supabase/seed-duty-options.sql`
4. `sql/remove-bag-checking-and-checkpoint-locations.sql`
5. `sql/update-floor-duty-permanent-assignments.sql`
6. `sql/make-coordinator-attendance-official.sql`
7. `sql/emergency-fix-attendance-status.sql`
8. `sql/fix-admin-user-management-role-updates.sql`
9. `sql/add-hall-of-fame.sql`

After signup creates your first admin account, run `supabase/sample-admin-setup.sql` or `sql/sample-admin-setup.sql` with your admin email filled in.

## 2. Supabase Auth Settings

In Supabase Dashboard, go to Authentication > URL Configuration.

Set Site URL after deployment to:

```text
https://YOUR-CLOUDFLARE-PAGES-SITE.pages.dev
```

Add Redirect URLs:

```text
https://YOUR-CLOUDFLARE-PAGES-SITE.pages.dev/**
http://127.0.0.1:5173/**
http://127.0.0.1:4173/**
```

For the prototype, disable email confirmation if signup rate limits keep blocking testing:

Authentication > Sign In / Providers > Email > Confirm email = off

For production school use, configure custom SMTP instead of relying on Supabase's shared email quota.

## 3. GitHub Upload

Create a GitHub repository, then upload/push this folder.

Do not upload any Supabase service-role key. This project only uses the publishable browser key in `js/config.js`, which is safe for frontend use because RLS protects the data.

Recommended commands if Git is installed:

```powershell
git init
git add .
git commit -m "Deploy RI Prefects Portal"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ri-prefects-portal.git
git push -u origin main
```

## 4. Cloudflare Pages Deployment

1. Go to https://dash.cloudflare.com
2. Open Workers & Pages.
3. Click Create application.
4. Choose Pages.
5. Connect to Git.
6. Select the GitHub repository.
7. Use these build settings:

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
Root directory: /
Node version: 22
```

8. Click Save and Deploy.

Cloudflare will give you a URL like:

```text
https://ri-prefects-portal.pages.dev
```

Put that URL into Supabase Auth settings as described above.

## 4A. If You Accidentally Created a Worker Instead of Pages

If the Cloudflare screen says "Connect your Worker to a Git repository", you created a Worker project. This repo now supports that too through `wrangler.jsonc`.

Keep these settings:

```text
Build command: npm run build
Root directory: /
```

Change these settings:

```text
Deploy command: npx wrangler deploy --assets ./dist
Version command: npx wrangler versions upload --assets ./dist
```

The important file for this mode is:

```text
wrangler.jsonc
```

It tells Cloudflare Workers to serve the Vite `dist` folder as static assets.

## 5. Custom School Domain

Optional but recommended:

1. In Cloudflare Pages, open your project.
2. Go to Custom domains.
3. Add something like:

```text
prefects.yourschooldomain.edu
```

4. Follow Cloudflare's DNS instructions.
5. Add the custom domain to Supabase redirect URLs:

```text
https://prefects.yourschooldomain.edu/**
```

## 6. Testing Checklist

After deployment:

1. Open the Cloudflare Pages URL.
2. Sign up a prefect.
3. Promote your staff/admin account in Supabase or Admin User Management.
4. Test login/logout persistence.
5. Test duty selection.
6. Test coordinator attendance marking.
7. Test teacher dashboards/reports.
8. Test Hall of Fame request submission and approval.
9. Confirm no browser console Supabase/RLS errors.

## Free Plan Limits To Watch

Cloudflare Pages Free is suitable for this website because it serves static files globally and does not require a backend server.

Supabase Free is suitable for a school prototype/small deployment. Watch:

- 500 MB database size
- 50,000 monthly active users
- 5 GB egress plus 5 GB cached egress
- Check the Supabase dashboard for any current inactivity or project-retention notices on the Free plan.

If this becomes official daily school infrastructure, the first paid upgrade should be Supabase Pro, not paid static hosting.
