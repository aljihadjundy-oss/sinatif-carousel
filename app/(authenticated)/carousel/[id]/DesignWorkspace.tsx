'use client'

import { useState } from 'react'
import RegenerateDesignButton from './RegenerateDesignButton'
import SlideImage from './SlideImage'
import SlideCustomizeControl from './SlideCustomizeControl'
import { Hierarchy, IconSelection, LayoutVariant, TextDensity } from './DesignOptionsPanel'
import Link from 'next/link'
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
  // Phase-5.2 deprecation gate: once a post has slide_documents (auto
  // since phase 2), the canvas editor is the per-slide source of truth
  // and the legacy per-slide override dropdowns are hidden in favor of a
  // link there. Pre-phase-2 posts (empty slide_documents) keep the full
  // legacy UI as the fallback path — AUDIT.md risk R4's lazy
  // materialization assumption, and why none of the old code is deleted.
  hasSlideDocuments: boolean
  // How many slides are manuallyEdited — those keep their canvas look
  // through a regenerate (phase-5.1 protection); saying so up front
  // beats letting the user wonder why "nothing changed" on them.
  manuallyEditedCount: number
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
  hasSlideDocuments,
  manuallyEditedCount,
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

      {manuallyEditedCount > 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {manuallyEditedCount} slide sudah diedit manual di Editor Kanvas dan akan
          dipertahankan apa adanya saat regenerate — slide lain tetap mengikuti opsi desain di
          atas.
        </p>
      )}

      {hasDesign ? (
        <div className="grid grid-cols-2 gap-3">
          {renderedSlides.map((s) => {
            const override = slideOverrides.find((o) => o.slideIndex === s.index)
            return (
              <div key={s.index}>
                <SlideImage topic={topic} index={s.index} url={s.url} isCustomized={!!override} />
                {hasSlideDocuments ? (
                  s.index === 1 ? (
                    <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                      Kustomisasi per-slide kini di{' '}
                      <Link
                        href={`/carousel/${postId}/editor`}
                        className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Editor Kanvas
                      </Link>
                      .
                    </p>
                  ) : null
                ) : (
                  <SlideCustomizeControl
                    slideIndex={s.index}
                    override={override}
                    brandColors={brandColors}
                    postId={postId}
                    defaultBackgroundImageUrl={initialBackgroundImageUrl}
                    onChange={(next) => handleSlideOverrideChange(s.index, next)}
                  />
                )}
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
