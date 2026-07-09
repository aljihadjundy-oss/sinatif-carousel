import { readFile } from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import { ImageResponse } from 'next/og'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { LucideIcon, pickSlideIcon } from '@/lib/icons'

export const runtime = 'nodejs'

interface Slide {
  index: number
  headline: string
  body: string
}

interface Script {
  title?: string
  slides?: Slide[]
}

interface VisualStyle {
  colors?: Record<string, string>
  logo_url?: string | null
}

type FontWeight = 400 | 500 | 600 | 700 | 800 | 900

interface FontConfig {
  headlineFamily: string
  headlineWeight: FontWeight
  bodyFamily: string
  bodyWeight: FontWeight
}

// ImageResponse's built-in default font loader resolves a local file path
// that breaks on Windows dev (`Invalid URL ... noto-sans-v27-latin-regular.ttf`).
// Explicitly supplying fonts for every rendered text node avoids that loader
// entirely. Font files are bundled in public/fonts/ (see FONT_FILES below)
// instead of fetched from Google Fonts at request time, so rendering never
// depends on the runtime's network reaching fonts.googleapis.com.
const BRAND_FONTS: Record<string, FontConfig> = {
  'Sinatif Agency': {
    headlineFamily: 'Inter',
    headlineWeight: 600,
    bodyFamily: 'Inter',
    bodyWeight: 400,
  },
  'Sinatif Academy': {
    headlineFamily: 'Khand',
    headlineWeight: 700,
    bodyFamily: 'Nunito',
    bodyWeight: 400,
  },
  'Osiris Event': {
    headlineFamily: 'Cinzel',
    headlineWeight: 700,
    bodyFamily: 'Poppins',
    bodyWeight: 400,
  },
  Hexolution: {
    // "Blanka" isn't on Google Fonts — fall back to a bold display sans.
    headlineFamily: 'Archivo Black',
    headlineWeight: 400,
    bodyFamily: 'Inter',
    bodyWeight: 400,
  },
  'Bedadikit.id': {
    // Architects Daughter only ships a regular weight.
    headlineFamily: 'Architects Daughter',
    headlineWeight: 400,
    bodyFamily: 'Architects Daughter',
    bodyWeight: 400,
  },
}

const DEFAULT_FONTS: FontConfig = {
  headlineFamily: 'Inter',
  headlineWeight: 700,
  bodyFamily: 'Inter',
  bodyWeight: 400,
}

// Fallback used to guarantee full glyph coverage (see loadFontsForBrand).
const FALLBACK_FAMILY = 'Noto Sans'
const FALLBACK_WEIGHT: FontWeight = 400

// Bundled once (downloaded from Google Fonts' raw .ttf endpoints, see PR)
// into public/fonts/ so rendering never depends on a live fetch to
// fonts.googleapis.com/fonts.gstatic.com at request time. Every
// (family, weight) pair used anywhere in BRAND_FONTS, DEFAULT_FONTS, or the
// fallback must have an entry here.
const FONT_FILES: Record<string, string> = {
  'Inter-400': 'inter-400.ttf',
  'Inter-600': 'inter-600.ttf',
  'Inter-700': 'inter-700.ttf',
  'Khand-700': 'khand-700.ttf',
  'Nunito-400': 'nunito-400.ttf',
  'Cinzel-700': 'cinzel-700.ttf',
  'Poppins-400': 'poppins-400.ttf',
  'Archivo Black-400': 'archivo-black-400.ttf',
  'Architects Daughter-400': 'architects-daughter-400.ttf',
  'Noto Sans-400': 'noto-sans-400.ttf',
}

const fontFileCache = new Map<string, ArrayBuffer>()

async function loadLocalFont(family: string, weight: number): Promise<ArrayBuffer> {
  const key = `${family}-${weight}`
  const cached = fontFileCache.get(key)
  if (cached) return cached

  const filename = FONT_FILES[key]
  if (!filename) {
    console.error(`designer: no bundled font file registered for ${key}`)
    throw new Error(`No bundled font file for ${family} ${weight}`)
  }

  const filePath = path.join(process.cwd(), 'public', 'fonts', filename)
  try {
    const buffer = await readFile(filePath)
    const data = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    )
    fontFileCache.set(key, data)
    return data
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined
    console.error(
      `designer: failed to read bundled font file for ${key} — ` +
        `code=${code ?? 'unknown'} cwd=${process.cwd()} resolvedPath="${filePath}"`,
      err
    )
    throw new Error(`Failed to read bundled font file for ${family} ${weight}`)
  }
}

// next/og (satori) only falls back across multiple font entries that share
// the exact same declared `name` — a CSS-style font-family stack
// ("Brand Font, Noto Sans") is NOT honored as a fallback chain. Any glyph
// missing from every entry under that name makes satori invoke its own
// internal default-font loader, which is the exact code path that throws
// "Invalid URL ... noto-sans-v27-latin-regular.ttf" on Windows. Decorative/
// script fonts (e.g. Architects Daughter) commonly lack coverage for
// ordinary punctuation an LLM generates (✓, →, etc.), so every family here
// gets a broad-coverage Noto Sans fallback registered under its own name to
// make sure that internal loader is never reached, regardless of platform.
async function loadFontsForBrand(fontConfig: FontConfig) {
  const pairs: { family: string; weight: FontWeight }[] = [
    { family: fontConfig.headlineFamily, weight: fontConfig.headlineWeight },
    { family: fontConfig.bodyFamily, weight: fontConfig.bodyWeight },
  ]
  const uniquePairs = Array.from(
    new Map(pairs.map((p) => [`${p.family}-${p.weight}`, p])).values()
  )
  const uniqueFamilies = Array.from(new Set(pairs.map((p) => p.family)))

  const fallbackData = await loadLocalFont(FALLBACK_FAMILY, FALLBACK_WEIGHT)

  const primary = await Promise.all(
    uniquePairs.map(async ({ family, weight }) => ({
      name: family,
      weight,
      style: 'normal' as const,
      data: await loadLocalFont(family, weight),
    }))
  )

  const fallbacks = uniqueFamilies.map((family) => ({
    name: family,
    weight: FALLBACK_WEIGHT,
    style: 'normal' as const,
    data: fallbackData,
  }))

  return [...primary, ...fallbacks]
}

type LayoutVariant = 'minimal' | 'accent'
const LAYOUT_VARIANTS: LayoutVariant[] = ['minimal', 'accent']

type TextDensity = 'concise' | 'standard' | 'detailed'
const TEXT_DENSITIES: TextDensity[] = ['concise', 'standard', 'detailed']

type Hierarchy = 'headline_focused' | 'balanced'
const HIERARCHIES: Hierarchy[] = ['headline_focused', 'balanced']

// colorScheme, when given, names which entry in visual_style.colors should
// be used as the background — the rest of the palette (in original order,
// minus that entry) still supplies accent/fg the same way pickColors
// already did, so picking a scheme just re-roots which color is "first".
function pickColors(visualStyle: VisualStyle | null, colorScheme: string | null) {
  const namedColors = visualStyle?.colors ?? {}
  const entries = Object.entries(namedColors)

  if (colorScheme && namedColors[colorScheme]) {
    const bg = namedColors[colorScheme]
    const rest = entries.filter(([name]) => name !== colorScheme).map(([, v]) => v)
    return {
      bg,
      fg: rest[rest.length - 1] ?? '#ffffff',
      accent: rest[0] ?? bg,
    }
  }

  const colors = entries.map(([, v]) => v)
  return {
    bg: colors[0] ?? '#111827',
    fg: colors[colors.length - 1] ?? '#ffffff',
    accent: colors[1] ?? colors[0] ?? '#2563eb',
  }
}

const BODY_FONT_SIZE: Record<TextDensity, number> = {
  concise: 28,
  standard: 32,
  detailed: 36,
}

const BODY_CHAR_LIMIT: Record<TextDensity, number | null> = {
  concise: 110,
  standard: 220,
  detailed: null,
}

function applyTextDensity(body: string, density: TextDensity): string {
  const limit = BODY_CHAR_LIMIT[density]
  if (!limit || body.length <= limit) return body
  return `${body.slice(0, limit).trimEnd()}…`
}

const HEADLINE_FONT_SIZE: Record<Hierarchy, number> = {
  headline_focused: 76,
  balanced: 64,
}

// Headline-focused shrinks body text relative to whatever text_density
// already picked, rather than a second independent size table competing
// with it.
function bodyFontSize(density: TextDensity, hierarchy: Hierarchy): number {
  const base = BODY_FONT_SIZE[density]
  return hierarchy === 'headline_focused' ? Math.round(base * 0.85) : base
}

// Slide number indicator: plain text for "minimal", a colored pill badge
// for "accent". Shared by both variants so the numbering logic lives once.
function slideNumberBadge(
  slide: Slide,
  total: number,
  colors: { bg: string; fg: string; accent: string },
  variant: LayoutVariant
) {
  if (variant === 'minimal') {
    return (
      <div style={{ display: 'flex', fontSize: 28, opacity: 0.7 }}>
        {slide.index} / {total}
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        backgroundColor: colors.accent,
        color: colors.bg,
        fontSize: 24,
        fontWeight: 700,
        padding: '8px 20px',
        borderRadius: 9999,
      }}
    >
      {slide.index} / {total}
    </div>
  )
}

async function renderSlide(
  slide: Slide,
  total: number,
  colors: { bg: string; fg: string; accent: string },
  fontConfig: FontConfig,
  fonts: Awaited<ReturnType<typeof loadFontsForBrand>>,
  variant: LayoutVariant,
  logoUrl: string | null,
  brandName: string | null,
  textDensity: TextDensity,
  hierarchy: Hierarchy
) {
  const isAccent = variant === 'accent'
  const icon = isAccent ? pickSlideIcon(slide.headline, slide.body, brandName) : null
  const body = applyTextDensity(slide.body, textDensity)

  const image = new ImageResponse(
    (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: colors.bg,
          color: colors.fg,
          padding: 80,
          fontFamily: fontConfig.bodyFamily,
          overflow: 'hidden',
        }}
      >
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            width={60}
            height={60}
            style={{ position: 'absolute', top: 40, right: 40, objectFit: 'contain' }}
          />
        )}

        {isAccent && (
          // Corner accent: a simple geometric circle, partly off-canvas —
          // satori only supports basic primitives (rect/circle/line via
          // CSS shapes), not SVG icon libraries.
          <div
            style={{
              position: 'absolute',
              top: -140,
              right: -140,
              width: 320,
              height: 320,
              borderRadius: 9999,
              backgroundColor: colors.accent,
              opacity: 0.15,
              display: 'flex',
            }}
          />
        )}

        {slideNumberBadge(slide, total, colors, variant)}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: isAccent ? 32 : 24,
          }}
        >
          {isAccent && icon && (
            <div style={{ display: 'flex' }}>
              <LucideIcon name={icon} size={48} color={colors.accent} strokeWidth={2} />
            </div>
          )}
          {isAccent && (
            <div
              style={{
                display: 'flex',
                width: 120,
                height: 6,
                backgroundColor: colors.accent,
              }}
            />
          )}
          <div
            style={{
              display: 'flex',
              fontFamily: fontConfig.headlineFamily,
              fontWeight: fontConfig.headlineWeight,
              fontSize: HEADLINE_FONT_SIZE[hierarchy],
              lineHeight: 1.15,
            }}
          >
            {slide.headline}
          </div>
          <div
            style={{
              display: 'flex',
              fontFamily: fontConfig.bodyFamily,
              fontWeight: fontConfig.bodyWeight,
              fontSize: bodyFontSize(textDensity, hierarchy),
              lineHeight: 1.4,
              opacity: 0.9,
            }}
          >
            {body}
          </div>
        </div>

        <div style={{ display: 'flex', width: 64, height: 8, backgroundColor: colors.accent }} />
      </div>
    ),
    { width: 1080, height: 1350, fonts }
  )
  return Buffer.from(await image.arrayBuffer())
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
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
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

  const { data: post, error: postErr } = await supabase
    .schema('carousel')
    .from('posts')
    .select('id, brand_profile_id, layout_variant, color_scheme, text_density, hierarchy')
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

  const script = scriptStage?.output_json as Script | undefined
  if (!script?.slides?.length) {
    return NextResponse.json(
      { error: 'No script found for this post' },
      { status: 400 }
    )
  }

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

  const colors = pickColors(visualStyle, colorScheme)
  const logoUrl = visualStyle?.logo_url ?? null
  const mappedFonts = brandName ? BRAND_FONTS[brandName] : undefined
  if (brandName && !mappedFonts) {
    console.warn(
      `designer: no font mapping for brand "${brandName}" — using default fonts`
    )
  }
  let fontConfig = mappedFonts ?? DEFAULT_FONTS
  const total = script.slides.length

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

  const renderedSlides: { index: number; url: string }[] = []
  try {
    for (const slide of script.slides) {
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
        hierarchy
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

      renderedSlides.push({ index: slide.index, url: publicUrl.publicUrl })
    }
  } catch (err) {
    console.error('designer: render/upload error', err)
    return NextResponse.json(
      { error: 'Design generation failed' },
      { status: 502 }
    )
  }

  await supabase.schema('carousel').from('slides').delete().eq('post_id', postId)

  const { error: slidesErr } = await supabase
    .schema('carousel')
    .from('slides')
    .insert(
      script.slides.map((slide) => ({
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
    })
    .eq('id', postId)

  return NextResponse.json({
    post_id: postId,
    slides: renderedSlides,
    layout_variant: layoutVariant,
    color_scheme: colorScheme,
    text_density: textDensity,
    hierarchy: hierarchy,
  })
}
