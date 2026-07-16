import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { ICON_NAMES } from '@/lib/icons'
import {
  getSlideDocumentContentError,
  isSlideDocumentArray,
} from '@/lib/slideDocument'

export const runtime = 'nodejs'

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
    .select('id')
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

  return NextResponse.json({ ok: true })
}
