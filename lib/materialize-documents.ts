// Lazy materialization of slide_documents (AUDIT.md strategy R4 — planned
// since phase 1, implemented now as the permanent safety net behind the
// "belum punya dokumen slide" dead-end class of bugs).
//
// The editor page calls materializeSlideDocuments() whenever a post's
// slide_documents is empty or shorter than its script: documents are
// compiled RIGHT THEN from the same script + persisted design options the
// designer route uses, written back to the post, and returned for the
// canvas to render. Whatever upstream path failed to write documents —
// a silently-failed UPDATE (the layout_variant CHECK-constraint bug), a
// designer 502/timeout that redirected to the post page, a post created
// before migration 0012, a future regression — the editor recovers on
// open instead of dead-ending.
//
// Differences vs the designer route's compile loop, both deliberate:
//  - No PNG rendering and no Storage writes — the editor needs documents
//    only; PNGs stay owned by the designer route.
//  - No AI calls: a non-standard text_density uses its cached rewrite
//    (stage script_<density>) when one exists and otherwise falls back to
//    the base script. Opening the editor must never block on (or fail
//    because of) an LLM.
//
// And the last line of defense: buildFallbackDocument() constructs a
// plain but fully valid, fully editable document (background + headline +
// body) that CANNOT fail — used per-slide when compileTemplate() throws,
// and standing alone when a post has no script at all. The editor
// therefore always has something real to open.

import { ALL_ICON_NAMES, IconName } from '@/lib/icons'
import { getTypographyPreset } from '@/lib/typography-presets'
import {
  BRAND_FONTS,
  DEFAULT_FONTS,
  Hierarchy,
  LayoutVariant,
  TextDensity,
  VisualStyle,
  pickColors,
} from '@/lib/slide-renderer'
import { SlideOverride, applyCustomColors, resolveSlideDesign } from '@/lib/slideDesign'
import { compileTemplate, loadLegacyFontSet } from '@/lib/template-compiler'
import {
  SLIDE_DOCUMENT_VERSION,
  SlideDocument,
  getSlideDocumentContentError,
  isSlideDocumentArray,
} from '@/lib/slideDocument'

interface ScriptSlide {
  index: number
  headline: string
  body: string
}

interface PostDesignRow {
  id: string
  topic: string
  layout_variant: string | null
  color_scheme: string | null
  text_density: string | null
  hierarchy: string | null
  background_image_url: string | null
  icon_name: string | null
  typography_preset: string | null
  slide_overrides: unknown
  slide_documents: unknown
  brand_profile_id: string | null
}

// Minimal structural interface over the supabase client so this module
// stays testable and independent of the ssr/browser client split. The
// query-builder chain is too polymorphic to type structurally without
// pulling in supabase-js's own generics — the table handle is the one
// deliberately-loose point.
interface DbClient {
  schema(name: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from(table: string): any
  }
}

export interface MaterializeResult {
  documents: SlideDocument[]
  // 1-based slide orders that got the plain fallback document because
  // compileTemplate() failed for them — surfaced so callers can log/show
  // a degraded-quality notice. Empty on the happy path.
  fallbackSlideOrders: number[]
  // True when this call actually compiled + persisted (i.e. the post was
  // missing/short on documents); false when existing documents were
  // already complete and returned untouched.
  materialized: boolean
}

// A document so simple it cannot fail validation: solid background, two
// text nodes. Uses the same fonts/colors the post's design options
// resolve to, so it looks intentional rather than broken — but its whole
// job is to be a guaranteed-openable, guaranteed-editable starting point.
export function buildFallbackDocument(input: {
  headline: string
  body: string
  bg: string
  fg: string
  headlineFamily: string
  bodyFamily: string
}): SlideDocument {
  return {
    version: SLIDE_DOCUMENT_VERSION,
    id: crypto.randomUUID(),
    canvas: { width: 1080, height: 1350, background: { type: 'solid', color: input.bg } },
    nodes: [
      {
        id: crypto.randomUUID(),
        type: 'text',
        x: 80,
        y: 480,
        width: 920,
        height: 260,
        text: input.headline,
        fontFamily: input.headlineFamily,
        fontWeight: 700,
        fontSize: 64,
        color: input.fg,
        align: 'left',
        lineHeight: 1.15,
      },
      {
        id: crypto.randomUUID(),
        type: 'text',
        x: 80,
        y: 780,
        width: 920,
        height: 320,
        text: input.body,
        fontFamily: input.bodyFamily,
        fontWeight: 400,
        fontSize: 34,
        color: input.fg,
        align: 'left',
        lineHeight: 1.5,
      },
    ],
  }
}

export async function materializeSlideDocuments(
  supabase: DbClient,
  post: PostDesignRow
): Promise<MaterializeResult> {
  const existing: SlideDocument[] = isSlideDocumentArray(post.slide_documents)
    ? post.slide_documents
    : []

  // Load the script (and, for a non-standard density, its cached rewrite
  // if one exists — never a fresh AI call here).
  const textDensity = (post.text_density as TextDensity | null) ?? 'standard'
  let slides: ScriptSlide[] = []
  const { data: scriptStage } = await supabase
    .schema('carousel')
    .from('stage_outputs')
    .select('output_json')
    .eq('post_id', post.id)
    .eq('stage', 'script')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const baseSlides = (scriptStage?.output_json as { slides?: ScriptSlide[] } | null)?.slides ?? []
  slides = baseSlides
  if (textDensity !== 'standard' && baseSlides.length > 0) {
    const { data: densityStage } = await supabase
      .schema('carousel')
      .from('stage_outputs')
      .select('output_json')
      .eq('post_id', post.id)
      .eq('stage', `script_${textDensity}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const rewritten = (densityStage?.output_json as { slides?: ScriptSlide[] } | null)?.slides
    if (rewritten?.length === baseSlides.length) slides = rewritten
  }

  // Complete already? Return as-is. "Complete" = at least as many
  // documents as script slides (manual editor work can legitimately push
  // the document count PAST the script count — never truncate that).
  const expected = Math.max(slides.length, existing.length, 1)
  if (existing.length >= expected && existing.length > 0) {
    return { documents: existing, fallbackSlideOrders: [], materialized: false }
  }

  // Resolve the same design inputs the designer route resolves.
  let visualStyle: VisualStyle | null = null
  let brandName: string | null = null
  if (post.brand_profile_id) {
    const { data: brand } = await supabase
      .schema('carousel')
      .from('brand_profiles')
      .select('name, visual_style')
      .eq('id', post.brand_profile_id)
      .maybeSingle()
    visualStyle = (brand?.visual_style as VisualStyle | null) ?? null
    brandName = brand?.name ?? null
  }

  const layoutVariant = (post.layout_variant as LayoutVariant | null) ?? 'minimal'
  const hierarchy = (post.hierarchy as Hierarchy | null) ?? 'balanced'
  const colors = pickColors(visualStyle, post.color_scheme)
  const logoUrl = visualStyle?.logo_url ?? null
  const presetFonts = getTypographyPreset(post.typography_preset)
  const fontConfig = presetFonts ?? (brandName ? BRAND_FONTS[brandName] : undefined) ?? DEFAULT_FONTS
  const iconChoice = (post.icon_name as IconName | 'none' | null) ?? null
  const slideOverrides: SlideOverride[] = Array.isArray(post.slide_overrides)
    ? (post.slide_overrides as SlideOverride[])
    : []
  const defaultDesign = {
    colorScheme: post.color_scheme,
    textDensity,
    backgroundImageUrl: post.background_image_url,
    layoutTemplate: layoutVariant,
  }

  // No script at all: one guaranteed fallback document from the topic, so
  // even a bare post opens an editable canvas instead of a dead end.
  if (slides.length === 0 && existing.length === 0) {
    const doc = buildFallbackDocument({
      headline: post.topic || 'Slide 1',
      body: 'Mulai edit slide ini — tambahkan teks, bentuk, foto, atau ikon dari toolbar.',
      bg: colors.bg,
      fg: colors.fg,
      headlineFamily: fontConfig.headlineFamily,
      bodyFamily: fontConfig.bodyFamily,
    })
    await persist(supabase, post.id, [doc])
    return { documents: [doc], fallbackSlideOrders: [], materialized: true }
  }

  const documents: SlideDocument[] = []
  const fallbackSlideOrders: number[] = []
  const fontSetCache = new Map<LayoutVariant, Awaited<ReturnType<typeof loadLegacyFontSet>>>()

  for (let position = 0; position < expected; position++) {
    // Anything already occupying this position (including manually edited
    // documents) is carried verbatim — materialization only FILLS GAPS,
    // it never replaces.
    if (existing[position]) {
      documents.push(existing[position])
      continue
    }
    const slide = slides[position] ?? {
      index: position + 1,
      headline: post.topic || `Slide ${position + 1}`,
      body: '',
    }
    const slideDesign = resolveSlideDesign(defaultDesign, slideOverrides, slide.index)
    const presetColors =
      slideDesign.colorScheme === post.color_scheme
        ? colors
        : pickColors(visualStyle, slideDesign.colorScheme)
    const rawOverride = slideOverrides.find((o) => o.slideIndex === slide.index)
    const slideColors = applyCustomColors(presetColors, rawOverride?.customColors)

    try {
      let fontSet = fontSetCache.get(slideDesign.layoutTemplate)
      if (!fontSet) {
        fontSet = await loadLegacyFontSet(slideDesign.layoutTemplate, fontConfig)
        fontSetCache.set(slideDesign.layoutTemplate, fontSet)
      }
      const doc = await compileTemplate(
        slideDesign.layoutTemplate,
        {
          slide: { ...slide, index: position + 1 },
          total: expected,
          colors: slideColors,
          fontConfig,
          textDensity: slideDesign.textDensity,
          hierarchy,
          logoUrl,
          brandName,
          backgroundImageUrl: slideDesign.backgroundImageUrl,
          iconChoice,
          iconColor: rawOverride?.customColors?.iconColor ?? null,
        },
        fontSet
      )
      const contentError = getSlideDocumentContentError(doc, ALL_ICON_NAMES)
      if (contentError) throw new Error(contentError)
      documents.push(doc)
    } catch (err) {
      console.error(
        `materialize: compile failed for post ${post.id} slide_order ${position + 1} ` +
          `(layout ${slideDesign.layoutTemplate}) — using fallback document`,
        err
      )
      fallbackSlideOrders.push(position + 1)
      documents.push(
        buildFallbackDocument({
          headline: slide.headline,
          body: slide.body,
          bg: slideColors.bg,
          fg: slideColors.fg,
          headlineFamily: fontConfig.headlineFamily,
          bodyFamily: fontConfig.bodyFamily,
        })
      )
    }
  }

  await persist(supabase, post.id, documents)
  return { documents, fallbackSlideOrders, materialized: true }
}

async function persist(supabase: DbClient, postId: string, documents: SlideDocument[]) {
  const { error } = await supabase
    .schema('carousel')
    .from('posts')
    .update({ slide_documents: documents })
    .eq('id', postId)
  if (error) {
    // Persisting is best-effort here: the editor can still render this
    // request from the in-memory documents. But a failure MUST be loud —
    // a silently-failing posts UPDATE is exactly the bug class that
    // caused the original dead-end (layout_variant CHECK violation
    // swallowed because the designer route never read .error).
    console.error(`materialize: failed to persist slide_documents for post ${postId}:`, error.message)
  }
}
