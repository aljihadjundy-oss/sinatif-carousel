import { notFound, redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'

interface Slide {
  index: number
  headline: string
  body: string
}

interface Script {
  title?: string
  slides?: Slide[]
}

export default async function CarouselPostPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: post } = await supabase
    .schema('carousel')
    .from('posts')
    .select('id, topic, status, brand_profiles(name)')
    .eq('id', id)
    .single()

  if (!post) notFound()

  const { data: scriptStage } = await supabase
    .schema('carousel')
    .from('stage_outputs')
    .select('output_json')
    .eq('post_id', id)
    .eq('stage', 'script')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const brand = post.brand_profiles as unknown as { name: string } | null
  const script = (scriptStage?.output_json ?? null) as Script | null

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{script?.title ?? post.topic}</h1>
          <a
            href="/carousel/new"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← New Carousel
          </a>
        </div>

        <div className="text-sm text-gray-500">
          {brand?.name && <span>Brand: {brand.name} · </span>}
          Status: {post.status}
        </div>

        {script?.slides && script.slides.length > 0 ? (
          <div className="space-y-4">
            {script.slides.map((slide) => (
              <div key={slide.index} className="bg-white rounded-xl shadow p-5">
                <p className="text-xs text-gray-400 mb-1">Slide {slide.index}</p>
                <h2 className="font-semibold text-lg mb-2">{slide.headline}</h2>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {slide.body}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No script content available.</p>
        )}
      </div>
    </div>
  )
}
