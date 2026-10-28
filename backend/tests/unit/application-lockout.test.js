const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createAuthService } = require('../../src/application/auth')
const lockout = require('../../src/domain/lockout')

const ctx = { ip: '10.0.0.1', userAgent: 'test-agent', correlationId: 'corr-1' }

async function setup() {
  const deps = createFakeDeps({ start: '2026-09-30T12:00:00.000Z' })
  const auth = createAuthService(deps)
  const user = await seedUser(deps, { email: 'ana@example.com', password: 'senhaForte123', roleCode: 'MEMBER' })
  return { deps, auth, user }
}

const codeOf = async (fn) => {
  try {
    await fn()
  } catch (err) {
    return err.code
  }
  return 'OK'
}

describe('domain/lockout', () => {
  it('bloqueio progressivo: 5 falhas = 5 min; dobra a cada 5 novas; no máximo 60 min', () => {
    assert.equal(lockout.lockMinutes(4), 0)
    assert.equal(lockout.lockMinutes(5), 5)
    assert.equal(lockout.lockMinutes(9), 5)
    assert.equal(lockout.lockMinutes(10), 10)
    assert.equal(lockout.lockMinutes(15), 20)
    assert.equal(lockout.lockMinutes(40), 60)
    const last = new Date('2026-09-30T12:00:00Z')
    assert.equal(lockout.lockedUntil(5, last).toISOString(), '2026-09-30T12:05:00.000Z')
    assert.equal(lockout.lockedUntil(3, last), null)
  })
})

describe('application/auth — bloqueio progressivo de conta', () => {
  it('após 5 senhas erradas a conta fica bloqueada (até com a senha certa) e libera depois do prazo', async () => {
    const { auth, deps } = await setup()
    for (let i = 0; i < 5; i++) assert.equal(await codeOf(() => auth.login({ email: 'ana@example.com', password: `errada${i}xxxxx` }, ctx)), 'INVALID_CREDENTIALS')
    await assert.rejects(() => auth.login({ email: 'ana@example.com', password: 'senhaForte123' }, ctx), (err) => {
      assert.equal(err.code, 'ACCOUNT_LOCKED')
      assert.equal(err.details.retry_after_seconds, 300)
      return true
    })
    assert.equal(deps.store.sessions.length, 0)
    assert.equal(deps.store.audit.at(-1).action, 'auth.login_locked')

    deps.clock.advanceMinutes(5)
    assert.equal(await codeOf(() => auth.login({ email: 'ana@example.com', password: 'senhaForte123' }, ctx)), 'OK')
  })

  it('entrar com sucesso zera a contagem; tentativas bloqueadas não prolongam o bloqueio', async () => {
    const { auth, deps } = await setup()
    for (let i = 0; i < 4; i++) await codeOf(() => auth.login({ email: 'ana@example.com', password: 'errada12345' }, ctx))
    await auth.login({ email: 'ana@example.com', password: 'senhaForte123' }, ctx)
    for (let i = 0; i < 4; i++) assert.equal(await codeOf(() => auth.login({ email: 'ana@example.com', password: 'errada12345' }, ctx)), 'INVALID_CREDENTIALS')

    await codeOf(() => auth.login({ email: 'ana@example.com', password: 'errada12345' }, ctx))
    deps.clock.advanceMinutes(3)
    // durante o bloqueio, nem a senha é conferida nem conta nova falha
    assert.equal(await codeOf(() => auth.login({ email: 'ana@example.com', password: 'errada12345' }, ctx)), 'ACCOUNT_LOCKED')
    deps.clock.advanceMinutes(2)
    assert.equal(await codeOf(() => auth.login({ email: 'ana@example.com', password: 'senhaForte123' }, ctx)), 'OK')
  })

  it('e-mail inexistente se comporta igual (não revela quais contas existem)', async () => {
    const { auth, deps } = await setup()
    for (let i = 0; i < 5; i++) assert.equal(await codeOf(() => auth.login({ email: 'ninguem@example.com', password: 'qualquer123' }, ctx)), 'INVALID_CREDENTIALS')
    assert.equal(await codeOf(() => auth.login({ email: 'ninguem@example.com', password: 'qualquer123' }, ctx)), 'ACCOUNT_LOCKED')
    // o e-mail nunca é gravado em claro: a chave passa pelo hash (SHA-256 no servidor real)
    assert.ok(deps.store.loginAttempts.every((a) => a.key === deps.tokens.hash('login:ninguem@example.com')))
    assert.ok(deps.store.loginAttempts.every((a) => a.key !== 'ninguem@example.com'))
    // outra conta não é afetada
    assert.equal(await codeOf(() => auth.login({ email: 'ana@example.com', password: 'senhaForte123' }, ctx)), 'OK')
  })
})
