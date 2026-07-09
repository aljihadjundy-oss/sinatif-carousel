-- 0004_add_design_options_to_posts.sql
-- Idempotent: safe to re-run.

alter table carousel.posts
  add column if not exists color_scheme text,
  add column if not exists text_density text not null default 'standard'
    check (text_density in ('concise', 'standard', 'detailed')),
  add column if not exists hierarchy text not null default 'balanced'
    check (hierarchy in ('headline_focused', 'balanced'));
