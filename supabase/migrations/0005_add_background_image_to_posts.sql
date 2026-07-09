-- 0005_add_background_image_to_posts.sql
-- Idempotent: safe to re-run.

alter table carousel.posts
  add column if not exists background_image_url text;
