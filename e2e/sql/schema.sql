-- carousel.* schema — REPLICATED FROM PRODUCTION by live catalog
-- introspection (information_schema.columns, pg_constraint,
-- pg_policies) on 2026-07-16, NOT from supabase/migrations/*.sql: the
-- repo's migration files describe an older public.* layout that
-- production no longer matches (the carousel schema was evolved directly
-- on the server).
--
-- Deliberately replicated bug-for-bug: posts_layout_variant_check below
-- allows only FIVE of the app's NINE layout variants — terminal_dev,
-- elegant_promo, news_card, photo_editorial were added to the code with
-- no accompanying constraint change. The E2E harness must reproduce that
-- production failure before any fix is applied; the fix ships as a
-- normal migration on top.

create schema if not exists carousel;

create table if not exists carousel.brand_profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_type text not null,
  name text not null,
  business_unit text,
  tone_guideline text,
  content_standards text,
  visual_style jsonb,
  target_audience_default text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists carousel.posts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  topic text not null,
  audience text,
  goal text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  brand_profile_id uuid references carousel.brand_profiles (id),
  layout_variant text not null default 'minimal'
    constraint posts_layout_variant_check check (
      layout_variant = any (array[
        'minimal'::text, 'accent'::text, 'editorial_gradient'::text,
        'flat_icon_list'::text, 'flat_mockup_card'::text
      ])
    ),
  color_scheme text,
  text_density text not null default 'standard'
    constraint posts_text_density_check check (
      text_density = any (array['concise'::text, 'standard'::text, 'detailed'::text])
    ),
  hierarchy text not null default 'balanced'
    constraint posts_hierarchy_check check (
      hierarchy = any (array['headline_focused'::text, 'balanced'::text])
    ),
  background_image_url text,
  icon_name text
    constraint posts_icon_name_check check (
      icon_name = any (array[
        'none'::text, 'TrendingUp'::text, 'Target'::text,
        'Lightbulb'::text, 'CheckCircle'::text, 'ArrowRight'::text
      ])
    ),
  typography_preset text
    constraint posts_typography_preset_check check (
      typography_preset = any (array[
        'modern_sans'::text, 'editorial_bold'::text, 'elegant_serif'::text,
        'friendly_rounded'::text, 'handwritten_accent'::text
      ])
    ),
  slide_overrides jsonb not null default '[]'::jsonb,
  slide_documents jsonb not null default '[]'::jsonb
);

create table if not exists carousel.slides (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references carousel.posts (id) on delete cascade,
  slide_order integer not null,
  copy_text text,
  image_url text,
  rendered_image_url text,
  created_at timestamptz not null default now()
);

create table if not exists carousel.stage_outputs (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references carousel.posts (id) on delete cascade,
  stage text not null,
  output_json jsonb not null,
  created_at timestamptz not null default now()
);

alter table carousel.brand_profiles enable row level security;
alter table carousel.posts enable row level security;
alter table carousel.slides enable row level security;
alter table carousel.stage_outputs enable row level security;

-- Production's actual policies (pg_policies dump): a single
-- role-membership check per table, not per-row ownership.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'carousel'
      and tablename = 'brand_profiles' and policyname = 'authenticated users manage all brand_profiles') then
    create policy "authenticated users manage all brand_profiles"
      on carousel.brand_profiles for all
      using (auth.role() = 'authenticated'::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'carousel'
      and tablename = 'posts' and policyname = 'authenticated users manage all posts') then
    create policy "authenticated users manage all posts"
      on carousel.posts for all
      using (auth.role() = 'authenticated'::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'carousel'
      and tablename = 'slides' and policyname = 'authenticated users manage all slides') then
    create policy "authenticated users manage all slides"
      on carousel.slides for all
      using (auth.role() = 'authenticated'::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'carousel'
      and tablename = 'stage_outputs' and policyname = 'authenticated users manage all stage_outputs') then
    create policy "authenticated users manage all stage_outputs"
      on carousel.stage_outputs for all
      using (auth.role() = 'authenticated'::text);
  end if;
end $$;

grant usage on schema carousel to anon, authenticated, service_role;
grant all on all tables in schema carousel to anon, authenticated, service_role;
alter default privileges in schema carousel
  grant all on tables to anon, authenticated, service_role;
