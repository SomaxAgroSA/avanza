/**
 * Ficha do projeto (regras de negócio §21) — testes de API contra um PocketBase real.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startPocketBase, createClient } = require('../support/pb-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

describe('API Ficha do projeto', { timeout: 180000 }, () => {
  let pb
  let admin
  let mario
  let marioUser
  let lia
  let otto
  let project
  let doc
  let statuses

  before(async () => {
    pb = await startPocketBase()
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
    marioUser = m.user
    lia = l.client
    otto = o.client
    project = (await admin.post('/projects', { name: 'Portal CRM', key: 'CRM' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: m.user.id, role: 'member' })
    await admin.post(`/projects/${project.id}/members`, { user_id: l.user.id, role: 'viewer' })
    doc = (await admin.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO')
    statuses = (await admin.get('/statuses')).body.data
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('monta a ficha: objetivo, funcionalidade com tarefas, escopo e resultado com medições', async () => {
    const empty = await lia.get(`/projects/${project.id}/charter`)
    assert.equal(empty.status, 200, JSON.stringify(empty.body))
    assert.deepEqual([empty.body.data.completeness.percent, empty.body.data.capabilities.edit], [0, false])

    const saved = await admin.put(`/projects/${project.id}/charter`, { objective: 'Centralizar a gestão comercial' })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    assert.equal(saved.body.data.objective, 'Centralizar a gestão comercial')

    const task = (await mario.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: 'Tela de reclamos' })).body.data
    const feature = await admin.post(`/projects/${project.id}/charter/items`, { kind: 'feature', title: 'Reclamos', task_ids: [task.id], owner_id: marioUser.id })
    assert.equal(feature.status, 201, JSON.stringify(feature.body))
    assert.deepEqual([feature.body.data.effective_state, feature.body.data.progress], ['planned', { done: 0, total: 1 }])

    await admin.post(`/projects/${project.id}/charter/items`, { kind: 'scope_in', title: 'Portal web' })
    await admin.post(`/projects/${project.id}/charter/items`, { kind: 'scope_out', title: 'App móvel' })
    const result = (
      await admin.post(`/projects/${project.id}/charter/items`, { kind: 'result', title: 'Usuários ativos', target: 120, unit: 'pessoas', due_date: '2099-12-31', owner_id: marioUser.id, frequency: 'monthly' })
    ).body.data
    assert.deepEqual([result.current, result.situation, result.frequency], [null, 'no_data', 'monthly'])

    const done = statuses.find((s) => s.key === 'CONCLUIDO')
    assert.equal((await mario.patch(`/tasks/${task.id}`, { status_id: done.id })).status, 200)

    // o responsável registra a medição; o leitor não
    assert.equal((await lia.post(`/charter-items/${result.id}/measurements`, { value: 10 })).status, 403)
    const measured = await mario.post(`/charter-items/${result.id}/measurements`, { value: 46, note: 'Relatório do CRM' })
    assert.equal(measured.status, 201, JSON.stringify(measured.body))
    assert.equal(measured.body.data.current, 46)
    const series = (await lia.get(`/charter-items/${result.id}/measurements`)).body.data
    assert.deepEqual(series.map((x) => [x.value, x.note, x.created_by.name]), [[46, 'Relatório do CRM', 'Mário']])

    const charter = (await lia.get(`/projects/${project.id}/charter`)).body.data
    const f = charter.items.find((i) => i.kind === 'feature')
    assert.deepEqual([f.effective_state, f.progress, f.tasks.map((t) => t.title), f.owner.name], ['delivered', { done: 1, total: 1 }, ['Tela de reclamos'], 'Mário'])
    assert.deepEqual(charter.completeness, { sections: { objectives: true, features: true, scope: true, results: true }, done: 4, total: 4, percent: 100 })
    assert.deepEqual([charter.summary.features_delivered, charter.summary.results_total], [1, 1])

    // histórico do projeto
    const history = (await admin.get(`/projects/${project.id}/history`)).body.data.map((h) => h.action)
    ;['charter.updated', 'charter_item.created', 'charter_item.measured'].forEach((action) => assert.ok(history.includes(action), action))
  })

  it('edita, reordena e exclui; permissões, validação e proteção CSRF', async () => {
    const a = (await admin.post(`/projects/${project.id}/charter/items`, { kind: 'objective', title: 'Digitalizar' })).body.data
    const b = (await admin.post(`/projects/${project.id}/charter/items`, { kind: 'objective', title: 'Dar trazabilidade' })).body.data
    const edited = await admin.patch(`/charter-items/${a.id}`, { state: 'achieved', description: 'Campo demonstrativo' })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    assert.equal(edited.body.data.effective_state, 'achieved')
    const order = await admin.put(`/projects/${project.id}/charter/order`, { kind: 'objective', ids: [b.id, a.id] })
    assert.deepEqual(order.body.data.items.filter((i) => i.kind === 'objective').map((i) => i.title), ['Dar trazabilidade', 'Digitalizar'])

    assert.equal((await mario.patch(`/charter-items/${a.id}`, { title: 'x' })).status, 403)
    assert.equal((await otto.get(`/projects/${project.id}/charter`)).status, 404)
    assert.equal((await otto.patch(`/charter-items/${a.id}`, { title: 'x' })).body.error.code, 'CHARTER_ITEM_NOT_FOUND')
    const invalid = await admin.post(`/projects/${project.id}/charter/items`, { kind: 'result', title: 'Sem meta' })
    assert.equal(invalid.body.error.details.fields.target, 'required')
    const csrf = await admin.del(`/charter-items/${a.id}`, { csrf: false })
    assert.equal(csrf.status, 403)

    assert.equal((await admin.del(`/charter-items/${a.id}`)).status, 200)
    assert.equal((await admin.patch(`/charter-items/${a.id}`, { title: 'x' })).status, 404)
  })
})
