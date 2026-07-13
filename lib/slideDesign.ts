import { TextDensity } from '@/lib/slide-renderer'

// Per-slide overrides for color scheme and text density. Layout template
// and background mode are intentionally NOT overridable per slide — both
// are structural (which JSX branch renderSlide takes, whether a photo is
// fetched at all) rather than a per-slide styling knob, so they stay
// post-level only. Keeping that split explicit here rather than letting
// a future SlideOverride field creep in casually.
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
}

export interface DesignOptions {
  colorScheme: string | null
  textDensity: TextDensity
}

// Merges a post's default design with whichever override (if any) applies
// to a given slide index. Only colorScheme/textDensity are ever
// overridden — an override object with other shapes can't express
// anything else since SlideOverride itself has no other fields.
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
