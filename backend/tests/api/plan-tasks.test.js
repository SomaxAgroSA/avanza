/**
 * Tarefas ligadas a elementos da Gestão de projetos (ADR-050, regras §28) contra a API real: ligar na
 * criação e na edição, filtro por elemento, progresso do elemento pelas tarefas, elemento de outro
 * projeto recusado, histórico e excluir o elemento desliga as tarefas.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

describe('API tarefas ligadas aos elementos da Gestão', { timeout: 180000 }, () => {
  let pb
  let admin
  let project
  let other
  let item
  let type
  let statuses

  before(async () => {
    pb = await startServer()
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    project = (await admin.post('/projects', { name: 'Implantação', key: 'IMP' })).body.data
    other = (await admin.post('/projects', { name: 'Outro', key: 'OUT' })).body.data
    const group = (await admin.post(`/projects/${project.id}/groups`, { name: 'Fase 1' })).body.data
    item = (await admin.post(`/projects/${project.id}/plan/items`, { group_id: group.id, name: 'Levantamento', progress: 40 })).body.data
    type = (await admin.post('/task-types', { key: 'LIG', name: 'Tarefa' })).body.data
    statuses = (await admin.get('/statuses')).body.data
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  const status = (category) => statuses.find((s) => s.category === category)

  it('liga na criação e na edição; o elemento passa a ter o progresso pelas tarefas', async () => {
    const a = await admin.post('/tasks', { project_id: project.id, task_type_id: type.id, title: 'Entrevistas', plan_item_id: item.id })
    assert.equal(a.status, 201, JSON.stringify(a.body))
    assert.deepEqual(a.body.data.plan_item, { id: item.id, name: 'Levantamento' })
    const b = (await admin.post('/tasks', { project_id: project.id, task_type_id: type.id, title: 'Documento' })).body.data
    assert.equal(b.plan_item, null)
    const linked = await admin.patch(`/tasks/${b.id}`, { plan_item_id: item.id, status_id: status('done').id })
    assert.equal(linked.status, 200, JSON.stringify(linked.body))
    await admin.post('/tasks', { project_id: project.id, task_type_id: type.id, title: 'Cancelada', plan_item_id: item.id, status_id: status('cancelled').id })

    const got = (await admin.get(`/plan/items/${item.id}`)).body.data
    assert.deepEqual(got.tasks, { total: 2, done: 1 })
    assert.deepEqual(got.progress, { value: 50, source: 'tasks' })
    const board = (await admin.get(`/projects/${project.id}/plan`)).body.data
    assert.deepEqual(board.items.find((i) => i.id === item.id).progress, { value: 50, source: 'tasks' })

    const list = (await admin.get(`/tasks?plan_item_id=${item.id}&perPage=50`)).body
    assert.equal(list.meta.total, 3)

    const history = (await admin.get(`/tasks/${b.id}/history`)).body.data
    assert.ok(history.some((h) => h.new_value && h.new_value.plan_item === 'Levantamento'), JSON.stringify(history))
  })

  it('elemento de outro projeto (ou inexistente) é recusado; null desliga', async () => {
    const t = (await admin.post('/tasks', { project_id: other.id, task_type_id: type.id, title: 'Fora' })).body.data
    const bad = await admin.patch(`/tasks/${t.id}`, { plan_item_id: item.id })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error.details.fields.plan_item_id, 'invalid_option')
    assert.equal((await admin.post('/tasks', { project_id: project.id, task_type_id: type.id, title: 'X', plan_item_id: 'naoexiste12345' })).body.error.details.fields.plan_item_id, 'invalid_option')

    const mine = (await admin.post('/tasks', { project_id: project.id, task_type_id: type.id, title: 'Solta', plan_item_id: item.id })).body.data
    const unlinked = (await admin.patch(`/tasks/${mine.id}`, { plan_item_id: null })).body.data
    assert.equal(unlinked.plan_item, null)
  })

  it('sem horas próprias, o elemento usa a soma das horas das tarefas no quadro e na saúde; informar no elemento substitui', async () => {
    const proj = (await admin.post('/projects', { name: 'Horas', key: 'HRS' })).body.data
    const group = (await admin.post(`/projects/${proj.id}/groups`, { name: 'Fase' })).body.data
    const done = (await admin.get(`/projects/${proj.id}/plan`)).body.data.statuses.find((s) => s.category === 'done')
    const element = (await admin.post(`/projects/${proj.id}/plan/items`, { group_id: group.id, name: 'Entrega', status_id: done.id })).body.data
    const task = (title, extra) => admin.post('/tasks', Object.assign({ project_id: proj.id, task_type_id: type.id, title, plan_item_id: element.id }, extra))
    assert.equal((await task('A', { estimated_hours: 6, actual_hours: 7.5, status_id: status('done').id })).status, 201)
    assert.equal((await task('B', { estimated_hours: 2 })).status, 201)
    assert.equal((await task('C', { estimated_hours: 50, actual_hours: 50, status_id: status('cancelled').id })).status, 201)

    const row = (await admin.get(`/projects/${proj.id}/plan`)).body.data.items.find((i) => i.id === element.id)
    assert.deepEqual([row.estimated_hours, row.actual_hours, row.estimated_from_tasks, row.actual_from_tasks], [8, 7.5, true, true])
    const report = (await admin.get(`/projects/${proj.id}/plan/report`)).body.data
    assert.deepEqual(report.effort, { estimated: 8, actual: 7.5, remaining: 0.5, deviation: { hours: -0.5, percent: -6 } })
    assert.equal(report.health.factors.find((f) => f.key === 'effort').level, 'ok')

    const own = (await admin.patch(`/plan/items/${element.id}`, { estimated_hours: 5 })).body.data
    assert.deepEqual([own.estimated_hours, own.estimated_from_tasks, own.actual_hours, own.actual_from_tasks], [5, false, 7.5, true])
  })

  it('excluir o elemento desliga as tarefas (elas continuam)', async () => {
    const group = (await admin.post(`/projects/${project.id}/groups`, { name: 'Fase 2' })).body.data
    const temp = (await admin.post(`/projects/${project.id}/plan/items`, { group_id: group.id, name: 'Temporário' })).body.data
    const task = (await admin.post('/tasks', { project_id: project.id, task_type_id: type.id, title: 'Ligada', plan_item_id: temp.id })).body.data
    assert.equal((await admin.del(`/plan/items/${temp.id}`)).status, 200)
    const after = (await admin.get(`/tasks/${task.id}`)).body.data
    assert.equal(after.plan_item, null)
  })
})
