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

export const runtime = 'nodejs'
// This route does not call Gemini (generateStructuredContent) — it's pure
// Satori rendering — but it renders every slide (up to 12) sequentially,
// each involving font loading and an ImageResponse render plus a Storage
// upload, which can add up past Vercel's 10s default timeout on larger
// carousels. 60 is the max maxDuration Vercel allows for a standard
// (non-Fluid-Compute) Hobby-plan function.
// https://vercel.com/docs/functions/configuring-functions/duration
export const maxDuration = 60

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

  const { data: post, error: postErr } = await supabase
    .schema('carousel')
    .from('posts')
    .select(
      'id, brand_profile_id, layout_variant, color_scheme, text_density, hierarchy, background_image_url, icon_name, typography_preset'
    )
    .eq('id', postId)
    .eq('user_id', user.id)
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
  let script: Script = originalScript
  if (textDensity !== 'standard') {
    const densityStage = `script_${textDensity}`
    const { data: cachedStage, error: cachedErr } = await supabase
      .schema('carousel')
      .from('stage_outputs')
      .select('output_json')
      .eq('post_id', postId)
      .eq('stage', densityStage)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (cachedErr) {
      return NextResponse.json({ error: cachedErr.message }, { status: 500 })
    }

    const cached = cachedStage?.output_json as Script | undefined
    if (cached?.slides?.length) {
      script = cached
    } else {
      let rewrittenSlides
      try {
        rewrittenSlides = await rewriteSlidesForDensity(
          originalScript.slides,
          textDensity,
          brandName ?? 'this brand',
          toneGuideline,
          contentStandards
        )
      } catch (err) {
        console.error('designer: rewriteSlidesForDensity error', err)
        return NextResponse.json(
          { error: `Failed to rewrite script for "${textDensity}" density` },
          { status: 502 }
        )
      }

      script = { title: originalScript.title, slides: rewrittenSlides }

      const { error: densityStageErr } = await supabase
        .schema('carousel')
        .from('stage_outputs')
        .insert({
          post_id: postId,
          stage: densityStage,
          output_json: script,
        })

      if (densityStageErr) {
        // Non-fatal: the rewrite still renders correctly this time, it
        // just won't be cached for next time. Surfacing this as a hard
        // failure would throw away a successful (and costly) rewrite over
        // what's purely a caching optimization failing to persist.
        console.error('designer: failed to cache density rewrite', densityStageErr)
      }
    }
  }

  // script.slides is optional on the Script type (it mirrors the
  // loosely-typed stage_outputs.output_json column), but every path above
  // that assigns `script` already validated a non-empty slides array
  // before assigning — this alias just gives the rest of the route a
  // type that reflects that guarantee instead of re-checking it.
  const slides = script.slides!

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

  const renderedSlides: { index: number; url: string }[] = []
  try {
    for (const slide of slides) {
      const png = await renderSlide(
        slide,
        total,
        colors,
        fontConfig,
        fonts,
        layoutVariant,
        logoUrl,
        brandName,
        textDensity,
        hierarchy,
        backgroundImageUrl,
        iconChoice
      )
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
      slides.map((slide) => ({
        post_id: postId,
        slide_order: slide.index,
        copy_text: `${slide.headline}\n\n${slide.body}`,
        rendered_image_url:
          renderedSlides.find((r) => r.index === slide.index)?.url ?? null,
      }))
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
  })
}
