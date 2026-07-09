import { NextResponse } from 'next/server'
import { ImageResponse } from 'next/og'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

interface Slide {
  index: number
  headline: string
  body: string
}

interface Script {
  title?: string
  slides?: Slide[]
}

interface VisualStyle {
  colors?: Record<string, string>
}

function pickColors(visualStyle: VisualStyle | null) {
  const colors = visualStyle?.colors ? Object.values(visualStyle.colors) : []
  return {
    bg: colors[0] ?? '#111827',
    fg: colors[colors.length - 1] ?? '#ffffff',
    accent: colors[1] ?? colors[0] ?? '#2563eb',
  }
}

async function renderSlide(
  slide: Slide,
  total: number,
  colors: { bg: string; fg: string; accent: string }
) {
  const image = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: colors.bg,
          color: colors.fg,
          padding: 80,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', fontSize: 28, opacity: 0.7 }}>
          {slide.index} / {total}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, lineHeight: 1.15 }}>
            {slide.headline}
          </div>
          <div style={{ display: 'flex', fontSize: 32, lineHeight: 1.4, opacity: 0.9 }}>
            {slide.body}
          </div>
        </div>
        <div style={{ display: 'flex', width: 64, height: 8, backgroundColor: colors.accent }} />
      </div>
    ),
    { width: 1080, height: 1350 }
  )
  return Buffer.from(await image.arrayBuffer())
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { post_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const postId = body.post_id?.trim()
  if (!postId) {
    return NextResponse.json({ error: 'post_id is required' }, { status: 400 })
  }

  const { data: post, error: postErr } = await supabase
    .schema('carousel')
    .from('posts')
    .select('id, brand_profile_id')
    .eq('id', postId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (postErr) {
    return NextResponse.json({ error: postErr.message }, { status: 500 })
  }
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  const { data: scriptStage, error: scriptErr } = await supabase
    .schema('carousel')
    .from('stage_outputs')
    .select('output_json')
    .eq('post_id', postId)
    .eq('stage', 'script')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (scriptErr) {
    return NextResponse.json({ error: scriptErr.message }, { status: 500 })
  }

  const script = scriptStage?.output_json as Script | undefined
  if (!script?.slides?.length) {
    return NextResponse.json(
      { error: 'No script found for this post' },
      { status: 400 }
    )
  }

  let visualStyle: VisualStyle | null = null
  if (post.brand_profile_id) {
    const { data: brand } = await supabase
      .schema('carousel')
      .from('brand_profiles')
      .select('visual_style')
      .eq('id', post.brand_profile_id)
      .maybeSingle()
    visualStyle = (brand?.visual_style as VisualStyle | null) ?? null
  }

  const colors = pickColors(visualStyle)
  const total = script.slides.length

  const renderedSlides: { index: number; url: string }[] = []
  try {
    for (const slide of script.slides) {
      const png = await renderSlide(slide, total, colors)
      const path = `${postId}/slide-${slide.index}.png`

      const { error: uploadErr } = await supabase.storage
        .from('carousel-assets')
        .upload(path, png, { contentType: 'image/png', upsert: true })

      if (uploadErr) {
        throw new Error(uploadErr.message)
      }

      const { data: publicUrl } = supabase.storage
        .from('carousel-assets')
        .getPublicUrl(path)

      renderedSlides.push({ index: slide.index, url: publicUrl.publicUrl })
    }
  } catch (err) {
    console.error('designer: render/upload error', err)
    return NextResponse.json(
      { error: 'Design generation failed' },
      { status: 502 }
    )
  }

  await supabase.schema('carousel').from('slides').delete().eq('post_id', postId)

  const { error: slidesErr } = await supabase
    .schema('carousel')
    .from('slides')
    .insert(
      script.slides.map((slide) => ({
        post_id: postId,
        slide_order: slide.index,
        copy_text: `${slide.headline}\n\n${slide.body}`,
        rendered_image_url:
          renderedSlides.find((r) => r.index === slide.index)?.url ?? null,
      }))
    )

  if (slidesErr) {
    return NextResponse.json({ error: slidesErr.message }, { status: 500 })
  }

  const { error: stageErr } = await supabase
    .schema('carousel')
    .from('stage_outputs')
    .insert({
      post_id: postId,
      stage: 'design',
      output_json: { slide_count: renderedSlides.length, slides: renderedSlides },
    })

  if (stageErr) {
    return NextResponse.json({ error: stageErr.message }, { status: 500 })
  }

  await supabase
    .schema('carousel')
    .from('posts')
    .update({ status: 'designed' })
    .eq('id', postId)

  return NextResponse.json({ post_id: postId, slides: renderedSlides })
}
