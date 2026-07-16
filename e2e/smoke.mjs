// Single-path smoke test: manual script mode + minimal layout. Validates
// the whole harness (auth, REST, storage, fonts, render loop) before the
// full matrix runs.
import { launch, login, generateCarousel } from './lib/driver.mjs'
import pg from 'pg'

const db = new pg.Pool({ host: '127.0.0.1', port: 55432, database: 'app', user: 'postgres' })

const { browser, context } = await launch()
const page = await context.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[browser]', m.text())
})

try {
  await login(page)
  console.log('login OK')

  const result = await generateCarousel(page, { mode: 'manual', layout: 'minimal', slideCount: 3 })
  console.log('generate result:', result)

  const { rows } = await db.query(
    `select status, layout_variant, jsonb_array_length(slide_documents) as doc_count,
            (select count(*) from carousel.slides s where s.post_id = p.id) as slide_rows
     from carousel.posts p where id = $1`,
    [result.postId]
  )
  console.log('post row:', rows[0])

  const canvas = await page.locator('[data-slide-canvas], canvas, [class*="canvas"]').count()
  const deadEnd = await page.locator('text=belum punya dokumen slide').count()
  console.log(`editor: canvas-ish elements=${canvas} deadEnd=${deadEnd}`)
  await page.screenshot({ path: 'e2e/.data/smoke-editor.png', fullPage: true })
} finally {
  await browser.close()
  await db.end()
}
