-- 0009_add_flat_icon_list_layout_variant.sql
-- Idempotent: safe to re-run.
-- Extends the existing layout_variant column/constraint (see
-- 0002_add_layout_variant_to_posts.sql, 0008_add_editorial_gradient_layout_variant.sql)
-- rather than adding a new column — flat_icon_list is a 4th value of the
-- same "overall slide style" concept. Unlike editorial_gradient, it's a
-- flat/no-photo style usable regardless of whether background_image_url
-- is set (the designer route ignores it for this variant).

alter table carousel.posts drop constraint if exists posts_layout_variant_check;
alter table carousel.posts
  add constraint posts_layout_variant_check
  check (layout_variant in ('minimal', 'accent', 'editorial_gradient', 'flat_icon_list'));
