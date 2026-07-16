// Compile-time text measurement for the template compiler (phase 2).
//
// The compiler produces absolute-positioned nodes, so it must know the
// layout height of every wrapping text block up front — and that height
// depends on line breaking, which is the exact risk (R1 in AUDIT.md)
// that sank naive approaches: any re-implementation of line breaking
// (font-metrics math, a different satori version installed standalone)
// can disagree with the satori bundled inside next/og that actually
// renders the slides, producing "editor says 3 lines, export renders 4".
//
// This module sidesteps R1 by construction: it measures by rendering
// through the SAME next/og ImageResponse pipeline used for output. The
// text block is laid out (painted background-on-background, invisible
// but fully layouted) in a flex column with a white 4px marker bar
// immediately below it on a black canvas; the marker's pixel row — found
// by scanning the raw pixels with sharp (existing prod dependency) — IS
// the block's layout height as the production line breaker computed it.
// No third-party line breaker, no version drift, no new dependencies.
//
// Cost: one small ImageResponse render per unique (text, style, width)
// — roughly the same order as rendering one extra slide per text node.
// Cached process-wide since the same headline/body is typically measured
// once and rendered many times (previews, regenerates).
import React from 'react'
import sharp from 'sharp'
import { ImageResponse } from 'next/og'
import type { loadFontsForBrand } from '@/lib/slide-renderer'

type Fonts = Awaited<ReturnType<typeof loadFontsForBrand>>

export interface TextMeasureSpec {
  text: string
  width: number // layout width the text will wrap inside, px
  fontFamily: string
  fontWeight: number
  fontSize: number
  // undefined = satori's font-derived "normal" line height — pass through
  // rather than defaulting to a number, so measurement matches templates
  // that don't set lineHeight (e.g. the minimal slide-number text).
  lineHeight?: number
  letterSpacing?: number
}

const MEASURE_CANVAS_HEIGHT = 2704 // tall enough for any plausible block
const MARKER_HEIGHT = 4

const cache = new Map<string, number>()

function cacheKey(spec: TextMeasureSpec): string {
  return JSON.stringify(spec)
}

export async function measureTextHeight(spec: TextMeasureSpec, fonts: Fonts): Promise<number> {
  const key = cacheKey(spec)
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const canvasWidth = Math.max(8, Math.ceil(spec.width))
  const content = React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        width: '100%',
        height: '100%',
        backgroundColor: '#000000',
      },
    },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          width: spec.width,
          color: '#000000',
          fontFamily: spec.fontFamily,
          fontWeight: spec.fontWeight,
          fontSize: spec.fontSize,
          ...(spec.lineHeight !== undefined ? { lineHeight: spec.lineHeight } : {}),
          ...(spec.letterSpacing !== undefined ? { letterSpacing: spec.letterSpacing } : {}),
        },
      },
      spec.text
    ),
    React.createElement('div', {
      style: {
        display: 'flex',
        width: 8,
        height: MARKER_HEIGHT,
        backgroundColor: '#ffffff',
      },
    })
  )

  const image = new ImageResponse(content, {
    width: canvasWidth,
    height: MEASURE_CANVAS_HEIGHT,
    fonts,
  })
  const png = Buffer.from(await image.arrayBuffer())

  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  // The marker is the only white ink on a black canvas — the first row
  // containing a bright pixel is exactly the text block's layout height.
  const rowStride = info.width * info.channels
  for (let y = 0; y < info.height; y++) {
    const row = y * rowStride
    for (let x = 0; x < info.width; x++) {
      if (data[row + x * info.channels] > 200) {
        cache.set(key, y)
        return y
      }
    }
  }
  throw new Error(
    `measureTextHeight: marker not found — text block taller than ${MEASURE_CANVAS_HEIGHT}px? ` +
      `(${spec.text.length} chars @ ${spec.fontSize}px in ${spec.width}px)`
  )
}
