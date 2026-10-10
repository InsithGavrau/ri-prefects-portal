begin;

alter table public.hall_of_fame_entries
  add column if not exists profile_image_path text,
  add column if not exists profile_image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hall-of-fame-photos',
  'hall-of-fame-photos',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "hall of fame photos are readable" on storage.objects;
drop policy if exists "prefects can upload their own hall of fame photos" on storage.objects;
drop policy if exists "prefects can replace their own hall of fame photos" on storage.objects;
drop policy if exists "prefects can delete their own hall of fame photos" on storage.objects;

create policy "hall of fame photos are readable"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'hall-of-fame-photos');

create policy "prefects can upload their own hall of fame photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'hall-of-fame-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.current_role() in ('prefect', 'coordinator')
);

create policy "prefects can replace their own hall of fame photos"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'hall-of-fame-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.current_role() in ('prefect', 'coordinator')
)
with check (
  bucket_id = 'hall-of-fame-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.current_role() in ('prefect', 'coordinator')
);

create policy "prefects can delete their own hall of fame photos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'hall-of-fame-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.current_role() in ('prefect', 'coordinator')
);

create or replace function private.protect_hall_of_fame_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text;
begin
  if (select auth.uid()) is null then
    new.updated_at := now();
    return new;
  end if;

  actor := private.current_role();

  if actor = 'admin' then
    new.updated_at := now();
    return new;
  end if;

  if actor = 'teacher' then
    if new.submitted_by is distinct from old.submitted_by
      or new.display_name is distinct from old.display_name
      or new.display_class is distinct from old.display_class
      or new.title is distinct from old.title
      or new.contribution_years is distinct from old.contribution_years
      or new.contribution_summary is distinct from old.contribution_summary
      or new.leadership_impact is distinct from old.leadership_impact
      or new.profile_image_path is distinct from old.profile_image_path
      or new.profile_image_url is distinct from old.profile_image_url
      or new.is_seeded is distinct from old.is_seeded
      or new.submitted_at is distinct from old.submitted_at
      or new.created_at is distinct from old.created_at then
      raise exception 'Teachers can only review or archive Wall of Honor records';
    end if;

    if new.reviewed_by is distinct from (select auth.uid()) then
      raise exception 'Review must be linked to the reviewing teacher';
    end if;
    if new.reviewed_at is null then
      raise exception 'Review time is required';
    end if;

    if new.status = 'archived' then
      new.updated_at := now();
      return new;
    end if;

    if old.submitted_by = (select auth.uid()) then
      raise exception 'Teachers cannot review their own Wall of Honor request';
    end if;
    if old.is_seeded or old.status <> 'pending' then
      raise exception 'Teachers can only approve or decline pending non-seeded Wall of Honor requests';
    end if;
    if new.status not in ('approved','declined') then
      raise exception 'Teachers can only approve, decline, or archive Wall of Honor records';
    end if;

    new.updated_at := now();
    return new;
  end if;

  raise exception 'Only teachers and admins can update Wall of Honor entries';
end;
$$;

drop trigger if exists protect_hall_of_fame_update on public.hall_of_fame_entries;
create trigger protect_hall_of_fame_update before update on public.hall_of_fame_entries
for each row execute function private.protect_hall_of_fame_update();

grant select on public.hall_of_fame_entries to anon;
grant select, insert, update on public.hall_of_fame_entries to authenticated;
notify pgrst, 'reload schema';

commit;
