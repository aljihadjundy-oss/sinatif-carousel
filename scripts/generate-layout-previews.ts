// One-time script — not a deployed route. Run with:
//   npx tsx scripts/generate-layout-previews.ts
//
// Renders a small preview PNG per layout variant in
// lib/slide-renderer.tsx's LAYOUT_VARIANTS and writes it to
// public/layout-previews/{layout_key}.png. Committed as static files and
// never regenerated at runtime — re-run this script by hand if a layout's
// rendering ever changes.
//
// Reuses the real renderSlide() from lib/slide-renderer.tsx (the same
// function the live designer route calls) rather than duplicating any
// layout logic — that module was specifically extracted to have no
// Next-server-only imports, so it's safe to call from a plain script. This
// is the same reasoning that made scripts/generate-typography-previews.ts
// avoid importing app/api/carousel/designer/route.tsx directly (that file
// pulls in createServerSupabaseClient(), which throws outside a real
// request context) — before this extraction, previewing a layout would
// have meant a 4th copy of increasingly complex render branches.
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import {
  DEFAULT_FONTS,
  LAYOUT_VARIANTS,
  LayoutVariant,
  loadFontsForBrand,
  pickColors,
  renderSlide,
} from '../lib/slide-renderer'

const PREVIEW_WIDTH = 400
const PREVIEW_HEIGHT = 500

const SAMPLE_SLIDE = {
  index: 2,
  headline: 'Kenapa Konsistensi Konten Itu Penting',
  body: 'Brand yang konsisten posting carousel edukatif setiap minggu membangun kepercayaan audiens jauh lebih cepat.',
}

// Variants whose defining visual feature is a background photo need one
// to preview meaningfully. Generated in-memory as a data: URI (a gradient
// + a soft circle, standing in for a real photo) rather than fetched from
// the network or read from a checked-in fixture — Satori/next-og's image
// loader accepts data: URIs directly, so this keeps the script fully
// self-contained with no server needed to serve a file over HTTP.
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

// Which layouts get the sample photo vs. a solid background — matches
// what each layout actually looks like in real use: accent's
// image-background treatment and editorial_gradient are photo-first,
// minimal/flat_icon_list/flat_mockup_card are meant to be previewed in
// their normal flat/no-photo form (both flat_* variants ignore
// background_image_url entirely regardless, per their design).
const USES_SAMPLE_PHOTO: Record<LayoutVariant, boolean> = {
  minimal: false,
  accent: true,
  editorial_gradient: true,
  flat_icon_list: false,
  flat_mockup_card: false,
  terminal_dev: false,
  elegant_promo: false,
}

async function main() {
  const outDir = path.join(process.cwd(), 'public', 'layout-previews')
  await mkdir(outDir, { recursive: true })

  const colors = pickColors(
    { colors: { primary: '#1d4ed8', secondary: '#f97316', neutral: '#111827' } },
    null
  )
  const fonts = await loadFontsForBrand(DEFAULT_FONTS)
  const samplePhotoDataUri = await buildSamplePhotoDataUri()

  for (const variant of LAYOUT_VARIANTS) {
    const backgroundImageUrl = USES_SAMPLE_PHOTO[variant] ? samplePhotoDataUri : null

    const fullSizePng = await renderSlide(
      SAMPLE_SLIDE,
      5,
      colors,
      DEFAULT_FONTS,
      fonts,
      variant,
      null,
      'Sinatif Agency',
      'standard',
      'balanced',
      backgroundImageUrl,
      null
    )

    // renderSlide always outputs the real 1080x1350 slide canvas — same
    // 4:5 aspect ratio as the requested 400x500 preview size, so this is
    // a proportional downscale, not a crop.
    const preview = await sharp(fullSizePng).resize(PREVIEW_WIDTH, PREVIEW_HEIGHT).png().toBuffer()

    const outPath = path.join(outDir, `${variant}.png`)
    await writeFile(outPath, preview)
    console.log(`wrote ${outPath} (${preview.length} bytes)`)
  }
}

main().catch((err) => {
  console.error('generate-layout-previews failed:', err)
  process.exit(1)
})
