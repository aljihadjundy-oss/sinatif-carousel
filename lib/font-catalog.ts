// Pure catalog of the bundled font files — extracted from
// lib/slide-renderer.tsx (which imports fs/next-og and therefore can't
// be imported by client components) so the phase-4 editor properties
// panel can offer the exact same families/weights the exporter can
// actually render. Keys are "<family>-<weight>", values are filenames
// under public/fonts/. Every (family, weight) used anywhere in
// BRAND_FONTS, DEFAULT_FONTS, typography presets, or the fallback must
// have an entry here.
export const FONT_FILES: Record<string, string> = {
  'Inter-400': 'inter-400.ttf',
  'Inter-600': 'inter-600.ttf',
  'Inter-700': 'inter-700.ttf',
  'Khand-700': 'khand-700.ttf',
  'Nunito-400': 'nunito-400.ttf',
  'Cinzel-700': 'cinzel-700.ttf',
  'Poppins-400': 'poppins-400.ttf',
  'Archivo Black-400': 'archivo-black-400.ttf',
  'Architects Daughter-400': 'architects-daughter-400.ttf',
  'Noto Sans-400': 'noto-sans-400.ttf',
  'JetBrains Mono-400': 'jetbrains-mono-400.woff',
  'JetBrains Mono-700': 'jetbrains-mono-700.woff',
  'Playfair Display-400': 'playfair-display-400.woff',
  'Playfair Display-700': 'playfair-display-700.woff',
  'Caveat-700': 'caveat-700.woff',
}

// family -> available weights, for the editor's font pickers.
export const FONT_CATALOG: { family: string; weights: number[] }[] = Object.keys(FONT_FILES)
  .map((key) => {
    const sep = key.lastIndexOf('-')
    return { family: key.slice(0, sep), weight: Number(key.slice(sep + 1)) }
  })
  .reduce<{ family: string; weights: number[] }[]>((acc, { family, weight }) => {
    const entry = acc.find((e) => e.family === family)
    if (entry) entry.weights.push(weight)
    else acc.push({ family, weights: [weight] })
    return acc
  }, [])
