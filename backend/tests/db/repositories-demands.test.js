/**
 * Demandas internas (§45) no Postgres real: a migration 0031 (caixa de sistema, colunas e restrição), o
 * projeto de sistema fora das listas, as colunas da demanda gravadas e lidas, a visibilidade na lista
 * geral, as caixas, os números, a carga da equipe e os relatórios sem demandas.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { createTestDatabase } = require('../support/db-harness')
const { insertRow } = require('../../src/infrastructure/sql')
const { createProjectRepository } = require('../../src/infrastructure/repositories/projects')
const { createTaskRepository } = require('../../src/infrastructure/repositories/tasks')
const { migrate } = require('../../src/infrastructure/migrate')

describe('repositórios — demandas internas (Postgres)', () => {
  let t
  let projects
  let tasks
  let inbox
  let regular
  let type
  let status
  let priority
  const u = {}

  const page = { perPage: 50, offset: 0 }
  const sort = [{ column: 'created', direction: 'ASC' }]

  before(async () => {
    t = await createTestDatabase()
    projects = createProjectRepository(t.db, {})
    tasks = createTaskRepository(t.db, {})
    const role = await t.db.one("SELECT id FROM roles WHERE code = 'MEMBER'")
    for (const name of ['ana', 'cesar', 'jorge', 'carlos', 'fabi']) u[name] = await insertRow(t.db, 'users', { email: `${name}@avanza.test`, name, role_id: role.id, status: 'active' })
    type = await t.db.one('SELECT id FROM task_types ORDER BY "order" LIMIT 1')
    status = await t.db.one(`SELECT id FROM task_statuses WHERE is_default`)
    priority = await t.db.one('SELECT id FROM task_priorities WHERE is_default')
    inbox = await projects.findSystem('demands')
    regular = await projects.create({ name: 'CRM', key: 'CRM', status: 'active', priority: 'medium', ownerId: u.cesar.id, createdBy: u.cesar.id })
    await insertRow(t.db, 'project_members', { project_id: regular.id, user_id: u.cesar.id, role: 'manager' })
  })

  after(async () => {
    if (t) await t.drop()
  })

  async function seed(project, data) {
    return t.db.transaction(async () => {
      const number = await tasks.nextNumber(project.id)
      return tasks.create(
        Object.assign(
          { projectId: project.id, number, code: `${project.key}-${number}`, title: `T${number}`, typeId: type.id, statusId: status.id, priorityId: priority.id, creatorId: u.ana.id, position: number * 1024 },
          data,
        ),
      )
    })
  }

  it('a migration cria a caixa DEM sem dono; projeto comum continua exigindo dono; rodar de novo não duplica', async () => {
    assert.equal(inbox.key, 'DEM')
    assert.equal(inbox.kind, 'demands')
    assert.equal(inbox.ownerId, null)
    await assert.rejects(() => insertRow(t.db, 'projects', { name: 'Sem dono', key: 'NOOWN', owner_id: null }), /chk_projects_owner_or_system/)
    // a migration é idempotente: rodar o arquivo de novo não cria outra caixa
    await t.db.exec('DELETE FROM schema_migrations WHERE name = $1', ['0031_internal_demands.sql'])
    await migrate(t.db)
    assert.equal((await t.db.query(`SELECT id FROM projects WHERE "kind" = 'demands'`)).length, 1)
    // garantir a caixa devolve a mesma
    assert.equal((await projects.ensureSystem('demands', { name: 'Demandas internas', keys: ['DEM', 'DEMINT'] })).id, inbox.id)
  })

  it('a caixa some de toda lista de projetos (lista, botões, visíveis e todos)', async () => {
    const scope = { userId: u.cesar.id, viewAll: true }
    assert.deepEqual((await projects.list({ view: 'all', scope, sort: [], pagination: page })).items.map((p) => p.key), ['CRM'])
    assert.deepEqual((await projects.facets({ view: 'all', scope })).status, { active: 1 })
    assert.deepEqual((await projects.listVisible({ viewAll: true })).map((p) => p.key), ['CRM'])
    assert.deepEqual((await projects.listAll()).map((p) => p.key), ['CRM'])
    assert.deepEqual((await projects.listAll({ ids: [inbox.id, regular.id] })).map((p) => p.key), ['CRM'])
    assert.equal((await projects.findById(inbox.id)).kind, 'demands')
  })

  it('grava e lê os campos da demanda (passo, responsável, quem já esteve, prazo com hora)', async () => {
    const due = new Date('2026-12-01T20:30:00.000Z')
    const created = await seed(inbox, { reporterId: u.ana.id, demandStatus: 'assigned', demandOwnerId: u.cesar.id, assigneeId: u.jorge.id, dueDate: due, estimatedHours: 4.5 })
    assert.equal(created.code, 'DEM-1')
    assert.equal(created.demandStatus, 'assigned')
    assert.equal(created.demandOwnerId, u.cesar.id)
    assert.deepEqual(created.demandPastAssignees, [])
    assert.equal(created.dueDate.toISOString(), '2026-12-01T20:30:00.000Z')
    const updated = await tasks.update(created.id, { assigneeId: u.carlos.id, demandPastAssignees: [u.jorge.id], demandStatus: 'in_progress' })
    assert.deepEqual(updated.demandPastAssignees, [u.jorge.id])
    assert.equal(updated.demandStatus, 'in_progress')
    const project = await seed(regular, { assigneeId: u.cesar.id })
    assert.equal(project.demandStatus, '')
    assert.equal(project.demandOwnerId, null)
    await t.db.exec('DELETE FROM tasks WHERE id = ANY($1::text[])', [[created.id, project.id]])
  })

  it('lista geral: visibilidade da demanda, Com/Sem projeto, "Minhas" e as caixas', async () => {
    const d1 = await seed(inbox, { reporterId: u.ana.id, demandStatus: 'unassigned', demandOwnerId: u.cesar.id })
    const d2 = await seed(inbox, { reporterId: u.ana.id, demandStatus: 'in_progress', demandOwnerId: u.cesar.id, assigneeId: u.carlos.id, demandPastAssignees: [u.jorge.id], estimatedHours: 3 })
    const p1 = await seed(regular, { assigneeId: u.cesar.id })
    const list = async (scope, extra) => (await tasks.list(Object.assign({ scope, sort, pagination: page }, extra))).items.map((x) => x.id)
    const as = (user, mates) => ({ userId: user.id, viewAll: false, areaMates: mates || [] })
    // quem pediu, o responsável (também membro do CRM), quem executa e quem já executou
    assert.deepEqual(await list(as(u.ana)), [d1.id, d2.id])
    assert.deepEqual(await list(as(u.cesar)), [d1.id, d2.id, p1.id])
    assert.deepEqual(await list(as(u.carlos)), [d2.id])
    assert.deepEqual(await list(as(u.jorge)), [d2.id])
    // equipe do responsável: colegas de área de quem consulta incluem o responsável
    assert.deepEqual(await list(as(u.fabi)), [])
    assert.deepEqual(await list(as(u.fabi, [u.fabi.id, u.cesar.id])), [d1.id, d2.id])
    assert.deepEqual(await list(as(u.cesar), { kind: 'project' }), [p1.id])
    assert.deepEqual(await list(as(u.cesar), { kind: 'demand' }), [d1.id, d2.id])
    assert.deepEqual(await list(as(u.ana), { mineId: u.ana.id }), [d1.id, d2.id])
    assert.deepEqual(await list(as(u.cesar), { mineId: u.cesar.id }), [d1.id, d2.id, p1.id])
    assert.deepEqual(await list(as(u.jorge), { mineId: u.jorge.id }), [])
    const all = { userId: u.ana.id, viewAll: true }
    assert.deepEqual(await list(all, { demandBox: { box: 'received', userId: u.cesar.id } }), [d1.id, d2.id])
    assert.deepEqual(await list(all, { demandBox: { box: 'assigned', userId: u.carlos.id } }), [d2.id])
    assert.deepEqual(await list(all, { demandBox: { box: 'requested', userId: u.ana.id }, demandStatuses: ['unassigned'] }), [d1.id])

    assert.deepEqual(await tasks.demandCounts(u.cesar.id), { received: { unassigned: 1, in_progress: 1 }, assigned: {}, requested: {} })
    assert.deepEqual(await tasks.demandCounts(u.ana.id), { received: {}, assigned: {}, requested: { unassigned: 1, in_progress: 1 } })
    assert.deepEqual(await tasks.demandLoad([u.carlos.id, u.jorge.id], ['assigned', 'in_progress']), { [u.carlos.id]: { open: 1, hours: 3 } })
    assert.deepEqual(await tasks.demandAssignees(u.cesar.id, ['assigned', 'in_progress']), [u.carlos.id])

    // relatórios, dependências e painel executivo: só tarefas de projeto
    const report = await tasks.listForReport({ scope: { userId: u.cesar.id, viewAll: true }, includeArchived: true })
    assert.deepEqual(report.map((x) => x.id), [p1.id])

    // tarefa de projeto com responsável: fica no projeto (Com projeto, relatórios) e quem participa do fluxo
    // a vê mesmo sem ser membro; a área do responsável não ganha a tarefa de projeto
    const p2 = await seed(regular, { reporterId: u.cesar.id, demandStatus: 'in_progress', demandOwnerId: u.fabi.id, assigneeId: u.jorge.id, estimatedHours: 2 })
    assert.deepEqual(await list(as(u.fabi)), [p2.id])
    assert.deepEqual(await list(as(u.jorge)), [d2.id, p2.id])
    assert.deepEqual(await list(as(u.carlos, [u.carlos.id, u.fabi.id])), [d2.id])
    assert.deepEqual(await list(as(u.cesar), { kind: 'project' }), [p1.id, p2.id])
    assert.deepEqual(await list(as(u.cesar), { kind: 'demand' }), [d1.id, d2.id])
    assert.deepEqual(await list(all, { demandBox: { box: 'received', userId: u.fabi.id } }), [p2.id])
    assert.deepEqual(await tasks.demandCounts(u.fabi.id), { received: { in_progress: 1 }, assigned: {}, requested: {} })
    assert.deepEqual(await tasks.demandLoad([u.jorge.id], ['assigned', 'in_progress']), { [u.jorge.id]: { open: 1, hours: 2 } })
    const withProject = await tasks.listForReport({ scope: { userId: u.cesar.id, viewAll: true }, includeArchived: true })
    assert.deepEqual(withProject.map((x) => x.id).sort(), [p1.id, p2.id].sort())
  })
})
