import { notFound } from 'next/navigation'
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
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {script?.title ?? post.topic}
        </h1>
        <a
          href="/carousel/new"
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ← New Carousel
        </a>
      </div>

      <div className="text-sm text-gray-500 dark:text-gray-400">
        {brand?.name && <span>Brand: {brand.name} · </span>}
        Status: {post.status}
      </div>

      {script?.slides && script.slides.length > 0 ? (
        <div className="space-y-4">
          {script.slides.map((slide) => (
            <div
              key={slide.index}
              className="bg-white rounded-xl shadow p-5 dark:bg-gray-900"
            >
              <p className="text-xs text-gray-400 mb-1 dark:text-gray-500">
                Slide {slide.index}
              </p>
              <h2 className="font-semibold text-lg mb-2 text-gray-900 dark:text-gray-100">
                {slide.headline}
              </h2>
              <p className="text-sm text-gray-700 whitespace-pre-wrap dark:text-gray-300">
                {slide.body}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-500 text-sm dark:text-gray-400">
          No script content available.
        </p>
      )}
    </div>
  )
}
