// Shared Playwright driver helpers for the E2E flows. Uses the sandbox's
// pre-installed Chromium; everything runs against localhost so no proxy
// config is needed in the browser.
import { chromium } from 'playwright'

export const APP = 'http://localhost:3000'
export const CREDS = { email: 'e2e@test.local', password: 'e2e-password-123' }

export async function launch() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  return { browser, context }
}

export async function login(page) {
  await page.goto(`${APP}/login`)
  // A context that already holds a session is redirected off /login (or
  // renders no form) — treat that as already-logged-in, don't wait 30s.
  if (page.url().includes('/dashboard')) return
  const email = page.locator('input[type="email"]')
  try {
    await email.waitFor({ timeout: 4000 })
  } catch {
    return
  }
  await email.fill(CREDS.email)
  await page.fill('input[type="password"]', CREDS.password)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 20000 })
}

// Drive the real "new carousel" form through one of the three script
// modes, pick a layout, and click Generate Design. Resolves once the
// browser lands wherever the app takes it (editor on success, post page
// on designer failure) — the caller inspects the outcome.
export async function generateCarousel(page, { mode, layout, slideCount = 4, textDensity = 'standard' }) {
  await page.goto(`${APP}/carousel/new`)

  if (mode === 'ai') {
    await page.click('button:has-text("Generate with AI")')
    await page.fill('input[placeholder*="engagement"]', `Topik E2E ${layout} ${Date.now() % 100000}`)
    await page.fill('input[min="3"]', String(slideCount))
    await page.click('button[type="submit"]')
  } else if (mode === 'manual') {
    await page.click('button:has-text("Write My Own Script")')
    await page.fill('input[placeholder*="engagement"]', `Topik manual ${layout} ${Date.now() % 100000}`)
    for (let i = 0; i < slideCount - 1; i++) {
      await page.click('button:has-text("+ Add Slide")')
    }
    const headlines = page.locator('input[placeholder="Headline"]')
    const bodies = page.locator('textarea[placeholder="Body"]')
    for (let i = 0; i < slideCount; i++) {
      await headlines.nth(i).fill(i === 0 ? `Judul utama ${layout}` : `Poin ${i} untuk ${layout}`)
      await bodies
        .nth(i)
        .fill(`Isi slide ${i + 1}: penjelasan praktis yang cukup panjang untuk menguji layout ${layout} secara realistis.`)
    }
    await page.click('button[type="submit"]')
  } else if (mode === 'research') {
    await page.click('button:has-text("From Research/Article")')
    await page.fill(
      'textarea[placeholder*="article"]',
      `Riset E2E untuk ${layout}: engagement Instagram naik 40% ketika carousel memakai hook kuat di slide pertama. ` +
        'Data internal menunjukkan carousel 4-6 slide punya completion rate tertinggi. ' +
        'Caption dengan pertanyaan meningkatkan komentar 2x lipat.'
    )
    await page.fill('input[min="3"]', String(slideCount))
    await page.click('button:has-text("Generate Ideas")')
    await page.waitForSelector('text=Pick one angle', { timeout: 30000 })
    await page.click('button:has-text("Angle 1")')
  } else {
    throw new Error(`unknown mode ${mode}`)
  }

  // All modes converge on the shared design-options step.
  await page.waitForSelector('text=Script siap', { timeout: 60000 })
  if (textDensity !== 'standard') {
    await page.click(`button:has-text("${textDensity[0].toUpperCase()}${textDensity.slice(1)}")`)
  }
  await page.click(`button:has(img[alt]) >> img[src*="/layout-previews/${layout}.png"]`)
  await page.click('button:has-text("Generate Design")')

  // Success -> /carousel/<id>/editor ; designer failure -> /carousel/<id>
  await page.waitForURL(/\/carousel\/[0-9a-f-]+/, { timeout: 120000 })
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {})
  const url = page.url()
  const postId = url.match(/\/carousel\/([0-9a-f-]+)/)?.[1] ?? null
  return { url, postId, landedInEditor: /\/editor/.test(url) }
}
