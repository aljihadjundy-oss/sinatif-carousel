import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { normalizeBackgroundImage } from '@/lib/image-processing'

export const runtime = 'nodejs'

// EXIF rotation + crop-to-1080x1350 logic lives in lib/image-processing.ts
// (see that file for the original investigation into why each step is
// needed), shared with ai-image/route.ts so both call sites stay in sync.

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
    normalized = await normalizeBackgroundImage(inputBuffer)
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
