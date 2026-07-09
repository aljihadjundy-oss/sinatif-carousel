import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

// Phone/camera photos commonly store rotation as EXIF orientation
// metadata rather than actually rotating the pixels. Browsers and most
// image viewers auto-rotate based on that tag, but Satori (used by the
// designer route's ImageResponse) ignores it entirely and renders the
// raw, unrotated pixels — verified directly against a synthetic photo
// with orientation=6, which rendered sideways in Satori. sharp's
// .rotate() with no arguments auto-orients based on EXIF and bakes the
// rotation into the pixels, then strips the orientation tag — verified
// this produces a physically-rotated image with no residual EXIF
// orientation left for Satori to (still) ignore.
//
// Uploaded phone photos were landing in storage 10-15x larger
// (~910KB) than the solid-color slide renders they get composited
// with (~40-80KB), since they were stored byte-for-byte as uploaded.
// The designer route only ever displays this image downscaled into a
// 1080x1350 slide (objectFit: cover), so anything wider than 1080px
// is wasted storage — resizing to max width 1080 (no upscaling of
// smaller images) and re-encoding as JPEG at 80% quality shrinks
// storage cost with no visible quality loss at the render size it's
// actually used at.
const MAX_WIDTH = 1080
const JPEG_QUALITY = 80

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
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

  const { data: post, error: postErr } = await supabase
    .schema('carousel')
    .from('posts')
    .select('id')
    .eq('id', postId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (postErr) {
    return NextResponse.json({ error: postErr.message }, { status: 500 })
  }
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  let normalized: Buffer
  try {
    const inputBuffer = Buffer.from(await file.arrayBuffer())
    normalized = await sharp(inputBuffer)
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()
  } catch (err) {
    console.error('background-upload: image processing failed', err)
    return NextResponse.json({ error: 'Failed to process image' }, { status: 400 })
  }

  const path = `${postId}/background.jpg`
  const contentType = 'image/jpeg'

  const { error: uploadErr } = await supabase.storage
    .from('carousel-assets')
    .upload(path, normalized, { contentType, upsert: true })

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 })
  }

  const { data: publicUrl } = supabase.storage.from('carousel-assets').getPublicUrl(path)

  return NextResponse.json({ url: publicUrl.publicUrl })
}
