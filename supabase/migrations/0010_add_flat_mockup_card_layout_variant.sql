-- 0010_add_flat_mockup_card_layout_variant.sql
-- Idempotent: safe to re-run.
-- Extends the existing layout_variant column/constraint (see
-- 0002, 0008, 0009) — flat_mockup_card is a 5th value of the same
-- "overall slide style" concept. Like flat_icon_list, it's a flat/no-photo
-- style usable regardless of whether background_image_url is set.

alter table carousel.posts drop constraint if exists posts_layout_variant_check;
alter table carousel.posts
  add constraint posts_layout_variant_check
  check (layout_variant in ('minimal', 'accent', 'editorial_gradient', 'flat_icon_list', 'flat_mockup_card'));
