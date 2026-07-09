-- 0002_add_layout_variant_to_posts.sql
-- Idempotent: safe to re-run.

alter table carousel.posts
  add column if not exists layout_variant text not null default 'minimal'
  check (layout_variant in ('minimal', 'accent'));
