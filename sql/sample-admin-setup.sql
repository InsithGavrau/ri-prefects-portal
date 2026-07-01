-- Run only after signing up the intended first admin through signup.html.
-- Replace the email below, then run this once in the Supabase SQL Editor.
update public.profiles
set role='admin', account_status='active', updated_at=now()
where lower(email)=lower('replace-with-your-admin-email@example.com');

-- Verify exactly one intended account was promoted.
select id, first_name, email, role, account_status
from public.profiles
where lower(email)=lower('replace-with-your-admin-email@example.com');
