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
// orientation left for Satori to (still) ignore. Applied first, before
// the resize/crop below, so orientation is corrected on the pixels that
// then get cropped — cropping before rotating would crop the wrong edges
// for any photo that isn't already right-side-up.
//
// Every slide is a fixed 1080x1350 (4:5) canvas. Satori's CSS support is
// limited enough (discovered earlier this session) that relying on its
// objectFit for arbitrary source aspect ratios is fragile — instead the
// upload itself is resized+cropped server-side with sharp so the stored
// object is ALWAYS exactly 1080x1350, and the designer route can just
// embed it with no fit logic of its own. `fit: 'cover'` scales the image
// up or down (upscaling small images too, unlike the old
// withoutEnlargement-guarded max-width resize) so it fully fills the
// frame with no empty borders, then crops to the target aspect ratio
// centered on the image — no stretching, no distortion, no repeating.
const TARGET_WIDTH = 1080
const TARGET_HEIGHT = 1350
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
      .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'cover', position: 'center' })
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
