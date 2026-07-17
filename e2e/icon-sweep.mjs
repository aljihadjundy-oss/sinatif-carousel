// Bug-1 evidence sweep: EVERY icon in the asset library, through the
// real application loop:
//
//   1. UI insert  — real editor, real AssetDrawer click per icon, assert
//                   an SVG for the node actually appears on the canvas.
//   2. Write boundary + export — the icon as an IconNode document PATCHed
//                   through the real /api/carousel/slide-documents route
//                   (the same validation every editor autosave hits),
//                   which also re-renders the slide PNG via
//                   renderDocument(); the PNG is then fetched back from
//                   storage and pixel-checked: a white canvas must have
//                   gained dark pixels where the icon was placed.
//
// Prints totals + per-icon failures. Exit code 1 if any icon fails.
import { launch, login, generateCarousel } from './lib/driver.mjs'
import sharp from 'sharp'
import crypto from 'node:crypto'

const { browser, context } = await launch()
const page = await context.newPage()

const failures = { uiInsert: [], boundary: [], exportPixels: [] }
let iconNames = []

try {
  await login(page)
  const { postId } = await generateCarousel(page, { mode: 'manual', layout: 'minimal', slideCount: 3 })
  await page.goto(`http://localhost:3000/carousel/${postId}/editor`)
  await page.click('button:has-text("Aset")')
  await page.waitForSelector('input[placeholder="Cari ikon…"]')

  // The library exactly as the UI presents it.
  iconNames = await page.$$eval('button[title]', (btns) =>
    btns.map((b) => b.getAttribute('title')).filter((t) => t && t !== 'Tutup' && t !== 'Hapus post')
  )
  console.log(`asset library exposes ${iconNames.length} icons`)

  // Phase 1: UI insert + editor canvas render, one icon at a time.
  const canvas = page.locator('[class*="aspect-"][class*="relative"]').first()
  for (const name of iconNames) {
    const before = await page.locator('svg').count()
    await page.click(`button[title="${name}"]`)
    await page.waitForTimeout(60)
    const after = await page.locator('svg').count()
    if (after <= before) {
      failures.uiInsert.push(name)
      continue
    }
    await page.keyboard.press('Delete')
    await page.waitForTimeout(30)
  }
  console.log(`phase 1 (UI insert -> canvas render): ${iconNames.length - failures.uiInsert.length}/${iconNames.length} ok`)

  // Phase 2: write boundary + renderDocument export, per icon.
  const shimBase = 'http://127.0.0.1:54321'
  for (const name of iconNames) {
    const doc = {
      version: 1,
      id: crypto.randomUUID(),
      canvas: { width: 1080, height: 1350, background: { type: 'solid', color: '#ffffff' } },
      nodes: [
        {
          id: crypto.randomUUID(),
          type: 'icon',
          name,
          x: 340,
          y: 475,
          width: 400,
          height: 400,
          color: '#111827',
          strokeWidth: 2,
        },
      ],
    }
    const res = await page.request.patch('http://localhost:3000/api/carousel/slide-documents', {
      data: { post_id: postId, slide_documents: [doc] },
    })
    if (!res.ok()) {
      failures.boundary.push(`${name} (${res.status()}: ${(await res.text()).slice(0, 120)})`)
      continue
    }
    const pngRes = await page.request.get(
      `${shimBase}/storage/v1/object/public/carousel-assets/${postId}/slide-1.png?v=${Date.now()}`
    )
    if (!pngRes.ok()) {
      failures.exportPixels.push(`${name} (png fetch ${pngRes.status()})`)
      continue
    }
    const buf = Buffer.from(await pngRes.body())
    // Materialize the crop first: sharp's .stats() ignores a chained
    // .extract() and would otherwise measure the whole image. Region is
    // scaled to the actual export size (may differ from 1080x1350).
    const meta = await sharp(buf).metadata()
    const sx = (meta.width ?? 1080) / 1080
    const sy = (meta.height ?? 1350) / 1350
    const regionBuf = await sharp(buf)
      .extract({
        left: Math.round(340 * sx),
        top: Math.round(475 * sy),
        width: Math.round(400 * sx),
        height: Math.round(400 * sy),
      })
      .toBuffer()
    const region = await sharp(regionBuf).stats()
    const darkest = Math.min(...region.channels.slice(0, 3).map((c) => c.min))
    if (darkest > 200) {
      // Region stayed (near-)white -> the icon did not draw in the export.
      failures.exportPixels.push(`${name} (region min channel ${darkest})`)
    }
  }
  console.log(
    `phase 2 (write boundary -> renderDocument export -> pixels): ${
      iconNames.length - failures.boundary.length - failures.exportPixels.length
    }/${iconNames.length} ok`
  )
} finally {
  await browser.close()
}

const failed = failures.uiInsert.length + failures.boundary.length + failures.exportPixels.length
console.log('\n=== ICON SWEEP RESULT ===')
console.log(`total icons in library : ${iconNames.length}`)
console.log(`passed all stages      : ${iconNames.length - failed}`)
console.log(`failed UI insert       : ${failures.uiInsert.length} ${JSON.stringify(failures.uiInsert)}`)
console.log(`failed write boundary  : ${failures.boundary.length} ${JSON.stringify(failures.boundary)}`)
console.log(`failed export pixels   : ${failures.exportPixels.length} ${JSON.stringify(failures.exportPixels)}`)
process.exit(failed > 0 ? 1 : 0)
