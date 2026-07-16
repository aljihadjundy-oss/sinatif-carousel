// Phase-0 safety net for the generator → visual-editor migration (see
// AUDIT.md): pixel-level baselines for every layout template rendered
// through the real renderSlide() — the same pure function the live
// designer route calls. Phases 1+ (SlideDocument data model, template
// compiler, renderDocument()) must keep these renders byte-stable; any
// visual drift fails here with a diff image instead of being discovered
// by a user.
//
// First run writes the baselines (committed under __baselines__/);
// subsequent runs compare. UPDATE_SNAPSHOTS=1 re-accepts intentionally
// changed output.
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  DEFAULT_FONTS,
  LAYOUT_VARIANTS,
  LayoutVariant,
  loadFontsForBrand,
  pickColors,
  renderSlide,
} from '@/lib/slide-renderer'
import { compareToBaseline } from './snapshot'

// Same in-memory data-URI stand-in for a photo that
// scripts/generate-layout-previews.ts uses — no network, no fixture file
// to bit-rot, and Satori's image loader accepts data: URIs directly.
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

// Mirrors the preview script's judgement of which layouts are photo-first
// in real use. Photo-dependent templates (news_card, photo_editorial,
// editorial_gradient) additionally get a dedicated no-photo variation
// below, because their fallback branch is exactly the kind of code a
// renderer refactor is most likely to break silently.
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

interface Variation {
  key: string
  colorScheme: string | null
  slide: typeof STANDARD_SLIDE
  textDensity: 'concise' | 'standard' | 'detailed'
  photo: 'default' | 'never'
}

// 3 variations per template: default brand palette, an alternate color
// scheme (re-roots which palette color is the background — exercises the
// derived-fg contrast path), and long/detailed content (exercises text
// fitting/scaling). 9 templates x 3 = 27 baselines, plus the no-photo
// fallback cases for the 3 photo-dependent templates.
const VARIATIONS: Variation[] = [
  { key: 'default', colorScheme: null, slide: STANDARD_SLIDE, textDensity: 'standard', photo: 'default' },
  { key: 'scheme-secondary', colorScheme: 'secondary', slide: STANDARD_SLIDE, textDensity: 'standard', photo: 'default' },
  { key: 'long-detailed', colorScheme: null, slide: LONG_SLIDE, textDensity: 'detailed', photo: 'default' },
]

const PHOTO_FALLBACK_VARIANTS: LayoutVariant[] = ['editorial_gradient', 'news_card', 'photo_editorial']

describe('layout template visual baselines', async () => {
  const fonts = await loadFontsForBrand(DEFAULT_FONTS)
  const samplePhotoDataUri = await buildSamplePhotoDataUri()

  async function renderCase(
    variant: LayoutVariant,
    variation: Variation,
    forceNoPhoto = false
  ): Promise<Buffer> {
    const colors = pickColors(BRAND_PALETTE, variation.colorScheme)
    const backgroundImageUrl =
      !forceNoPhoto && variation.photo === 'default' && USES_SAMPLE_PHOTO[variant]
        ? samplePhotoDataUri
        : null
    return renderSlide(
      variation.slide,
      5,
      colors,
      DEFAULT_FONTS,
      fonts,
      variant,
      null,
      'Sinatif Agency',
      variation.textDensity,
      'balanced',
      backgroundImageUrl,
      null
    )
  }

  for (const variant of LAYOUT_VARIANTS) {
    for (const variation of VARIATIONS) {
      it(`${variant} / ${variation.key}`, async () => {
        const png = await renderCase(variant, variation)
        const result = compareToBaseline(`${variant}--${variation.key}`, png)
        expect(result.status, result.message).toMatch(/^(created|matched)$/)
      })
    }
  }

  for (const variant of PHOTO_FALLBACK_VARIANTS) {
    it(`${variant} / no-photo-fallback`, async () => {
      const png = await renderCase(variant, VARIATIONS[0], true)
      const result = compareToBaseline(`${variant}--no-photo-fallback`, png)
      expect(result.status, result.message).toMatch(/^(created|matched)$/)
    })
  }
})
