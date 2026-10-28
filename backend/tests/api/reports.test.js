/**
 * Relatórios — testes de API contra um PocketBase real (a consulta enxuta roda em SQL de verdade).
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

describe('API Relatórios', { timeout: 180000 }, () => {
  let pb
  let admin
  let mario
  let project
  let archived
  let types
  let statuses
  let priorities

  before(async () => {
    pb = await startServer()
    await pb.updateSettings({ rateLimits: { enabled: true, rules: RULES } })
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    const created = await admin.post('/users', { name: 'Mário', email: 'mario@example.com', password: 'SenhaTeste123', role_id: roles.find((r) => r.code === 'MEMBER').id })
    mario = createClient(pb.api)
    await mario.login('mario@example.com', 'SenhaTeste123')
    project = (await admin.post('/projects', { name: 'CRM', key: 'CRM' })).body.data
    archived = (await admin.post('/projects', { name: 'Antigo', key: 'OLD' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: created.body.data.id, role: 'member' })
    await admin.post(`/projects/${archived.id}/members`, { user_id: created.body.data.id, role: 'member' })
    types = (await admin.get('/task-types')).body.data
    statuses = (await admin.get('/statuses')).body.data
    priorities = (await admin.get('/priorities')).body.data
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  const id = (list, key) => list.find((x) => x.key === key).id

  it('indicadores reais, período explícito e definições; arquivado fica de fora', async () => {
    const doc = id(types, 'DOCUMENTACAO')
    const bug = id(types, 'BUG')
    const make = (projectId, extra) => admin.post('/tasks', Object.assign({ project_id: projectId, task_type_id: doc, title: 'T' }, extra))
    await make(project.id, { status_id: id(statuses, 'DESENVOLVIMENTO') })
    await make(project.id, { status_id: id(statuses, 'CONCLUIDO') })
    await make(project.id, { due_date: '2020-01-01' })
    // bug crítico precisa dos campos obrigatórios do tipo: usa a criação com valores padrão da API
    const detail = (await admin.get(`/task-types/${bug}`)).body.data
    const values = {}
    detail.fields.filter((f) => f.required).forEach((f) => {
      values[f.field.name] = f.field.type === 'select' ? f.field.options[0].id : 'x'
    })
    const critical = await make(project.id, { task_type_id: bug, priority_id: id(priorities, 'CRITICA'), custom_values: values })
    assert.equal(critical.status, 201, JSON.stringify(critical.body))
    await make(archived.id)
    await admin.post(`/projects/${archived.id}/archive`)

    const res = await mario.get('/reports?tz_offset=180&group_by=status')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const r = res.body.data
    assert.ok(r.period.from && r.period.to)
    assert.deepEqual(r.definitions.critical_priority.name, 'Crítica')
    assert.equal(r.indicators.total, 4)
    assert.equal(r.indicators.in_progress, 1)
    assert.equal(r.indicators.completed, 1)
    assert.equal(r.indicators.overdue, 1)
    assert.equal(r.indicators.critical_bugs, 1)
    assert.equal(r.overdue_tasks.length, 1)
    assert.ok(r.breakdown.rows.every((g) => g.label && g.label.name))
    assert.equal(r.series.bucket, 'day')

    // projeto arquivado escolhido explicitamente
    assert.equal((await mario.get(`/reports?project_id=${archived.id}`)).body.data.indicators.total, 1)
    assert.equal((await mario.get('/reports?group_by=cor')).status, 400)
  })

  it('detalhamento de indicador: mesmas tarefas do número, paginado, com as permissões do relatório', async () => {
    const r = (await mario.get('/reports?tz_offset=180')).body.data
    for (const metric of ['open', 'in_progress', 'overdue', 'critical_bugs', 'completed', 'lead_time']) {
      const res = await mario.get(`/reports/tasks?tz_offset=180&metric=${metric}`)
      assert.equal(res.status, 200, JSON.stringify(res.body))
      const expected = typeof r.indicators[metric] === 'number' ? r.indicators[metric] : r.indicators[metric].count
      assert.equal(res.body.meta.total, expected, metric)
      assert.equal(res.body.data.length, expected, metric)
    }
    const overdue = (await mario.get('/reports/tasks?tz_offset=180&metric=overdue')).body.data
    assert.deepEqual(overdue.map((t) => t.code), r.overdue_tasks.map((t) => t.code))
    const lead = (await mario.get('/reports/tasks?metric=lead_time')).body.data
    assert.ok(lead.every((t) => typeof t.metric_hours === 'number'))
    const page = (await mario.get('/reports/tasks?metric=open&perPage=1&page=2')).body
    assert.deepEqual([page.data.length, page.meta.page, page.meta.total], [1, 2, r.indicators.open])
    assert.equal((await mario.get('/reports/tasks?metric=tudo')).body.error.code, 'VALIDATION_ERROR')
    assert.equal((await mario.get('/reports/tasks')).status, 400)
  })
})
