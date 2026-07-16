import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const maxDuration = 60

// Per-slide photo upload for the canvas editor (Canva-flow redesign).
// Assets live under {postId}/editor-assets/{uuid}.jpg — one object per
// insert, never shared post-level state, so replacing slide 3's photo
// can't touch slide 1's (per-slide independence, same rule as
// background-slide-N.jpg established for the legacy override uploads).
//
// Cost guards (numbers proposed in the PR for owner approval):
// - MAX_UPLOAD_BYTES 8MB: casual phone photos run 2-6MB; 8 accepts
//   nearly all of them while refusing DSLR/RAW-sized outliers.
// - MAX_ASSETS_PER_POST 20: a 5-10 slide carousel with 2 photos per
//   slide still fits; the cap is on stored objects (counted live from
//   the storage folder), so it limits accumulation, not workflow.
// - Normalization: EXIF-oriented, longest side capped at 1350px (the
//   canvas is 1080x1350 — bigger pixels are invisible), JPEG q80 —
//   stored objects land around 100-400KB regardless of input size, so
//   worst case per post is ~8MB stored, not 160MB.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const MAX_ASSETS_PER_POST = 20
const MAX_DIMENSION = 1350
const JPEG_QUALITY = 80

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient()

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const postId = formData.get('post_id')
  const file = formData.get('file')
  if (typeof postId !== 'string' || !postId) {
    return NextResponse.json({ error: 'post_id is required' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File terlalu besar (maks ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)` },
      { status: 400 }
    )
  }

  // Ownership via RLS-scoped select, same as every carousel route.
  const { data: post, error: postErr } = await supabase
    .schema('carousel')
    .from('posts')
    .select('id')
    .eq('id', postId)
    .maybeSingle()
  if (postErr) return NextResponse.json({ error: postErr.message }, { status: 500 })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const { data: existing, error: listErr } = await supabase.storage
    .from('carousel-assets')
    .list(`${postId}/editor-assets`)
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 })
  }
  if ((existing?.length ?? 0) >= MAX_ASSETS_PER_POST) {
    return NextResponse.json(
      { error: `Batas ${MAX_ASSETS_PER_POST} foto per post tercapai` },
      { status: 400 }
    )
  }

  let normalized: Buffer
  try {
    // Unlike the full-bleed background normalizer (hard 1080x1350 cover
    // crop), editor photos keep their own aspect ratio — the user
    // decides the crop by resizing the node on canvas. `fit: 'inside'`
    // only caps resolution; `withoutEnlargement` never upscales.
    normalized = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()
  } catch {
    return NextResponse.json({ error: 'File bukan gambar yang valid' }, { status: 400 })
  }

  const meta = await sharp(normalized).metadata()
  const path = `${postId}/editor-assets/${randomUUID()}.jpg`
  const { error: uploadErr } = await supabase.storage
    .from('carousel-assets')
    .upload(path, normalized, { contentType: 'image/jpeg' })
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const { data: publicUrl } = supabase.storage.from('carousel-assets').getPublicUrl(path)
  return NextResponse.json({
    url: publicUrl.publicUrl,
    width: meta.width ?? MAX_DIMENSION,
    height: meta.height ?? MAX_DIMENSION,
  })
}
