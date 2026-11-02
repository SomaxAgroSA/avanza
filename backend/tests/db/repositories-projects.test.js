const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createTestDatabase, TEST_STORAGE } = require('../support/db-harness')
const { createStorage } = require('../../src/infrastructure/storage')
const { insertRow } = require('../../src/infrastructure/sql')
const { createProjectRepository, createProjectMemberRepository, createProjectFileRepository } = require('../../src/infrastructure/repositories/projects')

describe('repositórios de projetos e membros', () => {
  let t
  let projects
  let members
  let users
  let p

  const page = (perPage, offset) => ({ perPage: perPage || 50, offset: offset || 0 })
  const ids = (result) => result.items.map((item) => item.key)

  before(async () => {
    t = await createTestDatabase()
    projects = createProjectRepository(t.db, {})
    members = createProjectMemberRepository(t.db, {})
    const role = await t.db.one("SELECT id FROM roles WHERE code = 'ADMIN'")
    users = {}
    for (const name of ['ana', 'bia', 'caio']) {
      users[name] = await insertRow(t.db, 'users', { email: `${name}@avanza.test`, name, role_id: role.id, status: 'active' })
    }
    // Alpha (ana), Beta (bia, sem prazo), Gamma (ana, arquivado), delta (bia)
    p = {}
    p.alpha = await projects.create({ name: 'Alpha', key: 'ALP', status: 'active', priority: 'high', ownerId: users.ana.id, createdBy: users.ana.id, dueDate: '2026-12-01T00:00:00.000Z' })
    p.beta = await projects.create({ name: 'Beta', key: 'BET', status: 'planning', priority: 'low', ownerId: users.bia.id, createdBy: null, startDate: null, dueDate: null })
    p.gamma = await projects.create({ name: 'Gamma', key: 'GAM', status: 'active', priority: 'high', ownerId: users.ana.id, createdBy: users.ana.id })
    p.gamma = await projects.update(p.gamma.id, { archivedAt: new Date('2026-10-01T10:00:00.000Z') })
    p.delta = await projects.create({ name: 'delta 50%_off', key: 'DEL', status: 'active', priority: 'medium', ownerId: users.bia.id, createdBy: users.bia.id, dueDate: new Date('2026-11-01T00:00:00.000Z') })
    await members.add({ projectId: p.alpha.id, userId: users.ana.id, role: 'manager' })
    await members.add({ projectId: p.gamma.id, userId: users.ana.id, role: 'manager' })
    await members.add({ projectId: p.beta.id, userId: users.bia.id, role: 'manager' })
    await members.add({ projectId: p.delta.id, userId: users.bia.id, role: 'manager' })
    await members.add({ projectId: p.alpha.id, userId: users.bia.id, role: 'member' })
  })
  after(() => t.drop())

  it('gravam e leem a entidade como o PocketBase (vazios, datas e relação vazia)', async () => {
    const beta = await projects.findById(p.beta.id)
    assert.equal(beta.createdBy, '')
    assert.equal(beta.description, '')
    assert.equal(beta.startDate, null)
    assert.equal(beta.archivedAt, null)
    assert.ok(beta.createdAt instanceof Date)
    const alpha = await projects.findByKey('ALP')
    assert.equal(alpha.id, p.alpha.id)
    assert.equal(alpha.dueDate.toISOString(), '2026-12-01T00:00:00.000Z')
    assert.equal(alpha.createdBy, users.ana.id)
    assert.equal(await projects.findByKey('NOPE'), null)
    assert.equal(await projects.findById('naoexiste12345'), null)
    assert.deepEqual((await projects.findManyByIds([p.alpha.id, p.delta.id, ''])).map((x) => x.key).sort(), ['ALP', 'DEL'])
    assert.deepEqual(await projects.findManyByIds([]), [])
  })

  it('listam conforme o escopo: meus, todos (com e sem view_all) e arquivados', async () => {
    const sort = [{ column: 'name', direction: 'ASC' }]
    const mine = await projects.list({ scope: { userId: users.ana.id, viewAll: true }, view: 'mine', sort, pagination: page() })
    assert.deepEqual(ids(mine), ['ALP'])
    assert.equal(mine.total, 1)
    const all = await projects.list({ scope: { userId: users.caio.id, viewAll: true }, view: 'all', sort, pagination: page() })
    assert.deepEqual(ids(all), ['ALP', 'BET', 'DEL'])
    assert.equal(all.total, 3)
    // sem view_all, "todos" são só os projetos em que é membro
    const restricted = await projects.list({ scope: { userId: users.bia.id, viewAll: false }, view: 'all', sort, pagination: page() })
    assert.deepEqual(ids(restricted), ['ALP', 'BET', 'DEL'])
    const none = await projects.list({ scope: { userId: users.caio.id, viewAll: false }, view: 'all', sort, pagination: page() })
    assert.deepEqual(none, { items: [], total: 0 })
    const archived = await projects.list({ scope: { userId: users.caio.id, viewAll: true }, view: 'archived', sort, pagination: page() })
    assert.deepEqual(ids(archived), ['GAM'])
    const archivedMine = await projects.list({ scope: { userId: users.bia.id, viewAll: false }, view: 'archived', sort, pagination: page() })
    assert.equal(archivedMine.total, 0)
  })

  it('visíveis para o quadro de todos os projetos: só abertos, pela chave; sem view_all, dono ou membro', async () => {
    const keys = (list) => list.map((item) => item.key)
    assert.deepEqual(keys(await projects.listVisible({ userId: users.caio.id, viewAll: true })), ['ALP', 'BET', 'DEL'])
    assert.deepEqual(keys(await projects.listVisible({ userId: users.ana.id, viewAll: false })), ['ALP'])
    assert.deepEqual(await projects.listVisible({ userId: users.caio.id, viewAll: false }), [])
    // a dona continua vendo o projeto mesmo sem a linha de membro
    await members.remove(p.delta.id, users.bia.id)
    assert.deepEqual(keys(await projects.listVisible({ userId: users.bia.id, viewAll: false })), ['ALP', 'BET', 'DEL'])
    await members.add({ projectId: p.delta.id, userId: users.bia.id, role: 'manager' })
    // `ids` restringe (arquivado e inexistente ficam de fora)
    assert.deepEqual(keys(await projects.listVisible({ userId: users.bia.id, viewAll: false, ids: [p.delta.id, p.gamma.id, 'naoexiste12345'] })), ['DEL'])
    assert.deepEqual(await projects.listVisible({ userId: users.ana.id, viewAll: true, ids: [] }), [])
  })

  it('filtram por busca (nome ou chave, sem curingas), status, prioridade e dono', async () => {
    const base = { scope: { userId: users.ana.id, viewAll: true }, view: 'all', sort: [{ column: 'name', direction: 'ASC' }], pagination: page() }
    const list = (extra) => projects.list(Object.assign({}, base, extra))
    assert.deepEqual(ids(await list({ search: 'alp' })), ['ALP'])
    assert.deepEqual(ids(await list({ search: 'bet' })), ['BET'])
    assert.deepEqual(ids(await list({ search: 'TA' })), ['BET', 'DEL'])
    assert.deepEqual(ids(await list({ search: '50%' })), ['DEL'])
    assert.deepEqual(ids(await list({ search: '%' })), ['DEL'])
    assert.deepEqual(ids(await list({ search: 'a_p' })), [])
    assert.deepEqual(ids(await list({ status: 'active' })), ['ALP', 'DEL'])
    assert.deepEqual(ids(await list({ priority: 'low' })), ['BET'])
    assert.deepEqual(ids(await list({ ownerId: users.bia.id })), ['BET', 'DEL'])
    assert.deepEqual(ids(await list({ ownerId: users.bia.id, status: 'planning', search: 'b' })), ['BET'])
  })

  it('urgência: vazia gravada como texto vazio (lida como null), filtro com none = sem urgência', async () => {
    const base = { scope: { userId: users.ana.id, viewAll: true }, view: 'all', sort: [{ column: 'name', direction: 'ASC' }], pagination: page() }
    const list = (extra) => projects.list(Object.assign({}, base, extra))
    assert.equal(p.alpha.urgency, null)
    assert.equal((await projects.update(p.delta.id, { urgency: 'high' })).urgency, 'high')
    try {
      assert.deepEqual(ids(await list({ urgency: 'high' })), ['DEL'])
      assert.deepEqual(ids(await list({ urgency: 'none' })), ['ALP', 'BET'])
      assert.deepEqual(await t.db.one('SELECT urgency FROM projects WHERE id = $1', [p.alpha.id]), { urgency: '' })
    } finally {
      assert.equal((await projects.update(p.delta.id, { urgency: null })).urgency, null)
    }
  })

  it('ordenam pelas colunas da whitelist (data vazia primeiro na crescente) e paginam com o total', async () => {
    const base = { scope: { userId: users.ana.id, viewAll: true }, view: 'all', pagination: page() }
    const sorted = async (column, dir) => ids(await projects.list(Object.assign({}, base, { sort: [{ column, direction: dir }] })))
    assert.deepEqual(await sorted('due_date', 'ASC'), ['BET', 'DEL', 'ALP'])
    assert.deepEqual(await sorted('due_date', 'DESC'), ['ALP', 'DEL', 'BET'])
    assert.deepEqual(await sorted('created', 'DESC'), ['DEL', 'BET', 'ALP'])
    assert.deepEqual(await sorted('key', 'DESC'), ['DEL', 'BET', 'ALP'])
    const second = await projects.list(Object.assign({}, base, { sort: [{ column: 'name', direction: 'ASC' }], pagination: page(2, 2) }))
    assert.deepEqual(ids(second), ['DEL'])
    assert.equal(second.total, 3)
    const beyond = await projects.list(Object.assign({}, base, { sort: [], pagination: page(2, 10) }))
    assert.deepEqual(beyond, { items: [], total: 3 })
  })

  it('atualizam (limpar data grava NULL) e recusam chave repetida, inclusive em paralelo', async () => {
    const updated = await projects.update(p.delta.id, { name: 'Delta', dueDate: null, ownerId: users.ana.id })
    assert.equal(updated.name, 'Delta')
    assert.equal(updated.dueDate, null)
    assert.equal(updated.ownerId, users.ana.id)
    assert.ok(updated.updatedAt >= p.delta.updatedAt)
    assert.equal(await projects.update('naoexiste12345', { name: 'x' }), null)
    await assert.rejects(projects.create({ name: 'Outro', key: 'ALP', ownerId: users.ana.id }), { code: 'PROJECT_KEY_IN_USE' })
    const results = await Promise.allSettled(
      [1, 2].map(() => t.db.transaction(() => projects.create({ name: 'Corrida', key: 'RACE', ownerId: users.ana.id }))),
    )
    assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected'])
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'PROJECT_KEY_IN_USE')
  })

  it('membros: busca, lista por projeto (ordem de entrada), papel e duplicidade', async () => {
    const found = await members.find(p.alpha.id, users.bia.id)
    assert.deepEqual(Object.keys(found).sort(), ['createdAt', 'id', 'projectId', 'role', 'userId'])
    assert.equal(found.role, 'member')
    assert.equal(await members.find(p.alpha.id, users.caio.id), null)
    // a lista alimenta a exclusão dos candidatos (quem já é membro não aparece)
    assert.deepEqual((await members.listByProject(p.alpha.id)).map((m) => m.userId), [users.ana.id, users.bia.id])
    await assert.rejects(members.add({ projectId: p.alpha.id, userId: users.bia.id, role: 'viewer' }), { code: 'MEMBER_ALREADY_EXISTS' })
    const changed = await members.updateRole(p.alpha.id, users.bia.id, 'viewer')
    assert.equal(changed.role, 'viewer')
    assert.equal(await members.updateRole(p.alpha.id, users.caio.id, 'viewer'), null)
  })

  it('membros: contagem e papéis do usuário em lote (só os projetos com linhas)', async () => {
    assert.deepEqual(await members.countByProjects([p.alpha.id, p.beta.id, p.gamma.id, 'naoexiste12345']), { [p.alpha.id]: 2, [p.beta.id]: 1, [p.gamma.id]: 1 })
    assert.deepEqual(await members.countByProjects([]), {})
    assert.deepEqual(await members.rolesForUser(users.bia.id, [p.alpha.id, p.beta.id, p.gamma.id]), { [p.alpha.id]: 'viewer', [p.beta.id]: 'manager' })
    assert.deepEqual(await members.rolesForUser(users.caio.id, [p.alpha.id]), {})
    assert.deepEqual(await members.rolesForUser(users.bia.id, []), {})
  })

  it('membros: remover um, remover todos; apagar o projeto leva os membros', async () => {
    const extra = await projects.create({ name: 'Temp', key: 'TMP', ownerId: users.ana.id })
    await members.add({ projectId: extra.id, userId: users.ana.id, role: 'manager' })
    await members.add({ projectId: extra.id, userId: users.bia.id, role: 'member' })
    await members.add({ projectId: extra.id, userId: users.caio.id, role: 'member' })
    await members.remove(extra.id, users.caio.id)
    assert.deepEqual(await members.countByProjects([extra.id]), { [extra.id]: 2 })
    await members.removeAllForProject(extra.id)
    assert.deepEqual(await members.countByProjects([extra.id]), {})
    await members.add({ projectId: extra.id, userId: users.ana.id, role: 'manager' })
    await projects.delete(extra.id)
    assert.equal(await projects.findById(extra.id), null)
    assert.equal(await members.find(extra.id, users.ana.id), null)
  })

  describe('arquivos do projeto', () => {
    let storage
    let files

    before(async () => {
      storage = createStorage(Object.assign({}, TEST_STORAGE, { bucket: `avanza-t-${crypto.randomBytes(4).toString('hex')}` }))
      await storage.ensureBucket()
      files = createProjectFileRepository(t.db, { storage })
    })

    after(async () => {
      if (storage) await storage.dropBucket()
    })

    it('grava no Storage, lista os mais recentes primeiro, exclui pela lixeira e sai em cascata com o projeto', async () => {
      const project = await projects.create({ name: 'Arquivos', key: 'ARQ', status: 'active', priority: 'medium', ownerId: users.ana.id, createdBy: users.ana.id })
      const bytes = Buffer.from('%PDF-1.7 conteúdo')
      const first = await files.create({
        projectId: project.id,
        handle: { buffer: bytes, mime: 'application/pdf', name: 'Contrato Final.pdf' },
        name: 'Contrato Final.pdf',
        mime: 'application/pdf',
        kind: 'document',
        size: bytes.length,
        uploadedBy: users.ana.id,
      })
      assert.deepEqual(await files.findById(first.id), {
        id: first.id,
        projectId: project.id,
        name: 'Contrato Final.pdf',
        mime: 'application/pdf',
        kind: 'document',
        size: bytes.length,
        uploadedBy: users.ana.id,
        createdAt: first.createdAt,
      })
      const key = await files.fileKeyOf(first.id)
      assert.match(key, new RegExp(`^project_files/${first.id}/contrato_final_[a-z0-9]{10}\\.pdf$`))
      assert.deepEqual(await storage.read(key), bytes)
      await assert.rejects(files.fileKeyOf('naoexiste123456'), (err) => err.code === 'PROJECT_FILE_NOT_FOUND')

      const second = await files.create({ projectId: project.id, handle: { buffer: Buffer.from('a'), name: 'b.txt' }, name: 'b.txt', mime: 'text/plain', kind: 'document', size: 1, uploadedBy: null })
      assert.deepEqual((await files.listByProject(project.id)).map((f) => f.id), [second.id, first.id])

      await files.delete(first.id)
      assert.equal(await files.findById(first.id), null)
      assert.ok(await t.db.one('SELECT key FROM storage_trash WHERE key = $1', [key]))
      assert.deepEqual(await storage.read(key), bytes)

      await t.db.exec('DELETE FROM projects WHERE id = $1', [project.id])
      assert.equal(await files.findById(second.id), null)
      assert.ok(await t.db.one("SELECT key FROM storage_trash WHERE key LIKE $1", [`project_files/${second.id}/%`]))
    })
  })
})
