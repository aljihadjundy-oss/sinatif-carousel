import { describe, expect, it } from 'vitest'
import {
  SLIDE_DOCUMENT_VERSION,
  SlideDocument,
  createSlideDocument,
  duplicateSlideDocument,
  isSlideDocument,
  isSlideDocumentArray,
  isSlideNode,
} from '@/lib/slideDocument'

function validTextNode() {
  return {
    id: crypto.randomUUID(),
    type: 'text' as const,
    x: 100,
    y: 200,
    width: 880,
    height: 300,
    text: 'Headline',
    fontFamily: 'Inter',
    fontWeight: 600 as const,
    fontSize: 64,
    color: '#ffffff',
    align: 'left' as const,
    lineHeight: 1.2,
  }
}

function validDocument(): SlideDocument {
  const doc = createSlideDocument()
  doc.nodes.push(validTextNode(), {
    id: crypto.randomUUID(),
    type: 'shape',
    x: 0,
    y: 1200,
    width: 1080,
    height: 150,
    shape: 'rect',
    fill: { type: 'solid', color: '#f97316' },
  })
  return doc
}

describe('createSlideDocument', () => {
  it('produces a valid v1 document with UUID identity and 1080x1350 canvas', () => {
    const doc = createSlideDocument()
    expect(doc.version).toBe(SLIDE_DOCUMENT_VERSION)
    expect(doc.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(doc.canvas).toMatchObject({ width: 1080, height: 1350 })
    expect(isSlideDocument(doc)).toBe(true)
  })
})

describe('duplicateSlideDocument', () => {
  it('regenerates the slide id and every node id, keeping content equal', () => {
    const original = validDocument()
    const copy = duplicateSlideDocument(original)

    expect(copy.id).not.toBe(original.id)
    expect(copy.nodes).toHaveLength(original.nodes.length)
    copy.nodes.forEach((node, i) => {
      expect(node.id).not.toBe(original.nodes[i].id)
      const { id: _a, ...copyRest } = node
      const { id: _b, ...origRest } = original.nodes[i]
      expect(copyRest).toEqual(origRest)
    })
    expect(isSlideDocument(copy)).toBe(true)
  })
})

describe('isSlideNode', () => {
  it('accepts all four node types', () => {
    expect(isSlideNode(validTextNode())).toBe(true)
    expect(
      isSlideNode({
        id: 'n1',
        type: 'shape',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        shape: 'ellipse',
        fill: {
          type: 'linear-gradient',
          angle: 135,
          stops: [
            { offset: 0, color: '#000000' },
            { offset: 1, color: '#333333' },
          ],
        },
      })
    ).toBe(true)
    expect(
      isSlideNode({
        id: 'n2',
        type: 'image',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        src: 'https://example.com/a.jpg',
        fit: 'cover',
      })
    ).toBe(true)
    expect(
      isSlideNode({
        id: 'n3',
        type: 'icon',
        x: 0,
        y: 0,
        width: 48,
        height: 48,
        name: 'lightbulb',
        color: '#f97316',
      })
    ).toBe(true)
  })

  it('rejects unknown types, missing per-type fields, and non-finite geometry', () => {
    expect(isSlideNode({ ...validTextNode(), type: 'video' })).toBe(false)
    expect(isSlideNode({ ...validTextNode(), fontWeight: 450 })).toBe(false)
    const { text: _text, ...noText } = validTextNode()
    expect(isSlideNode(noText)).toBe(false)
    expect(isSlideNode({ ...validTextNode(), x: NaN })).toBe(false)
    expect(isSlideNode({ ...validTextNode(), id: '' })).toBe(false)
  })
})

describe('isSlideDocument / isSlideDocumentArray', () => {
  it('round-trips through JSON like real JSONB storage', () => {
    const doc = validDocument()
    expect(isSlideDocument(JSON.parse(JSON.stringify(doc)))).toBe(true)
  })

  it('rejects wrong version, bad background, and non-array nodes', () => {
    const doc = validDocument()
    expect(isSlideDocument({ ...doc, version: 2 })).toBe(false)
    expect(
      isSlideDocument({ ...doc, canvas: { ...doc.canvas, background: { type: 'plaid' } } })
    ).toBe(false)
    expect(isSlideDocument({ ...doc, nodes: 'none' })).toBe(false)
  })

  it('rejects arrays with duplicate slide ids (identity must be unique)', () => {
    const doc = validDocument()
    expect(isSlideDocumentArray([doc, duplicateSlideDocument(doc)])).toBe(true)
    expect(isSlideDocumentArray([doc, { ...validDocument(), id: doc.id }])).toBe(false)
    expect(isSlideDocumentArray([])).toBe(true)
    expect(isSlideDocumentArray('[]')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Phase-2c write-boundary content validation

import { getSlideDocumentContentError, isValidNodeColor } from '@/lib/slideDocument'

describe('isValidNodeColor', () => {
  it('accepts hex (3/6/8) and rgb()/rgba()', () => {
    for (const c of ['#fff', '#1d4ed8', '#1d4ed8cc', 'rgb(0,0,0)', 'rgba(255,255,255,0.85)', 'rgba(0,0,0,0)']) {
      expect(isValidNodeColor(c), c).toBe(true)
    }
  })
  it('rejects CSS keywords, url(), and garbage', () => {
    for (const c of ['red', 'url(javascript:x)', 'linear-gradient(#000,#fff)', '#12345', 'rgba(0,0,0,2)', '']) {
      expect(isValidNodeColor(c), c).toBe(false)
    }
  })
})

describe('getSlideDocumentContentError', () => {
  const ICONS = ['Lightbulb', 'Target'] as const

  it('passes a valid document', () => {
    expect(getSlideDocumentContentError(validDocument(), ICONS)).toBeNull()
  })

  it('flags unknown icon names', () => {
    const doc = validDocument()
    doc.nodes.push({
      id: crypto.randomUUID(),
      type: 'icon',
      x: 0, y: 0, width: 48, height: 48,
      name: 'NotARealIcon',
      color: '#ffffff',
    })
    expect(getSlideDocumentContentError(doc, ICONS)).toMatch(/unknown icon "NotARealIcon"/)
  })

  it('flags invalid colors on text, fills, gradient stops, and strokes', () => {
    const bad = validDocument()
    ;(bad.nodes[0] as { color: string }).color = 'red'
    expect(getSlideDocumentContentError(bad, ICONS)).toMatch(/invalid color "red"/)

    const badBg = validDocument()
    badBg.canvas.background = {
      type: 'linear-gradient',
      angle: 180,
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: 'not-a-color' },
      ],
    }
    expect(getSlideDocumentContentError(badBg, ICONS)).toMatch(/invalid gradient stop color/)
  })
})

// ---------------------------------------------------------------------------
// Per-slide independence (Canva-flow redesign): a duplicated slide must
// share NOTHING by reference with its source — in-place mutation of one
// (even through nested objects like fills/strokes/gradient stops) must
// never bleed into the other.

describe('duplicateSlideDocument deep independence', () => {
  it('does not share nested fill/stroke/background objects by reference', () => {
    const original = createSlideDocument({
      type: 'linear-gradient',
      angle: 180,
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#333333' },
      ],
    })
    original.nodes.push({
      id: crypto.randomUUID(),
      type: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      shape: 'rect',
      fill: { type: 'solid', color: '#f97316' },
      stroke: { color: '#ffffff', width: 2 },
    })

    const copy = duplicateSlideDocument(original)

    // Mutate the COPY in place through every nested path...
    const copyShape = copy.nodes[0] as Extract<(typeof copy.nodes)[number], { type: 'shape' }>
    ;(copyShape.fill as { color: string }).color = '#ff0000'
    copyShape.stroke!.color = '#00ff00'
    ;(copy.canvas.background as { stops: { color: string }[] }).stops[0].color = '#ffffff'

    // ...and the ORIGINAL must be untouched.
    const origShape = original.nodes[0] as Extract<(typeof original.nodes)[number], { type: 'shape' }>
    expect((origShape.fill as { color: string }).color).toBe('#f97316')
    expect(origShape.stroke!.color).toBe('#ffffff')
    expect((original.canvas.background as { stops: { color: string }[] }).stops[0].color).toBe('#000000')
  })
})
