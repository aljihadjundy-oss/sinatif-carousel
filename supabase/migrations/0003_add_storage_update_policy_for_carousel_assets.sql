-- 0003_add_storage_update_policy_for_carousel_assets.sql
-- Idempotent: safe to re-run.

-- Only INSERT and SELECT policies existed on storage.objects for the
-- carousel-assets bucket. The designer route uploads with upsert: true,
-- which performs an UPDATE when a slide's object path already exists
-- (i.e. any regeneration). With no UPDATE policy, RLS defaults to deny,
-- producing: "new row violates row-level security policy (USING
-- expression) for table 'objects'".
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'authenticated users can update carousel assets'
  ) then
    create policy "authenticated users can update carousel assets"
      on storage.objects for update
      to authenticated
      using (bucket_id = 'carousel-assets')
      with check (bucket_id = 'carousel-assets');
  end if;
end $$;
