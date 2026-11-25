const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createProjectService } = require('../../src/application/projects')
const { createTeamActivityService } = require('../../src/application/team-activity')
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

async function setup() {
  const deps = createFakeDeps() // relógio em 10/01/2026 12:00
  const projects = createProjectService(deps)
  const ana = await seedUser(deps, { name: 'Angelica', roleCode: 'MANAGER' })
  const douglas = await seedUser(deps, { name: 'Douglas', roleCode: 'MEMBER' })
  const lia = await seedUser(deps, { name: 'Lia', roleCode: 'MEMBER' })
  const ctx = { ana: await ctxOf(deps, ana), douglas: await ctxOf(deps, douglas), lia: await ctxOf(deps, lia) }
  return { deps, projects, users: { ana, douglas, lia }, ctx }
}

describe('application/projects — responsável do projeto', () => {
  it('nasce com quem cria; passa para um membro; leitor ou de fora não; null limpa; histórico com os nomes', async () => {
    const { deps, projects, users, ctx } = await setup()
    const created = await projects.createProject(ctx.ana, { name: 'DRE', key: 'DRE' })
    assert.equal(created.lead.id, users.ana.id)
    await projects.addMember(ctx.ana, created.id, { user_id: users.douglas.id, role: 'member' })
    await projects.addMember(ctx.ana, created.id, { user_id: users.lia.id, role: 'viewer' })

    const updated = await projects.updateProject(ctx.ana, created.id, { lead_id: users.douglas.id })
    assert.equal(updated.lead.name, 'Douglas')
    assert.equal(updated.owner.id, users.ana.id, 'o dono não muda')
    const entry = deps.store.audit.filter((e) => e.action === 'project.updated').pop()
    assert.deepEqual([entry.oldValue.lead, entry.newValue.lead], ['Angelica', 'Douglas'])

    await assert.rejects(() => projects.updateProject(ctx.ana, created.id, { lead_id: users.lia.id }), (err) => err.details.fields.lead_id === 'not_a_member')
    const outsider = await seedUser(deps, { name: 'Otto', roleCode: 'MEMBER' })
    await assert.rejects(() => projects.updateProject(ctx.ana, created.id, { lead_id: outsider.id }), (err) => err.details.fields.lead_id === 'not_a_member')

    assert.equal((await projects.updateProject(ctx.ana, created.id, { lead_id: null })).lead, null)
  })

  it('quem é o responsável e sai do projeto devolve a responsabilidade ao dono', async () => {
    const { deps, projects, users, ctx } = await setup()
    const p = await projects.createProject(ctx.ana, { name: 'FUP', key: 'FUP' })
    await projects.addMember(ctx.ana, p.id, { user_id: users.douglas.id, role: 'member' })
    await projects.updateProject(ctx.ana, p.id, { lead_id: users.douglas.id })
    await projects.removeMember(ctx.ana, p.id, users.douglas.id)
    assert.equal((await projects.getProject(ctx.ana, p.id)).lead.id, users.ana.id)
    const entry = deps.store.audit.filter((e) => e.action === 'project.updated').pop()
    assert.deepEqual([entry.oldValue.lead, entry.newValue.lead], ['Douglas', 'Angelica'])
  })

  it('a lista traz o responsável e ordena por ele', async () => {
    const { projects, users, ctx } = await setup()
    const a = await projects.createProject(ctx.ana, { name: 'Alfa', key: 'ALF' })
    await projects.createProject(ctx.ana, { name: 'Beta', key: 'BET' })
    await projects.addMember(ctx.ana, a.id, { user_id: users.douglas.id, role: 'member' })
    await projects.updateProject(ctx.ana, a.id, { lead_id: users.douglas.id })
    const list = await projects.listProjects(ctx.ana, { sort: '-lead' })
    assert.deepEqual(list.items.map((p) => [p.key, p.lead && p.lead.name]), [
      ['ALF', 'Douglas'],
      ['BET', 'Angelica'],
    ])
  })
})

describe('application/team-activity — Equipo ahora', () => {
  async function scenario() {
    const s = await setup()
    const { deps, projects, users, ctx } = s
    const status = (id, name, category) => deps.store.statuses.push({ id, key: id.toUpperCase(), name, color: 'blue', category, order: 0, isActive: true })
    status('back', 'Backlog', 'backlog')
    status('dev', 'Desarrollo', 'in_progress')
    status('done', 'Concluido', 'done')
    const ds = await projects.createProject(ctx.ana, { name: 'Design System', key: 'DS', status: 'active' })
    const gcs = await projects.createProject(ctx.ana, { name: 'Gestión Comercial', key: 'GCS', status: 'active' })
    const old = await projects.createProject(ctx.ana, { name: 'Cerrado', key: 'OLD', status: 'completed' })
    const secret = await projects.createProject(ctx.douglas.principal.permissions.includes('projects.create') ? ctx.douglas : ctx.ana, { name: 'Secreto', key: 'SEC', status: 'active' })
    for (const p of [ds, gcs, old]) await projects.addMember(ctx.ana, p.id, { user_id: users.douglas.id, role: 'member' })
    const recent = new Date('2026-01-09T10:00:00Z')
    let n = 0
    const task = async (project, statusId, assignee) => {
      n++
      const t = await deps.taskRepository.create({ projectId: project.id, code: `${project.key}-${n}`, title: `Tarea ${n}`, number: n, statusId, assigneeId: assignee.id })
      t.updatedAt = recent // a última mudança da tarefa não conta mais: só as ações da pessoa
      return t
    }
    // o histórico da tarefa com quem fez (o relógio falso das tarefas não acompanha o do serviço)
    let k = 0
    const act = (user, t, action, at, oldValue, newValue) =>
      deps.store.audit.push({ id: `act_${++k}`, entityType: 'task', entityId: t.id, action, oldValue: oldValue || null, newValue: newValue || null, userId: user.id, createdAt: new Date(at) })
    const t1 = await task(ds, 'dev', users.douglas)
    const t2 = await task(ds, 'dev', users.douglas)
    const t3 = await task(ds, 'done', users.douglas)
    const t4 = await task(gcs, 'dev', users.douglas)
    await task(gcs, 'back', users.douglas)
    const t6 = await task(old, 'dev', users.douglas)
    const t7 = await task(gcs, 'done', users.ana)
    await task(gcs, 'done', users.ana) // cerrada y sin acción de Angelica: no cuenta
    const t9 = await task(secret, 'dev', users.lia)
    // Douglas en DS: pasó la 1 a Desarrollo y comentó; adjuntó en la 3 (ya concluida)
    act(users.douglas, t1, 'task.updated', '2026-01-09T10:00:00Z', { task_status: 'Backlog' }, { task_status: 'Desarrollo' })
    act(users.douglas, t1, 'comment.added', '2026-01-09T11:00:00Z', null, { comment: 'Listo para revisar' })
    act(users.douglas, t3, 'attachment.added', '2026-01-08T09:00:00Z', null, { attachments: 'informe.pdf' })
    // Angelica editó la 2 de Douglas: cuenta para ella, no para él
    act(users.ana, t2, 'task.updated', '2026-01-09T12:00:00Z', { title: 'x' }, { title: 'Tarea 2' })
    act(users.ana, t7, 'comment.added', '2026-01-09T09:00:00Z', null, { comment: 'Cerrada' })
    // Douglas en GCS: la última acción es vieja (fuera de la ventana)
    act(users.douglas, t4, 'comment.added', '2025-12-20T10:00:00Z', null, { comment: 'viejo' })
    act(users.douglas, t6, 'task.updated', '2026-01-09T10:00:00Z', { task_status: 'Backlog' }, { task_status: 'Desarrollo' }) // proyecto concluido: fuera
    act(users.lia, t9, 'comment.added', '2026-01-09T10:00:00Z', null, { comment: 'secreto' })
    return Object.assign(s, { ds, gcs, old, secret, t1, t2, t3, service: createTeamActivityService(deps) })
  }

  it('por persona, medido por las acciones propias: trabajando, activo esta semana y en curso pero parado', async () => {
    const s = await scenario()
    const data = await s.service.getTeamActivity(s.ctx.ana)
    assert.equal(data.window_days, 7)
    const douglas = data.people.find((p) => p.user.name === 'Douglas')
    assert.deepEqual(
      douglas.projects.map((p) => [p.project.key, p.state, p.in_progress, p.recent, p.actions, p.open, p.stale]),
      [
        ['DS', 'working', 2, 2, 3, 2, false],
        ['GCS', 'idle', 1, 0, 0, 2, true],
      ],
    )
    // parado: la última acción de Douglas en GCS, aunque sea de antes de la ventana
    assert.equal(douglas.projects[1].last_activity, '2025-12-20T10:00:00.000Z')
    assert.equal(douglas.projects[0].last_activity, '2026-01-09T11:00:00.000Z')
    const ana = data.people.find((p) => p.user.name === 'Angelica')
    assert.deepEqual(ana.projects.map((p) => [p.project.key, p.state, p.recent, p.open]), [
      ['DS', 'active', 1, 0],
      ['GCS', 'active', 1, 0],
    ])
  })

  it('las tareas en que actuó, con la última acción y la fecha, de la más reciente a la más antigua', async () => {
    const s = await scenario()
    const data = await s.service.getTeamActivity(s.ctx.ana)
    const ds = data.people.find((p) => p.user.name === 'Douglas').projects[0]
    assert.deepEqual(
      ds.acted_tasks.map((t) => [t.code, t.action, t.actions, t.in_progress, t.status.name]),
      [
        [s.t1.code, { type: 'commented', excerpt: 'Listo para revisar', at: '2026-01-09T11:00:00.000Z' }, 2, true, 'Desarrollo'],
        [s.t3.code, { type: 'attached', count: 1, at: '2026-01-08T09:00:00.000Z' }, 1, false, 'Concluido'],
      ],
    )
    const anaDs = data.people.find((p) => p.user.name === 'Angelica').projects[0]
    assert.deepEqual(anaDs.acted_tasks.map((t) => [t.code, t.action.type]), [[s.t2.code, 'edited']])
    // las tareas del panel del proyecto: en curso primero (la que tiene acción antes) y la concluida con acción
    assert.deepEqual(ds.tasks.map((t) => [t.code, t.in_progress, t.moved]), [
      [s.t1.code, true, true],
      [s.t2.code, true, false],
      [s.t3.code, false, true],
    ])
    // en GCS (parada) se ve la tarea en curso
    const gcs = data.people.find((p) => p.user.name === 'Douglas').projects[1]
    assert.deepEqual(gcs.tasks.map((t) => t.status.name), ['Desarrollo'])
    assert.deepEqual(gcs.acted_tasks, [])
  })

  it('cambio de estado con de/para', async () => {
    const s = await scenario()
    s.deps.store.audit.push({ id: 'act_last', entityType: 'task', entityId: s.t2.id, action: 'task.updated', oldValue: { task_status: 'Backlog' }, newValue: { task_status: 'Desarrollo' }, userId: s.users.douglas.id, createdAt: new Date('2026-01-10T11:00:00Z') })
    const ds = (await s.service.getTeamActivity(s.ctx.ana)).people.find((p) => p.user.name === 'Douglas').projects[0]
    assert.deepEqual(ds.acted_tasks[0].action, { type: 'status_changed', from: 'Backlog', to: 'Desarrollo', at: '2026-01-10T11:00:00.000Z' })
    assert.equal(ds.recent, 3)
  })

  it('solo proyectos que la persona ve; sin tasks.view, vacío', async () => {
    const s = await scenario()
    // Douglas no es miembro de SEC: Lia no le aparece (ni sus acciones)
    const forDouglas = await s.service.getTeamActivity(s.ctx.douglas)
    assert.equal(forDouglas.people.some((p) => p.user.name === 'Lia'), false)
    assert.ok(forDouglas.people.some((p) => p.user.name === 'Douglas'))
    const noTasks = { ...s.ctx.douglas, principal: { ...s.ctx.douglas.principal, permissions: s.ctx.douglas.principal.permissions.filter((code) => code !== 'tasks.view') } }
    assert.deepEqual((await s.service.getTeamActivity(noTasks)).people, [])
  })

  it('§41: tarefas por projeto (executadas e faltantes) dos projetos abertos que a pessoa vê por inteiro, sem as canceladas', async () => {
    const s = await scenario()
    s.deps.store.statuses.push({ id: 'cancel', key: 'CANCEL', name: 'Cancelada', color: 'gray', category: 'cancelled', order: 0, isActive: true })
    await s.deps.taskRepository.create({ projectId: s.ds.id, code: 'DS-99', title: 'Cancelada', number: 99, statusId: 'cancel', assigneeId: s.users.douglas.id })
    const byKey = async (ctx) => {
      const data = await s.service.getProjectTaskCounts(ctx)
      const keys = { [s.ds.id]: 'DS', [s.gcs.id]: 'GCS', [s.old.id]: 'OLD', [s.secret.id]: 'SEC' }
      return Object.fromEntries(data.projects.map((p) => [keys[p.project_id], [p.done, p.open]]))
    }
    // DS: 1 concluída, 2 en curso; GCS: 2 concluídas, 2 abiertas; OLD (concluido) también cuenta; la cancelada no
    assert.deepEqual(await byKey(s.ctx.douglas), { DS: [1, 2], GCS: [2, 2], OLD: [0, 1] })
    // sin tasks.view, vacío
    const noTasks = { ...s.ctx.douglas, principal: { ...s.ctx.douglas.principal, permissions: s.ctx.douglas.principal.permissions.filter((code) => code !== 'tasks.view') } }
    assert.deepEqual((await s.service.getProjectTaskCounts(noTasks)).projects, [])
  })
})
