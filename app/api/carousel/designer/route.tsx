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

type FontWeight = 400 | 500 | 600 | 700 | 800 | 900

interface FontConfig {
  headlineFamily: string
  headlineWeight: FontWeight
  bodyFamily: string
  bodyWeight: FontWeight
}

// ImageResponse's built-in default font loader resolves a local file path
// that breaks on Windows dev (`Invalid URL ... noto-sans-v27-latin-regular.ttf`).
// Explicitly supplying fonts for every rendered text node avoids that loader
// entirely, so every brand below is mapped to a real Google Fonts family.
const BRAND_FONTS: Record<string, FontConfig> = {
  'Sinatif Agency': {
    headlineFamily: 'Inter',
    headlineWeight: 600,
    bodyFamily: 'Inter',
    bodyWeight: 400,
  },
  'Sinatif Academy': {
    headlineFamily: 'Khand',
    headlineWeight: 700,
    bodyFamily: 'Nunito',
    bodyWeight: 400,
  },
  'Osiris Event': {
    headlineFamily: 'Cinzel',
    headlineWeight: 700,
    bodyFamily: 'Poppins',
    bodyWeight: 400,
  },
  Hexolution: {
    // "Blanka" isn't on Google Fonts — fall back to a bold display sans.
    headlineFamily: 'Archivo Black',
    headlineWeight: 400,
    bodyFamily: 'Inter',
    bodyWeight: 400,
  },
  'Bedadikit.id': {
    // Architects Daughter only ships a regular weight.
    headlineFamily: 'Architects Daughter',
    headlineWeight: 400,
    bodyFamily: 'Architects Daughter',
    bodyWeight: 400,
  },
}

const DEFAULT_FONTS: FontConfig = {
  headlineFamily: 'Inter',
  headlineWeight: 700,
  bodyFamily: 'Inter',
  bodyWeight: 400,
}

async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer> {
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`

  const cssRes = await fetch(cssUrl, {
    headers: {
      // A UA with no recognized browser token makes Google Fonts serve
      // .ttf instead of .woff/.woff2, which is what satori (ImageResponse)
      // needs — verified against the live API, not guessed.
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/538.1 (KHTML, like Gecko)',
    },
  })
  if (!cssRes.ok) {
    throw new Error(`Failed to load font CSS for ${family} ${weight}`)
  }

  const css = await cssRes.text()
  const match = css.match(/src: url\(([^)]+)\) format\('(?:truetype|opentype)'\)/)
  if (!match) {
    throw new Error(`No truetype source found for ${family} ${weight}`)
  }

  const fontRes = await fetch(match[1])
  if (!fontRes.ok) {
    throw new Error(`Failed to download font file for ${family} ${weight}`)
  }

  return fontRes.arrayBuffer()
}

async function loadFontsForBrand(fontConfig: FontConfig) {
  const pairs: { family: string; weight: FontWeight }[] = [
    { family: fontConfig.headlineFamily, weight: fontConfig.headlineWeight },
    { family: fontConfig.bodyFamily, weight: fontConfig.bodyWeight },
  ]
  const uniquePairs = Array.from(
    new Map(pairs.map((p) => [`${p.family}-${p.weight}`, p])).values()
  )

  const loaded = await Promise.all(
    uniquePairs.map(async ({ family, weight }) => ({
      name: family,
      weight: weight as FontWeight,
      style: 'normal' as const,
      data: await loadGoogleFont(family, weight),
    }))
  )

  return loaded
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
  colors: { bg: string; fg: string; accent: string },
  fontConfig: FontConfig,
  fonts: Awaited<ReturnType<typeof loadFontsForBrand>>
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
          fontFamily: fontConfig.bodyFamily,
        }}
      >
        <div style={{ display: 'flex', fontSize: 28, opacity: 0.7 }}>
          {slide.index} / {total}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              display: 'flex',
              fontFamily: fontConfig.headlineFamily,
              fontWeight: fontConfig.headlineWeight,
              fontSize: 64,
              lineHeight: 1.15,
            }}
          >
            {slide.headline}
          </div>
          <div
            style={{
              display: 'flex',
              fontFamily: fontConfig.bodyFamily,
              fontWeight: fontConfig.bodyWeight,
              fontSize: 32,
              lineHeight: 1.4,
              opacity: 0.9,
            }}
          >
            {slide.body}
          </div>
        </div>
        <div style={{ display: 'flex', width: 64, height: 8, backgroundColor: colors.accent }} />
      </div>
    ),
    { width: 1080, height: 1350, fonts }
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
  let brandName: string | null = null
  if (post.brand_profile_id) {
    const { data: brand } = await supabase
      .schema('carousel')
      .from('brand_profiles')
      .select('name, visual_style')
      .eq('id', post.brand_profile_id)
      .maybeSingle()
    visualStyle = (brand?.visual_style as VisualStyle | null) ?? null
    brandName = brand?.name ?? null
  }

  const colors = pickColors(visualStyle)
  const fontConfig = (brandName && BRAND_FONTS[brandName]) || DEFAULT_FONTS
  const total = script.slides.length

  let fonts: Awaited<ReturnType<typeof loadFontsForBrand>>
  try {
    fonts = await loadFontsForBrand(fontConfig)
  } catch (err) {
    console.error('designer: font load error', err)
    return NextResponse.json({ error: 'Failed to load brand fonts' }, { status: 502 })
  }

  const renderedSlides: { index: number; url: string }[] = []
  try {
    for (const slide of script.slides) {
      const png = await renderSlide(slide, total, colors, fontConfig, fonts)
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
