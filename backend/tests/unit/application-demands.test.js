const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createDemandService } = require('../../src/application/demands')
const { createTaskService } = require('../../src/application/tasks')
const { createProjectService } = require('../../src/application/projects')
const { createCommentService } = require('../../src/application/comments')
const { createAuditService } = require('../../src/application/audit-logs')
const { createReportService } = require('../../src/application/reports')
const { createTaskTypeService } = require('../../src/application/task-types')
const { createCustomFieldService } = require('../../src/application/custom-fields')
const { createLookupService } = require('../../src/application/lookups')
const { createPrincipal } = require('../../src/domain/rbac')

async function ctxOf(deps, user) {
  const role = await deps.roleRepository.findById(user.roleId)
  return {
    principal: createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: await deps.roleRepository.getPermissionCodes(role.id) }),
    ip: '1.1.1.1',
    userAgent: 'ua',
    correlationId: 'c',
  }
}

async function codeOf(fn) {
  try {
    await fn()
  } catch (err) {
    return err.code === 'VALIDATION_ERROR' ? `${err.code}:${JSON.stringify(err.details.fields)}` : err.code
  }
  return 'OK'
}

/**
 * Cenário: Ana (Estratégia) pede ao César (TI). A equipe de César é Jorge e Carlos (área TI em
 * "Dependências por área"); Fabi é de Finanças; Otto não está em área nenhuma; Admin vê tudo.
 */
async function setup() {
  const deps = createFakeDeps()
  const adminUser = await seedUser(deps, { roleCode: 'ADMIN', name: 'Admin' })
  const admin = await ctxOf(deps, adminUser)
  const users = {
    admin: adminUser,
    ana: await seedUser(deps, { roleCode: 'MEMBER', name: 'Ana' }),
    cesar: await seedUser(deps, { roleCode: 'MANAGER', name: 'César' }),
    jorge: await seedUser(deps, { roleCode: 'MEMBER', name: 'Jorge' }),
    carlos: await seedUser(deps, { roleCode: 'MEMBER', name: 'Carlos' }),
    fabi: await seedUser(deps, { roleCode: 'MEMBER', name: 'Fabi' }),
    otto: await seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' }),
    leo: await seedUser(deps, { roleCode: 'VIEWER', name: 'Leo' }),
  }
  deps.store.platformSettings.values = {
    dependency_areas: [
      { key: 'ti', name: 'TI', user_ids: [users.cesar.id, users.jorge.id, users.carlos.id] },
      { key: 'fin', name: 'Finanças', user_ids: [users.fabi.id] },
    ],
  }
  const statuses = createLookupService(deps, 'status')
  const backlog = await statuses.create(admin, { key: 'BACKLOG', name: 'Backlog', category: 'backlog', color: 'gray' })
  const todo = await statuses.create(admin, { key: 'TODO', name: 'A fazer', category: 'todo', color: 'blue' })
  const dev = await statuses.create(admin, { key: 'DEV', name: 'Desenvolvimento', category: 'in_progress', color: 'amber' })
  const done = await statuses.create(admin, { key: 'DONE', name: 'Concluído', category: 'done', color: 'green' })
  const priorities = createLookupService(deps, 'priority')
  const high = await priorities.create(admin, { key: 'ALTA', name: 'Alta', color: 'red' })
  await priorities.create(admin, { key: 'MEDIA', name: 'Média', color: 'amber', is_default: true })
  const areas = createLookupService(deps, 'area')
  const strategy = await areas.create(admin, { key: 'EST', name: 'Estratégia', color: 'blue' })
  // tipo com campo obrigatório: a demanda não pede campos personalizados
  const fields = createCustomFieldService(deps)
  const versao = await fields.createField(admin, { label: 'Versão', type: 'text' })
  const types = createTaskTypeService(deps)
  const devType = await types.createType(admin, { key: 'DEV', name: 'Desenvolvimento', icon: 'code', color: 'blue' })
  await types.setTypeFields(admin, devType.id, [{ field_id: versao.id, required: true }])

  const project = await deps.projectRepository.create({ name: 'CRM', key: 'CRM', ownerId: users.cesar.id, createdBy: users.cesar.id, status: 'active', priority: 'medium', kind: '' })
  await deps.projectMemberRepository.add({ projectId: project.id, userId: users.cesar.id, role: 'manager' })

  const ctx = {}
  for (const name of Object.keys(users)) ctx[name] = await ctxOf(deps, users[name])
  return {
    deps,
    users,
    ctx,
    project,
    demands: createDemandService(deps),
    tasks: createTaskService(deps),
    projects: createProjectService(deps),
    comments: createCommentService(deps),
    audit: createAuditService(deps),
    reports: createReportService(deps),
    statuses: { backlog, todo, dev, done },
    priorities: { high },
    areas: { strategy },
    types: { dev: devType },
  }
}

function newDemand(s, extra) {
  return Object.assign(
    { task_type_id: s.types.dev.id, title: 'Vista DMR: agregar Fecha cuenta', description: 'Coluna para o DRE.', demand_owner_id: s.users.cesar.id, area_id: s.areas.strategy.id },
    extra,
  )
}

const FUTURE = '2026-01-21T20:00:00.000Z'

describe('application/demands — abrir', () => {
  it('cria DEM-1 sem projeto, Sem atribuir, avisa o responsável e grava o histórico', async () => {
    const s = await setup()
    const created = await s.demands.createDemand(s.ctx.ana, newDemand(s, { priority_id: s.priorities.high.id, due_date: '2026-02-01', assignee_id: s.users.jorge.id }))
    assert.equal(created.code, 'DEM-1')
    assert.equal(created.project, null)
    assert.equal(created.demand.status, 'unassigned')
    assert.equal(created.demand.owner.name, 'César')
    assert.equal(created.reporter.name, 'Ana')
    assert.equal(created.area.name, 'Estratégia')
    assert.equal(created.priority.key, 'ALTA')
    // quem pede não define prazo nem executor
    assert.equal(created.assignee, null)
    assert.equal(created.demand.due_at, null)
    assert.equal(created.status.key, 'BACKLOG')
    assert.deepEqual(created.custom_values, {})
    assert.deepEqual(created.fields, [])
    assert.ok(created.demand.opened_at)
    const second = await s.demands.createDemand(s.ctx.ana, newDemand(s, { title: 'Outra' }))
    assert.equal(second.code, 'DEM-2')
    const received = s.deps.store.notifications.filter((n) => n.userId === s.users.cesar.id)
    assert.deepEqual(received.map((n) => n.type), ['demand_received', 'demand_received'])
    const entry = s.deps.store.audit.find((e) => e.entityId === created.id && e.action === 'task.created')
    assert.equal(entry.newValue.demand_owner, 'César')
    assert.equal(entry.newValue.area, 'Estratégia')
  })

  it('exige tipo, título, responsável e departamento; responsável ativo que vê tarefas', async () => {
    const s = await setup()
    assert.equal(
      await codeOf(() => s.demands.createDemand(s.ctx.ana, {})),
      'VALIDATION_ERROR:{"title":"required","task_type_id":"required","demand_owner_id":"required","area_id":"required"}',
    )
    await s.deps.userRepository.update(s.users.otto.id, { status: 'disabled' })
    assert.equal(await codeOf(() => s.demands.createDemand(s.ctx.ana, newDemand(s, { demand_owner_id: s.users.otto.id }))), 'VALIDATION_ERROR:{"demand_owner_id":"invalid_option"}')
    assert.equal(await codeOf(() => s.demands.createDemand(s.ctx.ana, newDemand(s, { area_id: 'nope' }))), 'VALIDATION_ERROR:{"area_id":"invalid_option"}')
  })

  it('pede tasks.create', async () => {
    const s = await setup()
    assert.equal(await codeOf(() => s.demands.createDemand(s.ctx.leo, newDemand(s))), 'FORBIDDEN')
  })

  it('a caixa de sistema não aparece nas listas de projetos e não abre como projeto (nem para o admin)', async () => {
    const s = await setup()
    const created = await s.demands.createDemand(s.ctx.ana, newDemand(s))
    const inbox = await s.deps.projectRepository.findSystem('demands')
    assert.equal(inbox.key, 'DEM')
    const listed = await s.projects.listProjects(s.ctx.admin, {})
    assert.deepEqual(listed.items.map((p) => p.key), ['CRM'])
    assert.equal(await codeOf(() => s.projects.getProject(s.ctx.admin, inbox.id)), 'PROJECT_NOT_FOUND')
    assert.equal(await codeOf(() => s.projects.archiveProject(s.ctx.admin, inbox.id)), 'PROJECT_NOT_FOUND')
    assert.equal(await codeOf(() => s.projects.updateProject(s.ctx.admin, inbox.id, { name: 'X' })), 'PROJECT_NOT_FOUND')
    // criar tarefa comum dentro da caixa também não
    assert.equal(await codeOf(() => s.tasks.createTask(s.ctx.admin, { project_id: inbox.id, task_type_id: s.types.dev.id, title: 'x', custom_values: { versao: '1' } })), 'PROJECT_NOT_FOUND')
    // relatórios são de projetos
    const report = await s.reports.getReport(s.ctx.admin, {})
    assert.equal(JSON.stringify(report).includes(created.id), false)
  })
})

describe('application/demands — visibilidade', () => {
  it('veem: quem pediu, o responsável, a equipe dele e quem vê todos; os demais não', async () => {
    const s = await setup()
    const created = await s.demands.createDemand(s.ctx.ana, newDemand(s))
    for (const name of ['ana', 'cesar', 'jorge', 'carlos', 'admin']) assert.equal((await s.tasks.getTask(s.ctx[name], created.id)).id, created.id, name)
    assert.equal(await codeOf(() => s.tasks.getTask(s.ctx.fabi, created.id)), 'TASK_NOT_FOUND')
    assert.equal(await codeOf(() => s.tasks.getTask(s.ctx.otto, created.id)), 'TASK_NOT_FOUND')
    const ids = async (name, query) => (await s.tasks.listTasks(s.ctx[name], query || {})).items.map((t) => t.code)
    assert.deepEqual(await ids('jorge'), ['DEM-1'])
    assert.deepEqual(await ids('fabi'), [])
    // histórico e comentários seguem a mesma regra
    assert.ok((await s.audit.listEntityHistory(s.ctx.jorge, 'task', created.id, {})).items.length > 0)
    assert.equal(await codeOf(() => s.audit.listEntityHistory(s.ctx.fabi, 'task', created.id, {})), 'TASK_NOT_FOUND')
    s.deps.store.notifications.length = 0
    await s.comments.createComment(s.ctx.jorge, created.id, { content: 'Vejo amanhã.' })
    // quem pediu e o responsável recebem o comentário
    assert.deepEqual(s.deps.store.notifications.map((n) => n.userId).sort(), [s.users.ana.id, s.users.cesar.id].sort())
    assert.equal(await codeOf(() => s.comments.createComment(s.ctx.fabi, created.id, { content: 'x' })), 'TASK_NOT_FOUND')
    // menções: só quem enxerga a demanda
    const names = (await s.comments.mentionCandidates(s.ctx.ana, created.id)).map((u) => u.name)
    assert.deepEqual(names, ['Ana', 'Carlos', 'César', 'Jorge'])
  })

  it('Lista de tarefas: Com projeto · Sem projeto e "Minhas" com as que pedi, recebi ou executo', async () => {
    const s = await setup()
    await s.tasks.createTask(s.ctx.cesar, { project_id: s.project.id, task_type_id: s.types.dev.id, title: 'Tarefa CRM', assignee_id: s.users.cesar.id, custom_values: { versao: '1' } })
    await s.demands.createDemand(s.ctx.ana, newDemand(s))
    const codes = async (name, query) => (await s.tasks.listTasks(s.ctx[name], query)).items.map((t) => t.code).sort()
    assert.deepEqual(await codes('cesar', {}), ['CRM-1', 'DEM-1'])
    assert.deepEqual(await codes('cesar', { kind: 'project' }), ['CRM-1'])
    assert.deepEqual(await codes('cesar', { kind: 'demand' }), ['DEM-1'])
    assert.deepEqual(await codes('cesar', { mine: 'true' }), ['CRM-1', 'DEM-1'])
    assert.deepEqual(await codes('ana', { mine: 'true' }), ['DEM-1'])
    assert.deepEqual(await codes('jorge', { mine: 'true' }), [])
    assert.equal(await codeOf(() => s.tasks.listTasks(s.ctx.cesar, { kind: 'x' })), 'VALIDATION_ERROR:{"kind":"invalid_option"}')
    const row = (await s.tasks.listTasks(s.ctx.cesar, { kind: 'demand' })).items[0]
    assert.equal(row.project, null)
    assert.equal(row.demand.status, 'unassigned')
  })
})

describe('application/demands — fluxo', () => {
  async function opened() {
    const s = await setup()
    const created = await s.demands.createDemand(s.ctx.ana, newDemand(s))
    return Object.assign(s, { id: created.id })
  }

  it('só o responsável atribui, a alguém da equipe, com prazo (data e hora) obrigatório', async () => {
    const s = await opened()
    assert.equal(await codeOf(() => s.demands.assign(s.ctx.jorge, s.id, { assignee_id: s.users.jorge.id, due_at: FUTURE })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.demands.assign(s.ctx.cesar, s.id, { assignee_id: s.users.jorge.id })), 'VALIDATION_ERROR:{"due_at":"required"}')
    assert.equal(await codeOf(() => s.demands.assign(s.ctx.cesar, s.id, { due_at: FUTURE })), 'VALIDATION_ERROR:{"assignee_id":"required"}')
    assert.equal(await codeOf(() => s.demands.assign(s.ctx.cesar, s.id, { assignee_id: s.users.fabi.id, due_at: FUTURE })), 'VALIDATION_ERROR:{"assignee_id":"not_in_team"}')
    assert.equal(await codeOf(() => s.demands.assign(s.ctx.cesar, s.id, { assignee_id: s.users.jorge.id, due_at: FUTURE, estimated_hours: -1 })), 'VALIDATION_ERROR:{"estimated_hours":"too_small"}')

    const assigned = await s.demands.assign(s.ctx.cesar, s.id, { assignee_id: s.users.jorge.id, due_at: FUTURE, estimated_hours: 4 })
    assert.equal(assigned.demand.status, 'assigned')
    assert.equal(assigned.assignee.name, 'Jorge')
    assert.equal(assigned.demand.due_at, FUTURE)
    assert.equal(assigned.estimated_hours, 4)
    assert.equal(assigned.status.key, 'TODO')
    const note = s.deps.store.notifications.find((n) => n.userId === s.users.jorge.id)
    assert.equal(note.type, 'assigned')
    const entry = s.deps.store.audit.filter((e) => e.entityId === s.id).at(-1)
    assert.equal(entry.action, 'task.demand_assigned')
    assert.deepEqual(entry.newValue, { assignee: 'Jorge', due_at: FUTURE, estimated_hours: 4, demand_status: 'assigned' })
  })

  it('reatribuir troca quem executa; quem saiu continua vendo; mesma pessoa só troca o prazo', async () => {
    const s = await opened()
    await s.demands.assign(s.ctx.cesar, s.id, { assignee_id: s.users.jorge.id, due_at: FUTURE, estimated_hours: 4 })
    await s.demands.start(s.ctx.jorge, s.id)
    const same = await s.demands.assign(s.ctx.cesar, s.id, { assignee_id: s.users.jorge.id, due_at: '2026-01-22T12:00:00.000Z', estimated_hours: 6 })
    assert.equal(same.demand.status, 'in_progress')
    const moved = await s.demands.assign(s.ctx.cesar, s.id, { assignee_id: s.users.carlos.id, due_at: FUTURE })
    assert.equal(moved.demand.status, 'assigned')
    assert.equal(moved.assignee.name, 'Carlos')
    assert.equal(s.deps.store.audit.filter((e) => e.entityId === s.id).at(-1).action, 'task.demand_reassigned')
    // Jorge saiu da área: continua vendo por ter sido atribuído antes
    s.deps.store.platformSettings.values = { dependency_areas: [{ key: 'ti', name: 'TI', user_ids: [s.users.cesar.id, s.users.carlos.id] }] }
    assert.equal((await s.tasks.getTask(s.ctx.jorge, s.id)).id, s.id)
  })

  it('quem executa começa, passa (com comentário) e conclui (com comentário); quem pediu valida', async () => {
    const s = await opened()
    await s.demands.assign(s.ctx.cesar, s.id, { assignee_id: s.users.jorge.id, due_at: FUTURE, estimated_hours: 4 })
    assert.equal(await codeOf(() => s.demands.start(s.ctx.carlos, s.id)), 'FORBIDDEN')
    const started = await s.demands.start(s.ctx.jorge, s.id)
    assert.equal(started.demand.status, 'in_progress')
    assert.equal(started.status.key, 'DEV')
    assert.ok(started.started_at)
    assert.equal(await codeOf(() => s.demands.start(s.ctx.jorge, s.id)), 'DEMAND_STATE_CONFLICT')

    assert.equal(await codeOf(() => s.demands.pass(s.ctx.jorge, s.id, { assignee_id: s.users.carlos.id })), 'VALIDATION_ERROR:{"comment":"required"}')
    assert.equal(await codeOf(() => s.demands.pass(s.ctx.jorge, s.id, { assignee_id: s.users.fabi.id, comment: 'x' })), 'VALIDATION_ERROR:{"assignee_id":"not_in_team"}')
    assert.equal(await codeOf(() => s.demands.pass(s.ctx.jorge, s.id, { assignee_id: s.users.jorge.id, comment: 'x' })), 'VALIDATION_ERROR:{"assignee_id":"same_assignee"}')
    s.deps.store.notifications.length = 0
    const passed = await s.demands.pass(s.ctx.jorge, s.id, { assignee_id: s.users.carlos.id, comment: 'Carlos já configurou esse servidor.' })
    assert.equal(passed.assignee.name, 'Carlos')
    assert.equal(passed.demand.status, 'assigned')
    assert.deepEqual(
      s.deps.store.notifications.map((n) => `${n.userId === s.users.cesar.id ? 'cesar' : 'carlos'}:${n.type}`).sort(),
      ['carlos:assigned', 'cesar:demand_passed'],
    )
    const passEntry = s.deps.store.audit.filter((e) => e.entityId === s.id).at(-1)
    assert.equal(passEntry.action, 'task.demand_passed')
    assert.equal(passEntry.newValue.note, 'Carlos já configurou esse servidor.')
    assert.equal(passEntry.newValue.assignee, 'Carlos')
    assert.equal(passEntry.oldValue.assignee, 'Jorge')

    assert.equal(await codeOf(() => s.demands.conclude(s.ctx.carlos, s.id, { comment: '  ' })), 'VALIDATION_ERROR:{"comment":"required"}')
    s.deps.store.notifications.length = 0
    const concluded = await s.demands.conclude(s.ctx.carlos, s.id, { comment: 'Publicado no servidor de aplicações.' })
    assert.equal(concluded.demand.status, 'to_validate')
    assert.deepEqual(s.deps.store.notifications.map((n) => n.type), ['demand_concluded', 'demand_concluded'])
    assert.deepEqual(s.deps.store.notifications.map((n) => n.userId).sort(), [s.users.ana.id, s.users.cesar.id].sort())

    assert.equal(await codeOf(() => s.demands.validate(s.ctx.cesar, s.id)), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.demands.returnDemand(s.ctx.ana, s.id, {})), 'VALIDATION_ERROR:{"comment":"required"}')
    const returned = await s.demands.returnDemand(s.ctx.ana, s.id, { comment: 'Falta o filtro por safra.' })
    assert.equal(returned.demand.status, 'in_progress')
    assert.equal(s.deps.store.audit.filter((e) => e.entityId === s.id).at(-1).action, 'task.demand_returned')
    await s.demands.conclude(s.ctx.carlos, s.id, { comment: 'Filtro incluído.' })
    const validated = await s.demands.validate(s.ctx.ana, s.id)
    assert.equal(validated.demand.status, 'done')
    assert.equal(validated.status.key, 'DONE')
    assert.ok(validated.completed_at)
    assert.equal(await codeOf(() => s.demands.assign(s.ctx.cesar, s.id, { assignee_id: s.users.jorge.id, due_at: FUTURE })), 'DEMAND_STATE_CONFLICT')
  })

  it('as ações do detalhe mudam conforme o papel', async () => {
    const s = await opened()
    assert.deepEqual((await s.tasks.getTask(s.ctx.cesar, s.id)).demand.actions, { assign: true, start: false, pass: false, conclude: false, validate: false, return: false })
    assert.deepEqual((await s.tasks.getTask(s.ctx.ana, s.id)).demand.actions, { assign: false, start: false, pass: false, conclude: false, validate: false, return: false })
  })

  it('responsável fora de área atribui a qualquer pessoa ativa', async () => {
    const s = await setup()
    const created = await s.demands.createDemand(s.ctx.ana, newDemand(s, { demand_owner_id: s.users.otto.id }))
    const assigned = await s.demands.assign(s.ctx.otto, created.id, { assignee_id: s.users.fabi.id, due_at: FUTURE })
    assert.equal(assigned.assignee.name, 'Fabi')
  })

  it('a edição comum não mexe no fluxo (status, executor, prazo); título e descrição sim', async () => {
    const s = await opened()
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.cesar, s.id, { status_id: s.statuses.done.id })), 'VALIDATION_ERROR:{"status_id":"demand_flow"}')
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.cesar, s.id, { assignee_id: s.users.jorge.id })), 'VALIDATION_ERROR:{"assignee_id":"demand_flow"}')
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.ana, s.id, { due_date: '2026-03-01' })), 'VALIDATION_ERROR:{"due_date":"demand_flow"}')
    const edited = await s.tasks.updateTask(s.ctx.ana, s.id, { title: 'Novo título', description: 'Mais detalhes', priority_id: s.priorities.high.id })
    assert.equal(edited.title, 'Novo título')
    assert.equal(edited.priority.key, 'ALTA')
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.jorge, s.id, { title: 'x' })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.tasks.moveTask(s.ctx.cesar, s.id, { status_id: s.statuses.dev.id })), 'VALIDATION_ERROR:{"status_id":"demand_flow"}')
  })
})

describe('application/demands — fora das relações', () => {
  it('tarefa de projeto não se relaciona com demanda; a demanda não relaciona nem faz fork', async () => {
    const s = await setup()
    const { createRelationService } = require('../../src/application/relations')
    const relations = createRelationService(s.deps)
    const demand = await s.demands.createDemand(s.ctx.ana, newDemand(s))
    const task = await s.tasks.createTask(s.ctx.cesar, { project_id: s.project.id, task_type_id: s.types.dev.id, title: 'CRM', custom_values: { versao: '1' } })
    assert.equal(await codeOf(() => relations.createRelation(s.ctx.cesar, task.id, { type: 'relates', target_id: demand.id })), 'VALIDATION_ERROR:{"target_id":"invalid_option"}')
    assert.equal(await codeOf(() => relations.createRelation(s.ctx.cesar, demand.id, { type: 'relates', target_id: task.id })), 'FORBIDDEN')
    assert.equal(await codeOf(() => relations.forkTask(s.ctx.cesar, demand.id, { project_id: s.project.id })), 'FORBIDDEN')
  })
})

describe('application/demands — caixas e carga da equipe', () => {
  it('Recebidas, Atribuídas e Pedidas, os números de cada passo e a carga por pessoa', async () => {
    const s = await setup()
    const a = await s.demands.createDemand(s.ctx.ana, newDemand(s, { title: 'A' }))
    const b = await s.demands.createDemand(s.ctx.ana, newDemand(s, { title: 'B' }))
    await s.demands.createDemand(s.ctx.ana, newDemand(s, { title: 'C' }))
    await s.demands.assign(s.ctx.cesar, a.id, { assignee_id: s.users.jorge.id, due_at: FUTURE, estimated_hours: 4 })
    await s.demands.assign(s.ctx.cesar, b.id, { assignee_id: s.users.jorge.id, due_at: FUTURE, estimated_hours: 2.5 })
    await s.demands.start(s.ctx.jorge, b.id)

    const titles = async (name, box) => (await s.demands.listDemands(s.ctx[name], { box })).items.map((t) => t.title).sort()
    assert.deepEqual(await titles('cesar', 'received'), ['A', 'B', 'C'])
    assert.deepEqual(await titles('jorge', 'assigned'), ['A', 'B'])
    assert.deepEqual(await titles('ana', 'requested'), ['A', 'B', 'C'])
    assert.deepEqual(await titles('jorge', 'received'), [])
    assert.deepEqual((await s.demands.listDemands(s.ctx.cesar, { box: 'received', status: 'unassigned' })).items.map((t) => t.title), ['C'])
    assert.equal(await codeOf(() => s.demands.listDemands(s.ctx.cesar, { box: 'x' })), 'VALIDATION_ERROR:{"box":"invalid_option"}')

    const overview = await s.demands.overview(s.ctx.cesar)
    assert.deepEqual(overview.counts.received, { unassigned: 1, assigned: 1, in_progress: 1, to_validate: 0, done: 0 })
    assert.deepEqual(overview.team.map((m) => [m.user.name, m.open_count, m.estimated_hours]), [
      ['Jorge', 2, 6.5],
      ['Carlos', 0, 0],
    ])
    assert.equal((await s.demands.overview(s.ctx.jorge)).counts.assigned.assigned, 1)
  })

  it('Todas (só com projects.view_all): todas as demandas, filtros por responsável e quem executa, números e a carga de todos', async () => {
    const s = await setup()
    const a = await s.demands.createDemand(s.ctx.ana, newDemand(s, { title: 'A' }))
    const b = await s.demands.createDemand(s.ctx.fabi, newDemand(s, { title: 'B', demand_owner_id: s.users.otto.id }))
    await s.demands.createDemand(s.ctx.ana, newDemand(s, { title: 'C' }))
    await s.demands.assign(s.ctx.cesar, a.id, { assignee_id: s.users.jorge.id, due_at: FUTURE, estimated_hours: 4 })
    // Otto fora de área: atribui a qualquer pessoa ativa
    await s.demands.assign(s.ctx.otto, b.id, { assignee_id: s.users.fabi.id, due_at: FUTURE, estimated_hours: 2 })
    await s.demands.start(s.ctx.fabi, b.id)

    const titles = async (name, extra) => (await s.demands.listDemands(s.ctx[name], Object.assign({ box: 'all' }, extra))).items.map((t) => t.title).sort()
    assert.deepEqual(await titles('admin'), ['A', 'B', 'C'])
    assert.deepEqual(await titles('admin', { owner_id: s.users.otto.id }), ['B'])
    assert.deepEqual(await titles('admin', { assignee_id: s.users.jorge.id }), ['A'])
    assert.deepEqual(await titles('admin', { owner_id: s.users.cesar.id, status: 'unassigned' }), ['C'])
    assert.equal(await codeOf(() => s.demands.listDemands(s.ctx.admin, { box: 'all', owner_id: 'x y' })), 'VALIDATION_ERROR:{"owner_id":"invalid_type"}')
    // sem projects.view_all: a caixa Todas é proibida (nem o responsável nem quem pediu a usam)
    assert.equal(await codeOf(() => s.demands.listDemands(s.ctx.cesar, { box: 'all' })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.demands.listDemands(s.ctx.ana, { box: 'all' })), 'FORBIDDEN')

    const overview = await s.demands.overview(s.ctx.admin)
    assert.deepEqual(overview.counts.all, { unassigned: 1, assigned: 1, in_progress: 1, to_validate: 0, done: 0 })
    assert.deepEqual(overview.all_team.map((m) => [m.user.name, m.open_count, m.estimated_hours]), [
      ['Jorge', 1, 4],
      ['Fabi', 1, 2],
    ])
    // quem não vê todas não recebe os números nem a carga de todos
    const mine = await s.demands.overview(s.ctx.cesar)
    assert.equal(mine.counts.all, undefined)
    assert.equal(mine.all_team, undefined)
  })

  it('equipe para atribuir/passar: a área do responsável (ele incluído); quem passa não aparece', async () => {
    const s = await setup()
    const created = await s.demands.createDemand(s.ctx.ana, newDemand(s))
    assert.deepEqual((await s.demands.team(s.ctx.cesar, created.id)).map((u) => u.name), ['Carlos', 'César', 'Jorge'])
    await s.demands.assign(s.ctx.cesar, created.id, { assignee_id: s.users.jorge.id, due_at: FUTURE })
    assert.deepEqual((await s.demands.team(s.ctx.jorge, created.id)).map((u) => u.name), ['Carlos', 'César'])
    assert.equal(await codeOf(() => s.demands.team(s.ctx.ana, created.id)), 'FORBIDDEN')
  })

  it('responsáveis possíveis: qualquer pessoa ativa (busca por nome)', async () => {
    const s = await setup()
    await s.deps.userRepository.update(s.users.otto.id, { status: 'disabled' })
    const names = (await s.demands.owners(s.ctx.ana, { search: '' })).map((u) => u.name)
    assert.ok(names.includes('César'))
    assert.ok(!names.includes('Otto'))
    assert.deepEqual((await s.demands.owners(s.ctx.ana, { search: 'jor' })).map((u) => u.name), ['Jorge'])
  })
})

describe('application/demands — tarefa de projeto com responsável (o mesmo fluxo, ligada ao projeto)', () => {
  /** Projeto Finanças (dono Admin; Ana e Fabi membros). César, Jorge e Carlos (TI) não são membros. */
  async function withProject() {
    const s = await setup()
    const fin = await s.deps.projectRepository.create({ name: 'Finanças', key: 'FIN', ownerId: s.users.admin.id, createdBy: s.users.admin.id, status: 'active', priority: 'medium', kind: '' })
    await s.deps.projectMemberRepository.add({ projectId: fin.id, userId: s.users.ana.id, role: 'member' })
    await s.deps.projectMemberRepository.add({ projectId: fin.id, userId: s.users.fabi.id, role: 'member' })
    const base = { project_id: fin.id, task_type_id: s.types.dev.id, custom_values: { versao: '1' } }
    const task = await s.tasks.createTask(s.ctx.ana, Object.assign({ title: 'Publicar o dashboard', demand_owner_id: s.users.cesar.id }, base))
    const other = await s.tasks.createTask(s.ctx.ana, Object.assign({ title: 'Conciliação bancária', assignee_id: s.users.ana.id }, base))
    return Object.assign(s, { fin, task, other, base })
  }

  it('criar com responsável: fica no projeto, Sem atribuir, e o responsável é avisado', async () => {
    const s = await withProject()
    assert.equal(s.task.code, 'FIN-1')
    assert.deepEqual(s.task.project, { id: s.fin.id, key: 'FIN', name: 'Finanças' })
    assert.equal(s.task.demand.status, 'unassigned')
    assert.equal(s.task.demand.owner.name, 'César')
    assert.deepEqual(s.task.custom_values, { versao: '1' })
    assert.ok(s.deps.store.notifications.some((n) => n.userId === s.users.cesar.id && n.type === 'demand_received' && n.taskId === s.task.id))
    // sem responsável, como sempre
    assert.equal(s.other.demand, null)
    // com responsável, executor e prazo são do fluxo
    assert.equal(
      await codeOf(() => s.tasks.createTask(s.ctx.ana, Object.assign({ title: 'x', demand_owner_id: s.users.cesar.id, assignee_id: s.users.ana.id }, s.base))),
      'VALIDATION_ERROR:{"assignee_id":"demand_flow"}',
    )
  })

  it('responsável e executor de fora do projeto: veem e trabalham só nessa tarefa, não no resto do projeto', async () => {
    const s = await withProject()
    assert.equal((await s.tasks.getTask(s.ctx.cesar, s.task.id)).id, s.task.id)
    assert.equal(await codeOf(() => s.tasks.getTask(s.ctx.cesar, s.other.id)), 'TASK_NOT_FOUND')
    assert.equal(await codeOf(() => s.projects.getProject(s.ctx.cesar, s.fin.id)), 'PROJECT_NOT_FOUND')
    assert.deepEqual((await s.tasks.listTasks(s.ctx.cesar, { project_id: s.fin.id })).items.map((t) => t.code), ['FIN-1'])
    // a equipe do responsável não ganha a tarefa de projeto só por ser da área
    assert.equal(await codeOf(() => s.tasks.getTask(s.ctx.jorge, s.task.id)), 'TASK_NOT_FOUND')

    // só a equipe do responsável recebe — mesmo um membro do projeto de fora da equipe não
    assert.equal(await codeOf(() => s.demands.assign(s.ctx.cesar, s.task.id, { assignee_id: s.users.fabi.id, due_at: FUTURE })), 'VALIDATION_ERROR:{"assignee_id":"not_in_team"}')
    const assigned = await s.demands.assign(s.ctx.cesar, s.task.id, { assignee_id: s.users.jorge.id, due_at: FUTURE, estimated_hours: 3 })
    assert.equal(assigned.assignee.name, 'Jorge')
    assert.equal(assigned.project.key, 'FIN')

    const jorgeSees = await s.tasks.getTask(s.ctx.jorge, s.task.id)
    assert.deepEqual(jorgeSees.capabilities, { edit: true, delete: false, assign: false, link: false, fork: false, comment: true })
    assert.deepEqual(jorgeSees.demand.actions, { assign: false, start: true, pass: true, conclude: true, validate: false, return: false })
    assert.equal(jorgeSees.plan_item, null)
    await s.comments.createComment(s.ctx.jorge, s.task.id, { content: 'Começo amanhã.' })
    assert.equal(await codeOf(() => s.tasks.getTask(s.ctx.jorge, s.other.id)), 'TASK_NOT_FOUND')
    assert.equal(await codeOf(() => s.tasks.deleteTask(s.ctx.jorge, s.task.id)), 'FORBIDDEN')

    await s.demands.start(s.ctx.jorge, s.task.id)
    await s.demands.pass(s.ctx.jorge, s.task.id, { assignee_id: s.users.carlos.id, comment: 'Carlos conhece o servidor.' })
    // Jorge passou e continua vendo
    assert.equal((await s.tasks.getTask(s.ctx.jorge, s.task.id)).assignee.name, 'Carlos')
    await s.demands.conclude(s.ctx.carlos, s.task.id, { comment: 'Publicado.' })
    const done = await s.demands.validate(s.ctx.ana, s.task.id)
    assert.equal(done.demand.status, 'done')
    assert.equal(done.status.key, 'DONE')
  })

  it('aparece nas caixas e na carga da equipe, com o projeto; continua no projeto e nos relatórios', async () => {
    const s = await withProject()
    await s.demands.createDemand(s.ctx.ana, newDemand(s, { title: 'Demanda sem projeto' }))
    await s.demands.assign(s.ctx.cesar, s.task.id, { assignee_id: s.users.jorge.id, due_at: FUTURE, estimated_hours: 3 })
    const received = (await s.demands.listDemands(s.ctx.cesar, { box: 'received' })).items
    assert.deepEqual(received.map((t) => [t.code, t.project ? t.project.name : null]).sort(), [['DEM-1', null], ['FIN-1', 'Finanças']])
    // Todas (admin): a demanda interna e a tarefa de projeto com responsável
    assert.deepEqual((await s.demands.listDemands(s.ctx.admin, { box: 'all' })).items.map((t) => t.code).sort(), ['DEM-1', 'FIN-1'])
    assert.deepEqual((await s.demands.overview(s.ctx.cesar)).team.find((m) => m.user.name === 'Jorge'), { user: received.find((t) => t.code === 'FIN-1').assignee, open_count: 1, estimated_hours: 3 })
    // Com projeto · Sem projeto: a tarefa com responsável é "com projeto"
    const kinds = async (kind) => (await s.tasks.listTasks(s.ctx.admin, { kind })).items.map((t) => t.code).sort()
    assert.deepEqual(await kinds('project'), ['FIN-1', 'FIN-2'])
    assert.deepEqual(await kinds('demand'), ['DEM-1'])
    const report = await s.deps.taskRepository.listForReport({ scope: { userId: s.users.admin.id, viewAll: true }, includeArchived: true, withTitles: true })
    assert.deepEqual(report.map((t) => t.code).sort(), ['FIN-1', 'FIN-2'])
  })

  it('PATCH: pôr o responsável numa tarefa que já existe (sem perder executor e status) e tirar volta ao normal', async () => {
    const s = await withProject()
    const withOwner = await s.tasks.updateTask(s.ctx.ana, s.other.id, { demand_owner_id: s.users.cesar.id })
    assert.equal(withOwner.demand.status, 'assigned')
    assert.equal(withOwner.demand.owner.name, 'César')
    assert.equal(withOwner.assignee.name, 'Ana')
    assert.ok(s.deps.store.notifications.some((n) => n.userId === s.users.cesar.id && n.taskId === s.other.id && n.type === 'demand_received'))
    assert.equal(s.deps.store.audit.filter((e) => e.entityId === s.other.id).at(-1).newValue.demand_owner, 'César')
    // com o fluxo ligado, status e executor só pelo fluxo; o resto edita normal
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.ana, s.other.id, { status_id: s.statuses.done.id })), 'VALIDATION_ERROR:{"status_id":"demand_flow"}')
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.ana, s.other.id, { assignee_id: s.users.fabi.id })), 'VALIDATION_ERROR:{"assignee_id":"demand_flow"}')
    assert.equal((await s.tasks.updateTask(s.ctx.ana, s.other.id, { title: 'Conciliação' })).title, 'Conciliação')
    assert.equal(await codeOf(() => s.tasks.moveTask(s.ctx.ana, s.other.id, { status_id: s.statuses.dev.id })), 'VALIDATION_ERROR:{"status_id":"demand_flow"}')
    // o responsável de fora do projeto não troca o responsável
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.cesar, s.other.id, { demand_owner_id: s.users.otto.id })), 'FORBIDDEN')
    const cleared = await s.tasks.updateTask(s.ctx.ana, s.other.id, { demand_owner_id: null })
    assert.equal(cleared.demand, null)
    assert.equal(cleared.assignee.name, 'Ana')
    assert.equal(await codeOf(() => s.tasks.getTask(s.ctx.cesar, s.other.id)), 'TASK_NOT_FOUND')
    assert.equal((await s.tasks.updateTask(s.ctx.ana, s.other.id, { status_id: s.statuses.dev.id })).status.key, 'DEV')
  })
})
