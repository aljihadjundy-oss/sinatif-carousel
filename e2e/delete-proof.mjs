// Feature-5 evidence: delete a post from the dashboard through the real
// UI (confirm dialog included) and prove with queries + storage listing
// that nothing is left behind: posts row, slides rows, stage_outputs
// rows, and every storage object under carousel-assets/{postId}/.
import { launch, login, generateCarousel } from './lib/driver.mjs'
import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const db = new pg.Pool({ host: '127.0.0.1', port: 55432, database: 'app', user: 'postgres' })
const storageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '.data', 'storage', 'carousel-assets')

async function counts(postId) {
  const { rows } = await db.query(
    `select
       (select count(*)::int from carousel.posts where id = $1) as posts,
       (select count(*)::int from carousel.slides where post_id = $1) as slides,
       (select count(*)::int from carousel.stage_outputs where post_id = $1) as stage_outputs`,
    [postId]
  )
  const dir = path.join(storageRoot, postId)
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, String(f))).isFile())
    : []
  return { ...rows[0], storage_files: files.length, storage_list: files.map(String) }
}

const { browser, context } = await launch()
const page = await context.newPage()

try {
  await login(page)
  const { postId } = await generateCarousel(page, { mode: 'manual', layout: 'minimal', slideCount: 3 })
  console.log('created post', postId)
  console.log('BEFORE delete:', JSON.stringify(await counts(postId), null, 2))

  await page.goto('http://localhost:3000/dashboard')
  page.once('dialog', (d) => {
    console.log('confirm dialog shown:', JSON.stringify(d.message()))
    d.accept()
  })
  // The delete button sits on the row for this post (newest first).
  await page.locator('button[title="Hapus post"]').first().click()
  await page.waitForTimeout(4000)

  const after = await counts(postId)
  console.log('AFTER delete:', JSON.stringify(after, null, 2))
  const clean =
    after.posts === 0 && after.slides === 0 && after.stage_outputs === 0 && after.storage_files === 0
  console.log(clean ? '\nDELETE PROOF: CLEAN — no orphan rows or files' : '\nDELETE PROOF: FAILED — orphans remain')
  process.exitCode = clean ? 0 : 1
} finally {
  await browser.close()
  await db.end()
}
