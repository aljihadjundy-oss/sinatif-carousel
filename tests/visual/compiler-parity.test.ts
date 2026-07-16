// Phase-2 parity gate (AUDIT.md risk R1): the compiled-document path
// (compileTemplate → renderDocument) must reproduce the LEGACY renderer's
// output pixel-for-pixel against the phase-0 baselines — the same
// baselines templates.test.ts holds renderSlide() to, at the same
// threshold. `created` is NOT an acceptable status here: a missing
// baseline would mean this test silently minted its own reference
// instead of proving parity with the legacy pipeline.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FONTS,
  loadFontsForBrand,
  pickColors,
} from '@/lib/slide-renderer'
import { compileTemplate } from '@/lib/template-compiler'
import { renderDocument } from '@/lib/render-document'
import { isSlideDocument } from '@/lib/slideDocument'
import { compareToBaseline } from './snapshot'

// Inputs mirror templates.test.ts exactly — same slide content, palette,
// densities — so the comparison target is the identical baseline file.
const BRAND_PALETTE = {
  colors: { primary: '#1d4ed8', secondary: '#f97316', neutral: '#111827' },
}

const STANDARD_SLIDE = {
  index: 2,
  headline: 'Kenapa Konsistensi Konten Itu Penting',
  body: 'Brand yang konsisten posting carousel edukatif setiap minggu membangun kepercayaan audiens jauh lebih cepat.',
}

const LONG_SLIDE = {
  index: 4,
  headline: 'Strategi Distribusi Konten yang Sering Dilupakan Brand Kecil',
  body:
    'Membuat konten bagus hanyalah setengah pekerjaan. Setengah lainnya adalah memastikan konten itu sampai ke orang yang tepat: repost di jam aktif audiens, ' +
    'adaptasi format per platform, dan kolaborasi dengan akun yang audiensnya beririsan. Tanpa distribusi, konten terbaik pun tenggelam dalam hitungan jam.',
}

const CASES = [
  { baseline: 'minimal--default', colorScheme: null, slide: STANDARD_SLIDE, textDensity: 'standard' as const },
  { baseline: 'minimal--scheme-secondary', colorScheme: 'secondary', slide: STANDARD_SLIDE, textDensity: 'standard' as const },
  { baseline: 'minimal--long-detailed', colorScheme: null, slide: LONG_SLIDE, textDensity: 'detailed' as const },
]

describe('compiled minimal template matches legacy renderer baselines', async () => {
  const fonts = await loadFontsForBrand(DEFAULT_FONTS)

  for (const c of CASES) {
    it(c.baseline, async () => {
      const doc = await compileTemplate(
        'minimal',
        {
          slide: c.slide,
          total: 5,
          colors: pickColors(BRAND_PALETTE, c.colorScheme),
          fontConfig: DEFAULT_FONTS,
          textDensity: c.textDensity,
          hierarchy: 'balanced',
          logoUrl: null,
          brandName: 'Sinatif Agency',
          backgroundImageUrl: null,
          iconChoice: null,
          iconColor: null,
        },
        fonts
      )
      expect(isSlideDocument(doc)).toBe(true)
      expect(doc.manuallyEdited).toBe(false)

      const png = await renderDocument(doc)
      const result = compareToBaseline(c.baseline, png)
      expect(result.status, result.message).toBe('matched')
    })
  }
})
