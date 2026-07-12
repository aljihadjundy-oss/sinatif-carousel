// WCAG-based text-color selection — replaces guessing a text color from
// where a hex code happens to sit in a brand's palette array (which
// produced real invisible-text bugs this session: a palette's 2nd color
// landing on "white", used as both an accent block's background *and*
// its hardcoded white text). Picking the text color from the actual
// luminance of whatever it's rendered on is correct regardless of how
// the brand happened to order its palette.

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace('#', '').trim()
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

// Relative luminance per the WCAG 2.x formula:
// https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
export function getLuminance(hexColor: string): number {
  const rgb = hexToRgb(hexColor)
  if (!rgb) return 0.5 // unparseable input: neutral value, caller still gets a deterministic answer

  const channel = (value: number) => {
    const srgb = value / 255
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4)
  }

  const r = channel(rgb.r)
  const g = channel(rgb.g)
  const b = channel(rgb.b)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// WCAG contrast ratio between two relative luminances:
// https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

// Returns '#000000' or '#FFFFFF' — whichever gives higher contrast
// against the given background, per actual WCAG contrast ratios rather
// than a fixed luminance threshold guess.
export function getTextColorForBackground(bgHexColor: string): '#000000' | '#FFFFFF' {
  const bgLuminance = getLuminance(bgHexColor)
  const contrastWithBlack = contrastRatio(bgLuminance, getLuminance('#000000'))
  const contrastWithWhite = contrastRatio(bgLuminance, getLuminance('#ffffff'))
  return contrastWithBlack >= contrastWithWhite ? '#000000' : '#FFFFFF'
}

// Phase 1: uploaded/AI-generated backgrounds are assumed dark enough (or
// have a dark gradient scrim applied over them, see slide-renderer.tsx)
// for white text to read — the imageUrl param is unused for now.
// Phase 2: extract the image's actual dominant color (e.g. sampling
// pixels via `sharp`/canvas server-side, since this runs in a Node
// route, not a browser) and run it through getTextColorForBackground.
export function getTextColorFromImage(imageUrl: string | null): '#000000' | '#FFFFFF' {
  void imageUrl
  return '#FFFFFF'
}
