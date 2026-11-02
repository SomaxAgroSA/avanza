const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createTestDatabase } = require('../support/db-harness')
const { insertRow } = require('../../src/infrastructure/sql')
const { createCharterRepository, createCharterItemRepository, createCharterMeasurementRepository } = require('../../src/infrastructure/repositories/charter')

describe('repositórios da Ficha do projeto (Postgres)', () => {
  let t
  let charters
  let items
  let measurements
  let owner
  let member

  before(async () => {
    t = await createTestDatabase()
    charters = createCharterRepository(t.db, {})
    items = createCharterItemRepository(t.db, {})
    measurements = createCharterMeasurementRepository(t.db, {})
    const role = await t.db.one("SELECT id FROM roles WHERE code = 'ADMIN'")
    owner = await insertRow(t.db, 'users', { email: 'dono@avanza.test', name: 'Dono', role_id: role.id, status: 'active' })
    member = await insertRow(t.db, 'users', { email: 'membro@avanza.test', name: 'Membro', role_id: role.id, status: 'active' })
  })
  after(() => t.drop())

  async function seedProject() {
    const key = `P${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    return insertRow(t.db, 'projects', { name: key, key, owner_id: owner.id })
  }

  it('ficha: uma por projeto (upsert, inclusive em paralelo); quem mudou por último', async () => {
    const project = await seedProject()
    assert.equal(await charters.findByProject(project.id), null)
    const first = await charters.upsert(project.id, { objective: 'Centralizar', updatedBy: owner.id })
    assert.deepEqual([first.projectId, first.objective, first.updatedBy], [project.id, 'Centralizar', owner.id])
    await t.db.exec('SELECT pg_sleep(0.01)')
    const second = await charters.upsert(project.id, { objective: 'Digitalizar', updatedBy: member.id })
    assert.equal(second.id, first.id)
    assert.deepEqual([second.objective, second.updatedBy], ['Digitalizar', member.id])
    assert.ok(second.updatedAt > first.updatedAt)
    await Promise.all([1, 2, 3].map((n) => t.db.transaction(() => charters.upsert(project.id, { objective: `v${n}`, updatedBy: owner.id }))))
    assert.equal((await t.db.one('SELECT count(*) AS total FROM project_charters WHERE project_id = $1', [project.id])).total, 1)
  })

  it('itens: gravam e leem com as convenções (vazios, dias puros, listas de ids, valor atual nulo)', async () => {
    const project = await seedProject()
    const result = await items.create({
      projectId: project.id,
      kind: 'result',
      title: 'Usuários ativos',
      description: '',
      state: '',
      position: 1,
      ownerId: member.id,
      unit: 'pessoas',
      baseline: 10,
      target: 120.5,
      startDate: '2026-10-01',
      dueDate: '2026-12-31',
      frequency: 'monthly',
      createdBy: owner.id,
    })
    assert.deepEqual(
      [result.kind, result.unit, result.baseline, result.target, result.current, result.startDate, result.dueDate, result.measuredAt, result.taskIds, result.linkIds],
      ['result', 'pessoas', 10, 120.5, null, '2026-10-01', '2026-12-31', null, [], []],
    )
    assert.deepEqual(await items.findById(result.id), result)
    const raw = await t.db.one('SELECT due_date, "current", owner_id FROM charter_items WHERE id = $1', [result.id])
    assert.deepEqual(raw, { due_date: new Date('2026-12-31T00:00:00.000Z'), current: null, owner_id: member.id })

    const measured = await items.update(result.id, { current: 46, measuredAt: '2026-10-15', ownerId: null, dueDate: null })
    assert.deepEqual([measured.current, measured.measuredAt, measured.ownerId, measured.dueDate], [46, '2026-10-15', null, null])

    const feature = await items.create({ projectId: project.id, kind: 'feature', title: 'Reclamos', state: 'auto', position: 1, taskIds: ['t1', 't2'] })
    const objective = await items.create({ projectId: project.id, kind: 'objective', title: 'Digitalizar', state: 'auto', position: 1, linkIds: [feature.id] })
    assert.deepEqual(feature.taskIds, ['t1', 't2'])
    assert.deepEqual((await items.update(objective.id, { linkIds: [feature.id, result.id] })).linkIds, [feature.id, result.id])
    await assert.rejects(items.update('naoexiste123456', { title: 'x' }), (err) => err.code === 'CHARTER_ITEM_NOT_FOUND')
    assert.equal(await items.findById('naoexiste123456'), null)
  })

  it('itens: pela posição, empate pela criação; excluir leva as medições; apagar o projeto leva tudo', async () => {
    const project = await seedProject()
    const b = await items.create({ projectId: project.id, kind: 'scope_in', title: 'B', position: 2 })
    const a = await items.create({ projectId: project.id, kind: 'scope_in', title: 'A', position: 1 })
    const c = await items.create({ projectId: project.id, kind: 'scope_out', title: 'C', position: 1 })
    // mesma posição: desempata pela criação (datas fixas, sem depender do relógio)
    await t.db.exec('UPDATE charter_items SET created = $2 WHERE id = $1', [a.id, new Date('2026-10-01T00:00:00Z')])
    await t.db.exec('UPDATE charter_items SET created = $2 WHERE id = $1', [c.id, new Date('2026-10-02T00:00:00Z')])
    assert.deepEqual((await items.listByProject(project.id)).map((i) => i.title), ['A', 'C', 'B'])

    const result = await items.create({ projectId: project.id, kind: 'result', title: 'R', target: 10, position: 1 })
    await measurements.create({ projectId: project.id, itemId: result.id, value: 1, note: '', measuredAt: '2026-10-01', createdBy: owner.id })
    await items.delete(result.id)
    assert.equal((await t.db.one('SELECT count(*) AS total FROM charter_measurements WHERE project_id = $1', [project.id])).total, 0)

    await charters.upsert(project.id, { objective: 'x', updatedBy: owner.id })
    await t.db.exec('DELETE FROM projects WHERE id = $1', [project.id])
    assert.deepEqual(await items.listByProject(project.id), [])
    assert.equal(await charters.findByProject(project.id), null)
    for (const item of [a, b, c]) assert.equal(await items.findById(item.id), null)
  })

  it('medições: mais recente primeiro (data da medição, empate pela gravação) e limite', async () => {
    const project = await seedProject()
    const result = await items.create({ projectId: project.id, kind: 'result', title: 'R', target: 10, position: 1 })
    const add = (value, measuredAt) => measurements.create({ projectId: project.id, itemId: result.id, value, note: `n${value}`, measuredAt, createdBy: member.id })
    const m1 = await add(1, '2026-10-05')
    await add(2, '2026-10-01')
    const m3 = await add(3, '2026-10-05')
    // mesma data de medição: desempata pela gravação (datas fixas, sem depender do relógio)
    await t.db.exec('UPDATE charter_measurements SET created = $2 WHERE id = $1', [m1.id, new Date('2026-10-05T10:00:00Z')])
    await t.db.exec('UPDATE charter_measurements SET created = $2 WHERE id = $1', [m3.id, new Date('2026-10-05T11:00:00Z')])
    assert.deepEqual([m1.itemId, m1.measuredAt, m1.note, m1.createdBy], [result.id, '2026-10-05', 'n1', member.id])
    assert.deepEqual((await measurements.listByItem(result.id)).map((m) => m.value), [3, 1, 2])
    assert.deepEqual((await measurements.listByItem(result.id, 2)).map((m) => m.value), [3, 1])
  })
})
