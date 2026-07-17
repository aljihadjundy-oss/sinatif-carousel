import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  ImageFill,
  SLIDE_DOCUMENT_VERSION,
  SlideDocument,
  imageFillLayerStyle,
  isSlideDocument,
} from '@/lib/slideDocument'
import { renderDocument } from '@/lib/render-document'

describe('imageFillLayerStyle', () => {
  const canvas = { width: 1080, height: 1350 }

  it('neutral fill has no transform (pre-existing documents render unchanged)', () => {
    const style = imageFillLayerStyle({ type: 'image', src: 'x', fit: 'cover' }, canvas)
    expect(style.transform).toBeUndefined()
    expect(style.objectFit).toBe('cover')
    expect(style.width).toBe(1080)
  })

  it('pan/zoom produce a center-origin translate+scale', () => {
    const fill: ImageFill = { type: 'image', src: 'x', fit: 'cover', scale: 1.5, offsetX: 100, offsetY: -50 }
    const style = imageFillLayerStyle(fill, canvas)
    expect(style.transform).toBe('translate(100px, -50px) scale(1.5)')
    expect(style.transformOrigin).toBe('center')
  })
})

describe('ImageFill validation with adjust fields', () => {
  function docWithBackground(background: ImageFill): SlideDocument {
    return {
      version: SLIDE_DOCUMENT_VERSION,
      id: crypto.randomUUID(),
      canvas: { width: 1080, height: 1350, background },
      nodes: [],
    }
  }

  it('accepts documents with scale/offsetX/offsetY', () => {
    expect(
      isSlideDocument(
        docWithBackground({ type: 'image', src: 'https://x/y.jpg', fit: 'cover', scale: 2, offsetX: 10, offsetY: -20 })
      )
    ).toBe(true)
  })

  it('accepts documents without them (backward compatible)', () => {
    expect(isSlideDocument(docWithBackground({ type: 'image', src: 'https://x/y.jpg', fit: 'cover' }))).toBe(true)
  })

  it('rejects non-numeric adjust values', () => {
    expect(
      isSlideDocument(
        docWithBackground({ type: 'image', src: 'https://x/y.jpg', fit: 'cover', scale: 'big' } as unknown as ImageFill)
      )
    ).toBe(false)
  })
})

// Export parity at the pixel level: the exporter must actually move the
// image when offsets change. Uses a data-URI image (no network): left
// half red, right half blue. Panning right by 300px must change which
// color dominates a fixed probe region.
describe('renderDocument background pan/zoom', () => {
  // Probe a region in the left quarter of the image, sized relative to
  // the PNG's ACTUAL dimensions (ImageResponse may not export at exactly
  // the canvas size).
  async function probeLeftQuarter(png: Buffer) {
    const meta = await sharp(png).metadata()
    const w = meta.width ?? 1080
    const h = meta.height ?? 1350
    // sharp's .stats() computes over the INPUT image, ignoring a chained
    // .extract() — the crop must be materialized to a buffer first.
    const region = await sharp(png)
      .extract({
        left: Math.round(w * 0.05),
        top: Math.round(h * 0.4),
        width: Math.round(w * 0.15),
        height: Math.round(h * 0.2),
      })
      .toBuffer()
    const stats = await sharp(region).stats()
    return { r: stats.channels[0].mean, b: stats.channels[2].mean }
  }

  async function makeSrc(): Promise<string> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
      <rect width="540" height="1350" fill="#ff0000"/>
      <rect x="540" width="540" height="1350" fill="#0000ff"/>
    </svg>`
    const buf = await sharp(Buffer.from(svg)).png().toBuffer()
    return `data:image/png;base64,${buf.toString('base64')}`
  }

  function doc(background: ImageFill): SlideDocument {
    return {
      version: SLIDE_DOCUMENT_VERSION,
      id: crypto.randomUUID(),
      canvas: { width: 1080, height: 1350, background },
      nodes: [],
    }
  }

  it('offsetX shifts the exported image; scale zooms it', async () => {
    const src = await makeSrc()
    const neutral = await renderDocument(doc({ type: 'image', src, fit: 'cover' }))
    const panned = await renderDocument(doc({ type: 'image', src, fit: 'cover', offsetX: 600 }))

    const n = await probeLeftQuarter(neutral)
    const p = await probeLeftQuarter(panned)
    // Neutral: the left quarter sits in the red half.
    expect(n.r).toBeGreaterThan(200)
    expect(n.b).toBeLessThan(60)
    // Panned 600px right: the image slid right, so the left quarter no
    // longer shows the same red pixels — the region reads materially
    // different and the buffers differ.
    expect(Buffer.compare(neutral, panned)).not.toBe(0)
    expect(Math.abs(p.r - n.r) + Math.abs(p.b - n.b)).toBeGreaterThan(50)

    const zoomed = await renderDocument(doc({ type: 'image', src, fit: 'cover', scale: 2 }))
    expect(Buffer.compare(neutral, zoomed)).not.toBe(0)
  }, 60000)
})
