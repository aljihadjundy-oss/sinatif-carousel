// Phase-2 template compiler: turns a (template, slide content, resolved
// design) triple into a SlideDocument — the same visual output
// lib/slide-renderer.tsx produces for that input, but as data (frozen
// absolute positions, frozen final colors) instead of a JSX branch.
//
// Colors are FINAL at compile time (AUDIT.md debt #5): every contrast
// decision lib/contrast.ts makes at render time in the legacy path is
// made here instead and stored on the node, so a future editor and the
// renderDocument() exporter can't disagree about what color anything is.
//
// Text heights come from measureTextHeight() — the production satori
// line breaker itself (see lib/measure-text.ts for why nothing else is
// trustworthy here) — which is what lets flow layouts (flex column,
// space-between) be re-expressed as absolute positions without guessing.
//
// Pilot scope: `minimal` only (AUDIT.md phase-2 plan: one template must
// prove pixel parity against its phase-0 baselines before the other 8
// are attempted). Other variants throw.
import {
  FontConfig,
  Hierarchy,
  HEADLINE_FONT_SIZE,
  LayoutVariant,
  Slide,
  TextDensity,
  applyTextDensity,
  bodyFontSize,
  loadFontsForBrand,
} from '@/lib/slide-renderer'
import { measureTextHeight } from '@/lib/measure-text'
import {
  SLIDE_DOCUMENT_VERSION,
  SlideDocument,
  SlideNode,
  createNodeId,
} from '@/lib/slideDocument'
import { IconName } from '@/lib/icons'

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

// Shared canvas geometry (matches the legacy renderer's fixed values).
const CANVAS_W = 1080
const CANVAS_H = 1350
const PAD = 80
const CONTENT_W = CANVAS_W - PAD * 2 // 920
const INNER_H = CANVAS_H - PAD * 2 // 1190

export async function compileTemplate(
  variant: LayoutVariant,
  input: CompileInput,
  fonts: Fonts
): Promise<SlideDocument> {
  switch (variant) {
    case 'minimal':
      return compileMinimal(input, fonts)
    default:
      throw new Error(
        `compileTemplate: variant "${variant}" is not compiled yet (phase-2 pilot covers 'minimal' only)`
      )
  }
}

// Legacy source of truth: the final (non-accent) branch of renderSlide()
// in lib/slide-renderer.tsx — a padded flex column, justify-content:
// space-between, with 3 children: slide-number text, the headline+body
// stack (gap 24), and a 64x8 accent bar. space-between with three
// children puts equal free space between neighbors: gap = (innerH - h1 -
// h2 - h3) / 2, so every y below is exact once the text heights are
// measured.
async function compileMinimal(input: CompileInput, fonts: Fonts): Promise<SlideDocument> {
  if (input.backgroundImageUrl) {
    // minimal WITH a background image takes the legacy renderer's
    // image-background branch (bottom-anchored block over the photo) —
    // a different layout entirely, compiled in the full rollout, not
    // the pilot.
    throw new Error(
      'compileTemplate(minimal): background-image treatment is not part of the pilot'
    )
  }

  const { slide, total, colors, fontConfig, textDensity, hierarchy } = input
  const body = applyTextDensity(slide.body, textDensity, false)
  const headlineFontSize = HEADLINE_FONT_SIZE[hierarchy]
  const bodySize = bodyFontSize(textDensity, hierarchy)
  const slideNumberText = `${slide.index} / ${total}`

  const [numberH, headlineH, bodyH] = await Promise.all([
    measureTextHeight(
      {
        text: slideNumberText,
        width: CONTENT_W,
        fontFamily: fontConfig.bodyFamily,
        // The legacy slide-number div inherits the container's default
        // (normal = 400) weight and natural line height — neither is set
        // explicitly there, so neither is overridden here.
        fontWeight: 400,
        fontSize: 28,
      },
      fonts
    ),
    measureTextHeight(
      {
        text: slide.headline,
        width: CONTENT_W,
        fontFamily: fontConfig.headlineFamily,
        fontWeight: fontConfig.headlineWeight,
        fontSize: headlineFontSize,
        lineHeight: 1.15,
      },
      fonts
    ),
    measureTextHeight(
      {
        text: body,
        width: CONTENT_W,
        fontFamily: fontConfig.bodyFamily,
        fontWeight: fontConfig.bodyWeight,
        fontSize: bodySize,
        lineHeight: 1.4,
      },
      fonts
    ),
  ])

  const middleH = headlineH + 24 + bodyH
  const barH = 8
  const gap = (INNER_H - numberH - middleH - barH) / 2

  const numberY = PAD
  const headlineY = PAD + numberH + gap
  const bodyY = headlineY + headlineH + 24
  const barY = CANVAS_H - PAD - barH

  const nodes: SlideNode[] = [
    {
      id: createNodeId(),
      type: 'text',
      x: PAD,
      y: numberY,
      width: CONTENT_W,
      height: numberH,
      text: slideNumberText,
      fontFamily: fontConfig.bodyFamily,
      fontWeight: 400,
      fontSize: 28,
      color: colors.fg,
      align: 'left',
      opacity: 0.7,
    },
    {
      id: createNodeId(),
      type: 'text',
      x: PAD,
      y: headlineY,
      width: CONTENT_W,
      height: headlineH,
      text: slide.headline,
      fontFamily: fontConfig.headlineFamily,
      fontWeight: fontConfig.headlineWeight,
      fontSize: headlineFontSize,
      color: colors.fg,
      align: 'left',
      lineHeight: 1.15,
    },
    {
      id: createNodeId(),
      type: 'text',
      x: PAD,
      y: bodyY,
      width: CONTENT_W,
      height: bodyH,
      text: body,
      fontFamily: fontConfig.bodyFamily,
      fontWeight: fontConfig.bodyWeight,
      fontSize: bodySize,
      color: colors.fg,
      align: 'left',
      lineHeight: 1.4,
      opacity: 0.9,
    },
    {
      id: createNodeId(),
      type: 'shape',
      x: PAD,
      y: barY,
      width: 64,
      height: barH,
      shape: 'rect',
      fill: { type: 'solid', color: colors.accent },
    },
  ]

  if (input.logoUrl) {
    nodes.push({
      id: createNodeId(),
      type: 'image',
      x: CANVAS_W - 40 - 60,
      y: 40,
      width: 60,
      height: 60,
      src: input.logoUrl,
      fit: 'contain',
    })
  }

  return {
    version: SLIDE_DOCUMENT_VERSION,
    id: crypto.randomUUID(),
    canvas: {
      width: CANVAS_W,
      height: CANVAS_H,
      background: { type: 'solid', color: colors.bg },
    },
    nodes,
    manuallyEdited: false,
  }
}
