const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createTaskService } = require('../../src/application/tasks')
const { createTimelineService } = require('../../src/application/timeline')
const { createMilestoneService } = require('../../src/application/milestones')
const { createSprintService } = require('../../src/application/sprints')
const { createRelationService } = require('../../src/application/relations')
const { createLookupService } = require('../../src/application/lookups')
const { createTaskTypeService } = require('../../src/application/task-types')
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

async function setup() {
  const deps = createFakeDeps()
  const adminUser = await seedUser(deps, { roleCode: 'ADMIN', name: 'Admin' })
  const gabi = await seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const mario = await seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  const lia = await seedUser(deps, { roleCode: 'MEMBER', name: 'Lia' })
  const otto = await seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' })
  const admin = await ctxOf(deps, adminUser)
  const project = await deps.projectRepository.create({ name: 'CRM', key: 'CRM', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium', startDate: new Date('2026-10-01T00:00:00Z'), dueDate: new Date('2026-12-15T00:00:00Z') })
  for (const [u, role] of [
    [gabi, 'manager'],
    [mario, 'member'],
    [lia, 'viewer'],
  ]) {
    await deps.projectMemberRepository.add({ projectId: project.id, userId: u.id, role })
  }
  const doc = await createTaskTypeService(deps).createType(admin, { key: 'DOC', name: 'Documentação' })
  const statuses = createLookupService(deps, 'status')
  await statuses.create(admin, { key: 'BACKLOG', name: 'Backlog', category: 'backlog', is_default: true })
  await statuses.create(admin, { key: 'DONE', name: 'Concluído', category: 'done' })
  await createLookupService(deps, 'priority').create(admin, { key: 'MEDIA', name: 'Média', is_default: true })
  const ctx = { admin, gabi: await ctxOf(deps, gabi), mario: await ctxOf(deps, mario), lia: await ctxOf(deps, lia), otto: await ctxOf(deps, otto) }
  const tasks = createTaskService(deps)
  return {
    deps,
    ctx,
    project,
    tasks,
    timeline: createTimelineService(deps),
    milestones: createMilestoneService(deps),
    sprints: createSprintService(deps),
    relations: createRelationService(deps),
    newTask: (title, extra) => tasks.createTask(ctx.mario, Object.assign({ project_id: project.id, task_type_id: doc.id, title }, extra)),
  }
}

describe('application/tasks — início planejado', () => {
  it('grava, mostra e valida início ≤ prazo (na criação e na edição, com o valor já salvo)', async () => {
    const s = await setup()
    const task = await s.newTask('Levantamento', { start_date: '2026-10-01', due_date: '2026-10-05' })
    assert.equal(task.start_date.slice(0, 10), '2026-10-01')
    assert.equal(await codeOf(() => s.newTask('Errada', { start_date: '2026-10-09', due_date: '2026-10-05' })), 'VALIDATION_ERROR:{"start_date":"after_due_date"}')
    // o prazo salvo vale na edição: mover só o início para depois dele é recusado
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.mario, task.id, { start_date: '2026-10-07' })), 'VALIDATION_ERROR:{"start_date":"after_due_date"}')
    const moved = await s.tasks.updateTask(s.ctx.mario, task.id, { start_date: '2026-10-07', due_date: '2026-10-10' })
    assert.deepEqual([moved.start_date.slice(0, 10), moved.due_date.slice(0, 10)], ['2026-10-07', '2026-10-10'])
    const cleared = await s.tasks.updateTask(s.ctx.mario, task.id, { start_date: null })
    assert.equal(cleared.start_date, null)
    // histórico mostra a mudança do início
    const history = s.deps.store.audit.filter((e) => e.entityId === task.id && e.action === 'task.updated')
    assert.ok(history.some((e) => e.newValue.start_date === '2026-10-07'))
  })
})

describe('application/timeline', () => {
  it('traz tarefas com datas, setas de dependência com conflito, sprints e marcos do projeto', async () => {
    const s = await setup()
    const a = await s.newTask('A', { start_date: '2026-10-01', due_date: '2026-10-05' })
    const b = await s.newTask('B', { start_date: '2026-10-03', due_date: '2026-10-08' })
    const c = await s.newTask('C (sem datas)')
    await s.relations.createRelation(s.ctx.mario, a.id, { type: 'blocks', target_id: b.id })
    await s.relations.createRelation(s.ctx.mario, c.id, { type: 'depends_on', target_id: b.id })
    await s.sprints.createSprint(s.ctx.gabi, s.project.id, { name: 'Sprint 1', start_date: '2026-10-01', end_date: '2026-10-14' })
    await s.milestones.createMilestone(s.ctx.gabi, s.project.id, { name: 'Go-live', due_date: '2026-10-20' })

    const t = await s.timeline.getTimeline(s.ctx.mario, s.project.id)
    assert.deepEqual([t.project.key, t.project.start_date.slice(0, 10), t.project.due_date.slice(0, 10)], ['CRM', '2026-10-01', '2026-12-15'])
    assert.deepEqual(t.tasks.map((x) => x.title), ['A', 'B', 'C (sem datas)'])
    assert.deepEqual(
      t.dependencies.map((e) => [e.from, e.to, e.conflict]),
      [
        [a.id, b.id, true],
        [b.id, c.id, false],
      ],
    )
    assert.deepEqual(t.sprints.map((x) => x.name), ['Sprint 1'])
    assert.deepEqual(t.milestones.map((m) => [m.name, m.due_date, m.state]), [['Go-live', '2026-10-20', 'pending']])
    assert.deepEqual(t.capabilities, { edit: true, manage_milestones: false })
    assert.deepEqual((await s.timeline.getTimeline(s.ctx.gabi, s.project.id)).capabilities, { edit: true, manage_milestones: true })
  })

  it('leitor vê sem editar; quem não é do projeto não enxerga', async () => {
    const s = await setup()
    await s.newTask('A', { due_date: '2026-10-05' })
    assert.deepEqual((await s.timeline.getTimeline(s.ctx.lia, s.project.id)).capabilities, { edit: false, manage_milestones: false })
    assert.equal(await codeOf(() => s.timeline.getTimeline(s.ctx.otto, s.project.id)), 'PROJECT_NOT_FOUND')
  })
})

describe('application/milestones', () => {
  it('gestor cria, edita, marca como atingido e exclui; tudo no histórico do projeto', async () => {
    const s = await setup()
    const m = await s.milestones.createMilestone(s.ctx.gabi, s.project.id, { name: '  Homologação  ', due_date: '2026-11-10', description: 'Aceite do cliente' })
    assert.deepEqual([m.name, m.due_date, m.state, m.description], ['Homologação', '2026-11-10', 'pending', 'Aceite do cliente'])
    const done = await s.milestones.updateMilestone(s.ctx.gabi, m.id, { state: 'done', due_date: '2026-11-12' })
    assert.deepEqual([done.state, done.due_date], ['done', '2026-11-12'])
    assert.deepEqual((await s.milestones.listMilestones(s.ctx.lia, s.project.id)).map((x) => x.name), ['Homologação'])
    await s.milestones.deleteMilestone(s.ctx.gabi, m.id)
    assert.equal((await s.milestones.listMilestones(s.ctx.gabi, s.project.id)).length, 0)
    const actions = s.deps.store.audit.filter((e) => e.entityType === 'project' && e.entityId === s.project.id).map((e) => e.action)
    assert.deepEqual(actions.filter((a) => a.startsWith('milestone.')), ['milestone.created', 'milestone.updated', 'milestone.deleted'])
  })

  it('valida e restringe: membro e leitor não gerenciam; quem não vê o projeto recebe 404', async () => {
    const s = await setup()
    assert.equal(await codeOf(() => s.milestones.createMilestone(s.ctx.gabi, s.project.id, { name: '', due_date: '2026-11-10' })), 'VALIDATION_ERROR:{"name":"required"}')
    assert.equal(await codeOf(() => s.milestones.createMilestone(s.ctx.gabi, s.project.id, { name: 'X' })), 'VALIDATION_ERROR:{"due_date":"required"}')
    assert.equal(await codeOf(() => s.milestones.createMilestone(s.ctx.gabi, s.project.id, { name: 'X', due_date: '2026-11-10', state: 'talvez' })), 'VALIDATION_ERROR:{"state":"invalid_option"}')
    assert.equal(await codeOf(() => s.milestones.createMilestone(s.ctx.mario, s.project.id, { name: 'X', due_date: '2026-11-10' })), 'FORBIDDEN')
    const m = await s.milestones.createMilestone(s.ctx.gabi, s.project.id, { name: 'X', due_date: '2026-11-10' })
    assert.equal(await codeOf(() => s.milestones.updateMilestone(s.ctx.lia, m.id, { name: 'Y' })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.milestones.deleteMilestone(s.ctx.otto, m.id)), 'MILESTONE_NOT_FOUND')
  })
})
