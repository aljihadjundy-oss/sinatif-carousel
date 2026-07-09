-- 0006_add_icon_name_to_posts.sql
-- Idempotent: safe to re-run.

alter table carousel.posts
  add column if not exists icon_name text
  check (icon_name in ('none', 'TrendingUp', 'Target', 'Lightbulb', 'CheckCircle', 'ArrowRight'));
