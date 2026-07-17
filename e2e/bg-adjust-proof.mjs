// Bug-4 evidence, both halves, through the real UI:
//   (a) photo as a FREE ELEMENT — insert via the toolbar's 🖼 Foto,
//       assert an independent ImageNode lands in the saved document
//       (positionable/resizable via the existing node overlay).
//   (b) background ADJUST — upload a background photo, drive the Zoom /
//       Geser X sliders, assert the saved ImageFill carries
//       scale/offsetX, and that the EXPORTED PNG actually changed pixels
//       versus the unadjusted export (parity: what the sliders preview is
//       what exports).
import { launch, login, generateCarousel } from './lib/driver.mjs'
import sharp from 'sharp'
import pg from 'pg'

const db = new pg.Pool({ host: '127.0.0.1', port: 55432, database: 'app', user: 'postgres' })

async function savedDoc(postId, index = 0) {
  // $2 must be cast to int: jsonb -> text does an object-key lookup, not
  // an array-index lookup.
  const { rows } = await db.query(
    `select slide_documents -> $2::int as doc from carousel.posts where id = $1`,
    [postId, index]
  )
  return rows[0]?.doc ?? null
}

async function makeTestImage(path) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
    <rect width="540" height="1350" fill="#e11d48"/><rect x="540" width="540" height="1350" fill="#2563eb"/>
    <circle cx="540" cy="675" r="120" fill="#facc15"/></svg>`
  await sharp(Buffer.from(svg)).jpeg().toFile(path)
}

async function setRange(page, labelText, value) {
  const slider = page.locator(`label:has-text("${labelText}") input[type="range"]`)
  await slider.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  }, String(value))
}

async function clickSimpan(page) {
  const simpan = page.locator('button:has-text("Simpan")').first()
  if (await simpan.isEnabled().catch(() => false)) await simpan.click()
  await page.waitForTimeout(5000) // debounce + PATCH + PNG re-render
}

const { browser, context } = await launch()
const page = await context.newPage()
let ok = true
const check = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`)
  if (!cond) ok = false
}

try {
  await login(page)
  const { postId } = await generateCarousel(page, { mode: 'manual', layout: 'minimal', slideCount: 3 })
  await page.goto(`http://localhost:3000/carousel/${postId}/editor`)
  await page.waitForSelector('text=PROPERTI SLIDE')

  const imgPath = 'e2e/.data/test-bg.jpg'
  await makeTestImage(imgPath)

  // ---- (a) photo as a free element -------------------------------------
  // DOM order (verified live): input 0 = toolbar 🖼 Foto (insert element),
  // input 1 = properties panel background upload. Set files directly —
  // clicking the button would open a native chooser that blocks the page.
  const fotoInput = page.locator('input[type="file"]').nth(0)
  await fotoInput.setInputFiles(imgPath)
  await page.waitForTimeout(2500)
  await clickSimpan(page)
  let doc = await savedDoc(postId)
  const imageNodes = (doc?.nodes ?? []).filter((n) => n.type === 'image')
  check(imageNodes.length === 1, `ImageNode element in saved document (found ${imageNodes.length})`)
  check(
    imageNodes[0] && imageNodes[0].width > 0 && typeof imageNodes[0].x === 'number',
    'ImageNode has free position/size (independent of background)'
  )
  check(doc?.canvas?.background?.type !== 'image', 'background untouched by element insert')

  // ---- (b) background photo + adjust ------------------------------------
  // Deselect the inserted node first: while a node is selected the right
  // panel shows NODE properties (whose "Ganti sumber" is also a file
  // input) instead of the slide's background controls. Clicking the
  // active slide's thumbnail resets selection (setSelectedId(null)).
  await page.locator('div.w-24 button').first().click()
  await page.waitForSelector('text=Atur foto background, text=Upload foto background', { timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(500)
  const panelInput = page.locator('input[type="file"]').nth(1)
  await panelInput.setInputFiles(imgPath)
  await page.waitForTimeout(2500)
  await clickSimpan(page)
  doc = await savedDoc(postId)
  check(doc?.canvas?.background?.type === 'image', 'background is an ImageFill after upload')

  // Neutral export snapshot.
  const pngUrl = `http://127.0.0.1:54321/storage/v1/object/public/carousel-assets/${postId}/slide-1.png`
  const neutralPng = Buffer.from(await (await page.request.get(`${pngUrl}?v=${Date.now()}`)).body())

  // Drive the adjust sliders.
  await setRange(page, 'Zoom', 200)
  await setRange(page, 'Geser X', 300)
  await clickSimpan(page)
  doc = await savedDoc(postId)
  check(doc?.canvas?.background?.scale === 2, `saved scale is 2 (got ${doc?.canvas?.background?.scale})`)
  check(doc?.canvas?.background?.offsetX === 300, `saved offsetX is 300 (got ${doc?.canvas?.background?.offsetX})`)

  const adjustedPng = Buffer.from(await (await page.request.get(`${pngUrl}?v=${Date.now()}`)).body())
  check(Buffer.compare(neutralPng, adjustedPng) !== 0, 'exported PNG changed after pan/zoom (parity)')

  await sharp(neutralPng).resize(270).toFile('e2e/.data/bg-neutral.png')
  await sharp(adjustedPng).resize(270).toFile('e2e/.data/bg-adjusted.png')
  await page.screenshot({ path: 'e2e/.data/bg-editor.png', fullPage: true })
  console.log('artifacts: e2e/.data/bg-neutral.png, bg-adjusted.png, bg-editor.png')
} finally {
  await browser.close()
  await db.end()
}
console.log(ok ? '\nBG-ADJUST PROOF: ALL PASS' : '\nBG-ADJUST PROOF: FAILURES ABOVE')
process.exit(ok ? 0 : 1)
