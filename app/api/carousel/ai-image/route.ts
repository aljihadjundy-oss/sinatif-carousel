import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { normalizeBackgroundImage } from '@/lib/image-processing'

export const runtime = 'nodejs'
// Pollinations has no hard 10s-style constraint like the Gemini/Vercel
// timeout issue hit earlier this session, but image generation still
// isn't instant — 60s covers a slow generation plus the fetch/normalize/
// upload steps after it, matching the ceiling already used on the other
// image-touching routes.
export const maxDuration = 60

// Free, no API key required — generates via the Flux model through a
// simple GET-with-prompt-in-the-URL API. Minimal content moderation
// upstream, which is exactly why this flow is preview-then-confirm on
// the frontend rather than auto-applying the result (see
// DesignOptionsPanel.tsx's "Generate with AI" section).
const POLLINATIONS_BASE_URL = 'https://image.pollinations.ai/prompt'
const GENERATION_TIMEOUT_MS = 20000

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { post_id?: string; prompt?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const postId = body.post_id?.trim()
  const prompt = body.prompt?.trim()

  if (!postId) {
    return NextResponse.json({ error: 'post_id is required' }, { status: 400 })
  }
  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

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

  const generationUrl =
    `${POLLINATIONS_BASE_URL}/${encodeURIComponent(prompt)}` +
    `?width=1080&height=1350&nologo=true`

  let imageBuffer: Buffer
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS)
    let fetchRes: Response
    try {
      fetchRes = await fetch(generationUrl, { signal: controller.signal })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!fetchRes.ok) {
      throw new Error(`Pollinations returned ${fetchRes.status}`)
    }
    imageBuffer = Buffer.from(await fetchRes.arrayBuffer())
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'AbortError'
    console.error(
      `ai-image: generation ${timedOut ? 'timed out' : 'failed'} for prompt "${prompt}"`,
      err
    )
    return NextResponse.json(
      {
        error:
          'Image generation service unavailable, try again or use a different background option',
      },
      { status: 502 }
    )
  }

  // Pollinations should already return ~1080x1350 given the width/height
  // query params, but this runs the exact same normalize step as
  // background-upload/route.ts anyway — for consistency (identical stored
  // object shape regardless of source) and as a safety net if
  // Pollinations ever returns a slightly different size or aspect ratio.
  let normalized: Buffer
  try {
    normalized = await normalizeBackgroundImage(imageBuffer)
  } catch (err) {
    console.error('ai-image: image processing failed', err)
    return NextResponse.json({ error: 'Failed to process generated image' }, { status: 400 })
  }

  // Timestamped path (not a fixed background.jpg like the upload flow) —
  // this is a preview-then-confirm flow, so the user may generate several
  // candidates before picking one via "Use This Image"; each generation
  // needs its own object rather than overwriting the previous preview
  // out from under a still-open comparison.
  const path = `${postId}/ai-generated-${Date.now()}.jpg`

  const { error: uploadErr } = await supabase.storage
    .from('carousel-assets')
    .upload(path, normalized, { contentType: 'image/jpeg', upsert: true })

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 })
  }

  const { data: publicUrl } = supabase.storage.from('carousel-assets').getPublicUrl(path)

  return NextResponse.json({ url: publicUrl.publicUrl })
}
