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

  // Export-gap fix: the PNGs Download All / per-slide download serve
  // come from storage (slide-N.png) + the carousel.slides cache — if
  // they kept the pre-edit render, the editor would "save" changes the
  // user can never download. Re-render every manuallyEdited document
  // whose JSON actually changed in this save (position-matched against
  // the previous column value; debounced saves mean usually exactly one
  // slide), upsert the same storage path, and refresh the cache row with
  // a new cache-bust param — the same staleness mechanics the designer
  // route already handles this way.
  const previous: SlideDocument[] = isSlideDocumentArray(post.slide_documents)
    ? post.slide_documents
    : []
  const cacheBustVersion = Date.now()
  const rerendered: { slideOrder: number; url: string }[] = []

  for (let i = 0; i < body.slide_documents.length; i++) {
    const doc = body.slide_documents[i]
    if (!doc.manuallyEdited) continue
    if (previous[i] && JSON.stringify(previous[i]) === JSON.stringify(doc)) continue
    try {
      const png = await renderDocument(doc)
      const path = `${body.post_id}/slide-${i + 1}.png`
      const { error: uploadErr } = await supabase.storage
        .from('carousel-assets')
        .upload(path, png, { contentType: 'image/png', upsert: true })
      if (uploadErr) throw new Error(uploadErr.message)
      const { data: publicUrl } = supabase.storage.from('carousel-assets').getPublicUrl(path)
      rerendered.push({ slideOrder: i + 1, url: `${publicUrl.publicUrl}?v=${cacheBustVersion}` })
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

  for (const r of rerendered) {
    const { error: cacheErr } = await supabase
      .schema('carousel')
      .from('slides')
      .update({ rendered_image_url: r.url })
      .eq('post_id', body.post_id)
      .eq('slide_order', r.slideOrder)
    if (cacheErr) {
      console.error(
        `slide-documents: cache row update failed for post ${body.post_id} slide ${r.slideOrder}`,
        cacheErr
      )
    }
  }

  return NextResponse.json({ ok: true, rerendered: rerendered.map((r) => r.slideOrder) })
}
