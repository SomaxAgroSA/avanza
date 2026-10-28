/**
 * Tarefas — testes de API contra um PocketBase real (migrations + seed da Fase 3/4).
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

/** Valor válido de exemplo para cada tipo de campo obrigatório. */
function sampleValue(field) {
  if (field.type === 'select') return field.options[0].id
  if (field.type === 'multiselect') return [field.options[0].id]
  if (field.type === 'number' || field.type === 'decimal') return 1
  if (field.type === 'boolean') return true
  if (field.type === 'date') return '2026-10-01'
  if (field.type === 'url') return 'https://example.com'
  return 'valor'
}

describe('API /api/v1/tasks', { timeout: 180000 }, () => {
  let pb
  let admin
  let member
  let viewer
  let outsider
  let project
  let bug
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
    const m = await make('Mário', 'mario@example.com', 'MEMBER')
    const v = await make('Lia', 'lia@example.com', 'MEMBER')
    const o = await make('Otto', 'otto@example.com', 'MEMBER')
    member = m
    viewer = v
    outsider = o

    project = (await admin.post('/projects', { name: 'CRM Corporativo', key: 'CRM' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: m.user.id, role: 'member' })
    await admin.post(`/projects/${project.id}/members`, { user_id: v.user.id, role: 'viewer' })

    const types = (await admin.get('/task-types')).body.data
    bug = (await admin.get(`/task-types/${types.find((t) => t.key === 'BUG').id}`)).body.data
    doc = types.find((t) => t.key === 'DOCUMENTACAO')
    statuses = (await admin.get('/statuses')).body.data
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  function bugValues(overrides) {
    const values = {}
    bug.fields.filter((f) => f.required).forEach((f) => {
      values[f.field.name] = sampleValue(f.field)
    })
    return Object.assign(values, overrides)
  }

  it('cria tarefas numeradas por projeto, com padrões e campos do tipo', async () => {
    const missing = await member.client.post('/tasks', { project_id: project.id, task_type_id: bug.id, title: 'Erro ao salvar' })
    assert.equal(missing.status, 400)
    assert.ok(Object.keys(missing.body.error.details.fields).every((k) => k.startsWith('custom_values.')))

    const first = await member.client.post('/tasks', {
      project_id: project.id,
      task_type_id: bug.id,
      title: 'Erro ao salvar pedido',
      assignee_id: member.user.id,
      due_date: '2026-10-15',
      estimated_hours: 3.5,
      custom_values: bugValues({ versao: '2.1.0' }),
    })
    assert.equal(first.status, 201, JSON.stringify(first.body))
    const task = first.body.data
    assert.equal(task.code, 'CRM-1')
    assert.equal(task.status.key, 'BACKLOG')
    assert.equal(task.priority.key, 'MEDIA')
    assert.equal(task.assignee.name, 'Mário')
    assert.equal(task.due_date.slice(0, 10), '2026-10-15')
    assert.equal(task.estimated_hours, 3.5)
    assert.equal(task.custom_values.versao, '2.1.0')
    assert.deepEqual(task.capabilities, { edit: true, delete: false, assign: true, link: true, fork: true, comment: true })

    const second = await member.client.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: 'Manual do usuário' })
    assert.equal(second.body.data.code, 'CRM-2')
  })

  it('lista com escopo, busca (inclusive em campos pesquisáveis), filtros e ordenação', async () => {
    const all = await member.client.get('/tasks?sort=-code')
    assert.equal(all.status, 200, JSON.stringify(all.body))
    assert.deepEqual(all.body.data.map((t) => t.code), ['CRM-2', 'CRM-1'])
    assert.equal(all.body.meta.total, 2)
    assert.deepEqual((await member.client.get('/tasks?search=2.1.0')).body.data.map((t) => t.code), ['CRM-1'])
    assert.deepEqual((await member.client.get('/tasks?search=crm-2')).body.data.map((t) => t.code), ['CRM-2'])
    assert.deepEqual((await member.client.get('/tasks?assignee_id=me')).body.data.map((t) => t.code), ['CRM-1'])
    assert.deepEqual((await member.client.get('/tasks?search=100%25')).body.data, [])
    assert.equal((await outsider.client.get('/tasks')).body.meta.total, 0)
    assert.deepEqual((await admin.get('/tasks?sort=due_date')).body.data.map((t) => t.code), ['CRM-1', 'CRM-2'])
  })

  it('edita status, registra conclusão e histórico legível', async () => {
    const task = (await member.client.get('/tasks?search=CRM-1')).body.data[0]
    const done = statuses.find((s) => s.key === 'CONCLUIDO')
    const updated = await member.client.patch(`/tasks/${task.id}`, { status_id: done.id, estimated_hours: null })
    assert.equal(updated.status, 200, JSON.stringify(updated.body))
    assert.ok(updated.body.data.completed_at)
    assert.equal(updated.body.data.estimated_hours, null)

    const history = (await viewer.client.get(`/tasks/${task.id}/history`)).body.data
    assert.equal(history[0].action, 'task.updated')
    assert.deepEqual(history[0].old_value, { task_status: 'Backlog', estimated_hours: 3.5 })
    assert.deepEqual(history[0].new_value, { task_status: 'Concluído', estimated_hours: null })
    assert.equal(history[1].action, 'task.created')
    assert.deepEqual((await member.client.get('/tasks?category=done')).body.data.map((t) => t.code), ['CRM-1'])
  })

  it('protege acesso: leitor não edita, estranho não vê, CSRF exigido, exclusão por gestor', async () => {
    const task = (await member.client.get('/tasks?search=CRM-2')).body.data[0]
    assert.equal((await viewer.client.patch(`/tasks/${task.id}`, { title: 'x' })).status, 403)
    assert.equal((await viewer.client.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: 'x' })).status, 403)
    assert.equal((await outsider.client.get(`/tasks/${task.id}`)).body.error.code, 'TASK_NOT_FOUND')
    assert.equal((await outsider.client.get(`/tasks/${task.id}/history`)).body.error.code, 'TASK_NOT_FOUND')
    assert.equal((await member.client.patch(`/tasks/${task.id}`, { title: 'x' }, { csrf: false })).status, 403)
    assert.equal((await member.client.del(`/tasks/${task.id}`)).status, 403)

    const removed = await admin.del(`/tasks/${task.id}`)
    assert.equal(removed.status, 200, JSON.stringify(removed.body))
    assert.equal((await admin.get(`/tasks/${task.id}`)).status, 404)
    // o status em uso não pode ser excluído
    const done = statuses.find((s) => s.key === 'CONCLUIDO')
    assert.equal((await admin.del(`/statuses/${done.id}`)).body.error.code, 'STATUS_IN_USE')
  })
})
