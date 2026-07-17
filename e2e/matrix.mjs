// Evidence matrix: [generate path x layout]. Each cell drives the REAL
// app flow in a real browser (route -> DB -> UI) and records:
//   - where the browser landed (editor vs post page fallback)
//   - posts.status / layout_variant / slide_documents count in the DB
//   - whether the editor actually opened (properties panel present)
//   - whether the dead-end message appeared
//
// Usage: node e2e/matrix.mjs [--modes ai,manual,research] [--layouts a,b,c]
import { launch, login, generateCarousel } from './lib/driver.mjs'
import pg from 'pg'

const ALL_LAYOUTS = [
  'minimal', 'accent', 'editorial_gradient', 'terminal_dev', 'elegant_promo',
  'news_card', 'photo_editorial', 'flat_icon_list', 'flat_mockup_card',
]
const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? def : args[i + 1].split(',')
}
const modes = opt('modes', ['manual'])
const layouts = opt('layouts', ALL_LAYOUTS)

const db = new pg.Pool({ host: '127.0.0.1', port: 55432, database: 'app', user: 'postgres' })
const { browser, context } = await launch()
const results = []

// Path 4: "regenerate" — one post is created once (manual/minimal), then
// each layout is applied via the post page's Regenerate Design panel.
// editorial_gradient is imageOnly there (hidden while background=solid),
// so it's exercised through the new-form paths instead.
async function runRegenCells() {
  const page = await context.newPage()
  await login(page)
  const { postId } = await generateCarousel(page, { mode: 'manual', layout: 'minimal', slideCount: 3 })
  for (const layout of layouts.filter((l) => l !== 'editorial_gradient')) {
    const cell = { mode: 'regen', layout, postId }
    try {
      await page.goto(`http://localhost:3000/carousel/${postId}`)
      await page.click(`button:has(img[src*="/layout-previews/${layout}.png"])`)
      await page.click('button:has-text("Regenerate Design")')
      // Completion signal: the post row reflects the new layout (or the
      // route errored — caught by the DB assert below staying stale).
      const deadline = Date.now() + 120000
      let row = null
      while (Date.now() < deadline) {
        const { rows } = await db.query(
          `select status, layout_variant, jsonb_array_length(slide_documents) as doc_count
           from carousel.posts where id = $1`,
          [postId]
        )
        row = rows[0]
        if (row?.layout_variant === layout) break
        await new Promise((r) => setTimeout(r, 2000))
      }
      Object.assign(cell, row ?? {})
      await page.goto(`http://localhost:3000/carousel/${postId}/editor`)
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
      cell.editorOpens = (await page.locator('text=PROPERTI SLIDE').count()) > 0
      cell.deadEnd = (await page.locator('text=belum punya dokumen slide').count()) > 0
    } catch (err) {
      cell.error = String(err).slice(0, 200)
    }
    results.push(cell)
    console.log(JSON.stringify(cell))
  }
  await page.close()
}

try {
  if (modes.includes('regen')) await runRegenCells()
  for (const mode of modes.filter((m) => m !== 'regen')) {
    for (const layout of layouts) {
      const page = await context.newPage()
      const cell = { mode, layout }
      try {
        await login(page)
        const r = await generateCarousel(page, { mode, layout, slideCount: 3 })
        cell.postId = r.postId
        cell.landedInEditor = r.landedInEditor

        const { rows } = await db.query(
          `select status, layout_variant, jsonb_array_length(slide_documents) as doc_count,
                  (select count(*)::int from carousel.slides s where s.post_id = p.id) as slide_rows
           from carousel.posts p where id = $1`,
          [r.postId]
        )
        Object.assign(cell, rows[0] ?? { status: 'ROW MISSING' })

        // The editor page itself: did the canvas actually open?
        await page.goto(`http://localhost:3000/carousel/${r.postId}/editor`)
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
        cell.editorOpens = (await page.locator('text=PROPERTI SLIDE').count()) > 0
        cell.deadEnd = (await page.locator('text=belum punya dokumen slide').count()) > 0
        cell.thumbnails = await page.locator('button:has(canvas), [class*="thumb"]').count()
      } catch (err) {
        cell.error = String(err).slice(0, 200)
      } finally {
        await page.close()
      }
      results.push(cell)
      console.log(JSON.stringify(cell))
    }
  }
} finally {
  await browser.close()
  await db.end()
}

console.log('\n| mode | layout | status | layout_variant | docs | editor opens | dead-end |')
console.log('|------|--------|--------|----------------|------|--------------|----------|')
for (const c of results) {
  console.log(
    `| ${c.mode} | ${c.layout} | ${c.status ?? '?'} | ${c.layout_variant ?? '?'} | ${c.doc_count ?? '?'} | ${
      c.editorOpens ? 'YES' : 'NO'
    } | ${c.deadEnd ? 'YES ❌' : 'no'} |${c.error ? ` ERROR: ${c.error}` : ''}`
  )
}
