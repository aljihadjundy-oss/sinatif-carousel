// Local Supabase wire-protocol shim for E2E testing.
//
// Why this exists: the CI/agent sandbox blocks all egress to the real
// Supabase project AND blocks Docker registry blob CDNs (so `supabase
// start` can't pull its images). This server speaks the subset of the
// Supabase HTTP surface this app actually uses — GoTrue password auth,
// PostgREST-style REST, Storage objects — backed by a REAL local
// Postgres 16 running the production-replicated schema with real RLS.
// The app runs against it completely unmodified: same @supabase/ssr
// clients, same env var shapes, same URLs.
//
// It also hosts two test doubles that exist only because of sandbox
// egress rules:
//   /groq-mock/*  — OpenAI-compatible chat.completions endpoint standing
//                   in for api.groq.com (blocked). Synthesizes structured
//                   JSON matching what each caller's prompt demands.
//   /fwd?url=...  — outbound fetch forwarder so the app's Google Fonts
//                   requests can ride this process's proxy-aware agent
//                   (Node fetch ignores HTTPS_PROXY on its own).
//
// Unknown REST features fail LOUDLY (500 + console.error) instead of
// guessing — a translation gap must surface as a test failure, never as
// silently-wrong data.

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { EnvHttpProxyAgent } from 'undici'

const PORT = Number(process.env.SHIM_PORT ?? 54321)
const PG_PORT = Number(process.env.E2E_PG_PORT ?? 55432)
const JWT_SECRET = process.env.SHIM_JWT_SECRET ?? 'e2e-local-jwt-secret-not-a-real-secret'
const STORAGE_ROOT =
  process.env.SHIM_STORAGE_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '.data', 'storage')

const pool = new pg.Pool({
  host: '127.0.0.1',
  port: PG_PORT,
  database: 'app',
  user: 'authenticator',
  password: 'postgres',
  max: 10,
})

// Superuser pool only for auth.users bookkeeping (the auth schema is
// platform-owned; GoTrue writes it outside RLS in real Supabase too).
const authPool = new pg.Pool({
  host: '127.0.0.1',
  port: PG_PORT,
  database: 'app',
  user: 'postgres',
  max: 4,
})

const proxyAgent = new EnvHttpProxyAgent()

// ---------------------------------------------------------------- JWT --

const b64url = (buf) => Buffer.from(buf).toString('base64url')

function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

function verifyJwt(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url')
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  if (claims.exp && claims.exp < Date.now() / 1000) return null
  return claims
}

export function anonKey() {
  return signJwt({ iss: 'supabase-local', role: 'anon', exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400 })
}

function sessionFor(user) {
  const expiresIn = 86400
  const claims = {
    iss: 'supabase-local',
    sub: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + expiresIn,
    iat: Math.floor(Date.now() / 1000),
  }
  return {
    access_token: signJwt(claims),
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: claims.exp,
    refresh_token: b64url(crypto.randomBytes(24)) + '.' + user.id,
    user: gotrueUser(user),
  }
}

function gotrueUser(user) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: user.created_at,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: user.created_at,
    updated_at: user.created_at,
  }
}

// -------------------------------------------------------------- helpers --

function json(res, status, body, extraHeaders = {}) {
  const data = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    ...corsHeaders,
    ...extraHeaders,
  })
  res.end(data)
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
  'access-control-allow-headers':
    'authorization, apikey, content-type, x-client-info, x-upsert, prefer, accept-profile, content-profile, cache-control, x-supabase-api-version, range',
  'access-control-expose-headers': 'content-range, x-total-count',
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function bearerClaims(req) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  return verifyJwt(auth.slice(7))
}

// ---------------------------------------------------------------- auth --

async function handleAuth(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/auth/v1/token') {
    const grant = url.searchParams.get('grant_type')
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    if (grant === 'password') {
      const { rows } = await authPool.query(
        'select id, email, encrypted_password, created_at from auth.users where email = $1',
        [body.email]
      )
      if (!rows[0] || rows[0].encrypted_password !== body.password) {
        return json(res, 400, {
          error: 'invalid_grant',
          error_description: 'Invalid login credentials',
          code: 400,
          msg: 'Invalid login credentials',
        })
      }
      return json(res, 200, sessionFor(rows[0]))
    }
    if (grant === 'refresh_token') {
      const userId = String(body.refresh_token ?? '').split('.')[1]
      const { rows } = await authPool.query(
        'select id, email, created_at from auth.users where id = $1',
        [userId]
      )
      if (!rows[0]) return json(res, 400, { error: 'invalid_grant', msg: 'Invalid Refresh Token' })
      return json(res, 200, sessionFor(rows[0]))
    }
    return json(res, 400, { error: 'unsupported_grant_type' })
  }

  if (req.method === 'POST' && url.pathname === '/auth/v1/signup') {
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    const { rows } = await authPool.query(
      `insert into auth.users (email, encrypted_password) values ($1, $2)
       on conflict (email) do nothing
       returning id, email, created_at`,
      [body.email, body.password]
    )
    if (!rows[0]) return json(res, 422, { code: 422, msg: 'User already registered' })
    return json(res, 200, sessionFor(rows[0]))
  }

  if (req.method === 'GET' && url.pathname === '/auth/v1/user') {
    const claims = bearerClaims(req)
    if (!claims?.sub) return json(res, 401, { code: 401, msg: 'invalid JWT' })
    const { rows } = await authPool.query(
      'select id, email, created_at from auth.users where id = $1',
      [claims.sub]
    )
    if (!rows[0]) return json(res, 401, { code: 401, msg: 'user not found' })
    return json(res, 200, gotrueUser(rows[0]))
  }

  if (req.method === 'POST' && url.pathname === '/auth/v1/logout') {
    res.writeHead(204, corsHeaders)
    return res.end()
  }

  json(res, 404, { msg: `auth shim: unhandled ${req.method} ${url.pathname}` })
}

// ---------------------------------------------------------------- REST --
//
// Translates the PostgREST subset this app uses into parameterized SQL,
// executed with role + request.jwt.claims set per-request so the real
// RLS policies replicated from production apply exactly as they do live.

const FK_MAP = new Map() // 'schema.table->embedTable' -> fk column

async function loadFkMap() {
  const { rows } = await authPool.query(`
    select tc.table_schema, tc.table_name, kcu.column_name, ccu.table_name as foreign_table
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'`)
  for (const r of rows) {
    FK_MAP.set(`${r.table_schema}.${r.table_name}->${r.foreign_table}`, r.column_name)
  }
}

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
function ident(name) {
  if (!IDENT_RE.test(name)) throw new Error(`rest shim: invalid identifier ${JSON.stringify(name)}`)
  return `"${name}"`
}

// Split a PostgREST select list on commas that are not inside parens.
function splitSelect(sel) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of sel) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

function buildSelectList(schema, table, sel) {
  const cols = []
  for (const part of splitSelect(sel || '*')) {
    const embed = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/)
    if (embed) {
      const [, rel, subSel] = embed
      const fk = FK_MAP.get(`${schema}.${table}->${rel}`)
      if (!fk) throw new Error(`rest shim: no FK found for embed ${schema}.${table} -> ${rel}`)
      const subCols = splitSelect(subSel)
        .map((c) => (c === '*' ? '*' : ident(c)))
        .join(', ')
      cols.push(
        `(select to_jsonb(sub) from (select ${subCols} from ${ident(schema)}.${ident(rel)} r ` +
          `where r.id = t.${ident(fk)}) sub) as ${ident(rel)}`
      )
    } else if (part === '*') {
      cols.push('t.*')
    } else {
      cols.push(`t.${ident(part)}`)
    }
  }
  return cols.join(', ')
}

const FILTER_KEYS_IGNORED = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'])

function buildFilters(url, params) {
  const clauses = []
  for (const [key, raw] of url.searchParams.entries()) {
    if (FILTER_KEYS_IGNORED.has(key)) continue
    const dot = raw.indexOf('.')
    const op = dot === -1 ? null : raw.slice(0, dot)
    const value = dot === -1 ? raw : raw.slice(dot + 1)
    if (op === 'eq') {
      params.push(value)
      clauses.push(`t.${ident(key)} = $${params.length}`)
    } else if (op === 'neq') {
      params.push(value)
      clauses.push(`t.${ident(key)} <> $${params.length}`)
    } else if (op === 'is' && value === 'null') {
      clauses.push(`t.${ident(key)} is null`)
    } else if (op === 'in') {
      const items = value.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''))
      const ph = items.map((it) => {
        params.push(it)
        return `$${params.length}`
      })
      clauses.push(`t.${ident(key)} in (${ph.join(', ')})`)
    } else {
      throw new Error(`rest shim: unsupported filter ${key}=${raw}`)
    }
  }
  return clauses.length ? ` where ${clauses.join(' and ')}` : ''
}

function buildOrder(url) {
  const order = url.searchParams.get('order')
  if (!order) return ''
  return (
    ' order by ' +
    order
      .split(',')
      .map((o) => {
        const [col, ...mods] = o.split('.')
        const dir = mods.includes('desc') ? 'desc' : 'asc'
        return `t.${ident(col)} ${dir}`
      })
      .join(', ')
  )
}

async function withRlsClient(claims, fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const role = claims?.role === 'authenticated' ? 'authenticated' : 'anon'
    await client.query(`select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)`, [
      role,
      JSON.stringify(claims ?? { role: 'anon' }),
    ])
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function handleRest(req, res, url) {
  const table = url.pathname.slice('/rest/v1/'.length)
  if (!IDENT_RE.test(table)) return json(res, 404, { message: `rest shim: bad table ${table}` })

  const isRead = req.method === 'GET' || req.method === 'HEAD'
  const schema = req.headers[isRead ? 'accept-profile' : 'content-profile'] ?? 'public'
  const claims = bearerClaims(req)
  const prefer = String(req.headers.prefer ?? '')
  const wantsRepresentation = prefer.includes('return=representation')
  const wantsExactCount = prefer.includes('count=exact')
  const wantsSingleObject = String(req.headers.accept ?? '').includes('application/vnd.pgrst.object+json')

  try {
    const params = []
    let rows
    let count = null

    if (isRead) {
      const where = buildFilters(url, params)
      if (wantsExactCount) {
        const countRows = await withRlsClient(claims, (c) =>
          c.query(`select count(*)::int as n from ${ident(schema)}.${ident(table)} t${where}`, params)
        )
        count = countRows.rows[0].n
      }
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          ...corsHeaders,
          'content-range': `0-${count === null || count === 0 ? '*' : count - 1}/${count ?? '*'}`,
        })
        return res.end()
      }
      const selectList = buildSelectList(schema, table, url.searchParams.get('select'))
      const limit = url.searchParams.get('limit')
      const sql =
        `select ${selectList} from ${ident(schema)}.${ident(table)} t${where}${buildOrder(url)}` +
        (limit ? ` limit ${Number(limit)}` : '')
      const result = await withRlsClient(claims, (c) => c.query(sql, params))
      rows = result.rows
    } else if (req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || 'null')
      const items = Array.isArray(body) ? body : [body]
      if (items.length === 0) {
        rows = []
      } else {
        const cols = Object.keys(items[0])
        const valuesSql = items
          .map(
            (item) =>
              '(' +
              cols
                .map((c) => {
                  const v = item[c]
                  params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v)
                  return `$${params.length}`
                })
                .join(', ') +
              ')'
          )
          .join(', ')
        const sql =
          `insert into ${ident(schema)}.${ident(table)} (${cols.map(ident).join(', ')}) ` +
          `values ${valuesSql} returning *`
        const result = await withRlsClient(claims, (c) => c.query(sql, params))
        rows = result.rows
      }
    } else if (req.method === 'PATCH') {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      const sets = Object.keys(body).map((c) => {
        const v = body[c]
        params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v)
        return `${ident(c)} = $${params.length}`
      })
      const where = buildFilters(url, params)
      if (!where) throw new Error('rest shim: refusing UPDATE without filters')
      const sql = `update ${ident(schema)}.${ident(table)} t set ${sets.join(', ')}${where} returning *`
      const result = await withRlsClient(claims, (c) => c.query(sql, params))
      rows = result.rows
    } else if (req.method === 'DELETE') {
      const where = buildFilters(url, params)
      if (!where) throw new Error('rest shim: refusing DELETE without filters')
      const sql = `delete from ${ident(schema)}.${ident(table)} t${where} returning *`
      const result = await withRlsClient(claims, (c) => c.query(sql, params))
      rows = result.rows
    } else {
      return json(res, 405, { message: `rest shim: ${req.method} not handled` })
    }

    const extra = {}
    if (count !== null) extra['content-range'] = `0-${Math.max(count - 1, 0)}/${count}`

    if (wantsSingleObject) {
      if (rows.length !== 1) {
        return json(res, 406, {
          code: 'PGRST116',
          details: `The result contains ${rows.length} rows`,
          hint: null,
          message: 'JSON object requested, multiple (or no) rows returned',
        })
      }
      return json(res, 200, rows[0], extra)
    }

    if (!isRead && !wantsRepresentation) {
      res.writeHead(req.method === 'POST' ? 201 : 204, { ...corsHeaders, ...extra })
      return res.end()
    }
    return json(res, req.method === 'POST' ? 201 : 200, rows, extra)
  } catch (err) {
    // Postgres errors surface in the supabase-js error shape the app's
    // routes actually read ({message, code, details}).
    console.error(`rest shim: ${req.method} ${url.pathname}${url.search} ->`, err.message)
    return json(res, 400, {
      message: err.message,
      code: err.code ?? 'SHIM500',
      details: err.detail ?? null,
      hint: err.hint ?? null,
    })
  }
}

// ------------------------------------------------------------- storage --

function storagePathFor(bucket, objectPath) {
  const full = path.normalize(path.join(STORAGE_ROOT, bucket, objectPath))
  if (!full.startsWith(path.join(STORAGE_ROOT, bucket))) throw new Error('path escape')
  return full
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' }

async function handleStorage(req, res, url) {
  const prefix = '/storage/v1/object'
  const rest = url.pathname.slice(prefix.length)

  // public download: GET /storage/v1/object/public/<bucket>/<path>
  if (req.method === 'GET' && rest.startsWith('/public/')) {
    const [bucket, ...parts] = rest.slice('/public/'.length).split('/')
    const file = storagePathFor(bucket, parts.join('/'))
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return json(res, 404, { error: 'not_found', message: 'Object not found' })
    }
    res.writeHead(200, {
      ...corsHeaders,
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    return fs.createReadStream(file).pipe(res)
  }

  // list: POST /storage/v1/object/list/<bucket>  body {prefix}
  if (req.method === 'POST' && rest.startsWith('/list/')) {
    const bucket = rest.slice('/list/'.length)
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    const dir = storagePathFor(bucket, body.prefix ?? '')
    let entries = []
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      entries = fs.readdirSync(dir, { withFileTypes: true }).map((e) => {
        const stat = e.isFile() ? fs.statSync(path.join(dir, e.name)) : null
        return {
          name: e.name,
          // Supabase returns folders as rows with id null — the app's
          // delete route relies on that distinction.
          id: e.isFile() ? crypto.randomUUID() : null,
          updated_at: stat ? stat.mtime.toISOString() : null,
          created_at: stat ? stat.ctime.toISOString() : null,
          last_accessed_at: null,
          metadata: stat ? { size: stat.size } : null,
        }
      })
    }
    return json(res, 200, entries)
  }

  // bulk delete: DELETE /storage/v1/object/<bucket>  body {prefixes: []}
  if (req.method === 'DELETE' && !rest.slice(1).includes('/')) {
    const bucket = rest.slice(1)
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    const removed = []
    for (const p of body.prefixes ?? []) {
      const file = storagePathFor(bucket, p)
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        fs.unlinkSync(file)
        removed.push({ name: p, bucket_id: bucket })
      }
    }
    return json(res, 200, removed)
  }

  // upload: POST/PUT /storage/v1/object/<bucket>/<path>
  if ((req.method === 'POST' || req.method === 'PUT') && rest.length > 1) {
    const [bucket, ...parts] = rest.slice(1).split('/')
    const objectPath = decodeURIComponent(parts.join('/'))
    const raw = await readBody(req)
    let fileBuf = raw
    const contentType = String(req.headers['content-type'] ?? '')
    if (contentType.startsWith('multipart/form-data')) {
      // Browser-side uploads (File/Blob) arrive as multipart; Node 22's
      // web Response can parse it without a parser dependency.
      const form = await new Response(raw, { headers: { 'content-type': contentType } }).formData()
      const filePart = [...form.values()].find((v) => typeof v !== 'string')
      if (!filePart) return json(res, 400, { error: 'invalid', message: 'no file part' })
      fileBuf = Buffer.from(await filePart.arrayBuffer())
    }
    const upsert = String(req.headers['x-upsert'] ?? 'false') === 'true'
    const target = storagePathFor(bucket, objectPath)
    if (fs.existsSync(target) && !upsert && req.method === 'POST') {
      return json(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, fileBuf)
    return json(res, 200, { Key: `${bucket}/${objectPath}`, Id: crypto.randomUUID(), path: objectPath })
  }

  json(res, 404, { error: 'not_found', message: `storage shim: unhandled ${req.method} ${url.pathname}` })
}

// ------------------------------------------------------------ groq mock --
//
// Stands in for api.groq.com (sandbox egress blocked). Reads the caller's
// prompt and synthesizes JSON in the exact shape that prompt demands —
// the three callers in lib/ai-client.ts / route handlers each state their
// shape explicitly in the user prompt.

function groqSynthesize(userPrompt) {
  const rewriteMatch = userPrompt.match(/Original slides \(JSON\):\n(\{.*?\})\n/s)
  if (rewriteMatch) {
    const { slides } = JSON.parse(rewriteMatch[1])
    const detailed = userPrompt.includes('50-70 words')
    const concise = userPrompt.includes('15-20 words')
    return {
      slides: slides.map((s) => ({
        index: s.index,
        headline: s.headline,
        body: concise
          ? `Versi ringkas: ${s.body.split(' ').slice(0, 12).join(' ')}.`
          : detailed
            ? `${s.body} Penjelasan tambahan versi detail: poin ini penting karena berdampak langsung pada hasil konten dan konsistensi brand Anda di Instagram setiap minggunya.`
            : s.body,
      })),
    }
  }

  const scriptMatch = userPrompt.match(/Generate exactly (\d+) slides/)
  if (scriptMatch) {
    const n = Number(scriptMatch[1])
    const topicMatch = userPrompt.match(/Topic: (.*)/)
    const topic = topicMatch ? topicMatch[1] : 'Konten Instagram'
    return {
      title: topic,
      slides: Array.from({ length: n }, (_, i) => ({
        index: i + 1,
        headline: i === 0 ? topic : `Poin ${i}: langkah penting ke-${i}`,
        body:
          i === 0
            ? `Simak ${n - 1} poin penting tentang ${topic.toLowerCase()} yang bisa langsung Anda praktikkan.`
            : `Penjelasan praktis untuk poin ${i}: terapkan langkah ini secara konsisten setiap minggu, ukur hasilnya, lalu sesuaikan strategi berdasarkan data engagement yang Anda kumpulkan.`,
      })),
    }
  }

  if (userPrompt.includes('"ideas"')) {
    return {
      ideas: [1, 2, 3].map((i) => ({
        title: `Angle ${i}: sudut pandang konten nomor ${i}`,
        hook: `Hook menarik untuk angle ${i}`,
        angle_description: `Deskripsi angle ${i} berdasarkan riset yang diberikan.`,
      })),
    }
  }

  throw new Error('groq mock: unrecognized prompt shape')
}

async function handleGroqMock(req, res, url) {
  if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    const userMsg = (body.messages ?? []).find((m) => m.role === 'user')?.content ?? ''
    try {
      const content = JSON.stringify(groqSynthesize(userMsg))
      return json(res, 200, {
        id: 'chatcmpl-e2e',
        object: 'chat.completion',
        model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    } catch (err) {
      console.error('groq mock:', err.message)
      return json(res, 500, { error: { message: err.message } })
    }
  }
  json(res, 404, { error: { message: `groq mock: unhandled ${req.method} ${url.pathname}` } })
}

// ---------------------------------------------------------- fwd (fonts) --

async function handleFwd(req, res, url) {
  const target = url.searchParams.get('url')
  if (!target) return json(res, 400, { error: 'url param required' })
  try {
    const upstream = await fetch(target, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: { 'user-agent': req.headers['x-fwd-user-agent'] ?? 'Mozilla/5.0 (e2e-shim)' },
      dispatcher: proxyAgent,
    })
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.writeHead(upstream.status, {
      ...corsHeaders,
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
    })
    return res.end(buf)
  } catch (err) {
    console.error('fwd:', target, err.message)
    return json(res, 502, { error: String(err) })
  }
}

// ---------------------------------------------------------------- main --

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders)
      return res.end()
    }
    if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(req, res, url)
    if (url.pathname.startsWith('/rest/v1/')) return await handleRest(req, res, url)
    if (url.pathname.startsWith('/storage/v1/object')) return await handleStorage(req, res, url)
    if (url.pathname.startsWith('/groq-mock/')) return await handleGroqMock(req, res, url)
    if (url.pathname === '/fwd') return await handleFwd(req, res, url)
    if (url.pathname === '/health') return json(res, 200, { ok: true })
    json(res, 404, { message: `shim: unhandled ${req.method} ${url.pathname}` })
  } catch (err) {
    console.error('shim: uncaught', req.method, req.url, err)
    json(res, 500, { message: String(err) })
  }
})

await loadFkMap()
fs.mkdirSync(STORAGE_ROOT, { recursive: true })
server.listen(PORT, '127.0.0.1', () => {
  console.log(`supashim listening on http://127.0.0.1:${PORT}`)
  console.log(`ANON_KEY=${anonKey()}`)
})
