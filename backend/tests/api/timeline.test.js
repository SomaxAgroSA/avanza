/**
 * Timeline e marcos (expansão, Onda 1) — testes de API contra um PocketBase real.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

describe('API Timeline', { timeout: 180000 }, () => {
  let pb
  let admin
  let mario
  let lia
  let otto
  let project
  let doc

  before(async () => {
    pb = await startServer()
    await pb.updateSettings({ rateLimits: { enabled: true, rules: RULES } })
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    const make = async (name, email, role) => {
      const created = (await admin.post('/users', { name, email, password: 'SenhaTeste123', role_id: roles.find((r) => r.code === role).id })).body.data
      const client = createClient(pb.api)
      await client.login(email, 'SenhaTeste123')
      return { client, user: created }
    }
    const m = await make('Mário', 'mario@example.com', 'MEMBER')
    const l = await make('Lia', 'lia@example.com', 'VIEWER')
    const o = await make('Otto', 'otto@example.com', 'MEMBER')
    mario = m.client
    lia = l.client
    otto = o.client
    project = (await admin.post('/projects', { name: 'Implantação', key: 'IMP', start_date: '2026-10-01', due_date: '2026-12-15' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: m.user.id, role: 'member' })
    await admin.post(`/projects/${project.id}/members`, { user_id: l.user.id, role: 'viewer' })
    doc = (await admin.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO')
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  const create = (title, extra) => mario.post('/tasks', Object.assign({ project_id: project.id, task_type_id: doc.id, title }, extra)).then((r) => r.body.data)

  it('tarefas com início planejado, setas com conflito, marcos e capacidades', async () => {
    const a = await create('Levantamento', { start_date: '2026-10-01', due_date: '2026-10-05' })
    const b = await create('Desenho', { start_date: '2026-10-03', due_date: '2026-10-09' })
    assert.equal(a.start_date.slice(0, 10), '2026-10-01')
    await mario.post(`/tasks/${a.id}/relations`, { type: 'blocks', target_id: b.id })
    const milestone = await admin.post(`/projects/${project.id}/milestones`, { name: 'Go-live', due_date: '2026-11-30' })
    assert.equal(milestone.status, 201, JSON.stringify(milestone.body))

    const res = await mario.get(`/projects/${project.id}/timeline`)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const t = res.body.data
    assert.deepEqual(t.tasks.map((x) => x.title), ['Levantamento', 'Desenho'])
    assert.deepEqual(t.dependencies.map((e) => [e.from, e.to, e.conflict]), [[a.id, b.id, true]])
    assert.deepEqual(t.milestones.map((x) => [x.name, x.due_date, x.state]), [['Go-live', '2026-11-30', 'pending']])
    assert.deepEqual(t.capabilities, { edit: true, manage_milestones: false })
    assert.equal(t.truncated, false)

    // mover a tarefa desfaz o conflito
    const moved = await mario.patch(`/tasks/${b.id}`, { start_date: '2026-10-06', due_date: '2026-10-12' })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.equal((await mario.get(`/projects/${project.id}/timeline`)).body.data.dependencies[0].conflict, false)
    // início depois do prazo é recusado
    assert.equal((await mario.patch(`/tasks/${b.id}`, { start_date: '2026-10-20' })).body.error.details.fields.start_date, 'after_due_date')
  })

  it('marcos: gestor gerencia; leitor e membro só veem; quem não é do projeto não enxerga', async () => {
    const created = (await admin.post(`/projects/${project.id}/milestones`, { name: 'Homologação', due_date: '2026-11-10' })).body.data
    assert.equal((await lia.get(`/projects/${project.id}/milestones`)).status, 200)
    assert.equal((await lia.post(`/projects/${project.id}/milestones`, { name: 'X', due_date: '2026-11-10' })).status, 403)
    assert.equal((await mario.patch(`/milestones/${created.id}`, { name: 'Y' })).status, 403)
    assert.equal((await otto.get(`/projects/${project.id}/timeline`)).status, 404)
    assert.equal((await otto.del(`/milestones/${created.id}`)).status, 404)
    const done = await admin.patch(`/milestones/${created.id}`, { state: 'done' })
    assert.equal(done.body.data.state, 'done')
    assert.equal((await admin.post(`/projects/${project.id}/milestones`, { name: 'Sem data' })).body.error.details.fields.due_date, 'required')
    assert.equal((await admin.del(`/milestones/${created.id}`)).status, 200)
    const history = (await admin.get(`/projects/${project.id}/history`)).body.data
    assert.ok(history.some((h) => h.action === 'milestone.deleted'))
  })
})
