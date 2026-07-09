import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import RegenerateDesignButton from './RegenerateDesignButton'
import DownloadAllButton from './DownloadAllButton'
import SlideImage from './SlideImage'

interface Slide {
  index: number
  headline: string
  body: string
}

interface Script {
  title?: string
  slides?: Slide[]
}

interface RenderedSlide {
  slide_order: number
  rendered_image_url: string | null
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
    .select('id, topic, status, layout_variant, brand_profiles(name)')
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

  const { data: renderedSlides } = await supabase
    .schema('carousel')
    .from('slides')
    .select('slide_order, rendered_image_url')
    .eq('post_id', id)
    .order('slide_order', { ascending: true })

  const brand = post.brand_profiles as unknown as { name: string } | null
  const script = (scriptStage?.output_json ?? null) as Script | null
  const slides = (renderedSlides ?? []) as RenderedSlide[]
  const hasDesign = slides.some((s) => s.rendered_image_url)

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
        {hasDesign && <span> · Layout: {post.layout_variant}</span>}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Design
          </h2>
          <div className="flex items-center gap-2">
            {hasDesign && (
              <DownloadAllButton
                topic={script?.title ?? post.topic}
                slides={slides
                  .filter((s) => s.rendered_image_url)
                  .map((s) => ({ index: s.slide_order, url: s.rendered_image_url! }))}
              />
            )}
            <RegenerateDesignButton
              postId={post.id}
              buttonStyle={hasDesign ? 'secondary' : 'primary'}
              initialLayoutVariant={
                (post.layout_variant as 'minimal' | 'accent' | null) ?? 'minimal'
              }
            />
          </div>
        </div>

        {hasDesign ? (
          <div className="grid grid-cols-2 gap-3">
            {slides
              .filter((s) => s.rendered_image_url)
              .map((s) => (
                <SlideImage
                  key={s.slide_order}
                  topic={script?.title ?? post.topic}
                  index={s.slide_order}
                  url={s.rendered_image_url!}
                />
              ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No design generated yet — this can happen if the automatic
            design step failed. Use the button above to try again.
          </p>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Script
        </h2>
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
                <h3 className="font-semibold text-lg mb-2 text-gray-900 dark:text-gray-100">
                  {slide.headline}
                </h3>
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
    </div>
  )
}
