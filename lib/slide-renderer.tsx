// Pure slide-rendering logic, shared by app/api/carousel/designer/route.tsx
// (the live route) and scripts/generate-layout-previews.ts (a one-time
// preview-image script run via `npx tsx`, not a deployed route).
//
// Deliberately has NO Next-server-only imports (no createServerSupabaseClient,
// no NextResponse, no next/headers) — everything here is just font loading
// off disk + building Satori/ImageResponse JSX, safe to call from either a
// real request handler or a plain Node script. Extracted from
// designer/route.tsx once a 4th layout variant (flat_icon_list) made
// duplicating this logic in the preview script clearly worse than sharing it.
// Explicit React import: tsconfig.json sets jsx:"preserve" (Next/SWC
// handles the actual JSX transform for the app itself, no import needed
// there), but this module is also executed directly via `npx tsx` from
// scripts/generate-layout-previews.ts, whose classic-mode JSX transform
// needs `React` in scope to call React.createElement — verified this was
// the actual failure (`ReferenceError: React is not defined`) by running
// the script, not assumed.
import React from 'react'
import { readFile } from 'fs/promises'
import path from 'path'
import { ImageResponse } from 'next/og'
import { IconName, LucideIcon, pickSlideIcon } from '@/lib/icons'
import {
  getContrastRatio,
  getLuminance,
  getTextColorForBackground,
  getTextColorFromImage,
} from '@/lib/contrast'

export interface Slide {
  index: number
  headline: string
  body: string
}

export interface VisualStyle {
  colors?: Record<string, string>
  logo_url?: string | null
}

export type FontWeight = 400 | 500 | 600 | 700 | 800 | 900

export interface FontConfig {
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
export const BRAND_FONTS: Record<string, FontConfig> = {
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

export const DEFAULT_FONTS: FontConfig = {
  headlineFamily: 'Inter',
  headlineWeight: 700,
  bodyFamily: 'Inter',
  bodyWeight: 400,
}

// Fallback used to guarantee full glyph coverage (see loadFontsForBrand).
const FALLBACK_FAMILY = 'Noto Sans'
const FALLBACK_WEIGHT: FontWeight = 400

// Bundled once (downloaded from Google Fonts' raw .ttf endpoints) into
// public/fonts/ so rendering never depends on a live fetch to
// fonts.googleapis.com/fonts.gstatic.com at request time. Every
// (family, weight) pair used anywhere in BRAND_FONTS, DEFAULT_FONTS, or the
// fallback must have an entry here.
//
// The 3 new-layout-template fonts (JetBrains Mono, Playfair Display, Caveat)
// are .woff rather than .ttf — extracted from the @fontsource/* npm packages
// (registry.npmjs.org is reachable in this environment; raw Google Fonts
// endpoints are not) instead of hand-downloaded .ttf files. Confirmed via a
// real ImageResponse render that satori accepts .woff data identically to
// .ttf — loadLocalFont below just reads whatever file extension is named
// here, no format-specific branching needed.
export const FONT_FILES: Record<string, string> = {
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
  'JetBrains Mono-400': 'jetbrains-mono-400.woff',
  'JetBrains Mono-700': 'jetbrains-mono-700.woff',
  'Playfair Display-400': 'playfair-display-400.woff',
  'Playfair Display-700': 'playfair-display-700.woff',
  'Caveat-700': 'caveat-700.woff',
}

const fontFileCache = new Map<string, ArrayBuffer>()

async function loadLocalFont(family: string, weight: number): Promise<ArrayBuffer> {
  const key = `${family}-${weight}`
  const cached = fontFileCache.get(key)
  if (cached) return cached

  const filename = FONT_FILES[key]
  if (!filename) {
    console.error(`slide-renderer: no bundled font file registered for ${key}`)
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
      `slide-renderer: failed to read bundled font file for ${key} — ` +
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
export async function loadFontsForBrand(fontConfig: FontConfig) {
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

export type LayoutVariant =
  | 'minimal'
  | 'accent'
  | 'editorial_gradient'
  | 'flat_icon_list'
  | 'flat_mockup_card'
  | 'terminal_dev'
  | 'elegant_promo'
export const LAYOUT_VARIANTS: LayoutVariant[] = [
  'minimal',
  'accent',
  'editorial_gradient',
  'flat_icon_list',
  'flat_mockup_card',
  'terminal_dev',
  'elegant_promo',
]

export type TextDensity = 'concise' | 'standard' | 'detailed'
export const TEXT_DENSITIES: TextDensity[] = ['concise', 'standard', 'detailed']

export type Hierarchy = 'headline_focused' | 'balanced'
export const HIERARCHIES: Hierarchy[] = ['headline_focused', 'balanced']

// colorScheme, when given, names which entry in visual_style.colors should
// be used as the background — the rest of the palette (in original order,
// minus that entry) still supplies accent/fg the same way pickColors
// already did, so picking a scheme just re-roots which color is "first".
export function pickColors(visualStyle: VisualStyle | null, colorScheme: string | null) {
  const namedColors = visualStyle?.colors ?? {}
  const entries = Object.entries(namedColors)

  if (colorScheme && namedColors[colorScheme]) {
    const bg = namedColors[colorScheme]
    const rest = entries.filter(([name]) => name !== colorScheme).map(([, v]) => v)
    return {
      bg,
      // fg used to be "whatever color happens to be last in the brand's
      // palette" — worked by luck as long as that landed on something
      // dark/light-contrasting with bg. Deriving it from bg's actual
      // luminance instead fixes the real case this produced: a palette
      // ordered such that the "last" color was itself light, rendered on
      // an equally light bg.
      fg: getTextColorForBackground(bg),
      accent: rest[0] ?? bg,
    }
  }

  const colors = entries.map(([, v]) => v)
  const bg = colors[0] ?? '#111827'
  return {
    bg,
    fg: getTextColorForBackground(bg),
    accent: colors[1] ?? colors[0] ?? '#2563eb',
  }
}

const BODY_FONT_SIZE: Record<TextDensity, number> = {
  concise: 28,
  standard: 32,
  detailed: 36,
}

// Density is now handled upstream by rewriteSlidesForDensity() (see
// lib/ai-client.ts) — the model rewrites each slide's body to the target
// word count (concise ~15-20, standard ~30-40, detailed ~50-70 words)
// instead of this route truncating one long body by character count. As
// a result these caps are no longer the primary mechanism; they're a
// safety net for the rare case a rewrite comes back longer than asked
// (a very long single sentence that can't be reasonably broken, a model
// that ignores the word-count instruction, etc). Set generously above
// what a correctly-rewritten "detailed" body should ever reach, rather
// than tuned tightly to the target word counts.
const BODY_CHAR_LIMIT: Record<TextDensity, number | null> = {
  concise: 200,
  standard: 400,
  detailed: null,
}

// Image-background slides put headline + body + slide number inside a
// bottom-anchored block covering ~38% of slide height (see
// BOTTOM_BLOCK_HEIGHT), rather than the full padded slide, so this still
// needs a hard ceiling even as a safety net — imageBgBodyFontSize below
// does the real work of fitting rewritten text of varying length into
// that fixed space by scaling the font down as body length grows, rather
// than this cap doing the fitting via truncation.
const BODY_CHAR_LIMIT_IMAGE_BG: Record<TextDensity, number> = {
  concise: 160,
  standard: 300,
  detailed: 480,
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

// The two image-background treatments (accent/minimal's bottom block,
// editorial_gradient's lower third) render body text inside a
// fixed-height block alongside the headline and slide number — now that
// density is a genuine rewrite rather than truncation (see
// rewriteSlidesForDensity in lib/ai-client.ts), body length varies
// continuously with how the rewrite came out rather than sitting at one
// of 3 known-safe lengths, so font size is scaled off the actual
// character count instead of off the density tier. Thresholds tuned by
// rendering real "detailed" (~50-70 word) rewrites through the pipeline
// and checking for overlap with the headline/slide-number badge, the
// same technique used for the density char caps above.
function imageBgBodyFontSize(density: TextDensity, hierarchy: Hierarchy, bodyLength: number): number {
  const base = BODY_FONT_SIZE[density]
  let scale: number
  if (bodyLength <= 90) scale = 0.8
  else if (bodyLength <= 160) scale = 0.72
  else if (bodyLength <= 240) scale = 0.62
  else if (bodyLength <= 340) scale = 0.54
  else scale = 0.46
  const scaled = Math.round(base * scale)
  return hierarchy === 'headline_focused' ? Math.round(scaled * 0.85) : scaled
}

// Slide number indicator: plain text for "minimal", a colored pill badge
// for every other variant. Shared so the numbering logic lives once.
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
        // Was hardcoded to colors.bg — assumed bg and accent always
        // contrast, which broke for palettes where they're both
        // dark/light. Deriving from accent's actual luminance instead.
        color: getTextColorForBackground(colors.accent),
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

const LIST_MARKER_RE = /^(\d{1,2}[.)]|[-•*])\s*/

function stripListMarker(line: string): string {
  return line.replace(LIST_MARKER_RE, '').trim()
}

// flat_icon_list renders the body either as a short numbered list (each
// item with its own icon) or as one paragraph paired with a single icon —
// deliberately NOT always-list, since LLM-generated body text is almost
// always a single unbroken paragraph (Gemini/Groq return one prose string
// per slide, no embedded structure) and forcing that into fake "list
// items" by splitting on sentences/commas would produce arbitrary,
// meaningless fragments that look broken rather than like an actual list.
// Only treats the body as a list when it already has real list structure:
// either genuine newline-separated lines (rare from an LLM, but some
// manually-written scripts might have this), or 2+ inline numbered
// markers within the text ("1. ... 2. ... 3. ..."), which some prompts do
// produce. Anything else falls through to the single-icon+paragraph path.
export function parseListItems(body: string): string[] | null {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length >= 2) {
    return lines.map(stripListMarker).filter(Boolean).slice(0, 4)
  }

  const markers = Array.from(body.matchAll(/(?:^|\s)(\d{1,2})[.)]\s+/g))
  if (markers.length >= 2) {
    const items: string[] = []
    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].index! + markers[i][0].length
      const end = i + 1 < markers.length ? markers[i + 1].index! : body.length
      const text = body.slice(start, end).trim()
      if (text) items.push(text)
    }
    if (items.length >= 2) return items.slice(0, 4)
  }

  return null
}

// flat_mockup_card's centerpiece card shows one short "highlight" line.
// There's no dedicated highlight field in the script data (script-writer
// only produces headline + body per slide), so this pulls from the body
// as a stand-in. A first version always used the body's first sentence,
// but a real rendered test showed that reading as an awkward near-verbatim
// repeat of the body paragraph directly above it (both start with the
// same words). Using the LAST sentence instead reads more like a distinct
// closing takeaway; single-sentence bodies fall back to the headline so
// the card never just re-shows the entire body a second time. Capped
// independently of BODY_CHAR_LIMIT since the card has much less width
// than a full-slide paragraph.
const CARD_HIGHLIGHT_CHAR_LIMIT = 90

function extractCardHighlight(body: string, headline: string): string {
  const sentences = body
    .split('. ')
    .map((s) => s.trim())
    .filter(Boolean)
  const source = sentences.length >= 2 ? sentences[sentences.length - 1] : headline
  const text = source.replace(/\.$/, '')
  if (text.length <= CARD_HIGHLIGHT_CHAR_LIMIT) return text
  return `${text.slice(0, CARD_HIGHLIGHT_CHAR_LIMIT).trimEnd()}…`
}

// terminal_dev's mock terminal window shows 4-6 short "code comment"-style
// lines derived from the body — reuses parseListItems() (already shared
// with flat_icon_list) when the body has real list structure, otherwise
// splits on sentences so a single prose paragraph still becomes multiple
// short lines instead of one long one wrapping inside a narrow monospace
// column. Each line is capped independently of BODY_CHAR_LIMIT since the
// terminal card is narrower than a full-slide paragraph.
const TERMINAL_LINE_CHAR_LIMIT = 56
const TERMINAL_MAX_LINES = 6

function truncateTerminalLine(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= TERMINAL_LINE_CHAR_LIMIT) return trimmed
  return `${trimmed.slice(0, TERMINAL_LINE_CHAR_LIMIT).trimEnd()}…`
}

function buildTerminalLines(body: string): string[] {
  const listItems = parseListItems(body)
  const rawLines =
    listItems ??
    body
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)

  const lines = rawLines.slice(0, TERMINAL_MAX_LINES).map(truncateTerminalLine)
  return lines.length > 0 ? lines : [truncateTerminalLine(body)]
}

export async function renderSlide(
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
  // Text/icon color for anything rendered directly on a colors.accent
  // background (badges, the mockup-card highlight box, the image-bg
  // bottom block) — computed once here instead of hardcoding '#FFFFFF'
  // at each call site, since accent is an arbitrary brand color that can
  // itself be light.
  const accentTextColor = getTextColorForBackground(colors.accent)
  // Text sitting directly on the photo (editorial_gradient's dark-gradient
  // scrim) gets its color from the image itself rather than from the
  // brand palette — phase 1 of getTextColorFromImage always returns
  // white (a reasonable assumption paired with the dark scrim beneath the
  // text), phase 2 can sample the actual image without any call site here
  // needing to change.
  const imageTextColor = getTextColorFromImage(backgroundImageUrl)
  // editorial_gradient only makes sense with a photo — falling back to
  // the accent treatment (rather than erroring) if it's ever picked
  // without background_image_url set keeps this route lenient the same
  // way every other option here already is about stale/mismatched data.
  const isEditorialGradient = variant === 'editorial_gradient' && hasBackgroundImage
  // flat_icon_list is a flat/no-photo style — it intentionally ignores
  // background_image_url even if one happens to be set on the post,
  // rather than growing a 3rd background-image code path for a layout
  // that's specifically meant not to use one.
  const isFlatIconList = variant === 'flat_icon_list'
  // flat_mockup_card is likewise a flat/no-photo style, same reasoning as
  // flat_icon_list above.
  const isFlatMockupCard = variant === 'flat_mockup_card'
  // terminal_dev is also a flat/no-photo style — its "screen" is a solid
  // brand-color background with a mock terminal window as the visual
  // anchor, not a photo.
  const isTerminalDev = variant === 'terminal_dev'
  const isAccent =
    variant === 'accent' || (variant === 'editorial_gradient' && !hasBackgroundImage)
  const icon =
    isAccent || isEditorialGradient
      ? iconChoice === 'none'
        ? null
        : (iconChoice as IconName | null) ?? pickSlideIcon(slide.headline, slide.body, brandName)
      : null
  const body = applyTextDensity(
    slide.body,
    textDensity,
    hasBackgroundImage && !isFlatIconList && !isFlatMockupCard && !isTerminalDev
  )
  // Fixed (not brand-derived) dark background for the mock terminal window
  // — a real terminal reads as a terminal specifically because it's dark
  // regardless of the slide's brand color, and fixing it means the ordinary
  // line color below can be computed once rather than depend on whichever
  // brand palette happens to be active.
  const TERMINAL_BG = '#0d1117'
  const terminalLineColor = getTextColorForBackground(TERMINAL_BG)
  // The highlighted last terminal line uses the brand's accent color for
  // flavor, but only when that accent actually reads against the fixed
  // dark terminal background — falls back to the same safe line color
  // otherwise, rather than trusting an arbitrary brand color to always be
  // light enough (the exact class of assumption that caused the invisible-
  // text bugs PR #47 fixed).
  const terminalHighlightColor =
    getContrastRatio(colors.accent, TERMINAL_BG) >= 3 ? colors.accent : terminalLineColor

  // elegant_promo is a light-cream palette by design, independent of
  // whichever bg the brand's colorScheme/pickColors resolved to — reuses
  // the brand's bg only when it's already light enough to read as
  // "cream-like", otherwise falls back to a fixed off-white rather than
  // rendering e.g. Hexolution's dark charcoal bg for a template whose
  // whole aesthetic depends on being light.
  const isElegantPromo = variant === 'elegant_promo'
  const ELEGANT_PROMO_FALLBACK_BG = '#F7F3EE'
  const promoBg = getLuminance(colors.bg) > 0.75 ? colors.bg : ELEGANT_PROMO_FALLBACK_BG
  const promoTextColor = getTextColorForBackground(promoBg)
  // The accent color is used directly for the script-style tagline/CTA
  // when it reads clearly against the cream bg; otherwise falls back to
  // the plain contrast-safe text color, same reasoning as
  // terminalHighlightColor above — never trust an arbitrary brand color
  // to be readable against a fixed surface without checking.
  const promoAccentColor =
    getContrastRatio(colors.accent, promoBg) >= 3 ? colors.accent : promoTextColor

  const content = isFlatMockupCard ? (
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

      {/* Top meta row: uppercase label (brand name, falling back to a
          generic tag when there's no brand) + "X OF N" counter. Reserves
          extra right-side clearance (paddingRight beyond the container's
          own 80px padding) so the counter never sits under the logo —
          both naturally want the top-right corner, and this session has
          already hit that exact overlap-bug class twice with
          independently-positioned elements. Skipped the optional
          feature/tag pill the spec offered as a maybe: with the label +
          counter already occupying this row, a 3rd meta element here
          would be redundant clutter rather than adding information. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingRight: 80,
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: 'uppercase',
            opacity: 0.6,
          }}
        >
          {brandName ?? 'CAROUSEL'}
        </div>
        <div style={{ display: 'flex', fontSize: 20, fontWeight: 600, opacity: 0.5 }}>
          {slide.index} OF {total}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
            opacity: 0.85,
          }}
        >
          {body}
        </div>

        {/* Centerpiece "mockup card" — a general highlight card, NOT
            styled as a code editor (no traffic-light dots, no monospace
            font). Content spans casual/corporate/educational brands, so
            a code-editor skin would only read as on-brand for
            Hexolution (the tech-focused one) and off-brand everywhere
            else. A per-brand code-editor variant for Hexolution
            specifically was explicitly optional in the spec ("could be
            a nice touch") with the brand-agnostic version as the hard
            requirement — skipped it to avoid a 2nd visual branch (and
            2nd thing to keep in sync across preview generation, the
            options UI, etc.) for a brand-specific nicety that wasn't
            actually requested. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: colors.accent,
            borderRadius: 20,
            padding: '32px 36px',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontFamily: fontConfig.bodyFamily,
              fontWeight: 600,
              fontSize: 26,
              lineHeight: 1.35,
              color: accentTextColor,
            }}
          >
            {extractCardHighlight(slide.body, slide.headline)}
          </div>
        </div>
      </div>

      {/* Purely decorative swipe cue — not functional, this is a static
          image. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          opacity: 0.6,
        }}
      >
        <div style={{ display: 'flex', fontSize: 20, fontWeight: 600 }}>Swipe</div>
        <LucideIcon name="ArrowRight" size={22} color={colors.fg} strokeWidth={2} />
      </div>
    </div>
  ) : isFlatIconList ? (
    (() => {
      const listItems = parseListItems(slide.body)
      const singleIcon =
        iconChoice === 'none'
          ? null
          : (iconChoice as IconName | null) ?? pickSlideIcon(slide.headline, slide.body, brandName)

      return (
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
            // Extra bottom padding (vs. the usual 80) reserves clearance
            // above the seal badge, which is absolutely positioned at a
            // fixed bottom-left spot regardless of how tall the content
            // above it grows. A real rendered test with a 4-item list
            // showed the last item colliding with the seal without this —
            // same class of bug as editorial_gradient's number/icon
            // overlap, same fix: give fixed decorative elements guaranteed
            // clearance instead of assuming content will stay short.
            padding: '80px 80px 160px 80px',
            fontFamily: fontConfig.bodyFamily,
            overflow: 'hidden',
          }}
        >
          {/* Large decorative corner shape — same technique as the accent
              variant's corner circle (a plain CSS circle; Satori has no SVG
              icon support), just bigger and lower-opacity so it reads as a
              background texture behind the content rather than a badge. */}
          <div
            style={{
              position: 'absolute',
              top: -220,
              left: -220,
              width: 560,
              height: 560,
              borderRadius: 9999,
              backgroundColor: colors.accent,
              opacity: 0.12,
              display: 'flex',
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

          {/* Decorative seal/badge — bottom-left, clear of both the logo
              (top-right) and the slide-number pill (which sits at the top
              of the flex flow below), so nothing overlaps regardless of
              content length. Not functional, purely decorative. */}
          <div
            style={{
              position: 'absolute',
              bottom: 40,
              left: 40,
              width: 64,
              height: 64,
              borderRadius: 9999,
              backgroundColor: colors.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LucideIcon name="CheckCircle" size={32} color={accentTextColor} strokeWidth={2} />
          </div>

          {slideNumberBadge(slide, total, colors, variant)}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
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

            {listItems ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {listItems.map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                    <div
                      style={{
                        display: 'flex',
                        flexShrink: 0,
                        width: 40,
                        height: 40,
                        borderRadius: 9999,
                        backgroundColor: colors.accent,
                        color: accentTextColor,
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 18,
                        fontWeight: 700,
                      }}
                    >
                      {i + 1}
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
                      {item}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
                {singleIcon && (
                  <div style={{ display: 'flex', flexShrink: 0 }}>
                    <LucideIcon name={singleIcon} size={56} color={colors.accent} strokeWidth={2} />
                  </div>
                )}
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
            )}
          </div>

          {/* No trailing bottom accent bar here (unlike minimal/accent) —
              the seal badge already occupies the bottom-left corner, and a
              real rendered test showed a bar in the same flex flow visually
              merging with it. The corner shape + seal + numbered pill are
              already the decorative elements the spec asked for. */}
        </div>
      )
    })()
  ) : isEditorialGradient ? (
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
        <LucideIcon name="ArrowRight" size={32} color={imageTextColor} strokeWidth={2} />
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
            color: imageTextColor,
            opacity: 0.35,
          }}
        >
          {slide.index}
        </div>
        {icon && (
          <div style={{ display: 'flex' }}>
            <LucideIcon name={icon} size={44} color={imageTextColor} strokeWidth={2} />
          </div>
        )}
        <div
          style={{
            display: 'flex',
            fontFamily: fontConfig.headlineFamily,
            fontWeight: fontConfig.headlineWeight,
            fontSize: HEADLINE_FONT_SIZE[hierarchy],
            lineHeight: 1.15,
            color: imageTextColor,
          }}
        >
          {slide.headline}
        </div>
        <div
          style={{
            display: 'flex',
            fontFamily: fontConfig.bodyFamily,
            fontWeight: fontConfig.bodyWeight,
            fontSize: imageBgBodyFontSize(textDensity, hierarchy, body.length),
            lineHeight: 1.35,
            color: imageTextColor,
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
          color: accentTextColor,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: isAccent ? 24 : 20,
          padding: '48px 80px',
        }}
      >
        {isAccent && icon && (
          <div style={{ display: 'flex' }}>
            <LucideIcon name={icon} size={44} color={accentTextColor} strokeWidth={2} />
          </div>
        )}
        {isAccent && (
          <div style={{ display: 'flex', width: 100, height: 5, backgroundColor: accentTextColor }} />
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
            fontSize: imageBgBodyFontSize(textDensity, hierarchy, body.length),
            lineHeight: 1.35,
            opacity: 0.9,
          }}
        >
          {body}
        </div>
        {slideNumberBadge(slide, total, colors, variant, true)}
      </div>
    </div>
  ) : isTerminalDev ? (
    (() => {
      const terminalBorderColor =
        terminalLineColor === '#FFFFFF' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'
      const terminalLines = buildTerminalLines(body)
      const paddedIndex = String(slide.index).padStart(2, '0')
      const paddedTotal = String(total).padStart(2, '0')

      return (
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  fontFamily: 'JetBrains Mono',
                  fontWeight: 700,
                  fontSize: 20,
                  letterSpacing: 3,
                  textTransform: 'uppercase',
                  opacity: 0.7,
                }}
              >
                {brandName ?? 'CAROUSEL'}
              </div>
              <div
                style={{
                  display: 'flex',
                  fontFamily: 'JetBrains Mono',
                  fontWeight: 700,
                  fontSize: 20,
                  opacity: 0.6,
                }}
              >
                {paddedIndex} OF {paddedTotal}
              </div>
            </div>

            {/* Bordered tag box — dark bg (matches the terminal window
                below) with a light 1px border, monospace uppercase, in
                the style of a code "feature flag" comment. */}
            <div
              style={{
                display: 'flex',
                alignSelf: 'flex-start',
                backgroundColor: TERMINAL_BG,
                border: `1px solid ${terminalBorderColor}`,
                borderRadius: 6,
                padding: '8px 16px',
                fontFamily: 'JetBrains Mono',
                fontWeight: 700,
                fontSize: 18,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: terminalLineColor,
              }}
            >
              Feature {paddedIndex} / Topic
            </div>

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
                opacity: 0.85,
              }}
            >
              {body}
            </div>
          </div>

          {/* Mock terminal window — the visual anchor. Fixed dark bg
              regardless of brand color (see TERMINAL_BG above), window
              chrome dots use the conventional macOS red/yellow/green
              (decorative UI convention, not text — no contrast concern). */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: TERMINAL_BG,
              borderRadius: 16,
              padding: '24px 28px',
              gap: 18,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 9999, backgroundColor: '#ff5f56' }} />
              <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 9999, backgroundColor: '#ffbd2e' }} />
              <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 9999, backgroundColor: '#27c93f' }} />
              <div
                style={{
                  display: 'flex',
                  fontFamily: 'JetBrains Mono',
                  fontSize: 16,
                  color: terminalLineColor,
                  opacity: 0.55,
                  marginLeft: 8,
                }}
              >
                slide-{slide.index}.ts
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {terminalLines.map((line, i) => {
                const isLast = i === terminalLines.length - 1
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      fontFamily: 'JetBrains Mono',
                      fontWeight: isLast ? 700 : 400,
                      fontSize: 22,
                      color: isLast ? terminalHighlightColor : terminalLineColor,
                      opacity: isLast ? 1 : 0.85,
                    }}
                  >
                    {isLast ? '# ' : '- '}
                    {line}
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', fontFamily: 'JetBrains Mono', fontSize: 18, opacity: 0.6 }}>
              {paddedIndex} / {paddedTotal}
            </div>
            <div style={{ display: 'flex', fontFamily: 'JetBrains Mono', fontSize: 18, opacity: 0.6 }}>
              SWIPE →
            </div>
          </div>
        </div>
      )
    })()
  ) : isElegantPromo ? (
    (() => {
      const listItems = parseListItems(body)
      // Splits the headline into two lines — first half bold serif,
      // second half regular serif, per the reference design's mixed-
      // weight heading. A single-word headline just renders as one bold
      // line rather than an empty second line.
      const words = slide.headline.split(' ')
      const mid = Math.max(1, Math.ceil(words.length / 2))
      const headlineLine1 = words.slice(0, mid).join(' ')
      const headlineLine2 = words.slice(mid).join(' ')
      // No dedicated tagline field in the script data, same situation
      // extractCardHighlight() already solves for flat_mockup_card — reused
      // here for the script-font accent line rather than inventing a 2nd
      // "pull a short line out of body/headline" heuristic.
      const tagline = extractCardHighlight(body, slide.headline)
      const badgeText = `${slide.index}/${total}`
      const accentTextOnPromoAccent = getTextColorForBackground(colors.accent)

      return (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            backgroundColor: promoBg,
            color: promoTextColor,
            padding: 80,
            fontFamily: fontConfig.bodyFamily,
            overflow: 'hidden',
          }}
        >
          {/* Decorative organic shapes in 2 corners — plain circles (Satori
              has no SVG blob/path support), low opacity so they read as
              background texture rather than competing with the content. */}
          <div
            style={{
              position: 'absolute',
              top: -120,
              left: -120,
              width: 300,
              height: 300,
              borderRadius: 9999,
              backgroundColor: colors.accent,
              opacity: 0.15,
              display: 'flex',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: -160,
              right: -160,
              width: 380,
              height: 380,
              borderRadius: 9999,
              backgroundColor: colors.accent,
              opacity: 0.12,
              display: 'flex',
            }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', fontSize: 24, color: promoAccentColor }}>*</div>
              <div
                style={{
                  display: 'flex',
                  fontSize: 20,
                  fontWeight: 700,
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                  opacity: 0.7,
                }}
              >
                {brandName ?? 'BRAND'}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  display: 'flex',
                  fontFamily: 'Playfair Display',
                  fontWeight: 700,
                  fontSize: HEADLINE_FONT_SIZE[hierarchy],
                  lineHeight: 1.15,
                }}
              >
                {headlineLine1}
              </div>
              {headlineLine2 && (
                <div
                  style={{
                    display: 'flex',
                    fontFamily: 'Playfair Display',
                    fontWeight: 400,
                    fontSize: HEADLINE_FONT_SIZE[hierarchy],
                    lineHeight: 1.15,
                  }}
                >
                  {headlineLine2}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ display: 'flex', fontSize: 20, color: promoAccentColor }}>*</div>
              <div
                style={{
                  display: 'flex',
                  fontFamily: 'Caveat',
                  fontWeight: 700,
                  fontSize: 44,
                  color: promoAccentColor,
                }}
              >
                {tagline}
              </div>
              <div style={{ display: 'flex', fontSize: 20, color: promoAccentColor }}>*</div>
            </div>

            <div
              style={{
                display: 'flex',
                fontFamily: fontConfig.bodyFamily,
                fontWeight: fontConfig.bodyWeight,
                fontSize: bodyFontSize(textDensity, hierarchy),
                lineHeight: 1.4,
                opacity: 0.85,
              }}
            >
              {body}
            </div>

            {listItems && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {listItems.map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div
                      style={{
                        display: 'flex',
                        flexShrink: 0,
                        width: 36,
                        height: 36,
                        borderRadius: 9999,
                        backgroundColor: colors.accent,
                        color: accentTextOnPromoAccent,
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 16,
                        fontWeight: 700,
                      }}
                    >
                      {i + 1}
                    </div>
                    <div style={{ display: 'flex', fontSize: 24, opacity: 0.85 }}>{item}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {/* Badge/seal — plain circle with a border matching the page
                bg (reads as an inset ring), not the scalloped-edge shape
                from the reference (Satori has no clip-path/SVG path
                support for that). */}
            <div
              style={{
                display: 'flex',
                width: 72,
                height: 72,
                borderRadius: 9999,
                backgroundColor: colors.accent,
                alignItems: 'center',
                justifyContent: 'center',
                border: `3px solid ${promoBg}`,
              }}
            >
              <div style={{ display: 'flex', fontSize: 16, fontWeight: 700, color: accentTextOnPromoAccent }}>
                {badgeText}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: 'uppercase',
                color: promoAccentColor,
              }}
            >
              TAP TO JOIN →
            </div>
          </div>
        </div>
      )
    })()
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

  // Extra font families beyond the brand's headline/body pair (already in
  // `fonts`) are loaded here, only for the template that actually needs
  // them, rather than always loading every template-specific font up
  // front.
  const templateFonts: Awaited<ReturnType<typeof loadFontsForBrand>> = []
  if (isTerminalDev) {
    templateFonts.push(
      { name: 'JetBrains Mono', weight: 400, style: 'normal', data: await loadLocalFont('JetBrains Mono', 400) },
      { name: 'JetBrains Mono', weight: 700, style: 'normal', data: await loadLocalFont('JetBrains Mono', 700) }
    )
  }
  if (isElegantPromo) {
    // Same "register a broad-coverage fallback under the font's own name"
    // requirement documented on loadFontsForBrand above applies here too.
    // Confirmed necessary by a real render: the original decorative marks
    // (✳, U+2733) are covered by neither Playfair Display nor Caveat, and
    // without a same-name fallback registered they silently rendered as
    // nothing rather than erroring — switched those marks to a plain "*"
    // (always covered) but kept this fallback registration, since
    // LLM-generated headline/body text can still contain other
    // punctuation these decorative fonts don't cover.
    const fallbackData = await loadLocalFont(FALLBACK_FAMILY, FALLBACK_WEIGHT)
    templateFonts.push(
      { name: 'Playfair Display', weight: 400, style: 'normal', data: await loadLocalFont('Playfair Display', 400) },
      { name: 'Playfair Display', weight: 700, style: 'normal', data: await loadLocalFont('Playfair Display', 700) },
      { name: 'Playfair Display', weight: FALLBACK_WEIGHT, style: 'normal', data: fallbackData },
      { name: 'Caveat', weight: 700, style: 'normal', data: await loadLocalFont('Caveat', 700) },
      { name: 'Caveat', weight: FALLBACK_WEIGHT, style: 'normal', data: fallbackData }
    )
  }

  const image = new ImageResponse(content, {
    width: 1080,
    height: 1350,
    fonts: [...fonts, ...templateFonts],
  })
  return Buffer.from(await image.arrayBuffer())
}
