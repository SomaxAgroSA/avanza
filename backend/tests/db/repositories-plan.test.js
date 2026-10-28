const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createTestDatabase, TEST_STORAGE } = require('../support/db-harness')
const { createStorage } = require('../../src/infrastructure/storage')
const { insertRow } = require('../../src/infrastructure/sql')
const plan = require('../../src/infrastructure/repositories/plan')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

describe('repositórios do quadro (Gerenciamento de Projetos)', () => {
  let t
  let storage
  let repos
  let owner

  before(async () => {
    t = await createTestDatabase()
    storage = createStorage(Object.assign({}, TEST_STORAGE, { bucket: `avanza-t-${crypto.randomBytes(4).toString('hex')}` }))
    await storage.ensureBucket()
    const ctx = { storage }
    repos = {
      groups: plan.createProjectGroupRepository(t.db, ctx),
      statuses: plan.createPlanStatusRepository(t.db, ctx),
      resources: plan.createPlanResourceRepository(t.db, ctx),
      items: plan.createPlanItemRepository(t.db, ctx),
      links: plan.createPlanLinkRepository(t.db, ctx),
      settings: plan.createPlanSettingsRepository(t.db, ctx),
      updates: plan.createPlanUpdateRepository(t.db, ctx),
      files: plan.createPlanFileRepository(t.db, ctx),
      journal: plan.createPlanJournalRepository(t.db, ctx),
      issues: plan.createPlanIssueRepository(t.db, ctx),
      columns: plan.createPlanColumnRepository(t.db, ctx),
    }
    const role = await t.db.one("SELECT id FROM roles WHERE code = 'ADMIN'")
    owner = await insertRow(t.db, 'users', { email: 'dono@avanza.test', name: 'Dono', role_id: role.id, status: 'active' })
  })
  after(async () => {
    await storage.dropBucket()
    await t.drop()
  })

  async function seedProject() {
    const key = `P${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    return insertRow(t.db, 'projects', { name: `Projeto ${key}`, key, owner_id: owner.id })
  }

  async function seedBoard() {
    const project = await seedProject()
    const group = await repos.groups.create({ projectId: project.id, parentId: null, name: 'Fase 1', color: 'blue', position: 1024, createdBy: owner.id })
    return { project, group }
  }

  const newItem = (project, group, extra) =>
    repos.items.create(Object.assign({ projectId: project.id, groupId: group.id, parentId: null, name: 'Elemento', statusId: null, position: 1024, createdBy: owner.id }, extra))

  describe('grupos', () => {
    it('lista na ordem (posição, criação), com subgrupos e posições por irmãos', async () => {
      const project = await seedProject()
      assert.equal(await repos.groups.maxPosition(project.id, null), null)
      const late = await repos.groups.create({ projectId: project.id, parentId: null, name: 'C', color: 'red', position: 2048, createdBy: owner.id })
      const first = await repos.groups.create({ projectId: project.id, parentId: null, name: 'A', color: 'blue', position: 1024, createdBy: owner.id })
      await sleep(5)
      const tie = await repos.groups.create({ projectId: project.id, parentId: null, name: 'B', color: 'blue', position: 1024, createdBy: null })
      const sub = await repos.groups.create({ projectId: project.id, parentId: first.id, name: 'A.1', color: 'green', position: 512 })

      assert.deepEqual((await repos.groups.listByProject(project.id)).map((g) => g.name), ['A.1', 'A', 'B', 'C'])
      assert.equal(first.parentId, null)
      assert.equal(sub.parentId, first.id)
      assert.equal(tie.createdBy, null)
      assert.equal(first.createdBy, owner.id)
      assert.ok(first.createdAt instanceof Date && first.updatedAt instanceof Date)
      assert.equal((await t.db.one('SELECT parent_id FROM project_groups WHERE id = $1', [first.id])).parent_id, '')

      assert.equal(await repos.groups.maxPosition(project.id, null), 2048)
      assert.equal(await repos.groups.maxPosition(project.id, first.id), 512)

      await repos.groups.renumber(project.id, null)
      assert.deepEqual(
        (await repos.groups.listByProject(project.id)).filter((g) => !g.parentId).map((g) => [g.name, g.position]),
        [['A', 1024], ['B', 2048], ['C', 3072]],
      )
      assert.equal((await repos.groups.findById(sub.id)).position, 512)

      const moved = await repos.groups.update(sub.id, { parentId: null, position: 4096, name: 'D' })
      assert.equal(moved.parentId, null)
      assert.equal(moved.name, 'D')
      assert.deepEqual((await repos.groups.findManyByIds([late.id, sub.id, 'naoexiste12345'])).map((g) => g.id).sort(), [late.id, sub.id].sort())
      assert.deepEqual(await repos.groups.findManyByIds([]), [])

      await repos.groups.delete(late.id)
      assert.equal(await repos.groups.findById(late.id), null)
      await assert.rejects(repos.groups.update(late.id, { name: 'x' }), { code: 'NOT_FOUND' })
    })
  })

  describe('etiquetas', () => {
    it('status: ordem por posição, edição e exclusão', async () => {
      const project = await seedProject()
      await repos.statuses.create({ projectId: project.id, name: 'Feito', color: 'green', category: 'done', position: 3072 })
      const todo = await repos.statuses.create({ projectId: project.id, name: 'A fazer', color: 'gray', category: 'todo', position: 1024 })
      assert.deepEqual(todo, { id: todo.id, projectId: project.id, name: 'A fazer', color: 'gray', category: 'todo', position: 1024 })
      assert.deepEqual((await repos.statuses.listByProject(project.id)).map((s) => s.name), ['A fazer', 'Feito'])
      assert.equal((await repos.statuses.update(todo.id, { name: 'Pendente' })).name, 'Pendente')
      await repos.statuses.delete(todo.id)
      assert.deepEqual((await repos.statuses.listByProject(project.id)).map((s) => s.name), ['Feito'])
    })

    it('recurso: chave única por projeto e exclusão tira o id dos elementos', async () => {
      const { project, group } = await seedBoard()
      const ana = await repos.resources.create({ projectId: project.id, name: 'Ana', nameKey: 'ana', color: 'blue' })
      const bia = await repos.resources.create({ projectId: project.id, name: 'Bia', nameKey: 'bia', color: 'red' })
      assert.deepEqual((await repos.resources.findByKey(project.id, 'ana')), { id: ana.id, projectId: project.id, name: 'Ana', nameKey: 'ana', color: 'blue' })
      assert.equal(await repos.resources.findByKey(project.id, 'zed'), null)
      assert.deepEqual((await repos.resources.listByProject(project.id)).map((r) => r.name), ['Ana', 'Bia'])
      await assert.rejects(repos.resources.create({ projectId: project.id, name: 'ANA', nameKey: 'ana', color: 'gray' }), { code: 'PLAN_RESOURCE_NAME_IN_USE' })
      await assert.rejects(repos.resources.update(bia.id, { name: 'Ana', nameKey: 'ana' }), { code: 'PLAN_RESOURCE_NAME_IN_USE' })

      const both = await newItem(project, group, { resourceIds: [ana.id, bia.id] })
      const onlyAna = await newItem(project, group, { resourceIds: [ana.id] })
      const none = await newItem(project, group, {})
      assert.deepEqual((await repos.items.listByResource(ana.id)).map((i) => i.id).sort(), [both.id, onlyAna.id].sort())

      await repos.resources.delete(ana.id)
      assert.equal(await repos.resources.findById(ana.id), null)
      assert.deepEqual((await repos.items.findById(both.id)).resourceIds, [bia.id])
      assert.deepEqual((await repos.items.findById(onlyAna.id)).resourceIds, [])
      assert.deepEqual((await repos.items.findById(none.id)).resourceIds, [])
      assert.deepEqual(await repos.items.listByResource(ana.id), [])
    })
  })

  describe('elementos', () => {
    it('gravam e leem dias, vínculos vazios e JSON (recursos, métricas, colunas)', async () => {
      const { project, group } = await seedBoard()
      const status = await repos.statuses.create({ projectId: project.id, name: 'Em andamento', color: 'blue', category: 'doing', position: 1024 })
      const plain = await newItem(project, group, {})
      assert.equal(plain.parentId, null)
      assert.equal(plain.statusId, null)
      assert.equal(plain.ownerId, null)
      assert.equal(plain.startDate, null)
      assert.deepEqual(plain.resourceIds, [])
      assert.deepEqual(plain.metrics, {})
      assert.deepEqual(plain.custom, {})
      assert.equal(plain.progress, 0)
      assert.equal(plain.progressSet, false)
      assert.equal(plain.createdBy, owner.id)

      const metrics = { estimated_hours: 12.5, actual_hours: 3, duration_days: 4 }
      const custom = { colabc: 'texto', coldef: 42.25, colghi: true, coljkl: '2026-11-30' }
      const full = await newItem(project, group, {
        name: 'Completo',
        statusId: status.id,
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        dueDate: '2026-11-15',
        ownerId: owner.id,
        resourceIds: ['rsaaaaaaaaaaaaa', 'rsbbbbbbbbbbbbb'],
        metrics,
        custom,
        progress: 40,
        progressSet: true,
      })
      const found = await repos.items.findById(full.id)
      assert.deepEqual(found, full)
      assert.equal(found.statusId, status.id)
      assert.deepEqual([found.startDate, found.endDate, found.dueDate], ['2026-10-01', '2026-10-31', '2026-11-15'])
      assert.deepEqual(found.resourceIds, ['rsaaaaaaaaaaaaa', 'rsbbbbbbbbbbbbb'])
      assert.deepEqual(found.metrics, metrics)
      assert.deepEqual(found.custom, custom)
      assert.equal(found.progress, 40)
      assert.equal(found.progressSet, true)
      const raw = await t.db.one(
        'SELECT jsonb_typeof(resource_ids) AS r, jsonb_typeof(metrics) AS m, jsonb_typeof(custom) AS c, start_date FROM plan_items WHERE id = $1',
        [full.id],
      )
      assert.deepEqual([raw.r, raw.m, raw.c], ['array', 'object', 'object'])
      assert.equal(raw.start_date.toISOString(), '2026-10-01T00:00:00.000Z')

      assert.deepEqual((await repos.items.listByStatus(status.id)).map((i) => i.id), [full.id])
      const cleared = await repos.items.update(full.id, { statusId: null, startDate: null, ownerId: null, resourceIds: null, custom: { colabc: 'novo' } })
      assert.equal(cleared.statusId, null)
      assert.equal(cleared.startDate, null)
      assert.equal(cleared.endDate, '2026-10-31')
      assert.equal(cleared.ownerId, null)
      assert.deepEqual(cleared.resourceIds, [])
      assert.deepEqual(cleared.custom, { colabc: 'novo' })
      assert.deepEqual(cleared.metrics, metrics)
      assert.ok(cleared.updatedAt >= full.updatedAt)
      assert.equal((await t.db.one('SELECT status_id FROM plan_items WHERE id = $1', [full.id])).status_id, '')
      assert.deepEqual(await repos.items.listByStatus(status.id), [])
    })

    it('ordem, subelementos, irmãos, posições e renumeração', async () => {
      const { project, group } = await seedBoard()
      const other = await repos.groups.create({ projectId: project.id, parentId: null, name: 'Fase 2', color: 'red', position: 2048 })
      assert.equal(await repos.items.maxPosition(group.id, null), null)

      const b = await newItem(project, group, { name: 'B', position: 2048 })
      const a = await newItem(project, group, { name: 'A', position: 1024 })
      await sleep(5)
      const a2 = await newItem(project, group, { name: 'A2', position: 1024 })
      const c = await newItem(project, other, { name: 'C', position: 512 })
      const sub2 = await newItem(project, group, { name: 'a.2', parentId: a.id, position: 2048 })
      const sub1 = await newItem(project, group, { name: 'a.1', parentId: a.id, position: 1024 })

      assert.deepEqual((await repos.items.listByProject(project.id)).map((i) => i.name), ['C', 'A', 'A2', 'a.1', 'B', 'a.2'])
      assert.deepEqual((await repos.items.listByProject(project.id, 2)).map((i) => i.name), ['C', 'A'])
      assert.deepEqual((await repos.items.listByGroups([group.id])).map((i) => i.name), ['A', 'A2', 'a.1', 'B', 'a.2'])
      assert.deepEqual((await repos.items.listByGroups([group.id, other.id])).length, 6)
      assert.deepEqual(await repos.items.listByGroups([]), [])
      assert.deepEqual((await repos.items.listChildren(a.id)).map((i) => i.id), [sub1.id, sub2.id])
      assert.equal(sub1.parentId, a.id)

      assert.deepEqual((await repos.items.listSiblings(group.id, null)).map((i) => i.name), ['A', 'A2', 'B'])
      assert.deepEqual((await repos.items.listSiblings(group.id, a.id)).map((i) => i.name), ['a.1', 'a.2'])
      assert.equal(await repos.items.maxPosition(group.id, null), 2048)
      assert.equal(await repos.items.maxPosition(group.id, a.id), 2048)
      assert.equal(await repos.items.maxPosition(other.id, null), 512)

      await repos.items.update(sub2.id, { position: 100 })
      await repos.items.renumber(group.id, null)
      await repos.items.renumber(group.id, a.id)
      assert.deepEqual(
        (await repos.items.listSiblings(group.id, null)).map((i) => [i.name, i.position]),
        [['A', 1024], ['A2', 2048], ['B', 3072]],
      )
      assert.deepEqual(
        (await repos.items.listSiblings(group.id, a.id)).map((i) => [i.name, i.position]),
        [['a.2', 1024], ['a.1', 2048]],
      )
      assert.equal((await repos.items.findById(c.id)).position, 512)

      // subelementos acompanham o grupo do elemento
      await repos.items.update(a.id, { groupId: other.id })
      assert.equal((await repos.items.findById(a.id)).groupId, other.id)
      await repos.items.delete(b.id)
      assert.equal(await repos.items.findById(b.id), null)
      assert.ok(await repos.items.findById(a2.id))
    })
  })

  describe('dependências e configuração', () => {
    it('ligações por projeto, par único e remoção pelos elementos', async () => {
      const { project, group } = await seedBoard()
      const elsewhere = await seedBoard()
      const [a, b, c] = [await newItem(project, group, { name: 'a' }), await newItem(project, group, { name: 'b' }), await newItem(project, group, { name: 'c' })]
      const x = await newItem(elsewhere.project, elsewhere.group, { name: 'x' })
      const y = await newItem(elsewhere.project, elsewhere.group, { name: 'y' })

      const ab = await repos.links.create({ projectId: project.id, fromId: a.id, toId: b.id, type: 'blocks', createdBy: owner.id })
      await sleep(5)
      const bc = await repos.links.create({ projectId: project.id, fromId: b.id, toId: c.id, type: 'relates', createdBy: null })
      await repos.links.create({ projectId: elsewhere.project.id, fromId: x.id, toId: y.id, type: 'blocks' })
      assert.deepEqual(ab, { id: ab.id, projectId: project.id, fromId: a.id, toId: b.id, type: 'blocks', createdBy: owner.id, createdAt: ab.createdAt })
      assert.equal(bc.createdBy, null)
      assert.deepEqual((await repos.links.listByProject(project.id)).map((l) => l.id), [ab.id, bc.id])
      assert.deepEqual(await repos.links.findById(ab.id), ab)

      await assert.rejects(repos.links.create({ projectId: project.id, fromId: a.id, toId: b.id, type: 'blocks' }), (err) => {
        assert.equal(err.code, 'VALIDATION_ERROR')
        assert.deepEqual(err.details.fields, { item_id: 'duplicate' })
        return true
      })

      await repos.links.deleteByItems([])
      await repos.links.deleteByItems([c.id])
      assert.deepEqual((await repos.links.listByProject(project.id)).map((l) => l.id), [ab.id])
      await repos.links.delete(ab.id)
      assert.deepEqual(await repos.links.listByProject(project.id), [])
      assert.equal((await repos.links.listByProject(elsewhere.project.id)).length, 1)
    })

    it('configuração: um registro por projeto, gravando só o que veio', async () => {
      const project = await seedProject()
      assert.equal(await repos.settings.findByProject(project.id), null)

      const first = await repos.settings.save(project.id, { issueSeq: 3 })
      assert.deepEqual(first, { projectId: project.id, dependencyRule: 'warn', baseline: null, issueSeq: 3 })
      const rule = await repos.settings.save(project.id, { dependencyRule: 'block' })
      assert.deepEqual(rule, { projectId: project.id, dependencyRule: 'block', baseline: null, issueSeq: 3 })

      const savedAt = new Date('2026-10-28T13:45:00.123Z')
      const items = { itaaaaaaaaaaaaa: { start: '2026-10-01', end: '2026-10-10' } }
      const withBaseline = await repos.settings.save(project.id, { baseline: { savedAt, items } })
      assert.deepEqual(withBaseline.baseline, { savedAt, items })
      assert.deepEqual((await repos.settings.findByProject(project.id)).baseline, { savedAt, items })
      assert.equal((await repos.settings.save(project.id, { baseline: null })).baseline, null)
      assert.equal((await repos.settings.save(project.id, {})).dependencyRule, 'block')

      // gravações simultâneas num projeto sem registro não duplicam nem falham
      const fresh = await seedProject()
      await Promise.all([
        t.db.transaction(() => repos.settings.save(fresh.id, { issueSeq: 1 })),
        t.db.transaction(() => repos.settings.save(fresh.id, { dependencyRule: 'block' })),
      ])
      assert.deepEqual(await t.db.one('SELECT count(*) AS n FROM plan_settings WHERE project_id = $1', [fresh.id]), { n: 1 })
      assert.deepEqual(await repos.settings.findByProject(fresh.id), { projectId: fresh.id, dependencyRule: 'block', baseline: null, issueSeq: 1 })
    })
  })

  describe('painel do elemento', () => {
    it('atualizações com respostas, menções, edição e exclusão lógica', async () => {
      const { project, group } = await seedBoard()
      const item = await newItem(project, group, {})
      const other = await newItem(project, group, {})
      const main = await repos.updates.create({ projectId: project.id, itemId: item.id, parentId: null, authorId: owner.id, content: 'Olá @dono', mentions: [owner.id] })
      await sleep(5)
      const reply = await repos.updates.create({ projectId: project.id, itemId: item.id, parentId: main.id, authorId: null, content: 'Resposta', mentions: [] })
      await repos.updates.create({ projectId: project.id, itemId: other.id, authorId: owner.id, content: 'Outro' })

      assert.deepEqual(main, {
        id: main.id,
        projectId: project.id,
        itemId: item.id,
        parentId: null,
        authorId: owner.id,
        content: 'Olá @dono',
        mentions: [owner.id],
        editedAt: null,
        deletedAt: null,
        createdAt: main.createdAt,
      })
      assert.equal(reply.parentId, main.id)
      assert.equal(reply.authorId, null)
      assert.equal((await t.db.one('SELECT jsonb_typeof(mentions) AS t FROM plan_item_updates WHERE id = $1', [main.id])).t, 'array')
      assert.deepEqual((await repos.updates.listByItem(item.id)).map((u) => u.id), [main.id, reply.id])

      const editedAt = new Date('2026-10-28T10:00:00.000Z')
      const edited = await repos.updates.update(main.id, { content: 'Editado', mentions: [], editedAt })
      assert.deepEqual([edited.content, edited.mentions, edited.editedAt.toISOString()], ['Editado', [], editedAt.toISOString()])
      assert.deepEqual(await repos.updates.countByProject(project.id), { [item.id]: 2, [other.id]: 1 })

      await repos.updates.update(reply.id, { content: '', mentions: [], deletedAt: new Date() })
      assert.ok((await repos.updates.findById(reply.id)).deletedAt instanceof Date)
      assert.equal((await repos.updates.findById(reply.id)).content, '')
      assert.deepEqual(await repos.updates.countByProject(project.id), { [item.id]: 1, [other.id]: 1 })
    })

    it('arquivos: conteúdo no Storage, chave, listagem, contagem e lixeira ao excluir', async () => {
      const { project, group } = await seedBoard()
      const item = await newItem(project, group, {})
      const update = await repos.updates.create({ projectId: project.id, itemId: item.id, authorId: owner.id, content: 'Com arquivos' })
      const bytes = Buffer.from('%PDF-1.4 conteúdo')
      const pdf = await repos.files.create({
        projectId: project.id,
        itemId: item.id,
        updateId: update.id,
        uploadedBy: owner.id,
        name: 'Relatório Final.pdf',
        mime: 'application/pdf',
        kind: 'document',
        size: bytes.length,
        handle: { buffer: bytes, mime: 'application/octet-stream', name: 'Relatório Final.pdf', size: bytes.length },
      })
      assert.deepEqual(pdf, {
        id: pdf.id,
        projectId: project.id,
        itemId: item.id,
        updateId: update.id,
        name: 'Relatório Final.pdf',
        mime: 'application/pdf',
        kind: 'document',
        size: bytes.length,
        uploadedBy: owner.id,
        createdAt: pdf.createdAt,
      })
      const key = await repos.files.fileKeyOf(pdf.id)
      assert.match(key, new RegExp(`^plan_item_files/${pdf.id}/relatorio_final_[a-z0-9]{10}\\.pdf$`))
      assert.deepEqual(await storage.read(key), bytes)
      const stored = await storage.get(key)
      assert.equal(stored.headers.get('content-type'), 'application/pdf')
      await stored.body.cancel()

      await sleep(5)
      const png = await repos.files.create({
        projectId: project.id,
        itemId: item.id,
        updateId: null,
        uploadedBy: null,
        name: 'print.png',
        mime: 'image/png',
        kind: 'image',
        size: 3,
        handle: { buffer: Buffer.from([1, 2, 3]), mime: 'image/png', name: 'print.png', size: 3 },
      })
      assert.equal(png.updateId, null)
      assert.equal(png.uploadedBy, null)
      assert.deepEqual((await repos.files.listByItem(item.id)).map((f) => f.id), [png.id, pdf.id])
      assert.deepEqual(await repos.files.countByProject(project.id), { [item.id]: 2 })

      await repos.files.delete(pdf.id)
      assert.equal(await repos.files.findById(pdf.id), null)
      assert.ok(await t.db.one('SELECT key FROM storage_trash WHERE key = $1', [key]))
      await assert.rejects(repos.files.fileKeyOf(pdf.id), { code: 'NOT_FOUND' })
      await assert.rejects(
        repos.files.create({ projectId: project.id, itemId: item.id, name: 'vazio.txt', mime: 'text/plain', kind: 'document', size: 0, handle: null }),
        { code: 'VALIDATION_ERROR' },
      )
    })
  })

  describe('Gestão e colunas personalizadas', () => {
    it('diário: dia puro, mais recentes primeiro, edição e exclusão', async () => {
      const project = await seedProject()
      const old = await repos.journal.create({ projectId: project.id, entryDate: '2026-10-01', content: 'Início', authorId: owner.id })
      const recent = await repos.journal.create({ projectId: project.id, entryDate: '2026-10-20', content: 'Meio', authorId: null })
      await sleep(5)
      const sameDay = await repos.journal.create({ projectId: project.id, entryDate: '2026-10-20', content: 'Meio 2', authorId: owner.id })
      assert.deepEqual(old, { id: old.id, projectId: project.id, entryDate: '2026-10-01', content: 'Início', authorId: owner.id, createdAt: old.createdAt, updatedAt: old.updatedAt })
      assert.equal(recent.authorId, null)
      assert.deepEqual((await repos.journal.listByProject(project.id)).map((e) => e.id), [sameDay.id, recent.id, old.id])

      const changed = await repos.journal.update(old.id, { entryDate: '2026-10-25', content: undefined })
      assert.equal(changed.entryDate, '2026-10-25')
      assert.equal(changed.content, 'Início')
      await repos.journal.delete(recent.id)
      assert.deepEqual((await repos.journal.listByProject(project.id)).map((e) => e.id), [old.id, sameDay.id])
    })

    it('problemas: número por projeto, ordem e numeração sem colisão entre transações', async () => {
      const project = await seedProject()
      assert.equal(await repos.issues.maxNumber(project.id), 0)
      const second = await repos.issues.create({ projectId: project.id, number: 2, openedOn: '2026-10-02', description: 'B', state: 'open', ownerId: null, resolvedOn: null, createdBy: owner.id })
      const first = await repos.issues.create({ projectId: project.id, number: 1, openedOn: '2026-10-01', description: 'A', state: 'resolved', ownerId: owner.id, resolvedOn: '2026-10-05', createdBy: null })
      assert.deepEqual(first, {
        id: first.id,
        projectId: project.id,
        number: 1,
        openedOn: '2026-10-01',
        description: 'A',
        state: 'resolved',
        ownerId: owner.id,
        resolvedOn: '2026-10-05',
        createdBy: null,
        createdAt: first.createdAt,
        updatedAt: first.updatedAt,
      })
      assert.equal(second.resolvedOn, null)
      assert.deepEqual((await repos.issues.listByProject(project.id)).map((i) => i.number), [1, 2])
      assert.equal(await repos.issues.maxNumber(project.id), 2)
      const reopened = await repos.issues.update(first.id, { state: 'open', resolvedOn: null, ownerId: null })
      assert.deepEqual([reopened.state, reopened.resolvedOn, reopened.ownerId], ['open', null, null])

      // duas criações ao mesmo tempo: a segunda espera a primeira e lê o número já gravado
      const created = await Promise.all(
        ['X', 'Y'].map((description) =>
          t.db.transaction(async () => {
            const number = (await repos.issues.maxNumber(project.id)) + 1
            await sleep(30)
            return repos.issues.create({ projectId: project.id, number, openedOn: '2026-10-28', description, state: 'open' })
          }),
        ),
      )
      assert.deepEqual(created.map((i) => i.number).sort(), [3, 4])

      await repos.issues.delete(second.id)
      assert.deepEqual((await repos.issues.listByProject(project.id)).map((i) => i.number), [1, 3, 4])
    })

    it('colunas: configurações em JSON, ordem, maior posição, edição e exclusão', async () => {
      const project = await seedProject()
      assert.equal(await repos.columns.maxPosition(project.id), 0)
      const settings = { options: [{ id: 'op1', name: 'Alta', color: 'red' }, { id: 'op2', name: 'Baixa', color: 'green' }] }
      const second = await repos.columns.create({ projectId: project.id, name: 'Prioridade', type: 'dropdown', settings, position: 2048, createdBy: owner.id })
      const first = await repos.columns.create({ projectId: project.id, name: 'Notas', type: 'text', position: 1024, createdBy: null })
      assert.deepEqual(second, {
        id: second.id,
        projectId: project.id,
        name: 'Prioridade',
        type: 'dropdown',
        settings,
        position: 2048,
        createdBy: owner.id,
        createdAt: second.createdAt,
        updatedAt: second.updatedAt,
      })
      assert.deepEqual(first.settings, {})
      assert.equal(first.createdBy, null)
      assert.deepEqual((await repos.columns.listByProject(project.id)).map((c) => c.name), ['Notas', 'Prioridade'])
      assert.equal(await repos.columns.maxPosition(project.id), 2048)

      const renamed = await repos.columns.update(second.id, { name: 'Urgência', settings: { options: [] } })
      assert.deepEqual([renamed.name, renamed.settings, renamed.type, renamed.position], ['Urgência', { options: [] }, 'dropdown', 2048])
      await repos.columns.delete(first.id)
      assert.equal(await repos.columns.findById(first.id), null)
      assert.deepEqual((await repos.columns.listByProject(project.id)).map((c) => c.id), [second.id])
    })
  })
})
