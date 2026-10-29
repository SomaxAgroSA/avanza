/**
 * Painel executivo (GET /api/v1/executive) contra a API real e isolada: permissão própria, todos os
 * projetos (mesmo sem ser membro), saúde da Gestão, Kanban, realizações (arquivados só aqui), filtro
 * por projeto e período, e a data de conclusão dos elementos gravada pelo banco.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const PASSWORD = 'SenhaTeste123'

describe('API painel executivo', { timeout: 180000 }, () => {
  let pb
  let admin
  let gestor
  let crm
  let erp
  let old

  before(async () => {
    pb = await startServer()
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    await admin.post('/users', { name: 'Gil', email: 'gil@example.com', password: PASSWORD, role_id: roles.find((r) => r.code === 'MANAGER').id })
    gestor = createClient(pb.api)
    await gestor.login('gil@example.com', PASSWORD)

    // projetos do gestor (o admin não é membro de nenhum)
    crm = (await gestor.post('/projects', { name: 'CRM', key: 'CRM', due_date: '2026-12-15' })).body.data
    erp = (await gestor.post('/projects', { name: 'ERP', key: 'ERP' })).body.data
    old = (await gestor.post('/projects', { name: 'Legado', key: 'OLD' })).body.data

    // Gestão do CRM: um elemento concluído e um atrasado → saúde com cronograma atrasado
    const board = (await gestor.get(`/projects/${crm.id}/plan`)).body.data
    const feito = board.statuses.find((s) => s.category === 'done')
    const group = (await gestor.post(`/projects/${crm.id}/groups`, { name: 'Fase 1' })).body.data
    await gestor.post(`/projects/${crm.id}/plan/items`, { group_id: group.id, name: 'Levantamento', status_id: feito.id, start_date: '2026-01-05', end_date: '2026-01-10' })
    await gestor.post(`/projects/${crm.id}/plan/items`, { group_id: group.id, name: 'Integração', start_date: '2026-01-12', end_date: '2026-02-01' })
    await gestor.post(`/projects/${crm.id}/plan/issues`, { opened_on: '2026-10-01', description: 'Fornecedor atrasou' })
    await gestor.post(`/projects/${crm.id}/milestones`, { name: 'Homologação', due_date: '2026-03-01', state: 'done' })

    // Kanban: tarefas concluídas no ERP e no projeto que será arquivado
    const type = (await admin.post('/task-types', { key: 'EXEC', name: 'Tarefa' })).body.data
    const statuses = (await admin.get('/statuses')).body.data
    const done = statuses.find((s) => s.category === 'done')
    await gestor.post('/tasks', { project_id: erp.id, task_type_id: type.id, title: 'Cadastro de fornecedores', status_id: done.id })
    await gestor.post('/tasks', { project_id: erp.id, task_type_id: type.id, title: 'Relatório fiscal', due_date: '2026-01-15' })
    await gestor.post('/tasks', { project_id: old.id, task_type_id: type.id, title: 'Migração antiga', status_id: done.id })
    await gestor.post(`/projects/${old.id}/archive`)
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('exige a permissão própria: gestor sem ela recebe 403; o admin vê todos os projetos sem ser membro', async () => {
    assert.equal((await gestor.get('/executive')).status, 403)
    const res = await admin.get('/executive?tz_offset=180')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const data = res.body.data
    assert.equal(data.period.from, null)
    assert.deepEqual(data.projects.map((p) => [p.key, p.archived]), [['CRM', false], ['ERP', false], ['OLD', true]])
    assert.equal(data.summary.active_projects, 2)
    assert.deepEqual(data.portfolio.map((r) => r.project.key), ['CRM', 'ERP'])
  })

  it('portfólio: saúde e progresso da Gestão; sem quadro, progresso pelas tarefas', async () => {
    const data = (await admin.get('/executive')).body.data
    const [crmRow, erpRow] = data.portfolio
    assert.equal(crmRow.health.level, 'critical')
    assert.equal(crmRow.health.factors.find((f) => f.key === 'schedule').level, 'critical')
    assert.deepEqual(crmRow.progress.source, 'plan')
    assert.deepEqual(crmRow.plan, { total: 2, done: 1, open: 1, overdue: 1, stuck: 0 })
    assert.equal(crmRow.open_issues, 1)
    assert.equal(crmRow.project.due_date, '2026-12-15')
    assert.equal(crmRow.project.owner.name, 'Gil')
    assert.equal(erpRow.health.level, 'none')
    assert.deepEqual(erpRow.progress, { value: 50, source: 'tasks' })
    assert.deepEqual(erpRow.tasks, { total: 2, open: 1, overdue: 1, done: 1 })
    assert.deepEqual(data.summary.health, { ok: 0, attention: 0, critical: 1, none: 1 })
    assert.equal(data.plan.open_issues_total, 1)
    assert.equal(data.plan.issues[0].project.key, 'CRM')
    assert.equal(data.kanban.overdue_tasks[0].title, 'Relatório fiscal')
    assert.equal(data.kanban.overdue_tasks[0].code, 'ERP-2')
  })

  it('o que já foi feito: arquivados entram nas entregas; o elemento concluído tem a data gravada pelo banco', async () => {
    const data = (await admin.get('/executive')).body.data
    assert.deepEqual(data.summary.deliveries, { tasks: 2, plan_items: 1, milestones: 1 })
    const byKey = {}
    data.achievements.forEach((a) => {
      byKey[a.project.key] = a
    })
    assert.equal(byKey.OLD.project.archived, true)
    assert.equal(byKey.OLD.tasks_done, 1)
    assert.equal(byKey.CRM.plan_items_done, 1)
    assert.deepEqual(byKey.CRM.milestones_done.map((m) => m.name), ['Homologação'])
    const item = byKey.CRM.recent.find((r) => r.kind === 'plan_item')
    assert.equal(item.title, 'Levantamento')
    assert.ok(Date.now() - Date.parse(item.completed_at) < 10 * 60000)
    const sum = (key) => data.timeline.points.reduce((total, p) => total + p[key], 0)
    assert.equal(sum('tasks_completed'), 2)
    assert.equal(sum('plan_items_completed'), 1)
  })

  it('filtro por projeto e período; dados inválidos voltam com o campo', async () => {
    const only = (await admin.get(`/executive?project_ids=${erp.id}`)).body.data
    assert.deepEqual(only.filters.project_ids, [erp.id])
    assert.deepEqual(only.portfolio.map((r) => r.project.key), ['ERP'])
    assert.equal(only.projects.length, 3)

    const future = (await admin.get('/executive?from=2099-01-01&to=2099-12-31')).body.data
    assert.deepEqual(future.summary.deliveries, { tasks: 0, plan_items: 0, milestones: 0 })
    assert.deepEqual(future.achievements, [])
    assert.equal(future.timeline.bucket, 'month')

    const bad = await admin.get('/executive?from=2026-05-01&to=2026-01-01')
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error.details.fields.to, 'to_before_from')
    assert.equal((await admin.get('/executive?project_ids=a;b')).body.error.details.fields.project_ids, 'invalid_type')
  })

  it('filtro pelo status do projeto (sozinho ou junto com os projetos escolhidos)', async () => {
    await gestor.patch(`/projects/${erp.id}`, { status: 'paused' })
    const paused = (await admin.get('/executive?statuses=paused')).body.data
    assert.deepEqual(paused.filters.statuses, ['paused'])
    assert.deepEqual(paused.portfolio.map((r) => r.project.key), ['ERP'])
    assert.equal(paused.projects.find((p) => p.key === 'ERP').status, 'paused')
    const none = (await admin.get(`/executive?statuses=paused&project_ids=${crm.id}`)).body.data
    assert.deepEqual(none.portfolio, [])
    assert.equal((await admin.get('/executive?statuses=paused,outro')).body.error.details.fields.statuses, 'invalid_option')
    await gestor.patch(`/projects/${erp.id}`, { status: 'active' })
  })
})
