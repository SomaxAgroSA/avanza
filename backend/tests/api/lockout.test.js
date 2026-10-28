/**
 * Bloqueio progressivo de conta — PocketBase real (coleção login_attempts, hash SHA-256).
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

describe('API — bloqueio progressivo de conta', { timeout: 180000 }, () => {
  let pb
  let admin

  before(async () => {
    pb = await startServer()
    await pb.updateSettings({ rateLimits: { enabled: true, rules: RULES } })
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    await admin.post('/users', { name: 'Ana', email: 'ana@example.com', password: 'SenhaTeste123', role_id: roles.find((r) => r.code === 'MEMBER').id })
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('5 falhas bloqueiam a conta (429 ACCOUNT_LOCKED com retry_after), mesmo com a senha certa', async () => {
    const client = createClient(pb.api)
    for (let i = 0; i < 5; i++) assert.equal((await client.login('ana@example.com', 'errada123456')).body.error.code, 'INVALID_CREDENTIALS')
    const locked = await client.login('ana@example.com', 'SenhaTeste123')
    assert.equal(locked.status, 429)
    assert.equal(locked.body.error.code, 'ACCOUNT_LOCKED')
    assert.ok(locked.body.error.details.retry_after_seconds > 250)
    assert.equal(client.hasSession(), false)
    // o e-mail não fica gravado em claro
    const attempts = await pb.query('SELECT * FROM login_attempts')
    assert.ok(attempts.length === 5 && attempts.every((a) => !a.key.includes('ana') && a.key.length >= 64))
  })

  it('e-mail inexistente responde igual (não revela contas)', async () => {
    const client = createClient(pb.api)
    for (let i = 0; i < 5; i++) assert.equal((await client.login('ninguem@example.com', 'qualquer1234')).body.error.code, 'INVALID_CREDENTIALS')
    assert.equal((await client.login('ninguem@example.com', 'qualquer1234')).body.error.code, 'ACCOUNT_LOCKED')
  })
})
