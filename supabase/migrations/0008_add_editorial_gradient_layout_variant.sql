-- 0008_add_editorial_gradient_layout_variant.sql
-- Idempotent: safe to re-run.
-- Extends the existing layout_variant column (see
-- 0002_add_layout_variant_to_posts.sql) rather than adding a new column —
-- editorial_gradient is a third value of the same "overall slide style"
-- concept minimal/accent already represent, just meant for
-- background_image_url slides specifically (falls back to accent-like
-- rendering if picked without a background image — see designer route).

alter table carousel.posts drop constraint if exists posts_layout_variant_check;
alter table carousel.posts
  add constraint posts_layout_variant_check
  check (layout_variant in ('minimal', 'accent', 'editorial_gradient'));
