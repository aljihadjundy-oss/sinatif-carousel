// Incident fix proof: the root URL '/' must resolve into the app, not the
// create-next-app scaffold. Two contexts, mirroring what a real visitor
// hits at sinatif-carousel.vercel.app:
//   - logged out: '/' -> /dashboard -> (middleware) -> /login
//   - logged in : '/' -> /dashboard (stays)
// Also asserts the old boilerplate string is gone from '/'.
import { launch, login } from './lib/driver.mjs'

const { browser, context } = await launch()
let ok = true
const check = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`)
  if (!cond) ok = false
}

try {
  // Logged-out: fresh context, no session.
  const anon = await context.browser().newContext()
  const p1 = await anon.newPage()
  await p1.goto('http://localhost:3000/', { waitUntil: 'networkidle' })
  check(p1.url().includes('/login'), `logged-out '/' lands on /login (got ${p1.url()})`)
  const body = await p1.content()
  check(!body.includes('Get started by editing'), "no create-next-app boilerplate at '/'")
  await anon.close()

  // Logged-in: authenticate, then hit '/'.
  const p2 = await context.newPage()
  await login(p2)
  await p2.goto('http://localhost:3000/', { waitUntil: 'networkidle' })
  check(p2.url().includes('/dashboard'), `logged-in '/' lands on /dashboard (got ${p2.url()})`)
  const dash = await p2.content()
  check(dash.includes('Dashboard') && !dash.includes('Get started by editing'), 'dashboard renders, no boilerplate')
} finally {
  await browser.close()
}
console.log(ok ? '\nREDIRECT PROOF: ALL PASS' : '\nREDIRECT PROOF: FAILURES ABOVE')
process.exit(ok ? 0 : 1)
