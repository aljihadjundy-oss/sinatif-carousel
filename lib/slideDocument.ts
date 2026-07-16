// Phase-1 data model for the generator → visual-editor migration (see
// AUDIT.md §2): a Figma-style node tree per slide, stored as
// carousel.posts.slide_documents (JSONB array of SlideDocument, migration
// 0012). This is a NEW column — the legacy structures (posts.script,
// posts.slide_overrides, the carousel.slides render cache) are untouched
// and remain the generator's input; slide_documents becomes the source of
// truth for a slide only once the user starts editing it (phase 2+ will
// materialize documents by compiling the existing templates).
//
// Design decisions carried over from the audit:
// - Slides and nodes are identified by stable UUIDs, never by array
//   position — this is the fix for the index-as-identity debt (script
//   slide index / slide_overrides.slideIndex / slides.slide_order /
//   slide-N.png all keying off position), and the prerequisite for
//   reorder/duplicate. Array order still MEANS something (slide order in
//   the carousel; node order = z-order bottom→top), but reordering is now
//   just moving array elements — no identity rewrites, no
//   reindexSlideOverrides()-style fixups.
// - `version` on every document so the schema can evolve without guessing
//   what shape old JSONB rows have.
// - Validation is hand-rolled type guards (no zod/ajv) — consistent with
//   how this codebase already validates untrusted JSONB input in the
//   designer route, and keeps phase 1 dependency-free per the
//   free/open-source-only constraint (which trivially includes "none").
//
// Everything here is pure data + pure functions — safe to import from
// server routes, client components, and plain scripts alike, same as
// lib/slideDesign.ts.

export const SLIDE_DOCUMENT_VERSION = 1 as const

// Instagram portrait canvas — the only size the renderer produces today.
// Kept as document data (not a hardcoded render-time constant) so other
// formats (square feed, story) become a data change, not a code change.
export const DEFAULT_CANVAS = { width: 1080, height: 1350 } as const

// ---------------------------------------------------------------------------
// Fills

export interface SolidFill {
  type: 'solid'
  color: string // hex, e.g. '#1d4ed8'
}

export interface LinearGradientFill {
  type: 'linear-gradient'
  angle: number // degrees, CSS convention (0 = to top)
  stops: { offset: number; color: string }[] // offset 0..1
}

export interface ImageFill {
  type: 'image'
  src: string // https URL or data: URI
  fit: 'cover' | 'contain'
}

export type Fill = SolidFill | LinearGradientFill | ImageFill

// ---------------------------------------------------------------------------
// Nodes

// Fields shared by every node. x/y are the top-left corner in canvas
// coordinates (px); rotation is degrees clockwise around the node's
// center. Optional fields omitted = their neutral value (rotation 0,
// opacity 1, locked false) — keeps persisted JSONB minimal.
export interface BaseNode {
  id: string // UUID, stable across edits/reorders
  type: 'text' | 'shape' | 'image' | 'icon'
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  opacity?: number // 0..1
  locked?: boolean
}

export interface TextNode extends BaseNode {
  type: 'text'
  // Plain string for v1. Multi-style runs (bold a single word, etc.) are
  // a planned v2 evolution: `text` becomes `runs: {text, style?}[]` under
  // a version bump — deliberately NOT speculatively modeled now.
  text: string
  fontFamily: string
  fontWeight: 400 | 500 | 600 | 700 | 800 | 900
  fontSize: number // px at canvas scale
  color: string // hex
  align: 'left' | 'center' | 'right'
  // Multiplier, e.g. 1.3. Omitted = the font's natural ("normal") line
  // height, exactly as satori computes it — several existing template
  // text elements (e.g. minimal's slide number) never set line-height,
  // and freezing a guessed number would shift them vs the phase-0
  // baselines. Made optional during the phase-2 pilot for this reason.
  lineHeight?: number
  // px. Several templates (terminal_dev meta rows, elegant_promo brand
  // row, flat_mockup_card labels) set CSS letter-spacing; added in the
  // phase-2 rollout when those templates were compiled.
  letterSpacing?: number
}

export interface ShapeNode extends BaseNode {
  type: 'shape'
  shape: 'rect' | 'ellipse' | 'line'
  fill: Fill
  cornerRadius?: number // rect only
  stroke?: { color: string; width: number }
}

export interface ImageNode extends BaseNode {
  type: 'image'
  src: string // https URL or data: URI
  fit: 'cover' | 'contain'
}

export interface IconNode extends BaseNode {
  type: 'icon'
  // Must be a key of ICON_NODES in lib/icons.tsx — validated by callers
  // against that list (same pattern as LayoutVariant validation) rather
  // than re-declared here.
  name: string
  color: string
  strokeWidth?: number
}

export type SlideNode = TextNode | ShapeNode | ImageNode | IconNode

// ---------------------------------------------------------------------------
// Document

export interface SlideDocument {
  version: typeof SLIDE_DOCUMENT_VERSION
  id: string // UUID, stable slide identity — never the array position
  canvas: {
    width: number
    height: number
    background: Fill
  }
  // Array order is z-order, bottom → top.
  nodes: SlideNode[]
  // Set once the user manually edits this slide in the visual editor.
  // Regeneration flows must not overwrite documents with this flag
  // without explicit user confirmation (AUDIT.md risk R3).
  manuallyEdited?: boolean
}

// ---------------------------------------------------------------------------
// Constructors

export function createSlideDocument(
  background: Fill = { type: 'solid', color: '#111827' }
): SlideDocument {
  return {
    version: SLIDE_DOCUMENT_VERSION,
    id: crypto.randomUUID(),
    canvas: { ...DEFAULT_CANVAS, background },
    nodes: [],
  }
}

export function createNodeId(): string {
  return crypto.randomUUID()
}

// Duplicate with fresh UUIDs for the slide AND every node — two slides
// (or two nodes) must never share an id, or selection/undo in the editor
// and any future per-node persistence would conflate them.
export function duplicateSlideDocument(doc: SlideDocument): SlideDocument {
  return {
    ...doc,
    id: crypto.randomUUID(),
    canvas: { ...doc.canvas, background: doc.canvas.background },
    nodes: doc.nodes.map((n) => ({ ...n, id: crypto.randomUUID() })),
  }
}

// ---------------------------------------------------------------------------
// Validation (untrusted JSONB / request bodies)
//
// Structural guards, not exhaustive value validation: they guarantee the
// shape TypeScript promises (so downstream code can't crash on a missing
// field) and reject unknown node/fill types. Range checks (opacity 0..1,
// hex format, icon-name membership) stay at the write boundaries that
// know the context, same split the designer route already uses.

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isFill(v: unknown): v is Fill {
  if (!v || typeof v !== 'object') return false
  const f = v as Record<string, unknown>
  switch (f.type) {
    case 'solid':
      return isNonEmptyString(f.color)
    case 'linear-gradient':
      return (
        isFiniteNumber(f.angle) &&
        Array.isArray(f.stops) &&
        f.stops.length > 0 &&
        f.stops.every(
          (s: unknown) =>
            !!s &&
            typeof s === 'object' &&
            isFiniteNumber((s as Record<string, unknown>).offset) &&
            isNonEmptyString((s as Record<string, unknown>).color)
        )
      )
    case 'image':
      return isNonEmptyString(f.src) && (f.fit === 'cover' || f.fit === 'contain')
    default:
      return false
  }
}

const FONT_WEIGHTS = [400, 500, 600, 700, 800, 900]

function isBaseNode(v: unknown): v is BaseNode {
  if (!v || typeof v !== 'object') return false
  const n = v as Record<string, unknown>
  return (
    isNonEmptyString(n.id) &&
    isFiniteNumber(n.x) &&
    isFiniteNumber(n.y) &&
    isFiniteNumber(n.width) &&
    isFiniteNumber(n.height) &&
    (n.rotation === undefined || isFiniteNumber(n.rotation)) &&
    (n.opacity === undefined || isFiniteNumber(n.opacity)) &&
    (n.locked === undefined || typeof n.locked === 'boolean')
  )
}

export function isSlideNode(v: unknown): v is SlideNode {
  if (!isBaseNode(v)) return false
  const n = v as unknown as Record<string, unknown>
  switch (n.type) {
    case 'text':
      return (
        typeof n.text === 'string' &&
        isNonEmptyString(n.fontFamily) &&
        FONT_WEIGHTS.includes(n.fontWeight as number) &&
        isFiniteNumber(n.fontSize) &&
        isNonEmptyString(n.color) &&
        (n.align === 'left' || n.align === 'center' || n.align === 'right') &&
        (n.lineHeight === undefined || isFiniteNumber(n.lineHeight)) &&
        (n.letterSpacing === undefined || isFiniteNumber(n.letterSpacing))
      )
    case 'shape':
      return (
        (n.shape === 'rect' || n.shape === 'ellipse' || n.shape === 'line') &&
        isFill(n.fill) &&
        (n.cornerRadius === undefined || isFiniteNumber(n.cornerRadius)) &&
        (n.stroke === undefined ||
          (!!n.stroke &&
            typeof n.stroke === 'object' &&
            isNonEmptyString((n.stroke as Record<string, unknown>).color) &&
            isFiniteNumber((n.stroke as Record<string, unknown>).width)))
      )
    case 'image':
      return isNonEmptyString(n.src) && (n.fit === 'cover' || n.fit === 'contain')
    case 'icon':
      return (
        isNonEmptyString(n.name) &&
        isNonEmptyString(n.color) &&
        (n.strokeWidth === undefined || isFiniteNumber(n.strokeWidth))
      )
    default:
      return false
  }
}

export function isSlideDocument(v: unknown): v is SlideDocument {
  if (!v || typeof v !== 'object') return false
  const d = v as Record<string, unknown>
  const canvas = d.canvas as Record<string, unknown> | undefined
  return (
    d.version === SLIDE_DOCUMENT_VERSION &&
    isNonEmptyString(d.id) &&
    !!canvas &&
    typeof canvas === 'object' &&
    isFiniteNumber(canvas.width) &&
    isFiniteNumber(canvas.height) &&
    isFill(canvas.background) &&
    Array.isArray(d.nodes) &&
    d.nodes.every(isSlideNode) &&
    (d.manuallyEdited === undefined || typeof d.manuallyEdited === 'boolean')
  )
}

// ---------------------------------------------------------------------------
// Write-boundary content validation (phase-2c) — the gap PR #62 flagged:
// structural guards above guarantee shape, these guarantee VALUES that
// downstream consumers dereference blindly. Applied by every route that
// writes posts.slide_documents, whether the document came from the
// compiler (defense in depth) or, later, from the phase-3 editor
// (genuinely untrusted input).

// Hex (#rgb/#rrggbb/#rrggbbaa) or rgb()/rgba() — the compiler emits both
// (rgba comes from the legacy templates' gradient stops and translucent
// fills), so hex-only validation would reject its own output.
const COLOR_RE =
  /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$|^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/

export function isValidNodeColor(color: string): boolean {
  return COLOR_RE.test(color)
}

function fillColorError(fill: Fill): string | null {
  switch (fill.type) {
    case 'solid':
      return isValidNodeColor(fill.color) ? null : `invalid fill color "${fill.color}"`
    case 'linear-gradient':
      for (const stop of fill.stops) {
        if (!isValidNodeColor(stop.color)) return `invalid gradient stop color "${stop.color}"`
      }
      return null
    case 'image':
      return null
  }
}

// Returns a human-readable problem description, or null when the
// document's colors and icon names are all valid. Icon names are checked
// against the caller-supplied list (lib/icons' ICON_NAMES) rather than
// imported here, keeping this module a leaf with no icon dependency.
export function getSlideDocumentContentError(
  doc: SlideDocument,
  validIconNames: readonly string[]
): string | null {
  const bgError = fillColorError(doc.canvas.background)
  if (bgError) return `canvas background: ${bgError}`
  for (const node of doc.nodes) {
    switch (node.type) {
      case 'text':
        if (!isValidNodeColor(node.color)) return `text node ${node.id}: invalid color "${node.color}"`
        break
      case 'shape': {
        const err = fillColorError(node.fill)
        if (err) return `shape node ${node.id}: ${err}`
        if (node.stroke && !isValidNodeColor(node.stroke.color))
          return `shape node ${node.id}: invalid stroke color "${node.stroke.color}"`
        break
      }
      case 'icon':
        if (!validIconNames.includes(node.name))
          return `icon node ${node.id}: unknown icon "${node.name}"`
        if (!isValidNodeColor(node.color)) return `icon node ${node.id}: invalid color "${node.color}"`
        break
      case 'image':
        break
    }
  }
  return null
}

// Validates the whole persisted column value (posts.slide_documents):
// an array of documents with globally unique slide ids.
export function isSlideDocumentArray(v: unknown): v is SlideDocument[] {
  if (!Array.isArray(v) || !v.every(isSlideDocument)) return false
  const ids = v.map((d) => d.id)
  return new Set(ids).size === ids.length
}
