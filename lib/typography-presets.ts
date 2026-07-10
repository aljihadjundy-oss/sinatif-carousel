// Single source of truth for the 5 typography presets — shared by the
// preview-generation script (scripts/generate-typography-previews.ts),
// the designer route (app/api/carousel/designer/route.tsx), and the
// options UI (DesignOptionsPanel.tsx), so the preset list/definitions
// only ever need to change in one place.
//
// Every font family/weight pair used here must already be bundled in
// public/fonts/ (see FONT_FILES in the designer route) — picked
// specifically from the fonts already downloaded for BRAND_FONTS there,
// so this feature needs zero new font downloads.
export type FontWeight = 400 | 500 | 600 | 700 | 800 | 900

export interface TypographyPreset {
  key: string
  name: string
  headlineFamily: string
  headlineWeight: FontWeight
  bodyFamily: string
  bodyWeight: FontWeight
}

export const TYPOGRAPHY_PRESETS: TypographyPreset[] = [
  {
    key: 'modern_sans',
    name: 'Modern Sans',
    headlineFamily: 'Inter',
    headlineWeight: 700,
    bodyFamily: 'Inter',
    bodyWeight: 400,
  },
  {
    key: 'editorial_bold',
    name: 'Editorial Bold',
    headlineFamily: 'Archivo Black',
    headlineWeight: 400,
    bodyFamily: 'Inter',
    bodyWeight: 400,
  },
  {
    key: 'elegant_serif',
    name: 'Elegant Serif',
    headlineFamily: 'Cinzel',
    headlineWeight: 700,
    bodyFamily: 'Poppins',
    bodyWeight: 400,
  },
  {
    key: 'friendly_rounded',
    name: 'Friendly Rounded',
    headlineFamily: 'Khand',
    headlineWeight: 700,
    bodyFamily: 'Nunito',
    bodyWeight: 400,
  },
  {
    key: 'handwritten_accent',
    name: 'Handwritten Accent',
    headlineFamily: 'Architects Daughter',
    headlineWeight: 400,
    bodyFamily: 'Inter',
    bodyWeight: 400,
  },
]

export type TypographyPresetKey = (typeof TYPOGRAPHY_PRESETS)[number]['key']

export const TYPOGRAPHY_PRESET_KEYS: TypographyPresetKey[] = TYPOGRAPHY_PRESETS.map(
  (p) => p.key
)

export function getTypographyPreset(key: string | null | undefined): TypographyPreset | null {
  if (!key) return null
  return TYPOGRAPHY_PRESETS.find((p) => p.key === key) ?? null
}
