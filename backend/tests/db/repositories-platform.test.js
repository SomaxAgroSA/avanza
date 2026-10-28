const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createTestDatabase, TEST_STORAGE } = require('../support/db-harness')
const { createStorage } = require('../../src/infrastructure/storage')
const { createSecrets } = require('../../src/infrastructure/secrets')
const { insertRow } = require('../../src/infrastructure/sql')
const platform = require('../../src/infrastructure/repositories/platform')

describe('repositórios da plataforma (Postgres)', () => {
  const storage = createStorage(Object.assign({}, TEST_STORAGE, { bucket: `avanza-t-${crypto.randomBytes(4).toString('hex')}` }))
  const secrets = createSecrets('chave-dos-testes')
  let t
  let ctx
  let user

  before(async () => {
    await storage.ensureBucket()
    t = await createTestDatabase()
    ctx = { storage, secrets, bcryptCost: 4 }
    const role = await t.db.one("SELECT id FROM roles WHERE code = 'MEMBER'")
    user = await insertRow(t.db, 'users', { email: 'plataforma@avanza.test', name: 'P', role_id: role.id, status: 'active' })
  })
  after(async () => {
    await t.drop()
    await storage.dropBucket()
  })

  /** "created" fixo: gravações no mesmo milissegundo empatariam na ordenação. */
  async function stamp(table, rows) {
    for (const [i, row] of rows.entries()) await t.db.exec(`UPDATE ${table} SET created = $2 WHERE id = $1`, [row.id, new Date(Date.UTC(2026, 9, 1, 0, 0, i))])
  }

  describe('Configurador geral', () => {
    const upload = (name, content, mime) => ({ field: 'file', name, mime, size: Buffer.byteLength(content), buffer: Buffer.from(content) })

    it('lê o registro único, grava os valores e recria o registro se ele sumir', async () => {
      const repo = platform.createPlatformSettingsRepository(t.db, ctx)
      const initial = await repo.get()
      assert.deepEqual([initial.values, initial.files], [{}, {}])
      assert.ok(initial.updatedAt instanceof Date)
      await repo.saveValues({ platform_name: 'Avanza Teste', audit_retention_months: 12, tags: ['a'] })
      const saved = await repo.get()
      assert.deepEqual(saved.values, { platform_name: 'Avanza Teste', audit_retention_months: 12, tags: ['a'] })
      assert.ok(saved.updatedAt >= initial.updatedAt)

      await t.db.exec('DELETE FROM platform_settings')
      assert.deepEqual((await repo.get()).values, {})
      assert.equal((await t.db.one('SELECT count(*) AS n FROM platform_settings')).n, 1)
    })

    it('guarda a identidade no Storage com a chave do registro e manda a anterior para a lixeira', async () => {
      const repo = platform.createPlatformSettingsRepository(t.db, ctx)
      const row = await t.db.one('SELECT id FROM platform_settings')
      await repo.setFile('logo_light', { handle: upload('Logo Clara.PNG', 'png-1', 'image/png'), name: 'Logo Clara.PNG', mime: 'image/png', size: 5 })
      const first = await repo.fileKeyOf('logo_light')
      assert.match(first, new RegExp(`^platform_settings/${row.id}/logo_clara_[a-z0-9]{10}\\.png$`))
      assert.equal((await storage.read(first)).toString(), 'png-1')
      assert.deepEqual((await repo.get()).files, { logo_light: { name: 'Logo Clara.PNG', mime: 'image/png', size: 5 } })

      await repo.setFile('logo_light', { handle: upload('nova.png', 'png-2', 'image/png'), name: 'nova.png', mime: 'image/png', size: 5 })
      await repo.setFile('favicon', { handle: upload('icone.svg', '<svg/>', 'image/svg+xml'), name: 'icone.svg', mime: 'image/svg+xml', size: 6 })
      const second = await repo.fileKeyOf('logo_light')
      assert.notEqual(second, first)
      assert.equal((await storage.read(second)).toString(), 'png-2')
      assert.deepEqual(Object.keys((await repo.get()).files).sort(), ['favicon', 'logo_light'])
      assert.ok(await t.db.one('SELECT key FROM storage_trash WHERE key = $1', [first]))

      await repo.clearFile('logo_light')
      const after = await repo.get()
      assert.deepEqual(Object.keys(after.files), ['favicon'])
      assert.equal((await t.db.one('SELECT logo_light FROM platform_settings')).logo_light, '')
      assert.ok(await t.db.one('SELECT key FROM storage_trash WHERE key = $1', [second]))
      await assert.rejects(repo.setFile('outro', { handle: upload('x.png', 'x', 'image/png'), name: 'x.png', mime: 'image/png', size: 1 }), /desconhecido/)
    })
  })

  describe('tokens de API', () => {
    it('o valor fica cifrado com a chave do servidor e só sai por revealValue', async () => {
      const repo = platform.createApiTokenRepository(t.db, ctx)
      const value = `kb_pat_${'a'.repeat(40)}`
      const saved = await repo.create({ userId: user.id, name: 'Claude', tokenHash: 'h-v', value, prefix: 'kb_pat_aaaa', expiresAt: null })
      assert.equal(saved.revealable, true)
      assert.equal('value' in saved || 'valueSecret' in saved, false)
      const row = await t.db.one('SELECT value_secret FROM api_tokens WHERE id = $1', [saved.id])
      assert.match(row.value_secret, /^v1:/)
      assert.equal(row.value_secret.includes(value), false)
      assert.equal(await repo.revealValue(saved.id), value)
      const legacy = await repo.create({ userId: user.id, name: 'Antigo', tokenHash: 'h-l', prefix: 'kb_pat_llll', expiresAt: null })
      assert.equal(legacy.revealable, false)
      assert.equal(await repo.revealValue(legacy.id), null)
      await t.db.exec("DELETE FROM api_tokens WHERE token_hash IN ('h-v', 'h-l')")
    })

    it('criam, acham pelo hash, listam, contam os ativos, registram uso e revogam', async () => {
      const repo = platform.createApiTokenRepository(t.db, ctx)
      const now = new Date('2026-10-28T12:00:00.000Z')
      const a = await repo.create({ userId: user.id, name: 'CI', tokenHash: 'h-a', prefix: 'kb_pat_aaaa', expiresAt: null })
      const b = await repo.create({ userId: user.id, name: 'Script', tokenHash: 'h-b', prefix: 'kb_pat_bbbb', expiresAt: new Date(now.getTime() + 86400000) })
      const expired = await repo.create({ userId: user.id, name: 'Velho', tokenHash: 'h-c', prefix: 'kb_pat_cccc', expiresAt: new Date(now.getTime() - 1) })
      await stamp('api_tokens', [a, b, expired])
      assert.deepEqual(
        [a.userId, a.name, a.tokenHash, a.prefix, a.expiresAt, a.lastUsedAt, a.lastUsedIp, a.revokedAt],
        [user.id, 'CI', 'h-a', 'kb_pat_aaaa', null, null, '', null],
      )
      assert.ok(a.createdAt instanceof Date)
      assert.equal((await repo.findByHash('h-b')).id, b.id)
      assert.equal(await repo.findByHash('nada'), null)
      assert.equal(await repo.findById('naoexiste000000'), null)
      assert.deepEqual((await repo.listByUser(user.id)).map((x) => x.id), [expired.id, b.id, a.id])
      assert.deepEqual((await repo.listAll()).map((x) => x.id), [expired.id, b.id, a.id])

      assert.equal(await repo.countActiveByUser(user.id, now), 2)
      const touched = await repo.touch(a.id, now, '2001:db8::1'.repeat(10))
      assert.equal(touched.lastUsedAt.getTime(), now.getTime())
      assert.equal(touched.lastUsedIp.length, 64)
      const revoked = await repo.revoke(b.id, now)
      assert.equal(revoked.revokedAt.getTime(), now.getTime())
      assert.equal(await repo.countActiveByUser(user.id, now), 1)
    })
  })

  describe('e-mail', () => {
    it('configuração: padrões da instalação, senha cifrada e "undefined" mantém a atual', async () => {
      const repo = platform.createEmailSettingsRepository(t.db, ctx)
      const initial = await repo.get()
      assert.equal(initial.hasPassword, false)
      assert.deepEqual(Object.keys(initial.values).sort(), ['app_url', 'enabled', 'host', 'port', 'sender_address', 'sender_name', 'tls', 'username'])
      assert.equal(initial.values.port, 587)
      assert.equal(initial.values.enabled, false)

      const values = { enabled: true, host: 'smtp.avanza.test', port: 465, username: 'robo', tls: true, sender_name: 'Avanza', sender_address: 'nao-responda@avanza.test', app_url: 'https://avanza.test' }
      await repo.save(values, 's3nh@-SMTP')
      const saved = await repo.get()
      assert.deepEqual(saved, { values, hasPassword: true })
      const row = await t.db.one('SELECT password_secret FROM email_settings')
      assert.match(row.password_secret, /^v1:/)
      assert.equal(row.password_secret.indexOf('s3nh@'), -1)
      assert.equal(secrets.decrypt(row.password_secret), 's3nh@-SMTP')

      await repo.save(Object.assign({}, values, { host: 'smtp2.avanza.test' }), undefined)
      assert.equal((await repo.get()).values.host, 'smtp2.avanza.test')
      assert.equal(secrets.decrypt((await t.db.one('SELECT password_secret FROM email_settings')).password_secret), 's3nh@-SMTP')

      await repo.save(values, '')
      assert.equal((await repo.get()).hasPassword, false)

      // se a linha sumir, volta com os padrões
      await t.db.exec('DELETE FROM email_settings')
      assert.equal((await repo.get()).values.enabled, false)
      await repo.save(values, 'outra')
      assert.equal((await repo.get()).hasPassword, true)
    })

    it('fila de saída: vencidos em ordem, limite, atualização, contagens e recentes', async () => {
      const repo = platform.createEmailOutboxRepository(t.db, ctx)
      const now = new Date('2026-10-28T12:00:00.000Z')
      const m1 = await repo.enqueue({ to: 'a@avanza.test', kind: 'invite', subject: 'x'.repeat(400), html: '<p>oi</p>', text: 'oi' })
      const m2 = await repo.enqueue({ to: 'b@avanza.test', kind: 'password_reset', subject: 'Senha' })
      const m3 = await repo.enqueue({ to: 'c@avanza.test', kind: 'invite', subject: 'Futuro' })
      const m4 = await repo.enqueue({ to: 'd@avanza.test', kind: 'invite', subject: 'Enviado' })
      await stamp('email_outbox', [m1, m2, m3, m4])
      assert.deepEqual(
        [m1.status, m1.attempts, m1.lastError, m1.nextAttemptAt, m1.sentAt, m1.subject.length, m2.html, m2.text],
        ['pending', 0, '', null, null, 300, '', ''],
      )

      await repo.update(m2.id, { attempts: 1, lastError: 'timeout', nextAttemptAt: new Date(now.getTime() - 1000) })
      await repo.update(m3.id, { attempts: 1, nextAttemptAt: new Date(now.getTime() + 60000) })
      const sent = await repo.update(m4.id, { status: 'sent', sentAt: now, attempts: 1, html: '', text: '', ignored: 1 })
      assert.deepEqual([sent.status, sent.sentAt.getTime(), sent.attempts], ['sent', now.getTime(), 1])

      assert.deepEqual((await repo.listDue(now, 50)).map((m) => m.id), [m1.id, m2.id])
      assert.deepEqual((await repo.listDue(now, 1)).map((m) => m.id), [m1.id])
      assert.equal((await repo.listDue(now, 50))[1].lastError, 'timeout')

      await repo.update(m1.id, { status: 'failed', attempts: 6 })
      assert.deepEqual(await repo.counts(), { pending: 2, sent: 1, failed: 1 })
      assert.deepEqual((await repo.listRecent(2)).map((m) => m.id), [m4.id, m3.id])
      await assert.rejects(repo.update('naoexiste000000', { status: 'sent' }), /não encontrado/)
    })

    it('links de uso único: criam, acham pelo hash, usam, invalidam e contam', async () => {
      const repo = platform.createAuthTokenRepository(t.db, ctx)
      const now = new Date('2026-10-28T12:00:00.000Z')
      const reset1 = await repo.create({ userId: user.id, purpose: 'reset', tokenHash: 'r1', expiresAt: new Date(now.getTime() + 3600000) })
      const reset2 = await repo.create({ userId: user.id, purpose: 'reset', tokenHash: 'r2', expiresAt: new Date(now.getTime() + 3600000) })
      const invite = await repo.create({ userId: user.id, purpose: 'invite', tokenHash: 'i1', expiresAt: new Date(now.getTime() + 3600000) })
      assert.deepEqual([reset1.userId, reset1.purpose, reset1.usedAt, 'tokenHash' in reset1], [user.id, 'reset', null, false])
      assert.ok(reset1.expiresAt instanceof Date && reset1.createdAt instanceof Date)
      assert.equal((await repo.findByHash('r2')).id, reset2.id)
      assert.equal(await repo.findByHash('nada'), null)

      await repo.markUsed(reset1.id, now)
      assert.equal((await repo.findByHash('r1')).usedAt.getTime(), now.getTime())
      const later = new Date(now.getTime() + 1000)
      await repo.invalidateForUser(user.id, 'reset', later)
      assert.equal((await repo.findByHash('r1')).usedAt.getTime(), now.getTime())
      assert.equal((await repo.findByHash('r2')).usedAt.getTime(), later.getTime())
      assert.equal((await repo.findByHash('i1')).usedAt, null)

      const since = new Date(Date.now() - 60000)
      assert.equal(await repo.countSince(user.id, 'reset', since), 2)
      assert.equal(await repo.countSince(user.id, 'invite', since), 1)
      assert.equal(await repo.countSince(user.id, 'reset', new Date(Date.now() + 60000)), 0)
      assert.ok(invite.id)
    })
  })
})
