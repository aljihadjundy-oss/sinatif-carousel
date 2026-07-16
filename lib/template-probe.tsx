// Probe-render layout extraction for the phase-2 template compiler.
//
// The pilot ('minimal') proved parity by measuring each text block and
// re-doing the flex math by hand — workable for a 3-child space-between
// column, but the remaining templates have nested rows, center/baseline
// alignment, shrink-to-fit pills, row-reverse, negative margins… hand-
// emulating satori's flexbox for all of that is exactly the kind of
// "re-implement the layout engine and hope" approach risk R1 warns
// about. So the rollout uses the opposite trick, same spirit as
// lib/measure-text.ts: let the PRODUCTION layout engine compute every
// position, then read the answers off the pixels.
//
// How: each template is transcribed once as a "probe tree" — the exact
// same element structure and layout styles as its legacy JSX branch, but
// every leaf that will become a SlideNode is painted in a unique flat
// probe color (text painted in its own probe color on a same-color
// container box, so glyph layout is identical but the box reads as one
// solid rect), all real colors/photos stripped. One ImageResponse render
// of that tree + one sharp pixel scan yields the exact border-box rect
// satori gave every leaf — fractional flex gaps, centered pills,
// baseline rows and all. The compiler then emits SlideNodes with those
// rects and the FINAL colors (contrast decisions frozen at compile time,
// AUDIT.md debt #5). Costs one extra hidden render per slide compile.
//
// Probe color uniqueness: the red channel encodes the leaf index 1:1
// (8 + i), so two leaves can never share a color; green/blue vary too so
// anti-aliased blends against the black canvas are vanishingly unlikely
// to land exactly on another leaf's triple. Scan matches exact RGB only.
import React from 'react'
import sharp from 'sharp'
import { ImageResponse } from 'next/og'
import { loadFontsForBrand } from '@/lib/slide-renderer'
import { Fill, SlideNode, createNodeId } from '@/lib/slideDocument'

type Fonts = Awaited<ReturnType<typeof loadFontsForBrand>>

export interface ProbeRect {
  x: number
  y: number
  width: number
  height: number
}

interface TextLeafFinal {
  kind: 'text'
  text: string
  fontFamily: string
  fontWeight: 400 | 500 | 600 | 700 | 800 | 900
  fontSize: number
  color: string
  opacity?: number
  lineHeight?: number
  letterSpacing?: number
  // How to turn the probed rect into the node's x/width:
  // - 'shrink'  (default): use the probed rect as-is, align left. For
  //   single-line shrink-to-fit text (counters, labels, pill numbers) —
  //   overflow doesn't clip, so an exact-width box repaints identically.
  // - {wrapWidth}: multi-line text that wrapped inside a known content
  //   width — keep the probed y/height but use the full wrap width so
  //   renderDocument re-wraps at the same boundary (a shrunk bbox can sit
  //   exactly on a line break and re-break differently).
  // - anchor 'right'/'center': keep wrapWidth but anchor x so the text's
  //   right edge / center matches the probed rect (row-reverse and
  //   centered layouts).
  wrapWidth?: number
  anchor?: 'left' | 'right' | 'center'
}

interface ShapeLeafFinal {
  kind: 'shape'
  shape: 'rect' | 'ellipse' | 'line'
  fill: Fill
  opacity?: number
  cornerRadius?: number
  stroke?: { color: string; width: number }
}

interface IconLeafFinal {
  kind: 'icon'
  name: string
  color: string
  strokeWidth?: number
  opacity?: number
}

interface ImageLeafFinal {
  kind: 'image'
  src: string
  fit: 'cover' | 'contain'
  opacity?: number
}

type LeafFinal = TextLeafFinal | ShapeLeafFinal | IconLeafFinal | ImageLeafFinal

export class ProbeTree {
  private leaves: LeafFinal[] = []

  private probeColor(i: number): string {
    const r = 8 + i // 1:1 with leaf index — collision-free by construction
    const g = 200 - ((i * 7) % 160)
    const b = 40 + ((i * 13) % 180)
    return `rgb(${r},${g},${b})`
  }

  private register(leaf: LeafFinal): { color: string; index: number } {
    const index = this.leaves.length
    this.leaves.push(leaf)
    return { color: this.probeColor(index), index }
  }

  // A text leaf: probe element preserves every layout-affecting style
  // (font, size, weight, line-height, letter-spacing, transform) and
  // paints both box and glyphs in the probe color.
  text(
    style: React.CSSProperties,
    text: string,
    final: Omit<TextLeafFinal, 'kind' | 'text'> & { text?: string }
  ): React.ReactElement {
    const { color } = this.register({ kind: 'text', text: final.text ?? text, ...final })
    return (
      <div style={{ display: 'flex', ...style, backgroundColor: color, color }}>{text}</div>
    )
  }

  // A shape leaf (decorative rect/circle/bar/pill/card background).
  // Children (e.g. the text inside a pill) paint over the shape probe —
  // its bbox stays exact because padding keeps the edges visible. Probe
  // keeps the layout styles; strokes keep their width (layout-affecting
  // for border-box edges) but are recolored to the probe color.
  // Children are passed as a FACTORY, not evaluated JSX: plain arguments
  // would register their leaves before the shape itself (JS evaluates
  // arguments first), putting the container AFTER its contents in
  // z-order — the compiled shape would paint over its own text. Found
  // the hard way: pill numbers were silently hidden (small enough to
  // sneak under the diff threshold) while card/terminal text made the
  // parity tests fail loudly.
  shape(
    style: React.CSSProperties,
    final: Omit<ShapeLeafFinal, 'kind'>,
    childrenFactory?: () => React.ReactNode
  ): React.ReactElement {
    const { color } = this.register({ kind: 'shape', ...final })
    const children = childrenFactory ? childrenFactory() : undefined
    const probeStyle: React.CSSProperties = {
      display: 'flex',
      ...style,
      backgroundColor: color,
      opacity: 1, // low-opacity decorations must scan as solid probe ink
    }
    if (final.stroke) probeStyle.border = `${final.stroke.width}px solid ${color}`
    return <div style={probeStyle}>{children}</div>
  }

  // An icon leaf: legacy renders an SVG of size x size; the probe stands
  // in a solid div of the same footprint (identical layout).
  icon(
    size: number,
    style: React.CSSProperties,
    final: Omit<IconLeafFinal, 'kind'>
  ): React.ReactElement {
    const { color } = this.register({ kind: 'icon', ...final })
    return (
      <div style={{ display: 'flex', ...style, width: size, height: size, backgroundColor: color, opacity: 1 }} />
    )
  }

  // An image leaf (logo etc.): probe stands in a solid div with the same
  // width/height footprint.
  image(
    width: number,
    height: number,
    style: React.CSSProperties,
    final: Omit<ImageLeafFinal, 'kind'>
  ): React.ReactElement {
    const { color } = this.register({ kind: 'image', ...final })
    return <div style={{ display: 'flex', ...style, width, height, backgroundColor: color }} />
  }

  // Renders the probe tree through the production pipeline, scans for
  // every leaf's exact border-box rect, and assembles the final
  // SlideNodes in registration (z-) order.
  async solve(
    root: React.ReactElement,
    fonts: Fonts,
    canvas: { width: number; height: number }
  ): Promise<SlideNode[]> {
    const image = new ImageResponse(
      <div
        style={{
          position: 'relative',
          display: 'flex',
          width: '100%',
          height: '100%',
          backgroundColor: '#000000',
          overflow: 'hidden',
        }}
      >
        {root}
      </div>,
      { width: canvas.width, height: canvas.height, fonts }
    )
    const png = Buffer.from(await image.arrayBuffer())
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })

    const boxes = new Map<number, { x1: number; y1: number; x2: number; y2: number }>()
    const expected = new Map<string, number>()
    this.leaves.forEach((_, i) => {
      const [r, g, b] = this.probeColor(i)
        .slice(4, -1)
        .split(',')
        .map((v) => parseInt(v, 10))
      expected.set(`${r},${g},${b}`, i)
    })

    const ch = info.channels
    for (let y = 0; y < info.height; y++) {
      const row = y * info.width * ch
      for (let x = 0; x < info.width; x++) {
        const p = row + x * ch
        const idx = expected.get(`${data[p]},${data[p + 1]},${data[p + 2]}`)
        if (idx === undefined) continue
        const box = boxes.get(idx)
        if (!box) boxes.set(idx, { x1: x, y1: y, x2: x, y2: y })
        else {
          if (x < box.x1) box.x1 = x
          if (x > box.x2) box.x2 = x
          if (y < box.y1) box.y1 = y
          if (y > box.y2) box.y2 = y
        }
      }
    }

    return this.leaves.map((leaf, i) => {
      const box = boxes.get(i)
      if (!box) {
        throw new Error(
          `template-probe: leaf ${i} (${leaf.kind}${leaf.kind === 'text' ? `: "${leaf.text.slice(0, 30)}"` : ''}) not found in probe render — fully occluded or zero-size?`
        )
      }
      const rect: ProbeRect = {
        x: box.x1,
        y: box.y1,
        width: box.x2 - box.x1 + 1,
        height: box.y2 - box.y1 + 1,
      }
      return leafToNode(leaf, rect)
    })
  }
}

function leafToNode(leaf: LeafFinal, rect: ProbeRect): SlideNode {
  const base = { id: createNodeId(), x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  switch (leaf.kind) {
    case 'text': {
      const width = leaf.wrapWidth ?? rect.width
      const x =
        leaf.anchor === 'right'
          ? rect.x + rect.width - width
          : leaf.anchor === 'center'
            ? rect.x + (rect.width - width) / 2
            : rect.x
      return {
        ...base,
        x,
        width,
        type: 'text',
        text: leaf.text,
        fontFamily: leaf.fontFamily,
        fontWeight: leaf.fontWeight,
        fontSize: leaf.fontSize,
        color: leaf.color,
        align: leaf.anchor ?? 'left',
        ...(leaf.lineHeight !== undefined ? { lineHeight: leaf.lineHeight } : {}),
        ...(leaf.letterSpacing !== undefined ? { letterSpacing: leaf.letterSpacing } : {}),
        ...(leaf.opacity !== undefined ? { opacity: leaf.opacity } : {}),
      }
    }
    case 'shape':
      return {
        ...base,
        type: 'shape',
        shape: leaf.shape,
        fill: leaf.fill,
        ...(leaf.cornerRadius !== undefined ? { cornerRadius: leaf.cornerRadius } : {}),
        ...(leaf.stroke !== undefined ? { stroke: leaf.stroke } : {}),
        ...(leaf.opacity !== undefined ? { opacity: leaf.opacity } : {}),
      }
    case 'icon':
      return {
        ...base,
        type: 'icon',
        name: leaf.name,
        color: leaf.color,
        ...(leaf.strokeWidth !== undefined ? { strokeWidth: leaf.strokeWidth } : {}),
        ...(leaf.opacity !== undefined ? { opacity: leaf.opacity } : {}),
      }
    case 'image':
      return {
        ...base,
        type: 'image',
        src: leaf.src,
        fit: leaf.fit,
        ...(leaf.opacity !== undefined ? { opacity: leaf.opacity } : {}),
      }
  }
}
