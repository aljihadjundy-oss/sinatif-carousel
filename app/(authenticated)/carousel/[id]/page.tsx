import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import RegenerateDesignButton from './RegenerateDesignButton'
import { LayoutVariant } from './DesignOptionsPanel'
import { IconName } from '@/lib/icons'
import DownloadAllButton from './DownloadAllButton'
import SlideImage from './SlideImage'
import EditableScript from './EditableScript'

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
    .select(
      'id, topic, status, layout_variant, color_scheme, text_density, hierarchy, background_image_url, icon_name, typography_preset, brand_profiles(name, visual_style)'
    )
    .eq('id', id)
    .single()

  if (!post) notFound()

  const { data: scriptStage } = await supabase
    .schema('carousel')
    .from('stage_outputs')
    .select('id, output_json')
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

  const brand = post.brand_profiles as unknown as {
    name: string
    visual_style: { colors?: Record<string, string> } | null
  } | null
  const script = (scriptStage?.output_json ?? null) as Script | null
  const slides = (renderedSlides ?? []) as RenderedSlide[]
  const hasDesign = slides.some((s) => s.rendered_image_url)

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {script?.title ?? post.topic}
        </h1>
        <Link
          href="/carousel/new"
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ← New Carousel
        </Link>
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
          {hasDesign && (
            <DownloadAllButton
              topic={script?.title ?? post.topic}
              slides={slides
                .filter((s) => s.rendered_image_url)
                .map((s) => ({ index: s.slide_order, url: s.rendered_image_url! }))}
            />
          )}
        </div>

        <RegenerateDesignButton
          postId={post.id}
          buttonStyle={hasDesign ? 'secondary' : 'primary'}
          initialLayoutVariant={
            (post.layout_variant as LayoutVariant | null) ?? 'minimal'
          }
          initialColorScheme={post.color_scheme}
          initialTextDensity={
            (post.text_density as 'concise' | 'standard' | 'detailed' | null) ?? 'standard'
          }
          initialHierarchy={
            (post.hierarchy as 'headline_focused' | 'balanced' | null) ?? 'balanced'
          }
          initialBackgroundImageUrl={post.background_image_url}
          initialIconName={
            (post.icon_name as IconName | 'none' | null) ?? 'auto'
          }
          initialTypographyPreset={post.typography_preset}
          brandColors={brand?.visual_style?.colors ?? null}
        />

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

      {scriptStage?.id ? (
        <EditableScript
          postId={post.id}
          stageOutputId={scriptStage.id}
          title={script?.title ?? post.topic}
          slides={script?.slides ?? []}
        />
      ) : (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Script
          </h2>
          <p className="text-gray-500 text-sm dark:text-gray-400">
            No script content available.
          </p>
        </div>
      )}
    </div>
  )
}
