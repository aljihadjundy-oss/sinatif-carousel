// Phase-2 template compiler: turns a (template, slide content, resolved
// design) triple into a SlideDocument — the same visual output
// lib/slide-renderer.tsx produces for that input, but as data (frozen
// absolute positions, frozen final colors) instead of a JSX branch.
//
// Colors are FINAL at compile time (AUDIT.md debt #5): every contrast
// decision lib/contrast.ts makes at render time in the legacy path is
// made here instead and stored on the node. Fonts are frozen the same
// way: nodes carry the (family, weight) satori actually resolves under
// the legacy renderer's registered font set — e.g. editorial_gradient's
// big slide number asks for Cinzel 700, but the legacy render never
// registers Cinzel, so satori falls back to the weight-matched
// registered font (verified empirically: byte-identical to Inter 700
// under the default brand); the compiled node freezes that real
// resolution, because loading the font the JSX *named* would change
// pixels vs. the phase-0 baselines.
//
// Layout comes from two techniques, both of which ask the production
// engine instead of re-implementing it (risk R1):
// - 'minimal' (the pilot): per-block text measurement + hand flex math
//   (lib/measure-text.ts) — kept as-is since it shipped at 0.00000% diff.
// - the other 8: probe rendering (lib/template-probe.tsx) — the template
//   structure is rendered once with every leaf in a unique flat color
//   and the exact border-box rects are read back off the pixels.
import React from 'react'
import {
  BOTTOM_BLOCK_HEIGHT,
  FontConfig,
  FontWeight,
  Hierarchy,
  HEADLINE_FONT_SIZE,
  LayoutVariant,
  Slide,
  TextDensity,
  applyTextDensity,
  bodyFontSize,
  buildTerminalLines,
  extractCardHighlight,
  imageBgBodyFontSize,
  loadFontsForBrand,
  loadLocalFont,
  parseListItems,
} from '@/lib/slide-renderer'
import {
  getContrastRatio,
  getLuminance,
  getTextColorForBackground,
  getTextColorFromImage,
} from '@/lib/contrast'
import { IconName, pickSlideIcon } from '@/lib/icons'
import { measureTextHeight } from '@/lib/measure-text'
import { ProbeTree } from '@/lib/template-probe'
import {
  SLIDE_DOCUMENT_VERSION,
  SlideDocument,
  SlideNode,
  createNodeId,
} from '@/lib/slideDocument'

type Fonts = Awaited<ReturnType<typeof loadFontsForBrand>>

export interface CompileInput {
  slide: Slide
  total: number
  colors: { bg: string; fg: string; accent: string }
  fontConfig: FontConfig
  textDensity: TextDensity
  hierarchy: Hierarchy
  logoUrl: string | null
  brandName: string | null
  backgroundImageUrl: string | null
  iconChoice: IconName | 'none' | null
  iconColor: string | null
}

const CANVAS_W = 1080
const CANVAS_H = 1350
const PAD = 80
const CONTENT_W = CANVAS_W - PAD * 2 // 920
const INNER_H = CANVAS_H - PAD * 2 // 1190

// Fixed values copied from the legacy renderer (same names there).
const TERMINAL_BG = '#0d1117'
const ELEGANT_PROMO_FALLBACK_BG = '#F7F3EE'
const NEWS_CARD_FALLBACK_BG = '#111827'

// ---------------------------------------------------------------------------
// Legacy font registration + weight/family freezing

// Replicates exactly which fonts renderSlide() registers for a given
// variant: the brand pair (+ per-family Noto fallback) always, plus the
// template-specific extras for terminal_dev / elegant_promo.
export async function loadLegacyFontSet(
  variant: LayoutVariant,
  fontConfig: FontConfig
): Promise<Fonts> {
  const fonts = await loadFontsForBrand(fontConfig)
  const extras: Fonts = []
  if (variant === 'terminal_dev') {
    extras.push(
      { name: 'JetBrains Mono', weight: 400, style: 'normal', data: await loadLocalFont('JetBrains Mono', 400) },
      { name: 'JetBrains Mono', weight: 700, style: 'normal', data: await loadLocalFont('JetBrains Mono', 700) }
    )
  }
  if (variant === 'elegant_promo') {
    const fallbackData = await loadLocalFont('Noto Sans', 400)
    extras.push(
      { name: 'Playfair Display', weight: 400, style: 'normal', data: await loadLocalFont('Playfair Display', 400) },
      { name: 'Playfair Display', weight: 700, style: 'normal', data: await loadLocalFont('Playfair Display', 700) },
      { name: 'Playfair Display', weight: 400 as FontWeight, style: 'normal', data: fallbackData },
      { name: 'Caveat', weight: 700, style: 'normal', data: await loadLocalFont('Caveat', 700) },
      { name: 'Caveat', weight: 400 as FontWeight, style: 'normal', data: fallbackData }
    )
  }
  return [...fonts, ...extras]
}

// CSS font-weight matching over one family's registered weights — the
// algorithm satori applies at render time. Freezing its answer into the
// node means renderDocument() loads the file that actually painted the
// baseline (e.g. a 600-weight request against registered {400,700}
// painted 700; loading a real 600 file would change pixels).
function resolveWeight(requested: number, registered: number[]): FontWeight {
  const weights = Array.from(new Set(registered)).sort((a, b) => a - b)
  if (weights.includes(requested)) return requested as FontWeight
  const below = weights.filter((w) => w < requested)
  const above = weights.filter((w) => w > requested)
  let pick: number | undefined
  if (requested === 500) {
    pick = weights.includes(400) ? 400 : below[below.length - 1] ?? above[0]
  } else if (requested < 500) {
    pick = below[below.length - 1] ?? above[0]
  } else {
    pick = above[0] ?? below[below.length - 1]
  }
  if (pick === undefined) throw new Error(`resolveWeight: no registered weights for request ${requested}`)
  return pick as FontWeight
}

// Freezes (family, weight) to what satori resolves under `fonts`:
// registered family → that family at its CSS-matched weight; unregistered
// family (e.g. 'Cinzel' outside a template that loads it) → weight-
// matched pick across all registered fonts (verified empirically — see
// module header).
function freezeFont(
  family: string,
  weight: number,
  fonts: Fonts
): { fontFamily: string; fontWeight: FontWeight } {
  const sameFamily = fonts.filter((f) => f.name === family)
  if (sameFamily.length > 0) {
    return {
      fontFamily: family,
      fontWeight: resolveWeight(weight, sameFamily.map((f) => f.weight as number)),
    }
  }
  const all = fonts.map((f) => ({ name: f.name, weight: f.weight as number }))
  const exact = all.find((f) => f.weight === weight)
  if (exact) return { fontFamily: exact.name, fontWeight: weight as FontWeight }
  const resolved = resolveWeight(weight, all.map((f) => f.weight))
  const pick = all.find((f) => f.weight === resolved)!
  return { fontFamily: pick.name, fontWeight: resolved }
}

// ---------------------------------------------------------------------------

function baseDocument(
  background: SlideDocument['canvas']['background'],
  nodes: SlideNode[]
): SlideDocument {
  return {
    version: SLIDE_DOCUMENT_VERSION,
    id: crypto.randomUUID(),
    canvas: { width: CANVAS_W, height: CANVAS_H, background },
    nodes,
    manuallyEdited: false,
  }
}

// Omit must distribute over the SlideNode union — plain Omit<Union, K>
// collapses to the shared base fields and rejects per-type ones.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

function fixedNode(node: DistributiveOmit<SlideNode, 'id'>): SlideNode {
  return { id: createNodeId(), ...node } as SlideNode
}

function resolveIcon(input: CompileInput): IconName | null {
  return input.iconChoice === 'none'
    ? null
    : ((input.iconChoice as IconName | null) ??
        pickSlideIcon(input.slide.headline, input.slide.body, input.brandName))
}

export async function compileTemplate(
  variant: LayoutVariant,
  input: CompileInput,
  fonts?: Fonts
): Promise<SlideDocument> {
  const legacyFonts = fonts ?? (await loadLegacyFontSet(variant, input.fontConfig))
  const hasImage = !!input.backgroundImageUrl
  switch (variant) {
    case 'minimal':
      return hasImage ? compileImageBg('minimal', input, legacyFonts) : compileMinimal(input, legacyFonts)
    case 'accent':
      return hasImage ? compileImageBg('accent', input, legacyFonts) : compileAccentSolid(input, legacyFonts)
    case 'editorial_gradient':
      return hasImage ? compileEditorialGradient(input, legacyFonts) : compileAccentSolid(input, legacyFonts)
    case 'flat_icon_list':
      return compileFlatIconList(input, legacyFonts)
    case 'flat_mockup_card':
      return compileFlatMockupCard(input, legacyFonts)
    case 'terminal_dev':
      return compileTerminalDev(input, legacyFonts)
    case 'elegant_promo':
      return compileElegantPromo(input, legacyFonts)
    case 'news_card':
      return compileNewsCard(input, legacyFonts)
    case 'photo_editorial':
      return compilePhotoEditorial(input, legacyFonts)
  }
}

// ---------------------------------------------------------------------------
// minimal (pilot — measured flex math, unchanged behavior from the pilot PR)

async function compileMinimal(input: CompileInput, fonts: Fonts): Promise<SlideDocument> {
  const { slide, total, colors, fontConfig, textDensity, hierarchy } = input
  const body = applyTextDensity(slide.body, textDensity, false)
  const headlineFontSize = HEADLINE_FONT_SIZE[hierarchy]
  const bodySize = bodyFontSize(textDensity, hierarchy)
  const slideNumberText = `${slide.index} / ${total}`

  const numberFont = freezeFont(fontConfig.bodyFamily, 400, fonts)
  const headlineFont = freezeFont(fontConfig.headlineFamily, fontConfig.headlineWeight, fonts)
  const bodyFont = freezeFont(fontConfig.bodyFamily, fontConfig.bodyWeight, fonts)

  const [numberH, headlineH, bodyH] = await Promise.all([
    measureTextHeight(
      { text: slideNumberText, width: CONTENT_W, fontFamily: numberFont.fontFamily, fontWeight: numberFont.fontWeight, fontSize: 28 },
      fonts
    ),
    measureTextHeight(
      { text: slide.headline, width: CONTENT_W, fontFamily: headlineFont.fontFamily, fontWeight: headlineFont.fontWeight, fontSize: headlineFontSize, lineHeight: 1.15 },
      fonts
    ),
    measureTextHeight(
      { text: body, width: CONTENT_W, fontFamily: bodyFont.fontFamily, fontWeight: bodyFont.fontWeight, fontSize: bodySize, lineHeight: 1.4 },
      fonts
    ),
  ])

  const middleH = headlineH + 24 + bodyH
  const barH = 8
  const gap = (INNER_H - numberH - middleH - barH) / 2
  const headlineY = PAD + numberH + gap

  const nodes: SlideNode[] = [
    { id: createNodeId(), type: 'text', x: PAD, y: PAD, width: CONTENT_W, height: numberH, text: slideNumberText, ...numberFont, fontSize: 28, color: colors.fg, align: 'left', opacity: 0.7 },
    { id: createNodeId(), type: 'text', x: PAD, y: headlineY, width: CONTENT_W, height: headlineH, text: slide.headline, ...headlineFont, fontSize: headlineFontSize, color: colors.fg, align: 'left', lineHeight: 1.15 },
    { id: createNodeId(), type: 'text', x: PAD, y: headlineY + headlineH + 24, width: CONTENT_W, height: bodyH, text: body, ...bodyFont, fontSize: bodySize, color: colors.fg, align: 'left', lineHeight: 1.4, opacity: 0.9 },
    { id: createNodeId(), type: 'shape', x: PAD, y: CANVAS_H - PAD - barH, width: 64, height: barH, shape: 'rect', fill: { type: 'solid', color: colors.accent } },
  ]
  if (input.logoUrl) {
    nodes.push({ id: createNodeId(), type: 'image', x: CANVAS_W - 100, y: 40, width: 60, height: 60, src: input.logoUrl, fit: 'contain' })
  }
  return baseDocument({ type: 'solid', color: colors.bg }, nodes)
}

// ---------------------------------------------------------------------------
// accent (no image) — also editorial_gradient's no-photo fallback ("isAccent"
// treatment in the legacy renderer)

async function compileAccentSolid(input: CompileInput, fonts: Fonts): Promise<SlideDocument> {
  const { slide, total, colors, fontConfig, textDensity, hierarchy } = input
  const body = applyTextDensity(slide.body, textDensity, false)
  const icon = resolveIcon(input)
  const accentText = getTextColorForBackground(colors.accent)
  const pillFont = freezeFont(fontConfig.bodyFamily, 700, fonts)
  const headlineFont = freezeFont(fontConfig.headlineFamily, fontConfig.headlineWeight, fonts)
  const bodyFont = freezeFont(fontConfig.bodyFamily, fontConfig.bodyWeight, fonts)

  const p = new ProbeTree()
  const root = (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: PAD,
        fontFamily: fontConfig.bodyFamily,
        overflow: 'hidden',
      }}
    >
      {p.shape(
        { display: 'flex', alignItems: 'center', padding: '8px 20px', borderRadius: 9999 },
        { shape: 'rect', fill: { type: 'solid', color: colors.accent }, cornerRadius: 9999 },
        () =>
          p.text({ fontSize: 24, fontWeight: 700 }, `${slide.index} / ${total}`, {
            ...pillFont,
            fontSize: 24,
            color: accentText,
          })
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        {icon && (
          <div style={{ display: 'flex' }}>
            {p.icon(48, {}, { name: icon, color: input.iconColor ?? colors.accent, strokeWidth: 2 })}
          </div>
        )}
        {p.shape({ width: 120, height: 6 }, { shape: 'rect', fill: { type: 'solid', color: colors.accent } })}
        {p.text(
          { fontFamily: fontConfig.headlineFamily, fontWeight: fontConfig.headlineWeight, fontSize: HEADLINE_FONT_SIZE[hierarchy], lineHeight: 1.15 },
          slide.headline,
          { ...headlineFont, fontSize: HEADLINE_FONT_SIZE[hierarchy], lineHeight: 1.15, color: colors.fg, wrapWidth: CONTENT_W }
        )}
        {p.text(
          { fontFamily: fontConfig.bodyFamily, fontWeight: fontConfig.bodyWeight, fontSize: bodyFontSize(textDensity, hierarchy), lineHeight: 1.4 },
          body,
          { ...bodyFont, fontSize: bodyFontSize(textDensity, hierarchy), lineHeight: 1.4, color: colors.fg, opacity: 0.9, wrapWidth: CONTENT_W }
        )}
      </div>
      {p.shape({ width: 64, height: 8 }, { shape: 'rect', fill: { type: 'solid', color: colors.accent } })}
    </div>
  )
  const probed = await p.solve(root, fonts, { width: CANVAS_W, height: CANVAS_H })

  const nodes: SlideNode[] = [
    fixedNode({ type: 'shape', x: CANVAS_W + 140 - 320, y: -140, width: 320, height: 320, shape: 'ellipse', fill: { type: 'solid', color: colors.accent }, opacity: 0.15 }),
    ...probed,
  ]
  if (input.logoUrl) {
    nodes.push(fixedNode({ type: 'image', x: CANVAS_W - 100, y: 40, width: 60, height: 60, src: input.logoUrl, fit: 'contain' }))
  }
  return baseDocument({ type: 'solid', color: colors.bg }, nodes)
}

// ---------------------------------------------------------------------------
// accent/minimal WITH a background image — bottom-anchored accent block

async function compileImageBg(
  variant: 'accent' | 'minimal',
  input: CompileInput,
  fonts: Fonts
): Promise<SlideDocument> {
  const { slide, total, colors, fontConfig, textDensity, hierarchy } = input
  const isAccent = variant === 'accent'
  const body = applyTextDensity(slide.body, textDensity, true)
  const icon = isAccent ? resolveIcon(input) : null
  const accentText = getTextColorForBackground(colors.accent)
  const headlineFont = freezeFont(fontConfig.headlineFamily, fontConfig.headlineWeight, fonts)
  const bodyFont = freezeFont(fontConfig.bodyFamily, fontConfig.bodyWeight, fonts)
  const numberFont = freezeFont(fontConfig.bodyFamily, 400, fonts)
  const bodySize = imageBgBodyFontSize(textDensity, hierarchy, body.length)

  const p = new ProbeTree()
  const root = (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', fontFamily: fontConfig.bodyFamily, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: CANVAS_W,
          height: BOTTOM_BLOCK_HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: isAccent ? 24 : 20,
          padding: '48px 80px',
        }}
      >
        {isAccent && icon && (
          <div style={{ display: 'flex' }}>
            {p.icon(44, {}, { name: icon, color: accentText, strokeWidth: 2 })}
          </div>
        )}
        {isAccent &&
          p.shape({ width: 100, height: 5 }, { shape: 'rect', fill: { type: 'solid', color: accentText } })}
        {p.text(
          { fontFamily: fontConfig.headlineFamily, fontWeight: fontConfig.headlineWeight, fontSize: HEADLINE_FONT_SIZE[hierarchy], lineHeight: 1.15 },
          slide.headline,
          { ...headlineFont, fontSize: HEADLINE_FONT_SIZE[hierarchy], lineHeight: 1.15, color: accentText, wrapWidth: CONTENT_W }
        )}
        {p.text(
          { fontFamily: fontConfig.bodyFamily, fontWeight: fontConfig.bodyWeight, fontSize: bodySize, lineHeight: 1.35 },
          body,
          { ...bodyFont, fontSize: bodySize, lineHeight: 1.35, color: accentText, opacity: 0.9, wrapWidth: CONTENT_W }
        )}
        {p.text({ fontSize: 28 }, `${slide.index} / ${total}`, {
          ...numberFont,
          fontSize: 28,
          color: accentText,
          opacity: 0.7,
        })}
      </div>
    </div>
  )
  const probed = await p.solve(root, fonts, { width: CANVAS_W, height: CANVAS_H })

  const nodes: SlideNode[] = [
    fixedNode({ type: 'image', x: 0, y: 0, width: CANVAS_W, height: CANVAS_H, src: input.backgroundImageUrl!, fit: 'cover' }),
  ]
  if (input.logoUrl) {
    nodes.push(fixedNode({ type: 'image', x: CANVAS_W - 100, y: 40, width: 60, height: 60, src: input.logoUrl, fit: 'contain' }))
  }
  nodes.push(
    fixedNode({ type: 'shape', x: 0, y: CANVAS_H - BOTTOM_BLOCK_HEIGHT, width: CANVAS_W, height: BOTTOM_BLOCK_HEIGHT, shape: 'rect', fill: { type: 'solid', color: colors.accent } }),
    ...probed
  )
  return baseDocument({ type: 'solid', color: colors.bg }, nodes)
}

// ---------------------------------------------------------------------------
// editorial_gradient (with photo)

async function compileEditorialGradient(input: CompileInput, fonts: Fonts): Promise<SlideDocument> {
  const { slide, colors, fontConfig, textDensity, hierarchy } = input
  const body = applyTextDensity(slide.body, textDensity, true)
  const icon = resolveIcon(input)
  const imageText = getTextColorFromImage(input.backgroundImageUrl)
  const headlineFont = freezeFont(fontConfig.headlineFamily, fontConfig.headlineWeight, fonts)
  const bodyFont = freezeFont(fontConfig.bodyFamily, fontConfig.bodyWeight, fonts)
  // The JSX asks for Cinzel 700 but the legacy render never registers
  // Cinzel here — freeze what satori actually falls back to (see module
  // header).
  const numberFont = freezeFont('Cinzel', 700, fonts)
  const bodySize = imageBgBodyFontSize(textDensity, hierarchy, body.length)

  const p = new ProbeTree()
  const root = (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', fontFamily: fontConfig.bodyFamily, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: PAD, right: PAD, bottom: PAD, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {p.text({ fontFamily: 'Cinzel', fontWeight: 700, fontSize: 120, lineHeight: 1 }, String(slide.index), {
          ...numberFont,
          fontSize: 120,
          lineHeight: 1,
          color: imageText,
          opacity: 0.35,
        })}
        {icon && (
          <div style={{ display: 'flex' }}>
            {p.icon(44, {}, { name: icon, color: imageText, strokeWidth: 2 })}
          </div>
        )}
        {p.text(
          { fontFamily: fontConfig.headlineFamily, fontWeight: fontConfig.headlineWeight, fontSize: HEADLINE_FONT_SIZE[hierarchy], lineHeight: 1.15 },
          slide.headline,
          { ...headlineFont, fontSize: HEADLINE_FONT_SIZE[hierarchy], lineHeight: 1.15, color: imageText, wrapWidth: CONTENT_W }
        )}
        {p.text(
          { fontFamily: fontConfig.bodyFamily, fontWeight: fontConfig.bodyWeight, fontSize: bodySize, lineHeight: 1.35 },
          body,
          { ...bodyFont, fontSize: bodySize, lineHeight: 1.35, color: imageText, opacity: 0.9, wrapWidth: CONTENT_W }
        )}
      </div>
    </div>
  )
  const probed = await p.solve(root, fonts, { width: CANVAS_W, height: CANVAS_H })

  const nodes: SlideNode[] = [
    fixedNode({ type: 'image', x: 0, y: 0, width: CANVAS_W, height: CANVAS_H, src: input.backgroundImageUrl!, fit: 'cover' }),
    fixedNode({
      type: 'shape',
      x: 0,
      y: 0,
      width: CANVAS_W,
      height: CANVAS_H,
      shape: 'rect',
      fill: {
        type: 'linear-gradient',
        angle: 180,
        stops: [
          { offset: 0.4, color: 'rgba(0,0,0,0)' },
          { offset: 1, color: 'rgba(0,0,0,0.8)' },
        ],
      },
    }),
  ]
  if (input.logoUrl) {
    nodes.push(fixedNode({ type: 'image', x: CANVAS_W - 100, y: 40, width: 60, height: 60, src: input.logoUrl, fit: 'contain' }))
  }
  nodes.push(
    fixedNode({ type: 'icon', x: CANVAS_W - 40 - 32, y: CANVAS_H - 40 - 32, width: 32, height: 32, name: 'ArrowRight', color: imageText, strokeWidth: 2, opacity: 0.8 }),
    ...probed
  )
  return baseDocument({ type: 'solid', color: colors.bg }, nodes)
}

// ---------------------------------------------------------------------------
// flat_icon_list

async function compileFlatIconList(input: CompileInput, fonts: Fonts): Promise<SlideDocument> {
  const { slide, total, colors, fontConfig, textDensity, hierarchy } = input
  const body = applyTextDensity(slide.body, textDensity, false)
  const listItems = parseListItems(slide.body)
  const singleIcon = resolveIcon(input)
  const accentText = getTextColorForBackground(colors.accent)
  const pillFont = freezeFont(fontConfig.bodyFamily, 700, fonts)
  const headlineFont = freezeFont(fontConfig.headlineFamily, fontConfig.headlineWeight, fonts)
  const bodyFont = freezeFont(fontConfig.bodyFamily, fontConfig.bodyWeight, fonts)
  const bodySize = bodyFontSize(textDensity, hierarchy)

  const p = new ProbeTree()
  const root = (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '80px 80px 160px 80px',
        fontFamily: fontConfig.bodyFamily,
        overflow: 'hidden',
      }}
    >
      {p.shape(
        { display: 'flex', alignItems: 'center', padding: '8px 20px', borderRadius: 9999 },
        { shape: 'rect', fill: { type: 'solid', color: colors.accent }, cornerRadius: 9999 },
        () => p.text({ fontSize: 24, fontWeight: 700 }, `${slide.index} / ${total}`, { ...pillFont, fontSize: 24, color: accentText })
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {p.text(
          { fontFamily: fontConfig.headlineFamily, fontWeight: fontConfig.headlineWeight, fontSize: HEADLINE_FONT_SIZE[hierarchy], lineHeight: 1.15 },
          slide.headline,
          { ...headlineFont, fontSize: HEADLINE_FONT_SIZE[hierarchy], lineHeight: 1.15, color: colors.fg, wrapWidth: CONTENT_W }
        )}
        {listItems ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {listItems.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                {p.shape(
                  { display: 'flex', flexShrink: 0, width: 40, height: 40, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
                  { shape: 'ellipse', fill: { type: 'solid', color: colors.accent } },
                  () => p.text({ fontSize: 18, fontWeight: 700 }, String(i + 1), { ...pillFont, fontSize: 18, color: accentText, anchor: 'center' })
                )}
                {p.text(
                  { fontFamily: fontConfig.bodyFamily, fontWeight: fontConfig.bodyWeight, fontSize: bodySize, lineHeight: 1.4 },
                  item,
                  { ...bodyFont, fontSize: bodySize, lineHeight: 1.4, color: colors.fg, opacity: 0.9, wrapWidth: CONTENT_W - 56 }
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
            {singleIcon && (
              <div style={{ display: 'flex', flexShrink: 0 }}>
                {p.icon(56, {}, { name: singleIcon, color: colors.accent, strokeWidth: 2 })}
              </div>
            )}
            {p.text(
              { fontFamily: fontConfig.bodyFamily, fontWeight: fontConfig.bodyWeight, fontSize: bodySize, lineHeight: 1.4 },
              body,
              { ...bodyFont, fontSize: bodySize, lineHeight: 1.4, color: colors.fg, opacity: 0.9, wrapWidth: singleIcon ? CONTENT_W - 76 : CONTENT_W }
            )}
          </div>
        )}
      </div>
    </div>
  )
  const probed = await p.solve(root, fonts, { width: CANVAS_W, height: CANVAS_H })

  const nodes: SlideNode[] = [
    fixedNode({ type: 'shape', x: -220, y: -220, width: 560, height: 560, shape: 'ellipse', fill: { type: 'solid', color: colors.accent }, opacity: 0.12 }),
    ...probed,
    fixedNode({ type: 'shape', x: 40, y: CANVAS_H - 40 - 64, width: 64, height: 64, shape: 'ellipse', fill: { type: 'solid', color: colors.accent } }),
    fixedNode({ type: 'icon', x: 40 + 16, y: CANVAS_H - 40 - 64 + 16, width: 32, height: 32, name: 'CheckCircle', color: accentText, strokeWidth: 2 }),
  ]
  if (input.logoUrl) {
    nodes.push(fixedNode({ type: 'image', x: CANVAS_W - 100, y: 40, width: 60, height: 60, src: input.logoUrl, fit: 'contain' }))
  }
  return baseDocument({ type: 'solid', color: colors.bg }, nodes)
}

// ---------------------------------------------------------------------------
// flat_mockup_card

async function compileFlatMockupCard(input: CompileInput, fonts: Fonts): Promise<SlideDocument> {
  const { slide, total, colors, fontConfig, textDensity, hierarchy } = input
  const body = applyTextDensity(slide.body, textDensity, false)
  const accentText = getTextColorForBackground(colors.accent)
  const labelFont = freezeFont(fontConfig.bodyFamily, 700, fonts)
  const counterFont = freezeFont(fontConfig.bodyFamily, 600, fonts)
  const headlineFont = freezeFont(fontConfig.headlineFamily, fontConfig.headlineWeight, fonts)
  const bodyFont = freezeFont(fontConfig.bodyFamily, fontConfig.bodyWeight, fonts)
  const cardFont = freezeFont(fontConfig.bodyFamily, 600, fonts)
  const bodySize = bodyFontSize(textDensity, hierarchy)
  const label = (input.brandName ?? 'CAROUSEL').toUpperCase()
  const highlight = extractCardHighlight(slide.body, slide.headline)

  const p = new ProbeTree()
  const root = (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: PAD,
        fontFamily: fontConfig.bodyFamily,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 80 }}>
        {p.text(
          { fontSize: 20, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' },
          input.brandName ?? 'CAROUSEL',
          { ...labelFont, text: label, fontSize: 20, letterSpacing: 2, color: colors.fg, opacity: 0.6 }
        )}
        {p.text({ fontSize: 20, fontWeight: 600 }, `${slide.index} OF ${total}`, {
          ...counterFont,
          fontSize: 20,
          color: colors.fg,
          opacity: 0.5,
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {p.text(
          { fontFamily: fontConfig.headlineFamily, fontWeight: fontConfig.headlineWeight, fontSize: HEADLINE_FONT_SIZE[hierarchy], lineHeight: 1.15 },
          slide.headline,
          { ...headlineFont, fontSize: HEADLINE_FONT_SIZE[hierarchy], lineHeight: 1.15, color: colors.fg, wrapWidth: CONTENT_W }
        )}
        {p.text(
          { fontFamily: fontConfig.bodyFamily, fontWeight: fontConfig.bodyWeight, fontSize: bodySize, lineHeight: 1.4 },
          body,
          { ...bodyFont, fontSize: bodySize, lineHeight: 1.4, color: colors.fg, opacity: 0.85, wrapWidth: CONTENT_W }
        )}
        {p.shape(
          { display: 'flex', flexDirection: 'column', borderRadius: 20, padding: '32px 36px' },
          { shape: 'rect', fill: { type: 'solid', color: colors.accent }, cornerRadius: 20 },
          () => p.text({ fontFamily: fontConfig.bodyFamily, fontWeight: 600, fontSize: 26, lineHeight: 1.35 }, highlight, {
            ...cardFont,
            fontSize: 26,
            lineHeight: 1.35,
            color: accentText,
            wrapWidth: CONTENT_W - 72,
          })
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
        {p.text({ fontSize: 20, fontWeight: 600 }, 'Swipe', { ...counterFont, fontSize: 20, color: colors.fg, opacity: 0.6 })}
        {p.icon(22, {}, { name: 'ArrowRight', color: colors.fg, strokeWidth: 2, opacity: 0.6 })}
      </div>
    </div>
  )
  const probed = await p.solve(root, fonts, { width: CANVAS_W, height: CANVAS_H })

  const nodes: SlideNode[] = [...probed]
  if (input.logoUrl) {
    nodes.push(fixedNode({ type: 'image', x: CANVAS_W - 100, y: 40, width: 60, height: 60, src: input.logoUrl, fit: 'contain' }))
  }
  return baseDocument({ type: 'solid', color: colors.bg }, nodes)
}

// ---------------------------------------------------------------------------
// terminal_dev

async function compileTerminalDev(input: CompileInput, fonts: Fonts): Promise<SlideDocument> {
  const { slide, total, colors, fontConfig, textDensity, hierarchy } = input
  const body = applyTextDensity(slide.body, textDensity, false)
  const terminalLineColor = getTextColorForBackground(TERMINAL_BG)
  const terminalBorderColor =
    terminalLineColor === '#FFFFFF' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'
  const terminalHighlightColor =
    getContrastRatio(colors.accent, TERMINAL_BG) >= 3 ? colors.accent : terminalLineColor
  const terminalLines = buildTerminalLines(body)
  const paddedIndex = String(slide.index).padStart(2, '0')
  const paddedTotal = String(total).padStart(2, '0')
  const mono700 = freezeFont('JetBrains Mono', 700, fonts)
  const mono400 = freezeFont('JetBrains Mono', 400, fonts)
  const headlineFont = freezeFont(fontConfig.headlineFamily, fontConfig.headlineWeight, fonts)
  const bodyFont = freezeFont(fontConfig.bodyFamily, fontConfig.bodyWeight, fonts)
  const bodySize = bodyFontSize(textDensity, hierarchy)
  const label = (input.brandName ?? 'CAROUSEL').toUpperCase()

  const p = new ProbeTree()
  const root = (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: PAD,
        fontFamily: fontConfig.bodyFamily,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {p.text(
            { fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 20, letterSpacing: 3, textTransform: 'uppercase' },
            input.brandName ?? 'CAROUSEL',
            { ...mono700, text: label, fontSize: 20, letterSpacing: 3, color: colors.fg, opacity: 0.7 }
          )}
          {p.text({ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 20 }, `${paddedIndex} OF ${paddedTotal}`, {
            ...mono700,
            fontSize: 20,
            color: colors.fg,
            opacity: 0.6,
          })}
        </div>
        {p.shape(
          { display: 'flex', alignSelf: 'flex-start', borderRadius: 6, padding: '8px 16px' },
          { shape: 'rect', fill: { type: 'solid', color: TERMINAL_BG }, cornerRadius: 6, stroke: { color: terminalBorderColor, width: 1 } },
          () => p.text(
            { fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 18, letterSpacing: 1, textTransform: 'uppercase' },
            `Feature ${paddedIndex} / Topic`,
            { ...mono700, text: `FEATURE ${paddedIndex} / TOPIC`, fontSize: 18, letterSpacing: 1, color: terminalLineColor }
          )
        )}
        {p.text(
          { fontFamily: fontConfig.headlineFamily, fontWeight: fontConfig.headlineWeight, fontSize: HEADLINE_FONT_SIZE[hierarchy], lineHeight: 1.15 },
          slide.headline,
          { ...headlineFont, fontSize: HEADLINE_FONT_SIZE[hierarchy], lineHeight: 1.15, color: colors.fg, wrapWidth: CONTENT_W }
        )}
        {p.text(
          { fontFamily: fontConfig.bodyFamily, fontWeight: fontConfig.bodyWeight, fontSize: bodySize, lineHeight: 1.4 },
          body,
          { ...bodyFont, fontSize: bodySize, lineHeight: 1.4, color: colors.fg, opacity: 0.85, wrapWidth: CONTENT_W }
        )}
      </div>
      {p.shape(
        { display: 'flex', flexDirection: 'column', borderRadius: 16, padding: '24px 28px', gap: 18 },
        { shape: 'rect', fill: { type: 'solid', color: TERMINAL_BG }, cornerRadius: 16 },
        () => [
        <div key="chrome" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {p.shape({ width: 14, height: 14, borderRadius: 9999 }, { shape: 'ellipse', fill: { type: 'solid', color: '#ff5f56' } })}
          {p.shape({ width: 14, height: 14, borderRadius: 9999 }, { shape: 'ellipse', fill: { type: 'solid', color: '#ffbd2e' } })}
          {p.shape({ width: 14, height: 14, borderRadius: 9999 }, { shape: 'ellipse', fill: { type: 'solid', color: '#27c93f' } })}
          {p.text({ fontFamily: 'JetBrains Mono', fontSize: 16, marginLeft: 8 }, `slide-${slide.index}.ts`, {
            ...mono400,
            fontSize: 16,
            color: terminalLineColor,
            opacity: 0.55,
          })}
        </div>,
        <div key="lines" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {terminalLines.map((line, i) => {
            const isLast = i === terminalLines.length - 1
            const text = `${isLast ? '# ' : '- '}${line}`
            return (
              <React.Fragment key={i}>
                {p.text({ fontFamily: 'JetBrains Mono', fontWeight: isLast ? 700 : 400, fontSize: 22 }, text, {
                  ...(isLast ? mono700 : mono400),
                  fontSize: 22,
                  color: isLast ? terminalHighlightColor : terminalLineColor,
                  opacity: isLast ? 1 : 0.85,
                  wrapWidth: CONTENT_W - 56,
                })}
              </React.Fragment>
            )
          })}
        </div>,
        ]
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {p.text({ fontFamily: 'JetBrains Mono', fontSize: 18 }, `${paddedIndex} / ${paddedTotal}`, {
          ...mono400,
          fontSize: 18,
          color: colors.fg,
          opacity: 0.6,
        })}
        {p.text({ fontFamily: 'JetBrains Mono', fontSize: 18 }, 'SWIPE →', { ...mono400, fontSize: 18, color: colors.fg, opacity: 0.6 })}
      </div>
    </div>
  )
  const probed = await p.solve(root, fonts, { width: CANVAS_W, height: CANVAS_H })
  return baseDocument({ type: 'solid', color: colors.bg }, probed)
}

// ---------------------------------------------------------------------------
// elegant_promo

async function compileElegantPromo(input: CompileInput, fonts: Fonts): Promise<SlideDocument> {
  const { slide, total, colors, fontConfig, textDensity, hierarchy } = input
  const body = applyTextDensity(slide.body, textDensity, false)
  const promoBg = getLuminance(colors.bg) > 0.75 ? colors.bg : ELEGANT_PROMO_FALLBACK_BG
  const promoTextColor = getTextColorForBackground(promoBg)
  const promoAccentColor =
    getContrastRatio(colors.accent, promoBg) >= 3 ? colors.accent : promoTextColor
  const accentTextOnPromoAccent = getTextColorForBackground(colors.accent)
  const listItems = parseListItems(body)
  const words = slide.headline.split(' ')
  const mid = Math.max(1, Math.ceil(words.length / 2))
  const headlineLine1 = words.slice(0, mid).join(' ')
  const headlineLine2 = words.slice(mid).join(' ')
  const tagline = extractCardHighlight(body, slide.headline)
  const badgeText = `${slide.index}/${total}`
  const playfair700 = freezeFont('Playfair Display', 700, fonts)
  const playfair400 = freezeFont('Playfair Display', 400, fonts)
  const caveat700 = freezeFont('Caveat', 700, fonts)
  const body400 = freezeFont(fontConfig.bodyFamily, fontConfig.bodyWeight, fonts)
  const body700 = freezeFont(fontConfig.bodyFamily, 700, fonts)
  const bodyPlain = freezeFont(fontConfig.bodyFamily, 400, fonts)
  const bodySize = bodyFontSize(textDensity, hierarchy)
  const H = HEADLINE_FONT_SIZE[hierarchy]

  const p = new ProbeTree()
  const root = (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: PAD,
        fontFamily: fontConfig.bodyFamily,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {p.text({ fontSize: 24 }, '*', { ...bodyPlain, fontSize: 24, color: promoAccentColor })}
          {p.text(
            { fontSize: 20, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' },
            input.brandName ?? 'BRAND',
            { ...body700, text: (input.brandName ?? 'BRAND').toUpperCase(), fontSize: 20, letterSpacing: 2, color: promoTextColor, opacity: 0.7 }
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {p.text({ fontFamily: 'Playfair Display', fontWeight: 700, fontSize: H, lineHeight: 1.15 }, headlineLine1, {
            ...playfair700,
            fontSize: H,
            lineHeight: 1.15,
            color: promoTextColor,
            wrapWidth: CONTENT_W,
          })}
          {headlineLine2 &&
            p.text({ fontFamily: 'Playfair Display', fontWeight: 400, fontSize: H, lineHeight: 1.15 }, headlineLine2, {
              ...playfair400,
              fontSize: H,
              lineHeight: 1.15,
              color: promoTextColor,
              wrapWidth: CONTENT_W,
            })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {p.text({ fontSize: 20 }, '*', { ...bodyPlain, fontSize: 20, color: promoAccentColor })}
          {p.text({ fontFamily: 'Caveat', fontWeight: 700, fontSize: 44 }, tagline, {
            ...caveat700,
            fontSize: 44,
            color: promoAccentColor,
          })}
          {p.text({ fontSize: 20 }, '*', { ...bodyPlain, fontSize: 20, color: promoAccentColor })}
        </div>
        {p.text(
          { fontFamily: fontConfig.bodyFamily, fontWeight: fontConfig.bodyWeight, fontSize: bodySize, lineHeight: 1.4 },
          body,
          { ...body400, fontSize: bodySize, lineHeight: 1.4, color: promoTextColor, opacity: 0.85, wrapWidth: CONTENT_W }
        )}
        {listItems && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {listItems.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {p.shape(
                  { display: 'flex', flexShrink: 0, width: 36, height: 36, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
                  { shape: 'ellipse', fill: { type: 'solid', color: colors.accent } },
                  () => p.text({ fontSize: 16, fontWeight: 700 }, String(i + 1), { ...body700, fontSize: 16, color: accentTextOnPromoAccent, anchor: 'center' })
                )}
                {p.text({ fontSize: 24 }, item, { ...bodyPlain, fontSize: 24, color: promoTextColor, opacity: 0.85, wrapWidth: CONTENT_W - 52 })}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {p.shape(
          { display: 'flex', width: 72, height: 72, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
          { shape: 'ellipse', fill: { type: 'solid', color: colors.accent }, stroke: { color: promoBg, width: 3 } },
          () => p.text({ fontSize: 16, fontWeight: 700 }, badgeText, { ...body700, fontSize: 16, color: accentTextOnPromoAccent, anchor: 'center' })
        )}
        {p.text({ fontSize: 20, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }, 'TAP TO JOIN →', {
          ...body700,
          fontSize: 20,
          letterSpacing: 2,
          color: promoAccentColor,
        })}
      </div>
    </div>
  )
  const probed = await p.solve(root, fonts, { width: CANVAS_W, height: CANVAS_H })

  const nodes: SlideNode[] = [
    fixedNode({ type: 'shape', x: -120, y: -120, width: 300, height: 300, shape: 'ellipse', fill: { type: 'solid', color: colors.accent }, opacity: 0.15 }),
    fixedNode({ type: 'shape', x: CANVAS_W + 160 - 380, y: CANVAS_H + 160 - 380, width: 380, height: 380, shape: 'ellipse', fill: { type: 'solid', color: colors.accent }, opacity: 0.12 }),
    ...probed,
  ]
  return baseDocument({ type: 'solid', color: promoBg }, nodes)
}

// ---------------------------------------------------------------------------
// news_card

async function compileNewsCard(input: CompileInput, fonts: Fonts): Promise<SlideDocument> {
  const { slide, total, colors, fontConfig, textDensity, hierarchy } = input
  const hasImage = !!input.backgroundImageUrl
  const body = applyTextDensity(slide.body, textDensity, false)
  const imageText = getTextColorFromImage(input.backgroundImageUrl)
  const boxText = getTextColorForBackground(colors.accent)
  const logoInitial = (input.brandName ?? 'C').trim().charAt(0).toUpperCase() || 'C'
  const subHeadline = extractCardHighlight(body, slide.headline)
  const headlineFont = freezeFont(fontConfig.headlineFamily, fontConfig.headlineWeight, fonts)
  const body500 = freezeFont(fontConfig.bodyFamily, 500, fonts)
  const body600 = freezeFont(fontConfig.bodyFamily, 600, fonts)
  const body700 = freezeFont(fontConfig.bodyFamily, 700, fonts)
  const bodyPlain = freezeFont(fontConfig.bodyFamily, 400, fonts)
  const headlineSize = Math.round(HEADLINE_FONT_SIZE[hierarchy] * 0.8)

  const p = new ProbeTree()
  const root = (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', fontFamily: fontConfig.bodyFamily, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '48%', right: 32, display: 'flex' }}>
        {p.text({ fontSize: 40 }, '›', { ...bodyPlain, fontSize: 40, color: imageText, opacity: 0.6 })}
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, bottom: 96, display: 'flex' }}>
        {p.shape(
          { position: 'absolute', top: 12, left: 12, width: 952, height: 240, borderRadius: 4 },
          { shape: 'rect', fill: { type: 'solid', color: 'rgba(255,255,255,0.85)' }, cornerRadius: 4 }
        )}
        {p.shape(
          { position: 'relative', display: 'flex', flexDirection: 'column', padding: '40px 40px 32px 40px', gap: 16, borderRadius: 4, width: '100%' },
          { shape: 'rect', fill: { type: 'solid', color: colors.accent }, cornerRadius: 4 },
          () => [
          p.shape(
            { position: 'absolute', top: -26, left: 24, display: 'flex', width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
            { shape: 'rect', fill: { type: 'solid', color: colors.bg }, cornerRadius: 4 },
            () => p.text({ fontSize: 24, fontWeight: 700 }, logoInitial, {
              ...body700,
              fontSize: 24,
              color: getTextColorForBackground(colors.bg),
              anchor: 'center',
            })
          ),
          p.text(
            { display: 'flex', marginTop: 20, fontFamily: fontConfig.headlineFamily, fontWeight: fontConfig.headlineWeight, fontSize: headlineSize, lineHeight: 1.1, textTransform: 'uppercase' },
            slide.headline,
            { ...headlineFont, text: slide.headline.toUpperCase(), fontSize: headlineSize, lineHeight: 1.1, color: boxText, wrapWidth: 952 - 80 }
          ),
          p.text({ fontFamily: fontConfig.bodyFamily, fontWeight: 500, fontSize: 26, lineHeight: 1.35 }, subHeadline, {
            ...body500,
            fontSize: 26,
            lineHeight: 1.35,
            color: boxText,
            opacity: 0.9,
            wrapWidth: 952 - 80,
          }),
          ]
        )}
      </div>
      <div style={{ position: 'absolute', left: 64, bottom: 40, display: 'flex', alignItems: 'center', gap: 12 }}>
        {input.logoUrl ? (
          p.image(36, 36, {}, { src: input.logoUrl, fit: 'contain' })
        ) : (
          p.shape(
            { display: 'flex', width: 36, height: 36, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
            { shape: 'ellipse', fill: { type: 'solid', color: imageText } },
            () => p.text({ fontSize: 16, fontWeight: 700 }, logoInitial, {
              ...body700,
              fontSize: 16,
              color: getTextColorForBackground(imageText),
              anchor: 'center',
            })
          )
        )}
        {p.text({ fontSize: 20, fontWeight: 600 }, input.brandName ?? 'CAROUSEL', {
          ...body600,
          fontSize: 20,
          color: imageText,
          opacity: 0.85,
        })}
      </div>
      <div style={{ position: 'absolute', right: 64, bottom: 40, display: 'flex' }}>
        {p.text({ fontSize: 20, fontWeight: 600 }, `${slide.index} / ${total}`, {
          ...body600,
          fontSize: 20,
          color: imageText,
          opacity: 0.85,
        })}
      </div>
    </div>
  )
  const probed = await p.solve(root, fonts, { width: CANVAS_W, height: CANVAS_H })

  const nodes: SlideNode[] = []
  if (hasImage) {
    nodes.push(
      fixedNode({ type: 'image', x: 0, y: 0, width: CANVAS_W, height: CANVAS_H, src: input.backgroundImageUrl!, fit: 'cover' }),
      fixedNode({
        type: 'shape',
        x: 0,
        y: 0,
        width: CANVAS_W,
        height: CANVAS_H,
        shape: 'rect',
        fill: {
          type: 'linear-gradient',
          angle: 180,
          stops: [
            { offset: 0, color: 'rgba(0,0,0,0.2)' },
            { offset: 0.35, color: 'rgba(0,0,0,0.05)' },
            { offset: 1, color: 'rgba(0,0,0,0.7)' },
          ],
        },
      })
    )
  } else {
    nodes.push(
      fixedNode({
        type: 'shape',
        x: 0,
        y: 0,
        width: CANVAS_W,
        height: CANVAS_H,
        shape: 'rect',
        fill: {
          type: 'linear-gradient',
          angle: 160,
          stops: [
            { offset: 0, color: NEWS_CARD_FALLBACK_BG },
            { offset: 1, color: '#1f2937' },
          ],
        },
      })
    )
  }
  nodes.push(...probed)
  return baseDocument({ type: 'solid', color: NEWS_CARD_FALLBACK_BG }, nodes)
}

// ---------------------------------------------------------------------------
// photo_editorial

async function compilePhotoEditorial(input: CompileInput, fonts: Fonts): Promise<SlideDocument> {
  const { slide, colors, fontConfig, textDensity, hierarchy } = input
  const hasImage = !!input.backgroundImageUrl
  const body = applyTextDensity(slide.body, textDensity, false)
  const imageText = getTextColorFromImage(input.backgroundImageUrl)
  const alignRight = slide.index % 2 === 0
  const headlineFont = freezeFont(fontConfig.headlineFamily, fontConfig.headlineWeight, fonts)
  const numberFont = freezeFont(fontConfig.headlineFamily, 400, fonts)
  const bodyFont = freezeFont(fontConfig.bodyFamily, fontConfig.bodyWeight, fonts)
  const bodySize = bodyFontSize(textDensity, hierarchy) * 0.75
  const anchor = alignRight ? ('right' as const) : ('left' as const)

  const p = new ProbeTree()
  const root = (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', fontFamily: fontConfig.bodyFamily, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          top: 64,
          [alignRight ? 'right' : 'left']: 64,
          width: 640,
          display: 'flex',
          flexDirection: 'column',
          alignItems: alignRight ? 'flex-end' : 'flex-start',
        }}
      >
        {p.text(
          { fontFamily: fontConfig.headlineFamily, fontWeight: 400, fontSize: 220, lineHeight: 1, marginBottom: -36 },
          String(slide.index),
          { ...numberFont, fontSize: 220, lineHeight: 1, color: imageText, opacity: 0.4 }
        )}
        {p.text(
          {
            fontFamily: fontConfig.headlineFamily,
            fontWeight: fontConfig.headlineWeight,
            fontSize: HEADLINE_FONT_SIZE[hierarchy],
            lineHeight: 1.1,
            textAlign: alignRight ? 'right' : 'left',
          },
          slide.headline,
          { ...headlineFont, fontSize: HEADLINE_FONT_SIZE[hierarchy], lineHeight: 1.1, color: imageText, wrapWidth: 640, anchor }
        )}
        <div style={{ display: 'flex', flexDirection: alignRight ? 'row-reverse' : 'row', gap: 16, marginTop: 20 }}>
          {p.shape({ display: 'flex', flexShrink: 0, width: 4 }, { shape: 'rect', fill: { type: 'solid', color: colors.accent } })}
          {p.text(
            {
              fontFamily: fontConfig.bodyFamily,
              fontWeight: fontConfig.bodyWeight,
              fontSize: bodySize,
              lineHeight: 1.4,
              textAlign: alignRight ? 'right' : 'left',
            },
            body,
            { ...bodyFont, fontSize: bodySize, lineHeight: 1.4, color: imageText, opacity: 0.9, wrapWidth: 620, anchor }
          )}
        </div>
      </div>
    </div>
  )
  const probed = await p.solve(root, fonts, { width: CANVAS_W, height: CANVAS_H })

  const nodes: SlideNode[] = []
  if (hasImage) {
    nodes.push(fixedNode({ type: 'image', x: 0, y: 0, width: CANVAS_W, height: CANVAS_H, src: input.backgroundImageUrl!, fit: 'cover' }))
  } else {
    nodes.push(
      fixedNode({
        type: 'shape',
        x: 0,
        y: 0,
        width: CANVAS_W,
        height: CANVAS_H,
        shape: 'rect',
        fill: {
          type: 'linear-gradient',
          angle: 160,
          stops: [
            { offset: 0, color: NEWS_CARD_FALLBACK_BG },
            { offset: 1, color: '#1f2937' },
          ],
        },
      })
    )
  }
  nodes.push(
    fixedNode({
      type: 'shape',
      x: 0,
      y: 0,
      width: CANVAS_W,
      height: 580,
      shape: 'rect',
      fill: {
        type: 'linear-gradient',
        angle: 180,
        stops: [
          { offset: 0, color: 'rgba(0,0,0,0.7)' },
          { offset: 0.65, color: 'rgba(0,0,0,0.45)' },
          { offset: 1, color: 'rgba(0,0,0,0)' },
        ],
      },
    }),
    ...probed
  )
  return baseDocument({ type: 'solid', color: NEWS_CARD_FALLBACK_BG }, nodes)
}
