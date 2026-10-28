const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createTaskService } = require('../../src/application/tasks')
const { createCommentService } = require('../../src/application/comments')
const { createNotificationService } = require('../../src/application/notifications')
const { createTaskTypeService } = require('../../src/application/task-types')
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
    return err.code
  }
  return 'OK'
}

async function setup() {
  const deps = createFakeDeps({ start: new Date('2026-09-29T12:00:00Z') })
  const adminUser = await seedUser(deps, { roleCode: 'ADMIN', name: 'Admin' })
  const u = {
    gabi: await seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' }),
    mario: await seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' }),
    ana: await seedUser(deps, { roleCode: 'MEMBER', name: 'Ana' }),
    lia: await seedUser(deps, { roleCode: 'MEMBER', name: 'Lia' }),
  }
  const admin = await ctxOf(deps, adminUser)
  const project = await deps.projectRepository.create({ name: 'CRM', key: 'CRM', ownerId: u.gabi.id, createdBy: u.gabi.id, status: 'active', priority: 'medium' })
  for (const [user, role] of [
    [u.gabi, 'manager'],
    [u.mario, 'member'],
    [u.ana, 'member'],
    [u.lia, 'viewer'],
  ]) {
    await deps.projectMemberRepository.add({ projectId: project.id, userId: user.id, role })
  }
  const type = await createTaskTypeService(deps).createType(admin, { key: 'DOC', name: 'Documentação' })
  const statuses = createLookupService(deps, 'status')
  await statuses.create(admin, { key: 'TODO', name: 'A fazer', category: 'todo' })
  const dev = await statuses.create(admin, { key: 'DEV', name: 'Desenvolvimento', category: 'in_progress' })
  const done = await statuses.create(admin, { key: 'DONE', name: 'Concluído', category: 'done' })
  await createLookupService(deps, 'priority').create(admin, { key: 'MEDIA', name: 'Média' })
  const ctx = { gabi: await ctxOf(deps, u.gabi), mario: await ctxOf(deps, u.mario), ana: await ctxOf(deps, u.ana), lia: await ctxOf(deps, u.lia) }
  const tasks = createTaskService(deps)
  return {
    deps,
    u,
    ctx,
    project,
    type,
    statuses: { dev, done },
    tasks,
    comments: createCommentService(deps),
    notifications: createNotificationService(deps),
    newTask: (actor, extra) => tasks.createTask(actor, Object.assign({ project_id: project.id, task_type_id: type.id, title: 'Manual' }, extra)),
  }
}

const inbox = async (s, ctx) => (await s.notifications.listNotifications(ctx, {})).items.map((n) => [n.type, n.task.code])

describe('application/notifications — eventos', () => {
  it('atribuir tarefa a outra pessoa notifica; atribuir a si mesmo não', async () => {
    const s = await setup()
    await s.newTask(s.ctx.mario, { assignee_id: s.u.ana.id })
    await s.newTask(s.ctx.mario, { assignee_id: s.u.mario.id })
    assert.deepEqual(await inbox(s, s.ctx.ana), [['assigned', 'CRM-1']])
    assert.deepEqual(await inbox(s, s.ctx.mario), [])
    const [n] = (await s.notifications.listNotifications(s.ctx.ana, {})).items
    assert.equal(n.actor.name, 'Mário')
    assert.equal(n.task.title, 'Manual')
    assert.equal(n.read, false)
  })

  it('mencionar notifica a pessoa (inclusive leitora); comentário avisa responsável e autor, nunca quem comentou', async () => {
    const s = await setup()
    const task = await s.newTask(s.ctx.mario, { assignee_id: s.u.ana.id })
    await s.comments.createComment(s.ctx.gabi, task.id, { content: `@[Lia](${s.u.lia.id}) confere?` })
    assert.deepEqual(await inbox(s, s.ctx.lia), [['mention', 'CRM-1']])
    assert.deepEqual((await inbox(s, s.ctx.ana)).slice(0, 1), [['comment', 'CRM-1']])
    assert.deepEqual(await inbox(s, s.ctx.mario), [['comment', 'CRM-1']])
    assert.deepEqual(await inbox(s, s.ctx.gabi), [])
    const mention = (await s.notifications.listNotifications(s.ctx.lia, {})).items[0]
    assert.equal(mention.data.comment, '@Lia confere?')
  })

  it('mencionar o responsável gera só "menção" (sem duplicar com "comentário")', async () => {
    const s = await setup()
    const task = await s.newTask(s.ctx.mario, { assignee_id: s.u.ana.id })
    await s.comments.createComment(s.ctx.gabi, task.id, { content: `@[Ana](${s.u.ana.id}) veja` })
    assert.deepEqual(await inbox(s, s.ctx.ana), [['mention', 'CRM-1'], ['assigned', 'CRM-1']])
  })

  it('editar comentário notifica só quem passou a ser mencionado', async () => {
    const s = await setup()
    const task = await s.newTask(s.ctx.mario)
    const c = await s.comments.createComment(s.ctx.gabi, task.id, { content: `@[Ana](${s.u.ana.id}) veja` })
    await s.comments.updateComment(s.ctx.gabi, c.id, { content: `@[Ana](${s.u.ana.id}) e @[Lia](${s.u.lia.id}) vejam` })
    assert.equal((await inbox(s, s.ctx.ana)).filter(([type]) => type === 'mention').length, 1)
    assert.deepEqual(await inbox(s, s.ctx.lia), [['mention', 'CRM-1']])
  })

  it('mudança de status avisa responsável e autor (menos quem mudou)', async () => {
    const s = await setup()
    const task = await s.newTask(s.ctx.mario, { assignee_id: s.u.ana.id })
    await s.tasks.updateTask(s.ctx.ana, task.id, { status_id: s.statuses.dev.id })
    assert.deepEqual(await inbox(s, s.ctx.mario), [['status_changed', 'CRM-1']])
    assert.equal((await inbox(s, s.ctx.ana)).some(([type]) => type === 'status_changed'), false)
    assert.equal((await s.notifications.listNotifications(s.ctx.mario, {})).items[0].data.status, 'Desenvolvimento')
  })

  it('quem perdeu acesso ao projeto não recebe', async () => {
    const s = await setup()
    const task = await s.newTask(s.ctx.mario, { assignee_id: s.u.ana.id })
    await s.deps.projectMemberRepository.remove(s.project.id, s.u.mario.id)
    await s.tasks.updateTask(s.ctx.ana, task.id, { status_id: s.statuses.dev.id })
    assert.deepEqual(await inbox(s, s.ctx.mario), [])
  })
})

describe('application/notifications — caixa de entrada', () => {
  it('não lidas, marcar como lida e marcar todas; cada um só vê e mexe nas suas', async () => {
    const s = await setup()
    await s.newTask(s.ctx.mario, { assignee_id: s.u.ana.id })
    await s.newTask(s.ctx.mario, { assignee_id: s.u.ana.id })
    assert.equal((await s.notifications.unreadCount(s.ctx.ana)).count, 2)
    const [first] = (await s.notifications.listNotifications(s.ctx.ana, {})).items
    assert.equal(await codeOf(() => s.notifications.markRead(s.ctx.mario, first.id)), 'NOTIFICATION_NOT_FOUND')
    await s.notifications.markRead(s.ctx.ana, first.id)
    assert.equal((await s.notifications.unreadCount(s.ctx.ana)).count, 1)
    assert.equal((await s.notifications.listNotifications(s.ctx.ana, { unread: '1' })).items.length, 1)
    assert.deepEqual(await s.notifications.markAllRead(s.ctx.ana), { updated: 1 })
    assert.equal((await s.notifications.unreadCount(s.ctx.ana)).count, 0)
  })
})

describe('application/notifications — lembretes de prazo', () => {
  it('prazo amanhã e vencido avisam o responsável uma única vez; tarefa encerrada não', async () => {
    const s = await setup()
    await s.newTask(s.ctx.mario, { assignee_id: s.u.ana.id, title: 'Amanhã', due_date: '2026-09-30' })
    await s.newTask(s.ctx.mario, { assignee_id: s.u.ana.id, title: 'Atrasada', due_date: '2026-09-27' })
    const closed = await s.newTask(s.ctx.mario, { assignee_id: s.u.ana.id, title: 'Feita', due_date: '2026-09-27' })
    await s.tasks.updateTask(s.ctx.mario, closed.id, { status_id: s.statuses.done.id })
    await s.newTask(s.ctx.mario, { title: 'Sem responsável', due_date: '2026-09-30' })

    const now = new Date('2026-09-29T08:00:00Z')
    assert.deepEqual(await s.notifications.sendDueReminders(now), { created: 2 })
    assert.deepEqual(await s.notifications.sendDueReminders(now), { created: 0 })
    const items = (await s.notifications.listNotifications(s.ctx.ana, {})).items.filter((n) => n.type === 'due_soon' || n.type === 'overdue')
    assert.deepEqual(items.map((n) => [n.type, n.task.title]).sort(), [['due_soon', 'Amanhã'], ['overdue', 'Atrasada']])
    assert.equal(items[0].actor, null)
  })
})
