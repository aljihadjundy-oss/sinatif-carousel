import { describe, expect, it } from 'vitest'
import { buildFallbackDocument, materializeSlideDocuments } from '@/lib/materialize-documents'
import { ALL_ICON_NAMES } from '@/lib/icons'
import {
  getSlideDocumentContentError,
  isSlideDocument,
  isSlideDocumentArray,
} from '@/lib/slideDocument'

const FALLBACK_INPUT = {
  headline: 'Judul uji',
  body: 'Isi slide untuk pengujian fallback.',
  bg: '#111827',
  fg: '#f9fafb',
  headlineFamily: 'Inter',
  bodyFamily: 'Inter',
}

describe('buildFallbackDocument', () => {
  it('produces a structurally valid document that passes content validation', () => {
    const doc = buildFallbackDocument(FALLBACK_INPUT)
    expect(isSlideDocument(doc)).toBe(true)
    expect(getSlideDocumentContentError(doc, ALL_ICON_NAMES)).toBeNull()
  })

  it('carries the headline and body as editable text nodes', () => {
    const doc = buildFallbackDocument(FALLBACK_INPUT)
    const texts = doc.nodes.filter((n) => n.type === 'text').map((n) => (n as { text: string }).text)
    expect(texts).toContain('Judul uji')
    expect(texts).toContain('Isi slide untuk pengujian fallback.')
  })

  it('never reuses ids across calls', () => {
    const a = buildFallbackDocument(FALLBACK_INPUT)
    const b = buildFallbackDocument(FALLBACK_INPUT)
    expect(a.id).not.toBe(b.id)
    expect(a.nodes[0].id).not.toBe(b.nodes[0].id)
  })
})

// Minimal in-memory stand-in for the supabase query chains this module
// uses (select().eq().order().limit().maybeSingle() / update().eq()).
function fakeSupabase(fixtures: {
  script?: { slides: { index: number; headline: string; body: string }[] } | null
  brand?: { name: string; visual_style: Record<string, unknown> | null } | null
  onUpdate?: (table: string, values: unknown) => void
}) {
  function chain(table: string) {
    const state: { stage?: string } = {}
    const builder: any = {
      select: () => builder,
      insert: () => builder,
      update: (values: unknown) => {
        fixtures.onUpdate?.(table, values)
        return { eq: () => Promise.resolve({ error: null }) }
      },
      eq: (col: string, val: unknown) => {
        if (col === 'stage') state.stage = String(val)
        return builder
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        if (table === 'stage_outputs') {
          if (state.stage === 'script' && fixtures.script) {
            return { data: { output_json: fixtures.script }, error: null }
          }
          return { data: null, error: null }
        }
        if (table === 'brand_profiles') {
          return { data: fixtures.brand ?? null, error: null }
        }
        return { data: null, error: null }
      },
    }
    return builder
  }
  return { schema: () => ({ from: (table: string) => chain(table) }) }
}

const BASE_POST = {
  id: 'post-1',
  topic: 'Topik pengujian',
  layout_variant: 'minimal',
  color_scheme: null,
  text_density: 'standard',
  hierarchy: 'balanced',
  background_image_url: null,
  icon_name: null,
  typography_preset: null,
  slide_overrides: [],
  slide_documents: [],
  brand_profile_id: null,
}

describe('materializeSlideDocuments', () => {
  it('compiles a full document set when slide_documents is empty', async () => {
    const updates: unknown[] = []
    const supabase = fakeSupabase({
      script: {
        slides: [
          { index: 1, headline: 'Satu', body: 'Isi satu' },
          { index: 2, headline: 'Dua', body: 'Isi dua' },
        ],
      },
      onUpdate: (_t, v) => updates.push(v),
    })
    const result = await materializeSlideDocuments(supabase, { ...BASE_POST })
    expect(result.materialized).toBe(true)
    expect(result.documents).toHaveLength(2)
    expect(isSlideDocumentArray(result.documents)).toBe(true)
    expect(result.fallbackSlideOrders).toEqual([])
    expect(updates).toHaveLength(1)
  })

  it('returns existing complete documents untouched (no recompile, no write)', async () => {
    const existing = [buildFallbackDocument(FALLBACK_INPUT), buildFallbackDocument(FALLBACK_INPUT)]
    const updates: unknown[] = []
    const supabase = fakeSupabase({
      script: {
        slides: [
          { index: 1, headline: 'Satu', body: 'Isi' },
          { index: 2, headline: 'Dua', body: 'Isi' },
        ],
      },
      onUpdate: (_t, v) => updates.push(v),
    })
    const result = await materializeSlideDocuments(supabase, {
      ...BASE_POST,
      slide_documents: existing,
    })
    expect(result.materialized).toBe(false)
    expect(result.documents).toBe(existing)
    expect(updates).toHaveLength(0)
  })

  it('fills only the gap positions, carrying existing documents verbatim', async () => {
    const kept = buildFallbackDocument({ ...FALLBACK_INPUT, headline: 'Dokumen lama' })
    const supabase = fakeSupabase({
      script: {
        slides: [
          { index: 1, headline: 'Satu', body: 'Isi' },
          { index: 2, headline: 'Dua', body: 'Isi' },
        ],
      },
    })
    const result = await materializeSlideDocuments(supabase, {
      ...BASE_POST,
      slide_documents: [kept],
    })
    expect(result.materialized).toBe(true)
    expect(result.documents).toHaveLength(2)
    expect(result.documents[0]).toBe(kept)
  })

  it('materializes a single editable fallback document for a post with no script at all', async () => {
    const supabase = fakeSupabase({ script: null })
    const result = await materializeSlideDocuments(supabase, { ...BASE_POST })
    expect(result.materialized).toBe(true)
    expect(result.documents).toHaveLength(1)
    const texts = result.documents[0].nodes
      .filter((n) => n.type === 'text')
      .map((n) => (n as { text: string }).text)
    expect(texts.some((t) => t.includes('Topik pengujian'))).toBe(true)
  })

  it('every layout variant materializes without fallback for realistic content', async () => {
    const layouts = [
      'minimal', 'accent', 'editorial_gradient', 'terminal_dev', 'elegant_promo',
      'news_card', 'photo_editorial', 'flat_icon_list', 'flat_mockup_card',
    ]
    for (const layout of layouts) {
      const supabase = fakeSupabase({
        script: {
          slides: [
            { index: 1, headline: `Judul ${layout}`, body: 'Isi pembuka yang cukup realistis untuk kompilasi.' },
            { index: 2, headline: 'Poin kedua', body: 'Penjelasan poin kedua dengan panjang yang wajar.' },
          ],
        },
      })
      const result = await materializeSlideDocuments(supabase, {
        ...BASE_POST,
        layout_variant: layout,
      })
      expect(result.documents, layout).toHaveLength(2)
      expect(isSlideDocumentArray(result.documents), layout).toBe(true)
      expect(result.fallbackSlideOrders, layout).toEqual([])
    }
  }, 120000)
})
