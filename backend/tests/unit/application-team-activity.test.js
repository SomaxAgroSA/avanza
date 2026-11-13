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
    const stale = new Date('2025-12-20T10:00:00Z')
    let n = 0
    const task = async (project, statusId, assignee, updatedAt) => {
      n++
      const t = await deps.taskRepository.create({ projectId: project.id, code: `${project.key}-${n}`, title: `Tarea ${n}`, number: n, statusId, assigneeId: assignee.id })
      t.updatedAt = updatedAt
      return t
    }
    await task(ds, 'dev', users.douglas, recent) // trabajando
    await task(ds, 'dev', users.douglas, recent)
    await task(ds, 'done', users.douglas, recent) // movió esta semana
    await task(gcs, 'dev', users.douglas, stale) // en curso pero parada
    await task(gcs, 'back', users.douglas, stale)
    await task(old, 'dev', users.douglas, recent) // proyecto concluido: fuera
    await task(gcs, 'done', users.ana, recent) // Angelica: activa esta semana en GCS
    await task(gcs, 'done', users.ana, stale) // cerrada y vieja: no cuenta
    await task(secret, 'dev', users.lia, recent)
    return Object.assign(s, { ds, gcs, old, secret, service: createTeamActivityService(deps) })
  }

  it('por persona: trabajando, activo esta semana y en curso pero parado, con las tareas detrás de los números', async () => {
    const s = await scenario()
    const data = await s.service.getTeamActivity(s.ctx.ana)
    assert.equal(data.window_days, 7)
    const douglas = data.people.find((p) => p.user.name === 'Douglas')
    assert.deepEqual(
      douglas.projects.map((p) => [p.project.key, p.state, p.in_progress, p.recent, p.open, p.stale]),
      [
        ['DS', 'working', 2, 3, 2, false],
        ['GCS', 'idle', 1, 0, 2, true],
      ],
    )
    // las tareas del "+": en DS, las en curso primero y la concluida de la semana después
    assert.deepEqual(douglas.projects[0].tasks.map((t) => [t.in_progress, t.moved]), [
      [true, true],
      [true, true],
      [false, true],
    ])
    // en GCS (parada) se ve la tarea en curso
    assert.deepEqual(douglas.projects[1].tasks.map((t) => t.status.name), ['Desarrollo'])
    const ana = data.people.find((p) => p.user.name === 'Angelica')
    assert.deepEqual(ana.projects.map((p) => [p.project.key, p.state, p.recent]), [['GCS', 'active', 1]])
  })

  it('solo proyectos que la persona ve; sin tasks.view, vacío', async () => {
    const s = await scenario()
    // Douglas no es miembro de SEC: Lia no le aparece
    const forDouglas = await s.service.getTeamActivity(s.ctx.douglas)
    assert.equal(forDouglas.people.some((p) => p.user.name === 'Lia'), false)
    assert.ok(forDouglas.people.some((p) => p.user.name === 'Douglas'))
    const noTasks = { ...s.ctx.douglas, principal: { ...s.ctx.douglas.principal, permissions: s.ctx.douglas.principal.permissions.filter((code) => code !== 'tasks.view') } }
    assert.deepEqual((await s.service.getTeamActivity(noTasks)).people, [])
  })
})
