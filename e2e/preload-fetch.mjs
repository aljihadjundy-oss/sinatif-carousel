// Preloaded into the Next.js dev process via NODE_OPTIONS="--import ...".
//
// The sandbox this harness runs in has no direct outbound network: Node's
// fetch ignores HTTPS_PROXY, and api.groq.com is egress-blocked entirely.
// This wraps globalThis.fetch BEFORE Next.js patches it (Next wraps the
// pre-existing global, so this stays underneath):
//
//   - localhost/127.0.0.1  -> untouched (app, shim, storage)
//   - api.groq.com         -> the shim's OpenAI-compatible mock, method
//                             and body preserved
//   - any other https GET  -> the shim's /fwd forwarder, which re-issues
//                             the request through a proxy-aware agent
//                             (Google Fonts CSS + font binaries)
//
// Anything else external fails loudly rather than hanging.

const SHIM = process.env.E2E_SHIM_ORIGIN ?? 'http://127.0.0.1:54321'
const realFetch = globalThis.fetch

globalThis.fetch = async function e2eFetch(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)

  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return realFetch(input, init)
  }

  if (url.hostname === 'api.groq.com') {
    const target = `${SHIM}/groq-mock${url.pathname.replace(/^\/openai/, '')}`
    if (typeof input !== 'string' && !(input instanceof URL)) {
      return realFetch(new Request(target, input), init)
    }
    return realFetch(target, init)
  }

  const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')) || 'GET'
  if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
    throw new Error(`e2e preload-fetch: refusing non-GET external request ${method} ${url}`)
  }
  return realFetch(`${SHIM}/fwd?url=${encodeURIComponent(String(url))}`, { method })
}
