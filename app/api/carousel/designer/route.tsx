import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { ICON_NAMES, IconName } from '@/lib/icons'
import { TYPOGRAPHY_PRESET_KEYS, getTypographyPreset } from '@/lib/typography-presets'
import { rewriteSlidesForDensity } from '@/lib/ai-client'
import {
  BRAND_FONTS,
  DEFAULT_FONTS,
  HIERARCHIES,
  Hierarchy,
  LAYOUT_VARIANTS,
  LayoutVariant,
  TEXT_DENSITIES,
  TextDensity,
  VisualStyle,
  loadFontsForBrand,
  pickColors,
  renderSlide,
} from '@/lib/slide-renderer'
import {
  DesignOptions,
  SlideOverride,
  applyCustomColors,
  reindexSlideOverrides,
  resolveSlideDesign,
} from '@/lib/slideDesign'
import { compileTemplate, loadLegacyFontSet } from '@/lib/template-compiler'
import { renderDocument } from '@/lib/render-document'
import {
  SlideDocument,
  getSlideDocumentContentError,
  isSlideDocumentArray,
} from '@/lib/slideDocument'

export const runtime = 'nodejs'
// This route does not call Gemini (generateStructuredContent) — it's pure
// Satori rendering — but it renders every slide (up to 12) sequentially,
// each involving font loading and an ImageResponse render plus a Storage
// upload, which can add up past Vercel's 10s default timeout on larger
// carousels. 60 is the max maxDuration Vercel allows for a standard
// (non-Fluid-Compute) Hobby-plan function.
// https://vercel.com/docs/functions/configuring-functions/duration
export const maxDuration = 60

// Per-slide overrides (slide_overrides) always go through this same
// whole-post route rather than a dedicated single-slide render endpoint —
// checked before building the feature: no such endpoint exists anywhere
// in this app, every design change (layout, color, background, and now
// per-slide overrides) already regenerates the full carousel through
// here. Adding a single-slide fast path was explicitly out of scope for
// this feature; a per-slide override still costs a full regenerate, just
// like every other design option change already does.

interface Slide {
  index: number
  headline: string
  body: string
}

interface Script {
  title?: string
  slides?: Slide[]
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Confirms the request is actually authenticated (not silently running
  // as anon) when diagnosing storage RLS failures — cheap enough to leave
  // in permanently.
  console.log(`designer: request from user ${user.id}`)

  let body: {
    post_id?: string
    layout_variant?: string
    color_scheme?: string | null
    text_density?: string
    hierarchy?: string
    background_image_url?: string | null
    icon_name?: string | null
    typography_preset?: string | null
    slide_overrides?: SlideOverride[]
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Gated behind DEBUG_DESIGNER rather than always-on: logs the exact raw
  // body this route received, to compare against what
  // RegenerateDesignButton.tsx logs it sent (same gate) when diagnosing a
  // "design options don't visibly change anything" report — confirms
  // whether the options ever reach this handler at all before looking any
  // further downstream (pickColors, renderSlide, storage caching, etc).
  if (process.env.DEBUG_DESIGNER) {
    console.log('designer: raw request body received', JSON.stringify(body))
  }

  const postId = body.post_id?.trim()
  if (!postId) {
    return NextResponse.json({ error: 'post_id is required' }, { status: 400 })
  }

  if (
    body.layout_variant !== undefined &&
    !LAYOUT_VARIANTS.includes(body.layout_variant as LayoutVariant)
  ) {
    return NextResponse.json(
      { error: `layout_variant must be one of: ${LAYOUT_VARIANTS.join(', ')}` },
      { status: 400 }
    )
  }
  if (
    body.text_density !== undefined &&
    !TEXT_DENSITIES.includes(body.text_density as TextDensity)
  ) {
    return NextResponse.json(
      { error: `text_density must be one of: ${TEXT_DENSITIES.join(', ')}` },
      { status: 400 }
    )
  }
  if (
    body.hierarchy !== undefined &&
    !HIERARCHIES.includes(body.hierarchy as Hierarchy)
  ) {
    return NextResponse.json(
      { error: `hierarchy must be one of: ${HIERARCHIES.join(', ')}` },
      { status: 400 }
    )
  }
  if (
    body.icon_name !== undefined &&
    body.icon_name !== null &&
    body.icon_name !== 'none' &&
    !ICON_NAMES.includes(body.icon_name as IconName)
  ) {
    return NextResponse.json(
      { error: `icon_name must be "none" or one of: ${ICON_NAMES.join(', ')}` },
      { status: 400 }
    )
  }
  if (
    body.typography_preset !== undefined &&
    body.typography_preset !== null &&
    !TYPOGRAPHY_PRESET_KEYS.includes(body.typography_preset)
  ) {
    return NextResponse.json(
      {
        error: `typography_preset must be null or one of: ${TYPOGRAPHY_PRESET_KEYS.join(', ')}`,
      },
      { status: 400 }
    )
  }
  const HEX_COLOR_RE = /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/
  function isValidCustomColors(c: unknown): boolean {
    if (c === undefined) return true
    if (!c || typeof c !== 'object') return false
    const fields = ['fontColor', 'backgroundColor', 'shapeColor', 'iconColor'] as const
    return fields.every((f) => {
      const v = (c as Record<string, unknown>)[f]
      return v === undefined || (typeof v === 'string' && HEX_COLOR_RE.test(v))
    })
  }
  if (body.slide_overrides !== undefined) {
    const isValid =
      Array.isArray(body.slide_overrides) &&
      body.slide_overrides.every(
        (o) =>
          o &&
          typeof o === 'object' &&
          typeof o.slideIndex === 'number' &&
          (o.colorScheme === undefined || typeof o.colorScheme === 'string') &&
          (o.textDensity === undefined || TEXT_DENSITIES.includes(o.textDensity)) &&
          (o.backgroundImageUrl === undefined || typeof o.backgroundImageUrl === 'string') &&
          (o.layoutTemplate === undefined || LAYOUT_VARIANTS.includes(o.layoutTemplate)) &&
          isValidCustomColors(o.customColors)
      )
    if (!isValid) {
      return NextResponse.json(
        {
          error:
            'slide_overrides must be an array of {slideIndex: number, colorScheme?: string, textDensity?: ' +
            `${TEXT_DENSITIES.join('|')}, backgroundImageUrl?: string, layoutTemplate?: ` +
            `${LAYOUT_VARIANTS.join('|')}, customColors?: {fontColor?, backgroundColor?, shapeColor?, ` +
            'iconColor?: hex color string}}',
        },
        { status: 400 }
      )
    }
  }

  const { data: post, error: postErr } = await supabase
    .schema('carousel')
    .from('posts')
    .select(
      'id, brand_profile_id, layout_variant, color_scheme, text_density, hierarchy, background_image_url, icon_name, typography_preset, slide_overrides, slide_documents'
    )
    .eq('id', postId)
    .maybeSingle()

  if (postErr) {
    return NextResponse.json({ error: postErr.message }, { status: 500 })
  }
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  // Falling back to the post's last-used choices (rather than a fixed
  // default) is what makes regenerating remember previous selections.
  const layoutVariant: LayoutVariant =
    (body.layout_variant as LayoutVariant | undefined) ??
    (post.layout_variant as LayoutVariant | null) ??
    'minimal'
  const colorScheme: string | null =
    body.color_scheme !== undefined ? body.color_scheme : (post.color_scheme as string | null)
  const textDensity: TextDensity =
    (body.text_density as TextDensity | undefined) ??
    (post.text_density as TextDensity | null) ??
    'standard'
  const hierarchy: Hierarchy =
    (body.hierarchy as Hierarchy | undefined) ??
    (post.hierarchy as Hierarchy | null) ??
    'balanced'
  const backgroundImageUrl: string | null =
    body.background_image_url !== undefined
      ? body.background_image_url
      : (post.background_image_url as string | null)
  // null = auto keyword-matched per slide (unchanged default behavior),
  // 'none' = never show an icon, an IconName = fixed icon on every slide.
  const iconChoice: IconName | 'none' | null =
    body.icon_name !== undefined
      ? (body.icon_name as IconName | 'none' | null)
      : (post.icon_name as IconName | 'none' | null)
  // null = use the brand's default font mapping (BRAND_FONTS/DEFAULT_FONTS),
  // a preset key = override both headline and body fonts for every slide.
  const typographyPreset: string | null =
    body.typography_preset !== undefined
      ? body.typography_preset
      : (post.typography_preset as string | null)
  // Reassigned once `total` (the current slide count) is known below —
  // reindexSlideOverrides() then drops any override whose slideIndex no
  // longer corresponds to a real slide (e.g. the script was edited down
  // to fewer slides between the override being set and this regenerate).
  let slideOverrides: SlideOverride[] =
    body.slide_overrides !== undefined
      ? body.slide_overrides
      : ((post.slide_overrides as SlideOverride[] | null) ?? [])

  const { data: scriptStage, error: scriptErr } = await supabase
    .schema('carousel')
    .from('stage_outputs')
    .select('output_json')
    .eq('post_id', postId)
    .eq('stage', 'script')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (scriptErr) {
    return NextResponse.json({ error: scriptErr.message }, { status: 500 })
  }

  const originalScript = scriptStage?.output_json as Script | undefined
  if (!originalScript?.slides?.length) {
    return NextResponse.json(
      { error: 'No script found for this post' },
      { status: 400 }
    )
  }
  // TS can't carry the narrowing above across the getSlidesForDensity
  // closure defined further down — this alias gives it (and everything
  // else in the route) a definitely-non-undefined array to reference.
  const originalSlides = originalScript.slides
  const originalScriptTitle = originalScript.title

  let visualStyle: VisualStyle | null = null
  let brandName: string | null = null
  let toneGuideline: string | null = null
  let contentStandards: string | null = null
  if (post.brand_profile_id) {
    const { data: brand } = await supabase
      .schema('carousel')
      .from('brand_profiles')
      .select('name, visual_style, tone_guideline, content_standards')
      .eq('id', post.brand_profile_id)
      .maybeSingle()
    visualStyle = (brand?.visual_style as VisualStyle | null) ?? null
    brandName = brand?.name ?? null
    toneGuideline = brand?.tone_guideline ?? null
    contentStandards = brand?.content_standards ?? null
  }

  // "standard" is the density the script is originally written at, so it
  // reuses the "script" stage output as-is — no rewrite, no extra stage
  // row. "concise"/"detailed" are cached per-post under their own stage
  // name (script_concise / script_detailed): the first regenerate at a
  // given density pays for one Groq rewrite call, every subsequent
  // regenerate at that density (or switch back to it) reads the cached
  // rewrite instead of re-calling the model.
  //
  // Extracted into a per-request-memoized function (rather than the single
  // inline block this used to be) because per-slide text density overrides
  // mean more than one density's rewrite can be needed in the same
  // request — e.g. the post's default is "standard" but one slide is
  // overridden to "detailed". Memoizing by density avoids re-querying/
  // re-rewriting the same density twice if multiple slides happen to
  // share an override.
  const densityScriptCache = new Map<TextDensity, Promise<Slide[]>>()
  function getSlidesForDensity(density: TextDensity): Promise<Slide[]> {
    const cached = densityScriptCache.get(density)
    if (cached) return cached

    const promise = (async (): Promise<Slide[]> => {
      if (density === 'standard') return originalSlides

      const densityStage = `script_${density}`
      console.log(
        `designer: resolving text_density="${density}" for post ${postId} — checking cached stage "${densityStage}"`
      )
      const { data: cachedStage, error: cachedErr } = await supabase
        .schema('carousel')
        .from('stage_outputs')
        .select('output_json')
        .eq('post_id', postId)
        .eq('stage', densityStage)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (cachedErr) throw new Error(cachedErr.message)

      const cachedScript = cachedStage?.output_json as Script | undefined
      console.log(
        `designer: cache lookup for stage "${densityStage}" on post ${postId} ` +
          `${cachedScript?.slides?.length ? `HIT (${cachedScript.slides.length} slides)` : 'MISS — will call rewriteSlidesForDensity()'}`
      )
      if (cachedScript?.slides?.length) return cachedScript.slides

      console.log(`designer: calling rewriteSlidesForDensity() for post ${postId}, density "${density}"`)
      const rewrittenSlides = await rewriteSlidesForDensity(
        originalSlides,
        density,
        brandName ?? 'this brand',
        toneGuideline,
        contentStandards
      )
      console.log(
        `designer: rewriteSlidesForDensity() succeeded for post ${postId} — ${rewrittenSlides.length} slides rewritten`
      )

      const { error: densityStageErr } = await supabase
        .schema('carousel')
        .from('stage_outputs')
        .insert({
          post_id: postId,
          stage: densityStage,
          output_json: { title: originalScriptTitle, slides: rewrittenSlides },
        })

      if (densityStageErr) {
        // Non-fatal: the rewrite still renders correctly this time, it
        // just won't be cached for next time. Surfacing this as a hard
        // failure would throw away a successful (and costly) rewrite over
        // what's purely a caching optimization failing to persist.
        console.error('designer: failed to cache density rewrite', densityStageErr)
      } else {
        console.log(`designer: cached rewrite under stage "${densityStage}" for post ${postId}`)
      }

      return rewrittenSlides
    })()

    densityScriptCache.set(density, promise)
    return promise
  }

  // The post-level default script (used for slide count/order/headlines,
  // and for any slide with no per-slide density override) still needs to
  // be resolved up front so a failure surfaces the same 502 it always has,
  // rather than deferring it to whichever slide happens to hit it first.
  let slides: Slide[]
  try {
    slides = await getSlidesForDensity(textDensity)
  } catch (err) {
    console.error('designer: failed to resolve default text_density script', err)
    return NextResponse.json(
      { error: `Failed to rewrite script for "${textDensity}" density` },
      { status: 502 }
    )
  }

  const colors = pickColors(visualStyle, colorScheme)
  const logoUrl = visualStyle?.logo_url ?? null
  const mappedFonts = brandName ? BRAND_FONTS[brandName] : undefined
  if (brandName && !mappedFonts) {
    console.warn(
      `designer: no font mapping for brand "${brandName}" — using default fonts`
    )
  }
  // An explicit typography_preset overrides the brand's default font
  // mapping entirely — chosen instead of merging per-field since presets
  // are meant to replace the whole pairing (headline+body were picked as
  // a set), not partially blend with the brand's normal fonts.
  const presetFonts = getTypographyPreset(typographyPreset)
  let fontConfig = presetFonts ?? mappedFonts ?? DEFAULT_FONTS
  const total = slides.length
  // Edge case: the script can be edited to a different slide count
  // between when an override was set and this regenerate (EditableScript's
  // "Save & Regenerate Design" reuses this same route) — drop any
  // override whose slideIndex is now out of range rather than carrying a
  // silently-orphaned entry forward that could reattach itself to
  // unrelated content if the slide count ever comes back up to cover
  // that index again.
  const reindexedSlideOverrides = reindexSlideOverrides(slideOverrides, total)
  if (reindexedSlideOverrides.length !== slideOverrides.length) {
    console.log(
      `designer: dropped ${slideOverrides.length - reindexedSlideOverrides.length} orphaned ` +
        `slide_overrides entries for post ${postId} (slide count is now ${total})`
    )
  }
  slideOverrides = reindexedSlideOverrides

  let fonts: Awaited<ReturnType<typeof loadFontsForBrand>>
  try {
    fonts = await loadFontsForBrand(fontConfig)
  } catch (err) {
    console.error(
      `designer: font load failed for brand "${brandName}" ` +
        `(headline: ${fontConfig.headlineFamily} ${fontConfig.headlineWeight}, ` +
        `body: ${fontConfig.bodyFamily} ${fontConfig.bodyWeight}) — falling back to Inter`,
      err
    )
    try {
      fontConfig = DEFAULT_FONTS
      fonts = await loadFontsForBrand(fontConfig)
    } catch (fallbackErr) {
      console.error('designer: default font load also failed', fallbackErr)
      return NextResponse.json(
        { error: 'Failed to load fonts for design generation' },
        { status: 502 }
      )
    }
  }

  // slide-N.png is a deterministic path reused on every regenerate
  // (upsert overwrites the same object) with Supabase Storage's default
  // Cache-Control (max-age=3600). Regenerating therefore produced new
  // bytes that were provably correct in isolated ImageResponse tests,
  // while the browser kept serving the previous response for that
  // identical URL — "no visible change" despite the backend working. A
  // per-generation cache-busting query param forces a fresh fetch every
  // time the URL is (re)rendered client-side.
  const cacheBustVersion = Date.now()

  const defaultDesign: DesignOptions = {
    colorScheme,
    textDensity,
    backgroundImageUrl,
    layoutTemplate: layoutVariant,
  }
  // Tracks whichever headline/body actually got rendered into each
  // slide's image (which can differ from the post-default `slides` array
  // when a per-slide density override pulled a different rewritten
  // variant) — carousel.slides.copy_text below must match what's in the
  // image, not blanket-reuse the default script.
  const renderedSlideContent = new Map<number, Slide>()

  const renderedSlides: { index: number; url: string }[] = []
  // Phase-2c: alongside the legacy PNG render, each slide is also
  // compiled to a SlideDocument (same resolved design inputs) and the
  // whole array persisted to posts.slide_documents. Parallel transition,
  // not a replacement: the PNGs users see still come from renderSlide();
  // the documents exist for the phase-3 editor to open. Compilation
  // failure therefore must not fail the route — it logs, skips the
  // column update, and leaves the previous documents in place.
  const compiledDocuments: SlideDocument[] = []
  let compileFailed = false
  // Regenerate-vs-manual-edit policy (AUDIT.md risk R3, agreed product
  // decision): a slide the user touched in the canvas editor
  // (manuallyEdited: true, set by phase 3) is NOT recompiled — its
  // existing document is carried forward verbatim, so a regenerate can
  // never silently overwrite manual canvas work. Correspondence is by
  // array position (slide.index is 1-based; documents are stored in
  // slide order) — if the slide count changed since the edit, positions
  // past the new count simply drop with the rest of the array.
  const existingDocuments: SlideDocument[] = isSlideDocumentArray(post.slide_documents)
    ? post.slide_documents
    : []
  // Template-extra fonts (JetBrains Mono etc.) vary per resolved layout,
  // and per-slide layout overrides mean one request can compile several
  // variants — cache the font set per variant, not per slide.
  const legacyFontSetCache = new Map<LayoutVariant, Awaited<ReturnType<typeof loadFontsForBrand>>>()
  async function getLegacyFontSet(variant: LayoutVariant) {
    const cached = legacyFontSetCache.get(variant)
    if (cached) return cached
    const set = await loadLegacyFontSet(variant, fontConfig)
    legacyFontSetCache.set(variant, set)
    return set
  }

  try {
    for (const slide of slides) {
      // If the resolved density differs from the slide's own script
      // variant, that slide's body needs to come from the OTHER density's
      // rewritten script (matched by index) — a color/image override
      // alone reuses this slide's already-resolved body as-is.
      const slideDesign = resolveSlideDesign(defaultDesign, slideOverrides, slide.index)
      const presetColors =
        slideDesign.colorScheme === colorScheme ? colors : pickColors(visualStyle, slideDesign.colorScheme)
      // customColors has no post-level default to merge through
      // resolveSlideDesign() (see lib/slideDesign.ts) — applied here as a
      // final per-element overlay on top of whatever the colorScheme
      // already resolved to.
      const rawOverride = slideOverrides.find((o) => o.slideIndex === slide.index)
      const slideColors = applyCustomColors(presetColors, rawOverride?.customColors)
      let slideToRender = slide
      if (slideDesign.textDensity !== textDensity) {
        const densitySlides = await getSlidesForDensity(slideDesign.textDensity)
        slideToRender = densitySlides.find((s) => s.index === slide.index) ?? slide
      }
      renderedSlideContent.set(slide.index, slideToRender)

      // Export-gap fix: a manuallyEdited slide's PNG must come from its
      // (preserved) document — the canvas edits live there, not in
      // script/slide_overrides — via the parity-proven renderDocument().
      // Untouched slides keep the legacy renderSlide() path unchanged.
      const preservedDoc = existingDocuments[slide.index - 1]
      const isPreserved = !!preservedDoc?.manuallyEdited

      const png = isPreserved
        ? await renderDocument(preservedDoc)
        : await renderSlide(
        slideToRender,
        total,
        slideColors,
        fontConfig,
        fonts,
        // A per-slide layout override that requires a photo
        // (photo_editorial/news_card) with no image resolved for this
        // slide needs no special-case here — renderSlide already falls
        // back to a fixed dark gradient for those two variants when
        // backgroundImageUrl is null, the same fallback the post-level
        // choice already relies on.
        slideDesign.layoutTemplate,
        logoUrl,
        brandName,
        slideDesign.textDensity,
        hierarchy,
        // Text color for this slide re-derives from whichever image URL
        // is actually passed here — renderSlide computes
        // getTextColorFromImage(backgroundImageUrl) internally per call,
        // so a per-slide image override automatically gets correct
        // contrast with no extra code, same as a per-slide colorScheme
        // override already does via pickColors() above.
        slideDesign.backgroundImageUrl,
        iconChoice,
        rawOverride?.customColors?.iconColor ?? null
      )

      if (!compileFailed) {
        if (isPreserved) {
          console.log(
            `designer: slide ${slide.index} of post ${postId} is manuallyEdited — ` +
              'keeping its document AND rendering its PNG from it (renderDocument)'
          )
          compiledDocuments.push(preservedDoc)
        } else
        try {
          const doc = await compileTemplate(
            slideDesign.layoutTemplate,
            {
              slide: slideToRender,
              total,
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
            await getLegacyFontSet(slideDesign.layoutTemplate)
          )
          // Write-boundary validation (the gap PR #62 flagged): icon
          // names against ICON_NAMES, every color against the hex/rgba
          // format — defense in depth even though this document came
          // from our own compiler, and the same check the phase-3
          // editor's write path must run against genuinely untrusted
          // input.
          const contentError = getSlideDocumentContentError(doc, ICON_NAMES)
          if (contentError) throw new Error(contentError)
          compiledDocuments.push(doc)
        } catch (err) {
          console.error(
            `designer: SlideDocument compile failed for post ${postId} slide ${slide.index} — ` +
              'skipping slide_documents update for this generation (PNG render unaffected)',
            err
          )
          compileFailed = true
        }
      }

      const path = `${postId}/slide-${slide.index}.png`

      const { error: uploadErr } = await supabase.storage
        .from('carousel-assets')
        .upload(path, png, { contentType: 'image/png', upsert: true })

      if (uploadErr) {
        throw new Error(uploadErr.message)
      }

      const { data: publicUrl } = supabase.storage
        .from('carousel-assets')
        .getPublicUrl(path)

      renderedSlides.push({
        index: slide.index,
        url: `${publicUrl.publicUrl}?v=${cacheBustVersion}`,
      })
    }
  } catch (err) {
    console.error('designer: render/upload error', err)
    return NextResponse.json(
      { error: 'Design generation failed' },
      { status: 502 }
    )
  }

  // Regenerating with fewer slides than a previous generation (e.g. 8 -> 5)
  // leaves slide-6.png..slide-8.png behind: upsert only overwrites matching
  // paths, it never deletes extras. Sweep the post's folder for any
  // slide-N.png beyond the current slide count and remove them. This only
  // ever targets slide-*.png — the uploaded background image (background.*)
  // lives in the same folder and is left untouched.
  const { data: existingFiles, error: listErr } = await supabase.storage
    .from('carousel-assets')
    .list(postId)

  if (listErr) {
    console.error('designer: failed to list existing slide files for cleanup', listErr)
  } else if (existingFiles) {
    const orphanedPaths = existingFiles
      .map((f) => {
        const match = f.name.match(/^slide-(\d+)\.png$/)
        return match ? { name: f.name, index: Number(match[1]) } : null
      })
      .filter((f): f is { name: string; index: number } => f !== null && f.index > total)
      .map((f) => `${postId}/${f.name}`)

    if (orphanedPaths.length > 0) {
      const { error: removeErr } = await supabase.storage
        .from('carousel-assets')
        .remove(orphanedPaths)
      if (removeErr) {
        console.error('designer: failed to remove orphaned slide files', removeErr)
      }
    }
  }

  await supabase.schema('carousel').from('slides').delete().eq('post_id', postId)

  const { error: slidesErr } = await supabase
    .schema('carousel')
    .from('slides')
    .insert(
      slides.map((slide) => {
        // Falls back to the default-density slide if somehow missing from
        // the map (shouldn't happen — every slide in `slides` is rendered
        // in the loop above) rather than risking a crash over copy_text
        // slightly disagreeing with the image for an edge case that
        // should be unreachable.
        const rendered = renderedSlideContent.get(slide.index) ?? slide
        return {
          post_id: postId,
          slide_order: slide.index,
          copy_text: `${rendered.headline}\n\n${rendered.body}`,
          rendered_image_url: renderedSlides.find((r) => r.index === slide.index)?.url ?? null,
        }
      })
    )

  if (slidesErr) {
    return NextResponse.json({ error: slidesErr.message }, { status: 500 })
  }

  const { error: stageErr } = await supabase
    .schema('carousel')
    .from('stage_outputs')
    .insert({
      post_id: postId,
      stage: 'design',
      output_json: { slide_count: renderedSlides.length, slides: renderedSlides },
    })

  if (stageErr) {
    return NextResponse.json({ error: stageErr.message }, { status: 500 })
  }

  await supabase
    .schema('carousel')
    .from('posts')
    .update({
      status: 'designed',
      layout_variant: layoutVariant,
      color_scheme: colorScheme,
      text_density: textDensity,
      hierarchy: hierarchy,
      background_image_url: backgroundImageUrl,
      icon_name: iconChoice,
      typography_preset: typographyPreset,
      slide_overrides: slideOverrides,
      // Compiled node-tree per slide (phase 2c). Every regenerate
      // rewrites the whole array — safe today because documents are
      // pure generator output (manuallyEdited is always false until the
      // phase-3 editor exists; the regenerate-vs-manual-edit policy,
      // AUDIT.md risk R3, lands with that editor). On compile failure
      // the previous documents are deliberately left untouched.
      ...(compileFailed ? {} : { slide_documents: compiledDocuments }),
    })
    .eq('id', postId)

  return NextResponse.json({
    post_id: postId,
    slides: renderedSlides,
    layout_variant: layoutVariant,
    color_scheme: colorScheme,
    text_density: textDensity,
    hierarchy: hierarchy,
    background_image_url: backgroundImageUrl,
    typography_preset: typographyPreset,
    slide_overrides: slideOverrides,
  })
}
