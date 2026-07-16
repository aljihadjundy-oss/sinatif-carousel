// Phase-2 parity gate (AUDIT.md risk R1): the compiled-document path
// (compileTemplate → renderDocument) must reproduce the LEGACY renderer's
// output pixel-for-pixel against the phase-0 baselines — the same
// baselines templates.test.ts holds renderSlide() to, at the same
// threshold. `created` is NOT an acceptable status here: a missing
// baseline would mean this test silently minted its own reference
// instead of proving parity with the legacy pipeline.
//
// Covers every phase-0 baseline: 9 templates x 3 variations + the 3
// no-photo fallback cases = 30 parity checks, exercising both compile
// strategies (measured flex math for 'minimal', probe rendering for the
// rest) and both photo/no-photo code paths.
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  DEFAULT_FONTS,
  LAYOUT_VARIANTS,
  LayoutVariant,
  pickColors,
} from '@/lib/slide-renderer'
import { ICON_NAMES } from '@/lib/icons'
import { compileTemplate, loadLegacyFontSet } from '@/lib/template-compiler'
import { renderDocument } from '@/lib/render-document'
import { getSlideDocumentContentError, isSlideDocument } from '@/lib/slideDocument'
import { compareToBaseline } from './snapshot'

// Inputs mirror templates.test.ts exactly — same slide content, palette,
// densities, photo assignment — so the comparison target is the
// identical baseline file.
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

async function buildSamplePhotoDataUri(): Promise<string> {
  const width = 1080
  const height = 1350
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#3a5f8a"/>
          <stop offset="50%" stop-color="#7fa8c9"/>
          <stop offset="100%" stop-color="#c9a87f"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <circle cx="${width * 0.5}" cy="${height * 0.4}" r="${width * 0.3}" fill="#ffffff" opacity="0.15"/>
    </svg>`
  )
  const jpeg = await sharp(svg).jpeg({ quality: 85 }).toBuffer()
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`
}

const USES_SAMPLE_PHOTO: Record<LayoutVariant, boolean> = {
  minimal: false,
  accent: true,
  editorial_gradient: true,
  flat_icon_list: false,
  flat_mockup_card: false,
  terminal_dev: false,
  elegant_promo: false,
  news_card: true,
  photo_editorial: true,
}

const VARIATIONS = [
  { key: 'default', colorScheme: null as string | null, slide: STANDARD_SLIDE, textDensity: 'standard' as const },
  { key: 'scheme-secondary', colorScheme: 'secondary' as string | null, slide: STANDARD_SLIDE, textDensity: 'standard' as const },
  { key: 'long-detailed', colorScheme: null as string | null, slide: LONG_SLIDE, textDensity: 'detailed' as const },
]

const PHOTO_FALLBACK_VARIANTS: LayoutVariant[] = ['editorial_gradient', 'news_card', 'photo_editorial']

describe('compiled templates match legacy renderer baselines', async () => {
  const samplePhotoDataUri = await buildSamplePhotoDataUri()

  async function runCase(
    variant: LayoutVariant,
    variation: (typeof VARIATIONS)[number],
    baselineName: string,
    forceNoPhoto = false
  ) {
    const fonts = await loadLegacyFontSet(variant, DEFAULT_FONTS)
    const doc = await compileTemplate(
      variant,
      {
        slide: variation.slide,
        total: 5,
        colors: pickColors(BRAND_PALETTE, variation.colorScheme),
        fontConfig: DEFAULT_FONTS,
        textDensity: variation.textDensity,
        hierarchy: 'balanced',
        logoUrl: null,
        brandName: 'Sinatif Agency',
        backgroundImageUrl: !forceNoPhoto && USES_SAMPLE_PHOTO[variant] ? samplePhotoDataUri : null,
        iconChoice: null,
        iconColor: null,
      },
      fonts
    )
    expect(isSlideDocument(doc)).toBe(true)
    expect(doc.manuallyEdited).toBe(false)
    // Compiler output must pass the same write-boundary validation the
    // designer route applies before persisting slide_documents.
    expect(getSlideDocumentContentError(doc, ICON_NAMES)).toBeNull()

    const png = await renderDocument(doc)
    const result = compareToBaseline(baselineName, png)
    expect(result.status, result.message).toBe('matched')
  }

  for (const variant of LAYOUT_VARIANTS) {
    for (const variation of VARIATIONS) {
      it(`${variant} / ${variation.key}`, async () => {
        await runCase(variant, variation, `${variant}--${variation.key}`)
      })
    }
  }

  for (const variant of PHOTO_FALLBACK_VARIANTS) {
    it(`${variant} / no-photo-fallback`, async () => {
      await runCase(variant, VARIATIONS[0], `${variant}--no-photo-fallback`, true)
    })
  }
})
