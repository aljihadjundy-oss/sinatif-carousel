import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { ICON_NAMES } from '@/lib/icons'
import {
  SlideDocument,
  getSlideDocumentContentError,
  isSlideDocumentArray,
} from '@/lib/slideDocument'
import { renderDocument } from '@/lib/render-document'

export const runtime = 'nodejs'
// Saving may re-render several edited slides' PNGs through satori —
// same reasoning as the designer route's own maxDuration.
export const maxDuration = 60

// Phase-3d: the canvas editor's autosave endpoint. This is the first
// route where slide_documents arrives as GENUINELY untrusted input (the
// designer route only persists its own compiler's output), so the full
// validation stack from phases 1+2c runs here: structural guards
// (isSlideDocumentArray — shape, version, unique UUIDs) and content
// validation (icon names against ICON_NAMES, every color against
// hex/rgb/rgba) before a byte is written.
//
// Ownership is enforced the same way every other carousel route does
// it: the Supabase client carries the user's session and RLS on
// carousel.posts scopes both the existence check and the update.
export async function PATCH(req: Request) {
  const supabase = await createServerSupabaseClient()

  let body: { post_id?: unknown; slide_documents?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.post_id !== 'string' || !body.post_id) {
    return NextResponse.json({ error: 'post_id is required' }, { status: 400 })
  }
  if (!isSlideDocumentArray(body.slide_documents)) {
    return NextResponse.json(
      { error: 'slide_documents must be a valid SlideDocument array (version 1, unique ids)' },
      { status: 400 }
    )
  }
  for (const doc of body.slide_documents) {
    const contentError = getSlideDocumentContentError(doc, ICON_NAMES)
    if (contentError) {
      return NextResponse.json(
        { error: `slide_documents rejected: ${contentError}` },
        { status: 400 }
      )
    }
  }

  const { data: post, error: postErr } = await supabase
    .schema('carousel')
    .from('posts')
    .select('id, slide_documents')
    .eq('id', body.post_id)
    .maybeSingle()

  if (postErr) {
    return NextResponse.json({ error: postErr.message }, { status: 500 })
  }
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  const { error: updateErr } = await supabase
    .schema('carousel')
    .from('posts')
    .update({ slide_documents: body.slide_documents })
    .eq('id', body.post_id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // Export-gap fix (+ reorder/duplicate support): the PNGs Download All /
  // per-slide download serve come from storage (slide-N.png) + the
  // carousel.slides cache. Re-render every POSITION whose document JSON
  // changed in this save — not just manuallyEdited docs: a reorder or
  // duplicate moves an untouched document to a new position, and that
  // position's PNG must now show it (rendering an untouched document
  // through renderDocument() is safe — that's exactly what the phase-2
  // parity suite proves). Debounced saves mean usually one or two
  // positions. Same cache-bust staleness mechanics as the designer route.
  const previous: SlideDocument[] = isSlideDocumentArray(post.slide_documents)
    ? post.slide_documents
    : []
  const cacheBustVersion = Date.now()
  const rerendered: { slideOrder: number; url: string; copyText: string }[] = []

  for (let i = 0; i < body.slide_documents.length; i++) {
    const doc = body.slide_documents[i]
    if (previous[i] && JSON.stringify(previous[i]) === JSON.stringify(doc)) continue
    try {
      const png = await renderDocument(doc)
      const path = `${body.post_id}/slide-${i + 1}.png`
      const { error: uploadErr } = await supabase.storage
        .from('carousel-assets')
        .upload(path, png, { contentType: 'image/png', upsert: true })
      if (uploadErr) throw new Error(uploadErr.message)
      const { data: publicUrl } = supabase.storage.from('carousel-assets').getPublicUrl(path)
      rerendered.push({
        slideOrder: i + 1,
        url: `${publicUrl.publicUrl}?v=${cacheBustVersion}`,
        // Cache copy_text from the document's own text nodes — after a
        // canvas edit these ARE the slide's words; keeps the cache row
        // consistent with the PNG it points at.
        copyText: doc.nodes
          .filter((n): n is Extract<typeof n, { type: 'text' }> => n.type === 'text')
          .map((n) => n.text)
          .join('\n\n'),
      })
    } catch (err) {
      // The document save above already succeeded — a PNG refresh
      // failure must not roll that back or fail the autosave; the next
      // save (or a regenerate) retries. Surfaced in the response so the
      // editor could warn if it ever wants to.
      console.error(
        `slide-documents: PNG re-render failed for post ${body.post_id} slide ${i + 1}`,
        err
      )
      return NextResponse.json({ ok: true, png_refresh_failed: true })
    }
  }

  // Update-or-insert per position: duplicating a slide creates positions
  // beyond the rows the designer route originally inserted.
  const { data: existingRows } = await supabase
    .schema('carousel')
    .from('slides')
    .select('slide_order')
    .eq('post_id', body.post_id)
  const existingOrders = new Set((existingRows ?? []).map((r) => r.slide_order))

  for (const r of rerendered) {
    const row = { rendered_image_url: r.url, copy_text: r.copyText }
    const { error: cacheErr } = existingOrders.has(r.slideOrder)
      ? await supabase
          .schema('carousel')
          .from('slides')
          .update(row)
          .eq('post_id', body.post_id)
          .eq('slide_order', r.slideOrder)
      : await supabase
          .schema('carousel')
          .from('slides')
          .insert({ post_id: body.post_id, slide_order: r.slideOrder, ...row })
    if (cacheErr) {
      console.error(
        `slide-documents: cache row upsert failed for post ${body.post_id} slide ${r.slideOrder}`,
        cacheErr
      )
    }
  }

  return NextResponse.json({ ok: true, rerendered: rerendered.map((r) => r.slideOrder) })
}
