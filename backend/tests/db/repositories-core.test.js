const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { PERMISSIONS } = require('../../src/domain/permissions')
const crypto = require('node:crypto')
const bcrypt = require('bcryptjs')
const { createTestDatabase, TEST_STORAGE } = require('../support/db-harness')
const { createStorage } = require('../../src/infrastructure/storage')
const core = require('../../src/infrastructure/repositories/core')

const CTX = { bcryptCost: 4 }

describe('repositórios do núcleo (Postgres)', () => {
  let t
  let users
  let roles
  let sessions
  let audit
  let attempts
  let roleIds

  before(async () => {
    t = await createTestDatabase()
    users = core.createUserRepository(t.db, CTX)
    roles = core.createRoleRepository(t.db, CTX)
    sessions = core.createSessionRepository(t.db, CTX)
    audit = core.createAuditRepository(t.db, CTX)
    attempts = core.createLoginAttemptRepository(t.db, CTX)
    roleIds = {}
    for (const row of await t.db.query('SELECT id, code FROM roles')) roleIds[row.code] = row.id
  })
  after(() => t.drop())

  function newUser(data) {
    return users.create(Object.assign({ name: 'Pessoa', password: 'Senha123', roleId: roleIds.MEMBER, status: 'active', locale: 'pt-BR', theme: 'system' }, data))
  }

  describe('usuários', () => {
    it('criam com a senha em bcrypt e devolvem a entidade como antes', async () => {
      const user = await newUser({ name: 'Ana', email: 'ana@avanza.test', locale: '', theme: '' })
      assert.equal(user.id.length, 15)
      assert.deepEqual(
        { name: user.name, email: user.email, avatarUrl: user.avatarUrl, status: user.status, roleId: user.roleId, locale: user.locale, theme: user.theme },
        { name: 'Ana', email: 'ana@avanza.test', avatarUrl: null, status: 'active', roleId: roleIds.MEMBER, locale: 'pt-BR', theme: 'system' },
      )
      assert.equal(user.emailNotifications, true)
      assert.equal(user.lastLoginAt, null)
      assert.ok(user.createdAt instanceof Date && user.updatedAt instanceof Date)
      assert.equal('password' in user || 'passwordHash' in user, false)
      const row = await t.db.one('SELECT password_hash FROM users WHERE id = $1', [user.id])
      assert.match(row.password_hash, /^\$2[aby]\$04\$/)
      assert.equal(await users.verifyPassword(user.id, 'Senha123'), true)
      assert.equal(await users.verifyPassword(user.id, 'senha123'), false)
      assert.equal(await users.verifyPassword('naoexiste000000', 'Senha123'), false)
    })

    it('aceitam as senhas vindas do PocketBase ($2a$)', async () => {
      const user = await newUser({ email: 'legado@avanza.test' })
      const legacy = bcrypt.hashSync('Legado123', '$2a$10$abcdefghijklmnopqrstuu')
      assert.match(legacy, /^\$2a\$10\$/)
      await t.db.exec('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, legacy])
      assert.equal(await users.verifyPassword(user.id, 'Legado123'), true)
      assert.equal(await users.verifyPassword(user.id, 'Senha123'), false)
      // hash vazio ou corrompido nunca autentica
      await t.db.exec("UPDATE users SET password_hash = 'lixo' WHERE id = $1", [user.id])
      assert.equal(await users.verifyPassword(user.id, 'Legado123'), false)
    })

    it('acham por e-mail sem diferenciar maiúsculas e recusam e-mail repetido', async () => {
      const user = await newUser({ email: 'bruno@avanza.test' })
      assert.equal((await users.findByEmail('BRUNO@Avanza.TEST')).id, user.id)
      assert.equal(await users.findByEmail('ninguem@avanza.test'), null)
      assert.equal(await users.emailExists('Bruno@avanza.test'), true)
      assert.equal(await users.emailExists('bruno@avanza.test', user.id), false)
      await assert.rejects(newUser({ email: 'BRUNO@avanza.test' }), (err) => err.code === 'EMAIL_ALREADY_IN_USE')
      const other = await newUser({ email: 'outro-bruno@avanza.test' })
      await assert.rejects(users.update(other.id, { email: 'Bruno@Avanza.test' }), (err) => err.code === 'EMAIL_ALREADY_IN_USE')
    })

    it('atualizam campos, preferências, último acesso e senha', async () => {
      const user = await newUser({ email: 'carla@avanza.test' })
      const at = new Date('2026-10-28T13:45:00.123Z')
      const saved = await users.update(user.id, { name: 'Carla', lastLoginAt: at, emailNotifications: false, theme: 'dark', roleId: roleIds.VIEWER, ignored: 'x' })
      assert.equal(saved.name, 'Carla')
      assert.equal(saved.theme, 'dark')
      assert.equal(saved.roleId, roleIds.VIEWER)
      assert.equal(saved.emailNotifications, false)
      assert.equal(saved.lastLoginAt.toISOString(), at.toISOString())
      await users.update(user.id, { password: 'NovaSenha9' })
      assert.equal(await users.verifyPassword(user.id, 'NovaSenha9'), true)
      assert.equal(await users.verifyPassword(user.id, 'Senha123'), false)
      await assert.rejects(users.update('naoexiste000000', { name: 'x' }), /não encontrado/)
    })

    it('listam com busca, filtros, ordenação, paginação e total', async () => {
      const role = roleIds.MANAGER
      await newUser({ name: 'João Lista', email: 'lista1@lista.test', roleId: role })
      await newUser({ name: 'Maria Lista', email: 'lista2@lista.test', roleId: role })
      await newUser({ name: 'Zeca Lista', email: 'lista3@lista.test', roleId: role, status: 'disabled' })
      await newUser({ name: 'Fora', email: 'fora@lista.test', roleId: roleIds.VIEWER })

      const base = { sort: [{ column: 'name', direction: 'ASC' }], pagination: { offset: 0, perPage: 2 } }
      const page1 = await users.list(Object.assign({}, base, { roleId: role }))
      assert.equal(page1.total, 3)
      assert.deepEqual(page1.items.map((u) => u.name), ['João Lista', 'Maria Lista'])
      const page2 = await users.list(Object.assign({}, base, { roleId: role, pagination: { offset: 2, perPage: 2 } }))
      assert.deepEqual(page2.items.map((u) => u.name), ['Zeca Lista'])
      assert.equal(page2.total, 3)

      const desc = await users.list({ roleId: role, status: 'active', sort: [{ column: 'name', direction: 'DESC' }], pagination: { offset: 0, perPage: 10 } })
      assert.deepEqual(desc.items.map((u) => u.name), ['Maria Lista', 'João Lista'])
      assert.equal(desc.total, 2)

      // busca por nome ou e-mail, sem diferenciar maiúsculas (inclusive acentuadas); curingas são texto
      const byName = await users.list(Object.assign({}, base, { search: 'JOÃO' }))
      assert.deepEqual(byName.items.map((u) => u.email), ['lista1@lista.test'])
      const byEmail = await users.list(Object.assign({}, base, { search: '@LISTA.test', pagination: { offset: 0, perPage: 10 } }))
      assert.equal(byEmail.total, 4)
      assert.equal((await users.list(Object.assign({}, base, { search: '%' }))).total, 0)
    })

    it('contam por perfil, buscam ativos e carregam em lote', async () => {
      const role = (await roles.create({ code: 'COUNT_ROLE', name: 'Contagem' })).id
      const a = await newUser({ name: 'Ativo A', email: 'ativo-a@busca.test', roleId: role })
      const b = await newUser({ name: 'Ativo B', email: 'ativo-b@busca.test', roleId: role })
      await newUser({ name: 'Ativo C (inativo)', email: 'ativo-c@busca.test', roleId: role, status: 'disabled' })
      assert.equal(await users.countByRole(role), 3)

      const found = await users.searchActive({ search: 'busca.test', excludeIds: [b.id], limit: 20 })
      assert.deepEqual(found.map((u) => u.id), [a.id])
      assert.deepEqual((await users.searchActive({ search: 'ATIVO', limit: 1 })).map((u) => u.id), [a.id])
      assert.ok((await users.searchActive({ search: '', limit: 50 })).every((u) => u.status === 'active'))

      assert.deepEqual(await users.findManyByIds([]), [])
      const many = await users.findManyByIds([a.id, b.id, 'naoexiste000000'])
      assert.deepEqual(many.map((u) => u.id).sort(), [a.id, b.id].sort())
      assert.equal(many[0].avatarUrl, null)
    })
  })

  describe('foto do usuário', () => {
    let storage
    let withStorage

    before(async () => {
      storage = createStorage(Object.assign({}, TEST_STORAGE, { bucket: `avanza-t-${crypto.randomBytes(4).toString('hex')}` }))
      await storage.ensureBucket()
      withStorage = core.createUserRepository(t.db, Object.assign({ storage }, CTX))
    })

    after(async () => {
      if (storage) await storage.dropBucket()
    })

    it('grava no Storage, muda o endereço a cada foto e manda a anterior para a lixeira (também ao remover e ao excluir)', async () => {
      const user = await newUser({ name: 'Foto', email: 'foto@avanza.test' })
      assert.equal(await withStorage.avatarKeyOf(user.id), null)
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
      const first = await withStorage.setAvatar(user.id, { buffer: bytes, mime: 'image/png', name: 'Minha Foto.png' }, 'image/png')
      assert.match(first.avatarUrl, new RegExp(`^/api/v1/users/${user.id}/avatar\\?v=[0-9a-f]{10}$`))
      assert.equal((await withStorage.findById(user.id)).avatarUrl, first.avatarUrl)
      const key = await withStorage.avatarKeyOf(user.id)
      assert.match(key, new RegExp(`^users/${user.id}/minha_foto_[a-z0-9]{10}\\.png$`))
      assert.deepEqual(await storage.read(key), bytes)

      const second = await withStorage.setAvatar(user.id, { buffer: Buffer.from([0xff, 0xd8, 0xff]), name: 'outra.jpg' }, 'image/jpeg')
      assert.notEqual(second.avatarUrl, first.avatarUrl)
      assert.ok(await t.db.one('SELECT key FROM storage_trash WHERE key = $1', [key]))

      const secondKey = await withStorage.avatarKeyOf(user.id)
      const cleared = await withStorage.clearAvatar(user.id)
      assert.equal(cleared.avatarUrl, null)
      assert.equal(await withStorage.avatarKeyOf(user.id), null)
      assert.ok(await t.db.one('SELECT key FROM storage_trash WHERE key = $1', [secondKey]))

      await withStorage.setAvatar(user.id, { buffer: bytes, name: 'ultima.png' }, 'image/png')
      const lastKey = await withStorage.avatarKeyOf(user.id)
      await t.db.exec('DELETE FROM users WHERE id = $1', [user.id])
      assert.ok(await t.db.one('SELECT key FROM storage_trash WHERE key = $1', [lastKey]))
    })
  })

  describe('perfis e permissões', () => {
    it('acham, listam por nome, criam e recusam código repetido', async () => {
      assert.equal((await roles.findByCode('ADMIN')).id, roleIds.ADMIN)
      assert.equal((await roles.findById(roleIds.ADMIN)).isSystem, true)
      assert.equal(await roles.findById('naoexiste000000'), null)
      assert.equal(await roles.findByCode('NADA'), null)
      const created = await roles.create({ code: 'AUDITOR', name: 'Auditor' })
      assert.deepEqual(Object.assign({}, created, { id: undefined }), { id: undefined, code: 'AUDITOR', name: 'Auditor', description: '', isSystem: false })
      await assert.rejects(roles.create({ code: 'AUDITOR', name: 'Outro' }), (err) => err.code === 'ROLE_CODE_IN_USE')
      const names = (await roles.list()).map((r) => r.name)
      assert.deepEqual(names, names.slice().sort((x, y) => x.localeCompare(y, 'en')))
      const updated = await roles.update(created.id, { description: 'Lê o histórico' })
      assert.deepEqual([updated.name, updated.description], ['Auditor', 'Lê o histórico'])
      await roles.delete(created.id)
      assert.equal(await roles.findById(created.id), null)
    })

    it('trocam o conjunto de permissões (remove, adiciona e ignora códigos desconhecidos)', async () => {
      const role = await roles.create({ code: 'PERMS', name: 'Permissões' })
      await roles.setPermissionCodes(role.id, ['tasks.view', 'projects.view', 'nao.existe'])
      assert.deepEqual(await roles.getPermissionCodes(role.id), ['projects.view', 'tasks.view'])
      await roles.setPermissionCodes(role.id, ['tasks.view', 'tasks.create'])
      assert.deepEqual(await roles.getPermissionCodes(role.id), ['tasks.create', 'tasks.view'])
      await roles.setPermissionCodes(role.id, [])
      assert.deepEqual(await roles.getPermissionCodes(role.id), [])
      // os outros perfis não mudam
      assert.equal((await roles.getPermissionCodes(roleIds.ADMIN)).length, PERMISSIONS.length)
    })

    it('listam o catálogo de permissões por módulo e código', async () => {
      const list = await core.createPermissionRepository(t.db).list()
      assert.equal(list.length, PERMISSIONS.length)
      const keys = list.map((p) => `${p.module}|${p.code}`)
      assert.deepEqual(keys, keys.slice().sort())
      assert.deepEqual(Object.keys(list[0]).sort(), ['code', 'id', 'module'])
    })
  })

  describe('sessões', () => {
    it('criam, acham pelo hash, renovam, listam as ativas e revogam', async () => {
      const user = await newUser({ email: 'sessoes@avanza.test' })
      const now = new Date('2026-10-28T12:00:00.000Z')
      const hour = 3600000
      const make = (hash, lastSeen, expires) =>
        sessions.create({ userId: user.id, tokenHash: hash, ip: '10.0.0.1', userAgent: 'teste', remember: true, lastSeenAt: new Date(lastSeen), expiresAt: new Date(expires) })

      const s1 = await make('hash-1', now.getTime() - 2 * hour, now.getTime() + hour)
      const s2 = await make('hash-2', now.getTime() - hour, now.getTime() + hour)
      const expired = await make('hash-3', now.getTime() - 3 * hour, now.getTime() - 1)
      assert.deepEqual(
        { userId: s1.userId, tokenHash: s1.tokenHash, ip: s1.ip, userAgent: s1.userAgent, remember: s1.remember, revokedAt: s1.revokedAt },
        { userId: user.id, tokenHash: 'hash-1', ip: '10.0.0.1', userAgent: 'teste', remember: true, revokedAt: null },
      )
      assert.ok(s1.createdAt instanceof Date)
      assert.equal((await sessions.findByTokenHash('hash-2')).id, s2.id)
      assert.equal(await sessions.findByTokenHash('nada'), null)
      assert.equal(await sessions.findById('naoexiste000000'), null)

      // mais recente primeiro; expiradas ficam de fora
      assert.deepEqual((await sessions.listActiveForUser(user.id, now)).map((s) => s.id), [s2.id, s1.id])
      const touched = await sessions.touch(s1.id, now, new Date(now.getTime() + 5 * hour))
      assert.equal(touched.lastSeenAt.getTime(), now.getTime())
      assert.deepEqual((await sessions.listActiveForUser(user.id, now)).map((s) => s.id), [s1.id, s2.id])

      const first = new Date('2026-10-28T12:30:00.000Z')
      await sessions.revoke(s2.id, first)
      await sessions.revoke(s2.id, new Date('2026-10-28T13:00:00.000Z'))
      assert.equal((await sessions.findById(s2.id)).revokedAt.toISOString(), first.toISOString())
      await sessions.revoke('naoexiste000000', first)

      const s4 = await make('hash-4', now.getTime(), now.getTime() + hour)
      // s1 e s4 ativas (s2 já revogada; a expirada também conta como não revogada)
      assert.equal(await sessions.revokeAllForUser(user.id, now, s4.id), 2)
      assert.deepEqual((await sessions.listActiveForUser(user.id, now)).map((s) => s.id), [s4.id])
      assert.ok((await sessions.findById(expired.id)).revokedAt)
      assert.equal(await sessions.revokeAllForUser(user.id, now), 1)
      assert.deepEqual(await sessions.listActiveForUser(user.id, now), [])
    })
  })

  describe('histórico de auditoria', () => {
    let actor
    before(async () => {
      actor = await newUser({ email: 'auditor@avanza.test' })
      await t.db.exec('DELETE FROM audit_logs')
    })

    let seq = 0
    /** Grava e fixa o "created" (achado pelo correlation_id, único por gravação). */
    async function recordAt(entry, created) {
      const correlationId = `corr-${++seq}`
      await audit.record(Object.assign({ ip: '127.0.0.1', userAgent: 'ua', correlationId }, entry))
      const row = await t.db.one('UPDATE audit_logs SET created = $2 WHERE correlation_id = $1 RETURNING id', [correlationId, new Date(created)])
      return row.id
    }

    it('grava JSON (objetos, listas e vazio) e lista com filtros, ordem e total', async () => {
      const a = await recordAt({ entityType: 'task', entityId: 't1', action: 'task.created', newValue: { title: 'A', tags: ['x', 'y'] }, userId: actor.id }, '2026-10-01T10:00:00Z')
      const b = await recordAt({ entityType: 'task', entityId: 't1', action: 'task.updated', oldValue: ['antes'], newValue: { title: 'B' }, userId: null }, '2026-10-02T10:00:00Z')
      const c = await recordAt({ entityType: 'project', entityId: 'p1', action: 'project.created', userId: actor.id }, '2026-10-03T10:00:00Z')
      await audit.record({ entityType: 'role', entityId: 'r1', action: 'role.updated' })

      const page = { offset: 0, perPage: 10 }
      const all = await audit.list({ filters: {}, pagination: page })
      assert.equal(all.total, 4)
      assert.deepEqual(all.items.slice(1).map((e) => e.id), [c, b, a])
      const sparse = all.items[0]
      assert.deepEqual(
        [sparse.oldValue, sparse.newValue, sparse.userId, sparse.ip, sparse.userAgent, sparse.correlationId],
        [null, null, null, '', '', ''],
      )

      const byEntity = await audit.list({ filters: { entityType: 'task', entityId: 't1' }, pagination: page })
      assert.deepEqual(byEntity.items.map((e) => e.id), [b, a])
      assert.deepEqual(byEntity.items[0].oldValue, ['antes'])
      assert.deepEqual(byEntity.items[1].newValue, { title: 'A', tags: ['x', 'y'] })
      assert.equal(byEntity.items[1].userId, actor.id)
      assert.ok(byEntity.items[1].createdAt instanceof Date)

      assert.deepEqual((await audit.list({ filters: { userId: actor.id }, pagination: page })).items.map((e) => e.id), [c, a])
      assert.deepEqual((await audit.list({ filters: { action: 'task.updated' }, pagination: page })).items.map((e) => e.id), [b])
      const range = await audit.list({ filters: { from: new Date('2026-10-02T00:00:00Z'), to: '2026-10-03T10:00:00.000Z' }, pagination: page })
      assert.deepEqual(range.items.map((e) => e.id), [c, b])

      const paged = await audit.list({ filters: { entityType: 'task' }, pagination: { offset: 1, perPage: 1 } })
      assert.deepEqual([paged.total, paged.items.map((e) => e.id)], [2, [a]])
    })

    it('contam e apagam em lotes o que é anterior à data', async () => {
      await t.db.exec('DELETE FROM audit_logs')
      await t.db.exec(
        "INSERT INTO audit_logs (id, entity_type, action, created) SELECT 'old' || lpad(g::text, 12, '0'), 'x', 'x.y', '2020-01-01T00:00:00Z'::timestamptz + (g || ' seconds')::interval FROM generate_series(1, 1203) AS g",
      )
      await audit.record({ entityType: 'x', entityId: 'novo', action: 'x.y' })
      const cutoff = new Date('2021-01-01T00:00:00Z')
      assert.equal(await audit.countBefore(cutoff), 1203)
      assert.equal(await audit.purgeBefore(cutoff), 1203)
      assert.equal(await audit.countBefore(cutoff), 0)
      assert.equal((await audit.list({ filters: {}, pagination: { offset: 0, perPage: 5 } })).total, 1)
      assert.equal(await audit.purgeBefore(cutoff), 0)
    })
  })

  describe('tentativas de login', () => {
    it('gravam, listam as recentes (mais nova primeiro), limpam e expiram', async () => {
      const base = new Date('2026-10-28T12:00:00.000Z').getTime()
      await attempts.record('login:ana', new Date(base - 10 * 60000))
      await attempts.record('login:ana', new Date(base - 2 * 60000))
      await attempts.record('login:ana', new Date(base - 60 * 60000))
      await attempts.record('login:bia', new Date(base - 60000))

      const since = await attempts.listSince('login:ana', new Date(base - 15 * 60000))
      assert.deepEqual(since.map((d) => d.getTime()), [base - 2 * 60000, base - 10 * 60000])
      assert.ok(since[0] instanceof Date)

      assert.equal(await attempts.purgeBefore(new Date(base - 30 * 60000)), 1)
      await attempts.clear('login:ana')
      assert.deepEqual(await attempts.listSince('login:ana', new Date(0)), [])
      assert.equal((await attempts.listSince('login:bia', new Date(0))).length, 1)
    })
  })

  describe('transações', () => {
    it('gravações dos repositórios dentro de db.transaction são desfeitas juntas', async () => {
      await assert.rejects(
        t.db.transaction(async () => {
          const user = await newUser({ email: 'desfeito@avanza.test' })
          await audit.record({ entityType: 'user', entityId: user.id, action: 'user.created', userId: user.id })
          assert.ok(await users.findByEmail('desfeito@avanza.test'))
          throw new Error('desfaz')
        }),
        /desfaz/,
      )
      assert.equal(await users.findByEmail('desfeito@avanza.test'), null)
      assert.equal((await t.db.one("SELECT count(*) AS n FROM audit_logs WHERE action = 'user.created'")).n, 0)
    })
  })
})
