/**
 * Backlog e sprints — testes de API contra um PocketBase real.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

describe('API Backlog', { timeout: 180000 }, () => {
  let pb
  let admin
  let mario
  let lia
  let project
  let doc
  let statuses

  before(async () => {
    pb = await startServer()
    await pb.updateSettings({ rateLimits: { enabled: true, rules: RULES } })
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    const make = async (name, email, role) => {
      const created = await admin.post('/users', { name, email, password: 'SenhaTeste123', role_id: roles.find((r) => r.code === role).id })
      const client = createClient(pb.api)
      await client.login(email, 'SenhaTeste123')
      return { client, user: created.body.data }
    }
    mario = await make('Mário', 'mario@example.com', 'MEMBER')
    lia = await make('Lia', 'lia@example.com', 'VIEWER')
    project = (await admin.post('/projects', { name: 'CRM', key: 'CRM' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: mario.user.id, role: 'member' })
    await admin.post(`/projects/${project.id}/members`, { user_id: lia.user.id, role: 'viewer' })
    doc = (await admin.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO')
    statuses = (await admin.get('/statuses')).body.data
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  const st = (key) => statuses.find((s) => s.key === key).id
  const create = (title, extra) => mario.client.post('/tasks', Object.assign({ project_id: project.id, task_type_id: doc.id, title }, extra)).then((r) => r.body.data)
  const backlog = () => mario.client.get(`/projects/${project.id}/backlog`).then((r) => r.body.data)
  const titles = (view) => view.items.map((t) => t.title)

  it('sprints: gestor cria com período; membro não; datas validadas', async () => {
    const created = await admin.post(`/projects/${project.id}/sprints`, { name: 'Sprint 1', goal: 'Checkout', start_date: '2026-10-01', end_date: '2026-10-14' })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.deepEqual([created.body.data.start_date, created.body.data.end_date, created.body.data.state], ['2026-10-01', '2026-10-14', 'planned'])
    assert.equal((await mario.client.post(`/projects/${project.id}/sprints`, { name: 'X' })).status, 403)
    const bad = await admin.post(`/projects/${project.id}/sprints`, { name: 'X', start_date: '2026-10-10', end_date: '2026-10-01' })
    assert.equal(bad.body.error.code, 'VALIDATION_ERROR')
    assert.equal(bad.body.error.details.fields.end_date, 'end_before_start')
    const list = await lia.client.get(`/projects/${project.id}/sprints`)
    assert.deepEqual(list.body.data.map((c) => c.name), ['Sprint 1'])
  })

  it('planejamento: tudo que não está encerrado, ordem manual, priorizar e planejar na sprint', async () => {
    const sprint = (await mario.client.get(`/projects/${project.id}/sprints`)).body.data[0]
    const a = await create('A')
    await create('B', { estimated_hours: 2 })
    const c = await create('C')
    await create('Ativa', { status_id: st('DESENVOLVIMENTO') })
    await create('Cancelada', { status_id: st('CANCELADO') })

    let view = await backlog()
    assert.deepEqual(titles(view), ['A', 'Ativa', 'B', 'C'])
    assert.deepEqual(view.capabilities, { rank: true, create: true, manage_sprints: false })
    // todos os status, menos os encerrados (categorias concluída e cancelada)
    assert.deepEqual(view.statuses.map((s) => s.key), ['BACKLOG', 'TRIAGEM', 'ANALISE', 'PRIORIZADO', 'DESENVOLVIMENTO', 'HOMOLOGACAO', 'PRODUCAO'])

    const ranked = await mario.client.post(`/tasks/${c.id}/rank`, { next_id: a.id, sprint_id: sprint.id })
    assert.equal(ranked.status, 200, JSON.stringify(ranked.body))
    assert.equal(ranked.body.data.sprint.name, 'Sprint 1')
    view = await backlog()
    assert.deepEqual(titles(view), ['C', 'A', 'Ativa', 'B'])

    const planned = await mario.client.get(`/tasks?project_id=${project.id}&sprint_id=${sprint.id}`)
    assert.deepEqual(planned.body.data.map((t) => t.title), ['C'])
    const history = (await mario.client.get(`/tasks/${c.id}/history`)).body.data
    assert.ok(history.some((h) => h.new_value && h.new_value.sprint === 'Sprint 1'))

    assert.equal((await lia.client.post(`/tasks/${a.id}/rank`, { prev_id: c.id })).status, 403)
    // analisada continua na lista e pode ser priorizada
    await mario.client.post(`/tasks/${a.id}/move`, { status_id: st('ANALISE') })
    assert.equal((await mario.client.post(`/tasks/${a.id}/rank`, { next_id: c.id })).status, 200)
    assert.ok(titles(await backlog()).includes('A'))
    // em andamento continua; cancelada sai da lista
    await mario.client.post(`/tasks/${a.id}/move`, { status_id: st('DESENVOLVIMENTO') })
    assert.ok(titles(await backlog()).includes('A'))
    await mario.client.post(`/tasks/${a.id}/move`, { status_id: st('CANCELADO') })
    const outside = await mario.client.post(`/tasks/${a.id}/rank`, {})
    assert.equal(outside.status, 409)
    assert.equal(outside.body.error.code, 'NOT_IN_BACKLOG')
  })

  it('encerrar a sprint devolve ao backlog; excluir tira a sprint', async () => {
    const sprint = (await mario.client.get(`/projects/${project.id}/sprints`)).body.data[0]
    const closed = await admin.patch(`/sprints/${sprint.id}`, { state: 'closed' })
    assert.equal(closed.status, 200, JSON.stringify(closed.body))
    assert.equal(closed.body.data.returned_count, 1)
    assert.ok((await backlog()).items.every((t) => t.sprint === null))
    assert.equal((await mario.client.get(`/projects/${project.id}/sprints`)).body.data.length, 0)

    const next = (await admin.post(`/projects/${project.id}/sprints`, { name: 'Sprint 2' })).body.data
    const item = (await backlog()).items[0]
    await mario.client.patch(`/tasks/${item.id}`, { sprint_id: next.id })
    assert.equal((await admin.del(`/sprints/${next.id}`)).status, 200)
    assert.equal((await mario.client.get(`/tasks/${item.id}`)).body.data.sprint, null)
    assert.equal((await admin.patch(`/sprints/${next.id}`, { name: 'Z' })).body.error.code, 'SPRINT_NOT_FOUND')
  })

  it('ordem manual das sprints: gestor reordena, membro não', async () => {
    const x = (await admin.post(`/projects/${project.id}/sprints`, { name: 'X' })).body.data
    const y = (await admin.post(`/projects/${project.id}/sprints`, { name: 'Y' })).body.data
    const names = async () => (await mario.client.get(`/projects/${project.id}/sprints`)).body.data.map((c) => c.name)
    assert.deepEqual(await names(), ['X', 'Y'])
    const reordered = await admin.put(`/projects/${project.id}/sprints/order`, { ids: [y.id, x.id] })
    assert.equal(reordered.status, 200, JSON.stringify(reordered.body))
    assert.deepEqual(await names(), ['Y', 'X'])
    assert.equal((await mario.client.put(`/projects/${project.id}/sprints/order`, { ids: [x.id, y.id] })).status, 403)
    assert.equal((await admin.put(`/projects/${project.id}/sprints/order`, { ids: [x.id] })).body.error.code, 'VALIDATION_ERROR')
  })
})
