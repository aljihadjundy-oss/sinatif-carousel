-- 0011_add_slide_overrides_to_posts.sql
-- Idempotent: safe to re-run.
-- Per-slide color scheme / text density overrides. Layout template and
-- background mode stay post-level, never per-slide — see lib/slideDesign.ts.

alter table carousel.posts
  add column if not exists slide_overrides jsonb not null default '[]'::jsonb;

comment on column carousel.posts.slide_overrides is
  'Per-slide color scheme / text density overrides. Array of {slideIndex, colorScheme?, textDensity?}. Layout template and background mode are always post-level, never overridden per slide.';
