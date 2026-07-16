import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

// Delete a post and everything that belongs to it (feature request: a
// destructive dashboard action, confirmed client-side before this ever
// fires).
//
// carousel.slides and carousel.stage_outputs both have ON DELETE CASCADE
// on post_id (verified live against the project, not assumed) — deleting
// the posts row cleans those up automatically. Supabase Storage objects
// are NOT rows in that FK graph, so they're the one thing this route has
// to clean up itself or they become permanent orphans: every PNG
// (slide-N.png), every uploaded/normalized background
// (background*.jpg), and every canvas-editor asset (editor-assets/*.jpg,
// from PR "per-slide photo upload") lives under carousel-assets/{postId}/
// with no automatic lifecycle tied to the post row.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: postId } = await params
  if (!postId) {
    return NextResponse.json({ error: 'post id is required' }, { status: 400 })
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Ownership check via the same RLS-scoped select every other carousel
  // route uses — a stranger's post_id 404s instead of silently deleting
  // nothing (RLS would already block the row delete below, but storage
  // cleanup has no RLS of its own, so this check has to come first).
  const { data: post, error: postErr } = await supabase
    .schema('carousel')
    .from('posts')
    .select('id')
    .eq('id', postId)
    .maybeSingle()
  if (postErr) {
    return NextResponse.json({ error: postErr.message }, { status: 500 })
  }
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  // Storage first, then the row: if storage cleanup fails partway, the
  // post row (and its now-broken image links) staying around is a far
  // smaller problem than deleting the row and permanently losing the
  // ability to find/retry cleaning up its orphaned files — the folder
  // path is derived from postId alone, so a retry of this same request
  // picks up wherever the previous attempt left off.
  const topLevel = await supabase.storage.from('carousel-assets').list(postId)
  const editorAssets = await supabase.storage
    .from('carousel-assets')
    .list(`${postId}/editor-assets`)

  const paths = [
    ...(topLevel.data ?? [])
      .filter((f) => f.name !== 'editor-assets') // that's a folder marker, not a file to remove directly
      .map((f) => `${postId}/${f.name}`),
    ...(editorAssets.data ?? []).map((f) => `${postId}/editor-assets/${f.name}`),
  ]

  if (paths.length > 0) {
    const { error: removeErr } = await supabase.storage.from('carousel-assets').remove(paths)
    if (removeErr) {
      console.error(`posts/[id] DELETE: storage cleanup failed for post ${postId}`, removeErr)
      return NextResponse.json(
        { error: `Failed to delete stored files: ${removeErr.message}` },
        { status: 500 }
      )
    }
  }

  const { error: deleteErr } = await supabase
    .schema('carousel')
    .from('posts')
    .delete()
    .eq('id', postId)
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
