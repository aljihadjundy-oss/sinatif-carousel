-- 0001_brand_profiles_and_carousel_posts.sql
-- Idempotent: safe to re-run.

create extension if not exists "pgcrypto";

-- brand_profiles -----------------------------------------------------------

create table if not exists public.brand_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  profile_type text not null check (profile_type in ('internal_bu', 'client')),
  business_unit text check (
    business_unit in (
      'Sinatif Agency', 'Sinatif Academy', 'Osiris Event', 'Hexolution', 'HMAIRA Scarf'
    )
  ),
  tone_guideline text,
  content_standards text,
  target_audience_default text,
  created_at timestamptz not null default now()
);

create index if not exists brand_profiles_user_id_idx
  on public.brand_profiles (user_id);

alter table public.brand_profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'brand_profiles'
      and policyname = 'Users manage own brand profiles'
  ) then
    create policy "Users manage own brand profiles"
      on public.brand_profiles for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- carousel_posts -----------------------------------------------------------

create table if not exists public.carousel_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_profile_id uuid references public.brand_profiles(id) on delete set null,
  topic text not null,
  audience text,
  goal text,
  script jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create index if not exists carousel_posts_user_id_idx
  on public.carousel_posts (user_id);

create index if not exists carousel_posts_brand_profile_id_idx
  on public.carousel_posts (brand_profile_id);

alter table public.carousel_posts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'carousel_posts'
      and policyname = 'Users manage own carousel posts'
  ) then
    create policy "Users manage own carousel posts"
      on public.carousel_posts for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
