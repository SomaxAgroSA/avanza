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

  it('excluir o elemento desliga as tarefas (elas continuam)', async () => {
    const group = (await admin.post(`/projects/${project.id}/groups`, { name: 'Fase 2' })).body.data
    const temp = (await admin.post(`/projects/${project.id}/plan/items`, { group_id: group.id, name: 'Temporário' })).body.data
    const task = (await admin.post('/tasks', { project_id: project.id, task_type_id: type.id, title: 'Ligada', plan_item_id: temp.id })).body.data
    assert.equal((await admin.del(`/plan/items/${temp.id}`)).status, 200)
    const after = (await admin.get(`/tasks/${task.id}`)).body.data
    assert.equal(after.plan_item, null)
  })

  it('etapa da Gestão (plan_group_id): criar a tarefa cria a linha na etapa, na mesma transação, já ligada', async () => {
    const stage = (await admin.post(`/projects/${project.id}/groups`, { name: 'Base de clientes' })).body.data
    const sub = (await admin.post(`/projects/${project.id}/groups`, { name: 'Critérios', parent_id: stage.id })).body.data
    const me = (await admin.get('/auth/me')).body.data.user
    const res = await admin.post('/tasks', {
      project_id: project.id,
      task_type_id: type.id,
      title: 'Unir a base de clientes',
      plan_group_id: sub.id,
      start_date: '2026-11-20',
      due_date: '2026-11-27',
      assignee_id: me.id,
    })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const task = res.body.data
    assert.equal(task.plan_item.name, 'Unir a base de clientes')
    const board = (await admin.get(`/projects/${project.id}/plan`)).body.data
    const row = board.items.find((i) => i.id === task.plan_item.id)
    assert.equal(row.group_id, sub.id)
    assert.equal(row.name, 'Unir a base de clientes')
    assert.equal(row.start_date.slice(0, 10), '2026-11-20')
    assert.equal(row.end_date.slice(0, 10), '2026-11-27')
    assert.deepEqual(row.tasks, { total: 1, done: 0 })
    assert.equal(row.owner.id, me.id)
    const history = (await admin.get(`/plan/items/${row.id}/history`)).body.data
    assert.ok(history.some((h) => h.action === 'plan_item.created'), JSON.stringify(history))

    // etapa e elemento juntos, ou etapa de outro projeto: nada é criado
    const before = board.items.length
    const both = await admin.post('/tasks', { project_id: project.id, task_type_id: type.id, title: 'X', plan_group_id: stage.id, plan_item_id: item.id })
    assert.equal(both.status, 400)
    assert.equal(both.body.error.details.fields.plan_group_id, 'exclusive')
    const foreign = await admin.post('/tasks', { project_id: other.id, task_type_id: type.id, title: 'Y', plan_group_id: stage.id })
    assert.equal(foreign.status, 400)
    assert.equal(foreign.body.error.details.fields.plan_group_id, 'invalid_option')
    assert.equal((await admin.get(`/projects/${project.id}/plan`)).body.data.items.length, before)
  })

  it('PATCH com plan_group_id: só para a tarefa sem elemento; depois recusa', async () => {
    const stage = (await admin.post(`/projects/${project.id}/groups`, { name: 'Fase 3' })).body.data
    const loose = (await admin.post('/tasks', { project_id: project.id, task_type_id: type.id, title: 'Sem etapa' })).body.data
    const placed = await admin.patch(`/tasks/${loose.id}`, { plan_group_id: stage.id })
    assert.equal(placed.status, 200, JSON.stringify(placed.body))
    assert.equal(placed.body.data.plan_item.name, 'Sem etapa')
    const again = await admin.patch(`/tasks/${loose.id}`, { plan_group_id: stage.id })
    assert.equal(again.status, 400)
    assert.equal(again.body.error.details.fields.plan_group_id, 'already_linked')
    const history = (await admin.get(`/tasks/${loose.id}/history`)).body.data
    assert.ok(history.some((h) => h.new_value && h.new_value.plan_item === 'Sem etapa'), JSON.stringify(history))
  })

  it('sem plan.view a etapa é recusada (FORBIDDEN); com plan.view, sem plan.edit, a linha é criada', async () => {
    const { DEFAULT_ROLE_PERMISSIONS } = require('../../src/domain/permissions')
    const base = DEFAULT_ROLE_PERMISSIONS.MEMBER.filter((p) => p !== 'plan.view' && p !== 'plan.edit' && p !== 'plan.manage')
    await admin.post('/roles', { code: 'SEM_GESTAO', name: 'Sem Gestão', permissions: base })
    await admin.post('/roles', { code: 'SO_VE_GESTAO', name: 'Só vê a Gestão', permissions: base.concat('plan.view') })
    const roles = (await admin.get('/roles')).body.data
    const person = async (code, email) => {
      const user = (await admin.post('/users', { name: code, email, password: 'SenhaTeste123', role_id: roles.find((r) => r.code === code).id })).body.data
      await admin.post(`/projects/${project.id}/members`, { user_id: user.id, role: 'member' })
      const client = createClient(pb.api)
      await client.login(email, 'SenhaTeste123')
      return client
    }
    const blind = await person('SEM_GESTAO', 'sem.gestao@example.com')
    const viewer = await person('SO_VE_GESTAO', 've.gestao@example.com')
    const stage = (await admin.post(`/projects/${project.id}/groups`, { name: 'Fase 4' })).body.data
    const refused = await blind.post('/tasks', { project_id: project.id, task_type_id: type.id, title: 'Não pode', plan_group_id: stage.id })
    assert.equal(refused.status, 403, JSON.stringify(refused.body))
    const ok = await viewer.post('/tasks', { project_id: project.id, task_type_id: type.id, title: 'Pode', plan_group_id: stage.id })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.equal(ok.body.data.plan_item.name, 'Pode')
  })
})
