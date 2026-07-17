-- 0013_allow_all_layout_variants.sql
-- Root-cause fix for "cuma 3 dari 9 layout yang bisa dibuka di editor" +
-- "belum punya dokumen slide" (bug 2+3, second report).
--
-- The app has NINE layout variants, but posts_layout_variant_check was
-- last updated in 0010 and still allows only FIVE — terminal_dev,
-- elegant_promo, news_card, photo_editorial were added to the code with
-- no accompanying migration. Every generate with one of those four
-- layouts made the designer route's final posts UPDATE (status,
-- layout_variant, slide_documents, ...) fail the CHECK constraint — and
-- that UPDATE's error was never read, so the route returned 200 with all
-- PNGs rendered while slide_documents silently stayed empty. The editor
-- then had nothing to open.
--
-- NOTE: this file targets the carousel.* schema production actually
-- uses. Earlier files in this directory (0001-0012) describe a public.*
-- layout that production has since been migrated away from outside this
-- repo; they are kept for history but no longer reflect live state. The
-- authoritative replica of live state as of 2026-07-16 is
-- e2e/sql/schema.sql.

alter table carousel.posts
  drop constraint if exists posts_layout_variant_check;

alter table carousel.posts
  add constraint posts_layout_variant_check check (
    layout_variant = any (array[
      'minimal'::text,
      'accent'::text,
      'editorial_gradient'::text,
      'flat_icon_list'::text,
      'flat_mockup_card'::text,
      'terminal_dev'::text,
      'elegant_promo'::text,
      'news_card'::text,
      'photo_editorial'::text
    ])
  );
