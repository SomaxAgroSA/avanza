const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createTaskService } = require('../../pb_hooks/src/application/tasks')
const { createCharterService } = require('../../pb_hooks/src/application/charter')
const { createLookupService } = require('../../pb_hooks/src/application/lookups')
const { createTaskTypeService } = require('../../pb_hooks/src/application/task-types')
const { createPrincipal } = require('../../pb_hooks/src/domain/rbac')

function ctxOf(deps, user) {
  const role = deps.roleRepository.findById(user.roleId)
  return {
    principal: createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: deps.roleRepository.getPermissionCodes(role.id) }),
    ip: '1.1.1.1',
    userAgent: 'ua',
    correlationId: 'c',
  }
}

function codeOf(fn) {
  try {
    fn()
  } catch (err) {
    return err.code === 'VALIDATION_ERROR' ? `${err.code}:${JSON.stringify(err.details.fields)}` : err.code
  }
  return 'OK'
}

function setup() {
  const deps = createFakeDeps({ start: '2026-10-15T12:00:00.000Z' })
  const adminUser = seedUser(deps, { roleCode: 'ADMIN', name: 'Admin' })
  const gabi = seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const mario = seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  const lia = seedUser(deps, { roleCode: 'MEMBER', name: 'Lia' })
  const otto = seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' })
  const admin = ctxOf(deps, adminUser)
  const project = deps.projectRepository.create({ name: 'CRM', key: 'CRM', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  const other = deps.projectRepository.create({ name: 'Outro', key: 'OUT', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  ;[
    [gabi, 'manager'],
    [mario, 'member'],
    [lia, 'viewer'],
  ].forEach(([u, role]) => deps.projectMemberRepository.add({ projectId: project.id, userId: u.id, role }))
  const doc = createTaskTypeService(deps).createType(admin, { key: 'DOC', name: 'Documentação' })
  const statuses = createLookupService(deps, 'status')
  statuses.create(admin, { key: 'BACKLOG', name: 'Backlog', category: 'backlog', is_default: true })
  const dev = statuses.create(admin, { key: 'DEV', name: 'Desenvolvimento', category: 'in_progress' })
  const done = statuses.create(admin, { key: 'DONE', name: 'Concluído', category: 'done' })
  createLookupService(deps, 'priority').create(admin, { key: 'MEDIA', name: 'Média', is_default: true })
  const ctx = { admin, gabi: ctxOf(deps, gabi), mario: ctxOf(deps, mario), lia: ctxOf(deps, lia), otto: ctxOf(deps, otto) }
  const tasks = createTaskService(deps)
  const newTask = (title, projectId) => tasks.createTask(ctx.gabi, { project_id: projectId || project.id, task_type_id: doc.id, title })
  const setStatus = (task, status) => deps.taskRepository.update(task.id, { statusId: status.id })
  return { deps, ctx, users: { gabi, mario, lia }, project, other, charter: createCharterService(deps), newTask, setStatus, statuses: { dev, done } }
}

describe('application/charter — estrutura', () => {
  it('ficha vazia: completude 0 e quem pode editar', () => {
    const s = setup()
    const c = s.charter.getCharter(s.ctx.lia, s.project.id)
    assert.equal(c.objective, '')
    assert.deepEqual(c.items, [])
    assert.equal(c.completeness.percent, 0)
    assert.deepEqual(c.capabilities, { edit: false })
    assert.deepEqual(s.charter.getCharter(s.ctx.gabi, s.project.id).capabilities, { edit: true })
    assert.equal(codeOf(() => s.charter.getCharter(s.ctx.otto, s.project.id)), 'PROJECT_NOT_FOUND')
  })

  it('gestor grava objetivo geral e itens das quatro seções; membro e leitor não', () => {
    const s = setup()
    assert.equal(codeOf(() => s.charter.updateCharter(s.ctx.mario, s.project.id, { objective: 'x' })), 'FORBIDDEN')
    s.charter.updateCharter(s.ctx.gabi, s.project.id, { objective: '  Centralizar a gestão comercial  ' })
    s.charter.createItem(s.ctx.gabi, s.project.id, { kind: 'feature', title: 'Reclamos' })
    s.charter.createItem(s.ctx.gabi, s.project.id, { kind: 'scope_in', title: 'Portal web' })
    s.charter.createItem(s.ctx.gabi, s.project.id, { kind: 'scope_out', title: 'App móvel' })
    s.charter.createItem(s.ctx.gabi, s.project.id, { kind: 'result', title: 'Usuários ativos', target: 120, due_date: '2026-12-31' })
    assert.equal(codeOf(() => s.charter.createItem(s.ctx.mario, s.project.id, { kind: 'feature', title: 'X' })), 'FORBIDDEN')

    const c = s.charter.getCharter(s.ctx.lia, s.project.id)
    assert.equal(c.objective, 'Centralizar a gestão comercial')
    assert.deepEqual(c.items.map((i) => [i.kind, i.title]), [
      ['feature', 'Reclamos'],
      ['scope_in', 'Portal web'],
      ['scope_out', 'App móvel'],
      ['result', 'Usuários ativos'],
    ])
    assert.equal(c.completeness.percent, 100)
    assert.equal(c.updated_by.name, 'Gabi')
    const actions = s.deps.store.audit.filter((e) => e.entityId === s.project.id).map((e) => e.action)
    assert.deepEqual(actions, ['charter.updated', 'charter_item.created', 'charter_item.created', 'charter_item.created', 'charter_item.created'])
  })

  it('valida o tipo, os campos de cada tipo e os vínculos', () => {
    const s = setup()
    const g = s.ctx.gabi
    assert.equal(codeOf(() => s.charter.createItem(g, s.project.id, { title: 'X' })), 'VALIDATION_ERROR:{"kind":"required"}')
    assert.equal(codeOf(() => s.charter.createItem(g, s.project.id, { kind: 'risk', title: 'X' })), 'VALIDATION_ERROR:{"kind":"invalid_option"}')
    assert.equal(codeOf(() => s.charter.createItem(g, s.project.id, { kind: 'result', title: 'X' })), 'VALIDATION_ERROR:{"target":"required"}')
    assert.equal(codeOf(() => s.charter.createItem(g, s.project.id, { kind: 'result', title: 'X', target: '10' })), 'VALIDATION_ERROR:{"target":"invalid_type"}')
    assert.equal(
      codeOf(() => s.charter.createItem(g, s.project.id, { kind: 'result', title: 'X', target: 10, start_date: '2026-12-01', due_date: '2026-11-01' })),
      'VALIDATION_ERROR:{"start_date":"after_due_date"}',
    )
    assert.equal(codeOf(() => s.charter.createItem(g, s.project.id, { kind: 'feature', title: 'X', state: 'achieved' })), 'VALIDATION_ERROR:{"state":"invalid_option"}')
    const foreign = s.newTask('De outro projeto', s.other.id)
    assert.equal(codeOf(() => s.charter.createItem(g, s.project.id, { kind: 'feature', title: 'X', task_ids: [foreign.id] })), 'VALIDATION_ERROR:{"task_ids":"not_in_project"}')
    assert.equal(codeOf(() => s.charter.createItem(g, s.project.id, { kind: 'feature', title: 'X', owner_id: s.ctx.otto.principal.userId })), 'VALIDATION_ERROR:{"owner_id":"not_member"}')
    const scope = s.charter.createItem(g, s.project.id, { kind: 'scope_in', title: 'Portal' })
    assert.equal(codeOf(() => s.charter.createItem(g, s.project.id, { kind: 'objective', title: 'X', link_ids: [scope.id] })), 'VALIDATION_ERROR:{"link_ids":"invalid_link"}')
    // campo de outro tipo é ignorado
    const plain = s.charter.createItem(g, s.project.id, { kind: 'scope_out', title: 'App', target: 5 })
    assert.equal(plain.target, undefined)
  })

  it('edita, reordena e exclui; item de projeto invisível = não encontrado', () => {
    const s = setup()
    const g = s.ctx.gabi
    const a = s.charter.createItem(g, s.project.id, { kind: 'scope_in', title: 'A' })
    const b = s.charter.createItem(g, s.project.id, { kind: 'scope_in', title: 'B' })
    assert.equal(s.charter.updateItem(g, a.id, { title: 'A2', description: 'detalhe' }).title, 'A2')
    const reordered = s.charter.reorderItems(g, s.project.id, { kind: 'scope_in', ids: [b.id, a.id] })
    assert.deepEqual(reordered.items.map((i) => i.title), ['B', 'A2'])
    assert.equal(codeOf(() => s.charter.reorderItems(g, s.project.id, { kind: 'scope_in', ids: [b.id] })), 'VALIDATION_ERROR:{"ids":"invalid_order"}')
    assert.equal(codeOf(() => s.charter.updateItem(s.ctx.otto, a.id, { title: 'x' })), 'CHARTER_ITEM_NOT_FOUND')
    assert.equal(codeOf(() => s.charter.updateItem(s.ctx.mario, a.id, { title: 'x' })), 'FORBIDDEN')
    assert.deepEqual(s.charter.deleteItem(g, a.id), { deleted: true })
    assert.deepEqual(s.charter.getCharter(g, s.project.id).items.map((i) => i.title), ['B'])
    const actions = s.deps.store.audit.map((e) => e.action).filter((x) => x.indexOf('charter') === 0)
    assert.deepEqual(actions, ['charter_item.created', 'charter_item.created', 'charter_item.updated', 'charter_item.reordered', 'charter_item.deleted'])
  })
})

describe('application/charter — seguimento', () => {
  it('funcionalidade avança sozinha pelas tarefas vinculadas', () => {
    const s = setup()
    const t1 = s.newTask('Tela')
    const t2 = s.newTask('API')
    const f = s.charter.createItem(s.ctx.gabi, s.project.id, { kind: 'feature', title: 'Reclamos', task_ids: [t1.id, t2.id, t1.id], owner_id: s.users.mario.id })
    assert.deepEqual([f.effective_state, f.progress, f.task_ids.length, f.owner.name], ['planned', { done: 0, total: 2 }, 2, 'Mário'])
    s.setStatus(t1, s.statuses.dev)
    assert.equal(s.charter.getCharter(s.ctx.lia, s.project.id).items[0].effective_state, 'in_progress')
    s.setStatus(t1, s.statuses.done)
    s.setStatus(t2, s.statuses.done)
    const c = s.charter.getCharter(s.ctx.lia, s.project.id)
    assert.deepEqual([c.items[0].effective_state, c.items[0].progress], ['delivered', { done: 2, total: 2 }])
    assert.deepEqual(c.items[0].tasks.map((t) => t.title), ['Tela', 'API'])
    assert.deepEqual([c.summary.features_delivered, c.summary.tasks_done, c.summary.tasks_total], [1, 2, 2])
    // tarefa excluída sai do vínculo
    s.deps.store.tasks = s.deps.store.tasks.filter((t) => t.id !== t2.id)
    assert.deepEqual(s.charter.getCharter(s.ctx.lia, s.project.id).items[0].task_ids, [t1.id])
  })

  it('medição do resultado: responsável ou gestor registra; vira o valor atual e a situação', () => {
    const s = setup()
    const r = s.charter.createItem(s.ctx.gabi, s.project.id, {
      kind: 'result',
      title: 'Reclamos no prazo',
      unit: '%',
      baseline: 40,
      target: 90,
      start_date: '2026-10-01',
      due_date: '2026-10-29',
      frequency: 'weekly',
      owner_id: s.users.mario.id,
    })
    assert.deepEqual([r.current, r.situation, r.percent], [null, 'no_data', 0])
    assert.equal(codeOf(() => s.charter.addMeasurement(s.ctx.lia, r.id, { value: 50 })), 'FORBIDDEN')
    assert.equal(codeOf(() => s.charter.addMeasurement(s.ctx.mario, r.id, { value: 'muito' })), 'VALIDATION_ERROR:{"value":"invalid_type"}')
    assert.equal(codeOf(() => s.charter.addMeasurement(s.ctx.mario, r.id, { value: 50, measured_at: '2026-10-20' })), 'VALIDATION_ERROR:{"measured_at":"in_future"}')

    const measured = s.charter.addMeasurement(s.ctx.mario, r.id, { value: 70, note: 'Relatório do CRM' })
    assert.deepEqual([measured.current, measured.measured_at, measured.situation, measured.percent, measured.stale], [70, '2026-10-15', 'on_track', 60, false])
    // medição com data antiga entra na série, mas não muda o valor atual
    const old = s.charter.addMeasurement(s.ctx.gabi, r.id, { value: 45, measured_at: '2026-10-05' })
    assert.equal(old.current, 70)
    const series = s.charter.listMeasurements(s.ctx.lia, r.id)
    assert.deepEqual(series.map((m) => [m.value, m.measured_at, m.created_by.name]), [
      [70, '2026-10-15', 'Mário'],
      [45, '2026-10-05', 'Gabi'],
    ])
    assert.equal(series[0].note, 'Relatório do CRM')
    assert.ok(s.deps.store.audit.some((e) => e.action === 'charter_item.measured' && e.newValue.value === 70))
    const scope = s.charter.createItem(s.ctx.gabi, s.project.id, { kind: 'scope_in', title: 'Portal' })
    assert.equal(codeOf(() => s.charter.addMeasurement(s.ctx.gabi, scope.id, { value: 1 })), 'CHARTER_ITEM_NOT_FOUND')
  })

  it('objetivo automático pelos vínculos; resumo conta resultados atrasados e sem medir', () => {
    const s = setup()
    const g = s.ctx.gabi
    const t = s.newTask('Tela')
    const f = s.charter.createItem(g, s.project.id, { kind: 'feature', title: 'Reclamos', task_ids: [t.id] })
    const r = s.charter.createItem(g, s.project.id, { kind: 'result', title: 'Usuários', target: 100, start_date: '2026-10-01', due_date: '2026-10-31', frequency: 'weekly' })
    const o = s.charter.createItem(g, s.project.id, { kind: 'objective', title: 'Digitalizar reclamos', link_ids: [f.id, r.id] })
    assert.equal(o.effective_state, 'pending')
    s.charter.addMeasurement(g, r.id, { value: 10, measured_at: '2026-10-02' })
    const c = s.charter.getCharter(g, s.project.id)
    const byId = Object.fromEntries(c.items.map((i) => [i.id, i]))
    assert.equal(byId[r.id].situation, 'late')
    assert.equal(byId[r.id].stale, true)
    assert.equal(byId[o.id].effective_state, 'at_risk')
    assert.deepEqual([c.summary.results_late, c.summary.results_stale], [1, 1])
    // estado escolhido à mão vale
    assert.equal(s.charter.updateItem(g, o.id, { state: 'in_progress' }).effective_state, 'in_progress')
    // excluir o resultado tira o vínculo
    s.charter.deleteItem(g, r.id)
    assert.deepEqual(s.charter.getCharter(g, s.project.id).items.filter((i) => i.id === o.id)[0].link_ids, [f.id])
  })
})
