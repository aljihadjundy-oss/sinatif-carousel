-- 0012_add_slide_documents_to_posts.sql
-- Idempotent: safe to re-run.
--
-- Phase 1 of the generator -> visual-editor migration (see AUDIT.md).
-- New column only — script, slide_overrides, and carousel.slides are
-- untouched and keep working as the generator's input/output. Once a
-- post has slide_documents entries, those become the source of truth
-- for the visual editor (phase 3+); until then the column stays '[]'.
--
-- Shape: JSONB array of SlideDocument (see lib/slideDocument.ts):
--   [{ version: 1, id: <uuid>, canvas: {width, height, background},
--      nodes: [{id: <uuid>, type: 'text'|'shape'|'image'|'icon', x, y,
--               width, height, ...per-type fields}],
--      manuallyEdited?: boolean }]
-- Slides and nodes are identified by their stable UUID `id`, never by
-- array position — array order is only ordering (slide order / z-order).
-- Every document carries `version` so future schema evolutions can
-- migrate old rows explicitly instead of guessing their shape.

alter table carousel.posts
  add column if not exists slide_documents jsonb not null default '[]'::jsonb;

comment on column carousel.posts.slide_documents is
  'Visual-editor node-tree per slide: array of SlideDocument {version, id (uuid), canvas, nodes[], manuallyEdited?}. Empty array until the post is materialized for editing. Legacy script/slide_overrides remain the generator input; this column is the editor''s source of truth once populated. See lib/slideDocument.ts.';
