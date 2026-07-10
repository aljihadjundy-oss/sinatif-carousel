import { readFile } from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import { ImageResponse } from 'next/og'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { ICON_NAMES, IconName, LucideIcon, pickSlideIcon } from '@/lib/icons'
import { TYPOGRAPHY_PRESET_KEYS, getTypographyPreset } from '@/lib/typography-presets'

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

type LayoutVariant = 'minimal' | 'accent' | 'editorial_gradient'
const LAYOUT_VARIANTS: LayoutVariant[] = ['minimal', 'accent', 'editorial_gradient']

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

// Image-background slides put headline + body + slide number inside a
// bottom-anchored block covering ~38% of slide height (see
// BOTTOM_BLOCK_HEIGHT), rather than the full padded slide — so even
// "detailed" needs a hard cap here, and every tier is capped noticeably
// tighter than the solid-background limits above.
const BODY_CHAR_LIMIT_IMAGE_BG: Record<TextDensity, number> = {
  concise: 60,
  standard: 100,
  detailed: 130,
}

function applyTextDensity(
  body: string,
  density: TextDensity,
  hasBackgroundImage: boolean
): string {
  const limit = hasBackgroundImage ? BODY_CHAR_LIMIT_IMAGE_BG[density] : BODY_CHAR_LIMIT[density]
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
// `onAccentBlock` is used inside the bottom accent-colored block on
// image-background slides — the normal accent pill (colors.accent
// background) would be invisible against a block that's already
// colors.accent, so it falls back to plain text there instead.
function slideNumberBadge(
  slide: Slide,
  total: number,
  colors: { bg: string; fg: string; accent: string },
  variant: LayoutVariant,
  onAccentBlock: boolean = false
) {
  if (variant === 'minimal' || onAccentBlock) {
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

// Bottom-anchored block height for image-background slides — roughly 38%
// of the 1350px canvas. Chosen to comfortably fit headline + a capped
// body + slide number (see BODY_CHAR_LIMIT_IMAGE_BG) without the block
// itself dominating the photo.
const BOTTOM_BLOCK_HEIGHT = 540

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
  hierarchy: Hierarchy,
  backgroundImageUrl: string | null,
  iconChoice: IconName | 'none' | null
) {
  const hasBackgroundImage = !!backgroundImageUrl
  // editorial_gradient only makes sense with a photo — falling back to
  // the accent treatment (rather than erroring) if it's ever picked
  // without background_image_url set keeps this route lenient the same
  // way every other option here already is about stale/mismatched data.
  const isEditorialGradient = variant === 'editorial_gradient' && hasBackgroundImage
  const isAccent = variant === 'accent' || (variant === 'editorial_gradient' && !hasBackgroundImage)
  const icon = isAccent || isEditorialGradient
    ? iconChoice === 'none'
      ? null
      : (iconChoice as IconName | null) ?? pickSlideIcon(slide.headline, slide.body, brandName)
    : null
  const body = applyTextDensity(slide.body, textDensity, hasBackgroundImage)

  const content = isEditorialGradient ? (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        backgroundColor: colors.bg,
        fontFamily: fontConfig.bodyFamily,
        overflow: 'hidden',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={backgroundImageUrl!}
        alt=""
        width={1080}
        height={1350}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 1080,
          height: 1350,
          objectFit: 'cover',
        }}
      />

      {/* Dark gradient from fully transparent at the top to ~80% black at
          the bottom — verified this renders correctly in Satori (linear-
          gradient CSS backgrounds are supported) before committing to this
          approach, rather than assuming. Text sits directly on the
          gradient in the lower third where it's darkest; no separate
          solid block like the other image-background treatment. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 1080,
          height: 1350,
          display: 'flex',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0) 40%, rgba(0,0,0,0.8) 100%)',
        }}
      />

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

      {/* Purely decorative corner cue — not functional navigation, this
          is a static image. */}
      <div style={{ position: 'absolute', bottom: 40, right: 40, display: 'flex', opacity: 0.8 }}>
        <LucideIcon name="ArrowRight" size={32} color="#FFFFFF" strokeWidth={2} />
      </div>

      {/* Large stylized slide number as a design element (low opacity,
          serif), not a plain small counter. Originally positioned with
          its own fixed `bottom` coordinate independent of the text block
          below it — verified via a real rendered slide that this
          overlapped the icon/headline whenever their combined height
          varied (e.g. an icon present, or a longer headline), since two
          independently-positioned absolute blocks don't know about each
          other's size. Fixed by putting it in the same flex column as
          everything else, immediately above the icon, so it's always
          pushed clear regardless of how much space the content below it
          needs. */}
      <div
        style={{
          position: 'absolute',
          left: 80,
          right: 80,
          bottom: 80,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            fontFamily: 'Cinzel',
            fontWeight: 700,
            fontSize: 120,
            lineHeight: 1,
            color: '#FFFFFF',
            opacity: 0.35,
          }}
        >
          {slide.index}
        </div>
        {icon && (
          <div style={{ display: 'flex' }}>
            <LucideIcon name={icon} size={44} color="#FFFFFF" strokeWidth={2} />
          </div>
        )}
        <div
          style={{
            display: 'flex',
            fontFamily: fontConfig.headlineFamily,
            fontWeight: fontConfig.headlineWeight,
            fontSize: HEADLINE_FONT_SIZE[hierarchy],
            lineHeight: 1.15,
            color: '#FFFFFF',
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
            color: '#FFFFFF',
            opacity: 0.9,
          }}
        >
          {body}
        </div>
      </div>
    </div>
  ) : hasBackgroundImage ? (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        backgroundColor: colors.bg,
        fontFamily: fontConfig.bodyFamily,
        overflow: 'hidden',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={backgroundImageUrl}
        alt=""
        width={1080}
        height={1350}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 1080,
          height: 1350,
          objectFit: 'cover',
        }}
      />

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

      {/* Bottom-anchored solid block, not floating text over the photo:
          replaces the earlier full-image dark scrim + translucent text
          box. No other decorative accent (corner shape, badge) is allowed
          to float loose over the photo outside this block — everything
          accent-related for image-background slides lives inside it. */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: 1080,
          height: BOTTOM_BLOCK_HEIGHT,
          backgroundColor: colors.accent,
          color: '#FFFFFF',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: isAccent ? 24 : 20,
          padding: '48px 80px',
        }}
      >
        {isAccent && icon && (
          <div style={{ display: 'flex' }}>
            <LucideIcon name={icon} size={44} color="#FFFFFF" strokeWidth={2} />
          </div>
        )}
        {isAccent && (
          <div style={{ display: 'flex', width: 100, height: 5, backgroundColor: '#FFFFFF' }} />
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
        {slideNumberBadge(slide, total, colors, variant, true)}
      </div>
    </div>
  ) : (
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
        // Corner accent only — a small geometric shape tucked into one
        // corner, partly off-canvas, never a border/outline around the
        // whole frame. Satori only supports basic primitives (rect/circle/
        // line via CSS shapes), not SVG icon libraries.
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: isAccent ? 32 : 24 }}>
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
  )

  const image = new ImageResponse(content, { width: 1080, height: 1350, fonts })
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
  // An explicit typography_preset overrides the brand's default font
  // mapping entirely — chosen instead of merging per-field since presets
  // are meant to replace the whole pairing (headline+body were picked as
  // a set), not partially blend with the brand's normal fonts.
  const presetFonts = getTypographyPreset(typographyPreset)
  let fontConfig = presetFonts ?? mappedFonts ?? DEFAULT_FONTS
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

  // slide-N.png is a deterministic path reused on every regenerate
  // (upsert overwrites the same object) with Supabase Storage's default
  // Cache-Control (max-age=3600) on the returned public URL. Regenerating
  // therefore produced new bytes that were provably correct in isolated
  // ImageResponse tests, while the browser kept serving the previous
  // response for that identical URL — "no visible change" despite the
  // backend working. A per-generation cache-busting query param forces a
  // fresh fetch every time the URL is (re)rendered client-side.
  const cacheBustVersion = Date.now()

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
