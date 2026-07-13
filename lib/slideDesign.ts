import { LayoutVariant, TextDensity } from '@/lib/slide-renderer'

// Per-slide overrides. Originally (PR #52) this comment said layout
// template and background mode were intentionally excluded — that was a
// deliberate scope boundary for the first version of this feature, not a
// structural limitation; both are now overridable per slide too
// (backgroundImageUrl, layoutTemplate below), superseding that boundary.
export interface SlideOverride {
  slideIndex: number
  colorScheme?: string
  // The task spec that introduced this feature used 'normal' for the
  // middle tier, but every existing density value in this codebase
  // (lib/slide-renderer.tsx's TextDensity, TEXT_DENSITIES, the designer
  // route's validation, the DB column's existing values) is 'standard' —
  // matching that instead of introducing a second, inconsistent name for
  // the same tier.
  textDensity?: TextDensity
  // Per-slide background image — applies to any layout that reads
  // backgroundImageUrl (accent/minimal's image-bg treatment,
  // editorial_gradient, news_card, photo_editorial). Falls back to the
  // post-level background_image_url, same as every other override field.
  backgroundImageUrl?: string
  // Per-slide layout template. One of LAYOUT_VARIANTS (see
  // lib/slide-renderer.tsx) — validated against that list wherever this
  // is read from untrusted input (the designer route), not re-declared
  // as its own union here to avoid the two drifting apart.
  layoutTemplate?: LayoutVariant
}

export interface DesignOptions {
  colorScheme: string | null
  textDensity: TextDensity
  backgroundImageUrl: string | null
  layoutTemplate: LayoutVariant
}

// Merges a post's default design with whichever override (if any) applies
// to a given slide index.
export function resolveSlideDesign(
  defaultDesign: DesignOptions,
  overrides: SlideOverride[],
  slideIndex: number
): DesignOptions {
  const override = overrides.find((o) => o.slideIndex === slideIndex)
  if (!override) return defaultDesign
  return {
    ...defaultDesign,
    colorScheme: override.colorScheme ?? defaultDesign.colorScheme,
    textDensity: override.textDensity ?? defaultDesign.textDensity,
    backgroundImageUrl: override.backgroundImageUrl ?? defaultDesign.backgroundImageUrl,
    layoutTemplate: override.layoutTemplate ?? defaultDesign.layoutTemplate,
  }
}

// Drops overrides that no longer correspond to a real slide — called
// whenever the underlying script's slide count can change (editing the
// script, regenerating with a different slide_count). Keeping a stale
// override around is harmless on its own (resolveSlideDesign simply never
// matches it), but leaving it in the persisted array forever would let it
// silently reattach itself if a later edit brings the slide count back up
// to cover that index again with different, unrelated content.
//
// slideIndex is 1-based here, matching Slide.index everywhere else in
// this codebase (script-writer's output, renderSlide's "N / total"
// counters, carousel.slides.slide_order) — a post with 5 slides has
// indices 1..5, so the valid range is slideIndex <= newSlideCount, not
// the 0-based "< newSlideCount" a literal reading of "slideIndex >= new
// slide count" would suggest for a 0-based scheme this app doesn't use.
export function reindexSlideOverrides(
  overrides: SlideOverride[],
  newSlideCount: number
): SlideOverride[] {
  return overrides.filter((o) => o.slideIndex <= newSlideCount)
}
