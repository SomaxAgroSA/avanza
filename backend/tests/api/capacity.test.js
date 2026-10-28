/**
 * Capacidade do servidor (regressão): conexões do tempo real abertas não pesam nas requisições.
 *
 * No PocketBase, cada conexão SSE (uma por aba logada) chegou a prender VMs do JS e derrubar a API
 * (500 leitores: p50 de 47 s; ADR-041). No servidor Node, uma conexão SSE é só um socket aberto — não
 * segura conexão do banco nem trabalho: com 24 delas abertas, a API responde como sem elas.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startServer, createClient } = require('../support/server-harness')
const { connectRealtime } = require('../support/sse-client')

const CONNECTIONS = 24

async function medianMs(fn, times) {
  const list = []
  for (let i = 0; i < times; i++) {
    const started = process.hrtime.bigint()
    await fn()
    list.push(Number(process.hrtime.bigint() - started) / 1e6)
  }
  list.sort((a, b) => a - b)
  return list[Math.floor(list.length / 2)]
}

describe('API Capacidade', { timeout: 180000 }, () => {
  let pb
  let root
  let user
  let publicDir
  const connections = []

  before(async () => {
    publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamban-public-'))
    fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>Avanza</title>')
    pb = await startServer({}, { publicDir })
    root = createClient(pb.api)
    await root.login(pb.admin.email, pb.admin.password)
    user = (await root.get('/auth/me')).body.data.user
  })

  after(async () => {
    connections.forEach((c) => c.close())
    if (pb) await pb.stop()
    if (publicDir) fs.rmSync(publicDir, { recursive: true, force: true })
  })

  it('o frontend recebe os cabeçalhos de segurança (também na rota do SPA); a API mantém o envelope', async () => {
    for (const pathname of ['/', '/projects/abc']) {
      const res = await fetch(`${pb.baseUrl}${pathname}`)
      assert.equal(res.status, 200, pathname)
      assert.match(await res.text(), /Avanza/)
      assert.match(res.headers.get('content-security-policy') || '', /frame-ancestors 'none'/, pathname)
      assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
    }
    const api = await fetch(`${pb.api}/health`)
    assert.equal(api.headers.get('content-security-policy'), null)
    const missing = await root.get('/nao-existe')
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error.code, 'ROUTE_NOT_FOUND')
  })

  it(`com ${CONNECTIONS} conexões do tempo real abertas, a API responde como sem elas`, async () => {
    const call = () => root.get('/auth/me')
    for (let i = 0; i < 10; i++) await call()
    const before = await medianMs(call, 15)
    for (let i = 0; i < CONNECTIONS; i++) {
      const live = await connectRealtime(pb.baseUrl, root.cookie())
      connections.push(live)
      assert.equal((await live.subscribe([`user:${user.id}`])).status, 204)
    }
    const during = await medianMs(call, 15)
    assert.ok(during < before * 3 + 60, `mediana ${during.toFixed(1)} ms com conexões abertas x ${before.toFixed(1)} ms sem elas`)
  })
})
