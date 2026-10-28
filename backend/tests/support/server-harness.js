/**
 * Sobe a API do Avanza isolada para os testes de ponta a ponta: um esquema novo no Postgres do
 * Supabase local (migrations reais), um bucket novo no Storage, o SUPER_ADMIN de teste e o servidor
 * Node num processo próprio, numa porta livre. `stop()` apaga tudo.
 */

const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const net = require('node:net')
const path = require('node:path')
const { createTestDatabase, TEST_STORAGE } = require('./db-harness')
const { createStorage } = require('../../src/infrastructure/storage')
const { createSecrets } = require('../../src/infrastructure/secrets')
const { bootstrapAdmin } = require('../../src/infrastructure/bootstrap-admin')
const config = require('../../src/infrastructure/config')

const ROOT = path.resolve(__dirname, '..', '..')
const SERVER = path.join(ROOT, 'src', 'server.js')

const ADMIN = { email: 'admin@kamban.test', password: 'AdminTest12345', name: 'Admin Teste' }
// senhas com bcrypt barato nos testes (o padrão de produção é 10)
const TEST_BCRYPT_COST = '4'

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

async function waitForHealth(baseUrl, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`a API saiu com código ${child.exitCode}`)
    try {
      const res = await fetch(`${baseUrl}/api/v1/health`)
      if (res.ok) return
    } catch (_) {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('a API não respondeu a tempo')
}

/**
 * `extraEnv`: variáveis a mais para o servidor (ex.: KAMBAN_RATE_LIMITS).
 * `options.publicDir`: build do front para servir junto (E2E).
 * `options.seedSql`: SQL rodado depois das migrations (dados que a API não cria, ex.: histórico antigo).
 */
async function startServer(extraEnv, options) {
  const opts = options || {}
  const t = await createTestDatabase()
  const bucket = `avanza-t-${crypto.randomBytes(5).toString('hex')}`
  const storage = createStorage(Object.assign({}, TEST_STORAGE, { bucket }))
  await storage.ensureBucket()
  for (const sql of opts.seedSql || []) await t.db.query(sql)

  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const env = Object.assign({}, process.env, {
    KAMBAN_ENV: 'test',
    KAMBAN_HTTP: `127.0.0.1:${port}`,
    KAMBAN_DATABASE_URL: t.url,
    KAMBAN_DB_SCHEMA: t.schema,
    KAMBAN_DB_SSL: 'disable',
    KAMBAN_SUPABASE_URL: TEST_STORAGE.url,
    KAMBAN_SUPABASE_SECRET_KEY: TEST_STORAGE.secretKey,
    KAMBAN_STORAGE_BUCKET: bucket,
    KAMBAN_BCRYPT_COST: TEST_BCRYPT_COST,
    KAMBAN_PUBLIC_DIR: opts.publicDir || path.join(ROOT, 'tests', 'no-public-dir'),
    KAMBAN_SECRET_KEY: 'chave-dos-testes',
  }, extraEnv || {})

  const settings = config.load(env)
  const log = { info() {}, warn() {}, error() {} }
  await bootstrapAdmin({ config: settings, db: t.db, storage, secrets: createSecrets(settings.secretKey), log }, ADMIN)

  const child = spawn(process.execPath, [SERVER], { env, stdio: 'pipe' })
  let output = ''
  child.stdout.on('data', (d) => (output += d))
  child.stderr.on('data', (d) => (output += d))

  async function cleanup() {
    await storage.dropBucket().catch(() => {})
    await t.drop()
  }

  try {
    await waitForHealth(baseUrl, child, 20000)
  } catch (err) {
    child.kill()
    await cleanup()
    throw new Error(`${err.message}\n${output}`)
  }

  return {
    baseUrl,
    api: `${baseUrl}/api/v1`,
    admin: ADMIN,
    schema: t.schema,
    output: () => output,
    /** Limites por IP (o mesmo formato das regras do PocketBase): `{ rateLimits: { enabled, rules } }`. */
    async updateSettings(patch) {
      const limits = (patch && patch.rateLimits) || {}
      const res = await fetch(`${baseUrl}/api/_test/rate-limits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: limits.enabled, rules: limits.rules }),
      })
      if (res.status !== 204) throw new Error(`Falha ao ajustar os limites: ${res.status} ${await res.text()}`)
    },
    /** Consulta direta ao banco do teste (ex.: conferir auditoria). */
    query: (sql, params) => t.db.query(sql, params),
    async stop() {
      child.kill()
      await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)))
      await cleanup()
    },
  }
}

/** Cliente HTTP mínimo com "cookie jar" de uma única sessão. */
function createClient(api) {
  let cookie = ''
  async function request(method, pathname, body, options) {
    const opts = options || {}
    const headers = { Accept: 'application/json' }
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
    if (opts.csrf !== false && method !== 'GET') headers['X-Requested-With'] = 'kamban'
    if (cookie) headers.Cookie = cookie
    if (opts.headers) Object.assign(headers, opts.headers)

    const res = await fetch(`${api}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm || typeof body === 'string' ? body : JSON.stringify(body),
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) {
      const pair = setCookie.split(';')[0]
      cookie = pair.endsWith('=') ? '' : pair
    }
    if (opts.raw) return { status: res.status, headers: res.headers, setCookie, bytes: Buffer.from(await res.arrayBuffer()) }
    const text = await res.text()
    return { status: res.status, headers: res.headers, setCookie, body: text ? JSON.parse(text) : null }
  }
  return {
    get: (p, o) => request('GET', p, undefined, o),
    post: (p, b, o) => request('POST', p, b === undefined ? {} : b, o),
    put: (p, b, o) => request('PUT', p, b, o),
    patch: (p, b, o) => request('PATCH', p, b, o),
    del: (p, o) => request('DELETE', p, undefined, o),
    login: (email, password, remember) => request('POST', '/auth/login', { email, password, remember: !!remember }),
    hasSession: () => !!cookie,
    cookie: () => cookie,
  }
}

module.exports = { startServer, createClient, ADMIN }
