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
  // Granular per-element color overrides, applied on top of whichever
  // {bg, fg, accent} colorScheme (or its default) already resolved —
  // see applyCustomColors() below. Unlike every other SlideOverride
  // field, this has no equivalent post-level default to merge against
  // (there's no post-level "custom colors" concept), so it isn't part
  // of DesignOptions/resolveSlideDesign()'s merge; the designer route
  // applies it as a separate final step per slide.
  customColors?: SlideCustomColors
}

export interface SlideCustomColors {
  fontColor?: string
  backgroundColor?: string
  shapeColor?: string
  iconColor?: string
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

export interface ResolvedSlideColors {
  bg: string
  fg: string
  accent: string
  // Only the layout's standalone topical icon (the one rendered directly
  // on the page/card background — see renderSlide's iconColor param in
  // lib/slide-renderer.tsx) reads this. Icons embedded inside a colored
  // badge/block (the seal badge, numbered list markers, the image-
  // background bottom block's icon, etc.) stay locked to that
  // container's own contrast-computed color regardless of iconColor —
  // those aren't "the icon color" as an independent choice, they're a
  // specific element's text-on-a-known-background problem that
  // getTextColorForBackground() already solves safely, and letting an
  // arbitrary manual color override that specific computation would
  // reopen the exact invisible-icon failure mode PR #47 fixed.
  icon: string
}

// Applies granular per-element overrides on top of whichever {bg, fg,
// accent} a colorScheme (or the brand/post default) already resolved to
// — per-field: an unset customColors field falls back to the preset-
// derived value, it does not fall back to some other customColors field.
// This intentionally does NOT contrast-check anything itself (see
// getManualColorContrastWarning() in lib/contrast.ts for the UI-facing
// warning) — manual color picking is a deliberate user choice the task
// spec says to warn about, not block.
export function applyCustomColors(
  colors: { bg: string; fg: string; accent: string },
  customColors: SlideCustomColors | undefined
): ResolvedSlideColors {
  return {
    bg: customColors?.backgroundColor ?? colors.bg,
    fg: customColors?.fontColor ?? colors.fg,
    accent: customColors?.shapeColor ?? colors.accent,
    icon: customColors?.iconColor ?? colors.accent,
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
