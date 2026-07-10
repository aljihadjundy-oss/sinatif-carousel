-- 0007_add_typography_preset_to_posts.sql
-- Idempotent: safe to re-run.
-- Preset keys must stay in sync with lib/typography-presets.ts.

alter table carousel.posts
  add column if not exists typography_preset text
  check (typography_preset in ('modern_sans', 'editorial_bold', 'elegant_serif', 'friendly_rounded', 'handwritten_accent'));
