'use client'

import { useState } from 'react'
import RegenerateDesignButton from './RegenerateDesignButton'
import SlideImage from './SlideImage'
import SlideCustomizeControl from './SlideCustomizeControl'
import { Hierarchy, IconSelection, LayoutVariant, TextDensity } from './DesignOptionsPanel'
import { SlideOverride } from '@/lib/slideDesign'

interface RenderedSlide {
  index: number
  url: string
}

interface Props {
  postId: string
  hasDesign: boolean
  initialLayoutVariant: LayoutVariant
  initialColorScheme: string | null
  initialTextDensity: TextDensity
  initialHierarchy: Hierarchy
  initialBackgroundImageUrl: string | null
  initialIconName: IconSelection
  initialTypographyPreset: string | null
  initialSlideOverrides: SlideOverride[]
  brandColors: Record<string, string> | null
  topic: string
  brandName: string | null
  renderedSlides: RenderedSlide[]
}

// Owns slide_overrides state so it can be shared between
// RegenerateDesignButton (sends it on generate) and the slide thumbnail
// grid (edits it per-slide, right below each thumbnail) — the two used to
// be independent siblings in page.tsx with no shared client-side state,
// which per-slide customization needs since a page.tsx Server Component
// can't hold state itself.
export default function DesignWorkspace({
  postId,
  hasDesign,
  initialLayoutVariant,
  initialColorScheme,
  initialTextDensity,
  initialHierarchy,
  initialBackgroundImageUrl,
  initialIconName,
  initialTypographyPreset,
  initialSlideOverrides,
  brandColors,
  topic,
  brandName,
  renderedSlides,
}: Props) {
  const [slideOverrides, setSlideOverrides] = useState<SlideOverride[]>(initialSlideOverrides)

  function handleSlideOverrideChange(slideIndex: number, override: SlideOverride | undefined) {
    setSlideOverrides((prev) => {
      const rest = prev.filter((o) => o.slideIndex !== slideIndex)
      return override ? [...rest, override] : rest
    })
  }

  return (
    <>
      <RegenerateDesignButton
        postId={postId}
        buttonStyle={hasDesign ? 'secondary' : 'primary'}
        initialLayoutVariant={initialLayoutVariant}
        initialColorScheme={initialColorScheme}
        initialTextDensity={initialTextDensity}
        initialHierarchy={initialHierarchy}
        initialBackgroundImageUrl={initialBackgroundImageUrl}
        initialIconName={initialIconName}
        initialTypographyPreset={initialTypographyPreset}
        brandColors={brandColors}
        topic={topic}
        brandName={brandName}
        slideOverrides={slideOverrides}
      />

      {hasDesign ? (
        <div className="grid grid-cols-2 gap-3">
          {renderedSlides.map((s) => {
            const override = slideOverrides.find((o) => o.slideIndex === s.index)
            return (
              <div key={s.index}>
                <SlideImage topic={topic} index={s.index} url={s.url} isCustomized={!!override} />
                <SlideCustomizeControl
                  slideIndex={s.index}
                  override={override}
                  brandColors={brandColors}
                  onChange={(next) => handleSlideOverrideChange(s.index, next)}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No design generated yet — this can happen if the automatic design
          step failed. Use the button above to try again.
        </p>
      )}
    </>
  )
}
