const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createProjectService } = require('../../src/application/projects')
const { createPlatformSettingsService } = require('../../src/application/platform-settings')
const { createTiDependenciesService } = require('../../src/application/ti-dependencies')
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

const day = (value) => new Date(`${value}T00:00:00.000Z`)
const without = (ctx, code) => ({ ...ctx, principal: { ...ctx.principal, permissions: ctx.principal.permissions.filter((c) => c !== code) } })

/** Relógio em 10/01/2026 12:00 (UTC). FVB com entregas da TI; DRE com uma tarefa que espera por FVB. */
async function scenario() {
  const deps = createFakeDeps()
  const projects = createProjectService(deps)
  const settings = createPlatformSettingsService(deps)
  const admin = await seedUser(deps, { name: 'Admin', roleCode: 'ADMIN' })
  const ana = await seedUser(deps, { name: 'Angelica', roleCode: 'MANAGER' })
  const victor = await seedUser(deps, { name: 'Equipo de Informática', roleCode: 'MEMBER' })
  const douglas = await seedUser(deps, { name: 'Douglas', roleCode: 'MEMBER' })
  const lia = await seedUser(deps, { name: 'Lia', roleCode: 'VIEWER' })
  const itDre = await seedUser(deps, { name: 'TI do DRE', roleCode: 'MEMBER' })
  const ctx = { admin: await ctxOf(deps, admin), ana: await ctxOf(deps, ana), douglas: await ctxOf(deps, douglas), lia: await ctxOf(deps, lia), itDre: await ctxOf(deps, itDre) }

  const status = (id, category) => deps.store.statuses.push({ id, key: id.toUpperCase(), name: id, color: 'blue', category, order: 0, isActive: true })
  status('todo', 'todo')
  status('done', 'done')
  const fvb = await projects.createProject(ctx.ana, { name: 'Fuerza de Ventas Brasil', key: 'FVB', status: 'active', due_date: '2026-03-31' })
  const dre = await projects.createProject(ctx.ana, { name: 'DRE Somax Paraguay', key: 'DRE', status: 'active' })
  const secret = await projects.createProject(ctx.ana, { name: 'Secreto', key: 'SEC', status: 'active' })
  // Victor é gestor do FVB (não Responsável TI): só a lista "Pessoas de TI" o cobre
  await projects.addMember(ctx.ana, fvb.id, { user_id: victor.id, role: 'manager' })
  await projects.addMember(ctx.ana, fvb.id, { user_id: douglas.id, role: 'member' })
  await projects.addMember(ctx.ana, dre.id, { user_id: douglas.id, role: 'member' })
  await projects.addMember(ctx.ana, dre.id, { user_id: itDre.id, role: 'it' })
  await projects.addMember(ctx.ana, fvb.id, { user_id: lia.id, role: 'viewer' })
  await projects.addMember(ctx.ana, dre.id, { user_id: lia.id, role: 'viewer' })

  let n = 0
  const task = async (project, assignee, extra) => {
    n++
    return deps.taskRepository.create(
      Object.assign({ projectId: project.id, code: `${project.key}-${n}`, title: `Tarefa ${n}`, number: n, statusId: 'todo', assigneeId: assignee ? assignee.id : null, createdAt: day('2026-01-05') }, extra || {}),
    )
  }
  const sso = await task(fvb, victor) // sem prazo
  const azure = await task(fvb, victor, { dueDate: day('2026-04-10') }) // depois do encerramento (31/03)
  await task(fvb, victor, { statusId: 'done' }) // concluída: não é entrega pendente
  const security = await task(fvb, douglas, { dueDate: day('2026-01-11') })
  const dashboard = await task(dre, douglas, { dueDate: day('2026-01-12') })
  const dreIt = await task(dre, itDre, { dueDate: day('2026-01-09') }) // Responsável TI do DRE: vencida
  const hidden = await task(secret, douglas)
  deps.store.relations.push(
    { id: 'r1', type: 'depends_on', sourceId: dashboard.id, targetId: sso.id, createdAt: new Date() },
    { id: 'r2', type: 'relates', sourceId: sso.id, targetId: security.id, createdAt: new Date() },
    { id: 'r3', type: 'blocks', sourceId: azure.id, targetId: hidden.id, createdAt: new Date() }, // SEC: Douglas não vê
  )
  await settings.updateItPeople(ctx.admin, { user_ids: [victor.id] })
  return { deps, settings, service: createTiDependenciesService(deps), ctx, users: { admin, ana, victor, douglas, lia, itDre }, fvb, dre, secret, tasks: { sso, azure, security, dashboard, dreIt, hidden } }
}

describe('application/ti-dependencies — Dependências de TI (§42)', () => {
  it('entregas da TI (lista da plataforma + Responsável TI do projeto), bloqueadas de outro projeto e a validar', async () => {
    const s = await scenario()
    const data = await s.service.getTiDependencies(s.ctx.douglas, {})
    assert.equal(data.today, '2026-01-10')
    const byKey = Object.fromEntries(data.projects.map((p) => [p.project.key, p]))
    assert.deepEqual(Object.keys(byKey).sort(), ['DRE', 'FVB'])
    assert.deepEqual(
      byKey.FVB.deliveries.map((d) => [d.code, d.risk]),
      [
        [s.tasks.azure.code, 'after_project_due'],
        [s.tasks.sso.code, 'none_due'],
      ],
    )
    assert.equal(byKey.FVB.deliveries.find((d) => d.code === s.tasks.sso.code).blocks, 1)
    assert.deepEqual(byKey.FVB.pending.map((p) => [p.code, p.related_to.code, p.relation_id, p.can_confirm]), [[s.tasks.security.code, s.tasks.sso.code, 'r2', true]])
    assert.deepEqual(byKey.DRE.blocked.map((b) => [b.code, b.waiting_on[0].code, b.waiting_on[0].project.key]), [[s.tasks.dashboard.code, s.tasks.sso.code, 'FVB']])
    assert.deepEqual(byKey.DRE.deliveries.map((d) => [d.code, d.risk]), [[s.tasks.dreIt.code, 'overdue']])
    // o bloqueio no projeto que Douglas não vê não aparece
    assert.equal(JSON.stringify(data).includes(s.tasks.hidden.code), false)
    assert.deepEqual(data.people.map((u) => u.name), ['Equipo de Informática', 'TI do DRE'])
    assert.equal(data.totals.blocked, 1)
    assert.equal(data.totals.projects, 2)
  })

  it('project_ids recorta os blocos; o fuso muda o "hoje"', async () => {
    const s = await scenario()
    const only = await s.service.getTiDependencies(s.ctx.douglas, { project_ids: s.dre.id })
    assert.deepEqual(only.projects.map((p) => p.project.key), ['DRE'])
    assert.equal(only.totals.projects, 1)
    assert.equal(only.totals.pending, 0)
    // 10/01 12:00 UTC com +14h = 11/01 no fuso de quem consulta (tz_offset = -840)
    assert.equal((await s.service.getTiDependencies(s.ctx.douglas, { tz_offset: '-840' })).today, '2026-01-11')
    await assert.rejects(() => s.service.getTiDependencies(s.ctx.douglas, { project_ids: 'x;y' }), (err) => err.code === 'VALIDATION_ERROR')
  })

  it('quem só vê não confirma; sem tasks.view, vazio; o Responsável TI (acesso limitado) não recebe o projeto', async () => {
    const s = await scenario()
    const viewer = await s.service.getTiDependencies(s.ctx.lia, {})
    assert.equal(viewer.projects.find((p) => p.project.key === 'FVB').pending[0].can_confirm, false)
    assert.deepEqual((await s.service.getTiDependencies(without(s.ctx.douglas, 'tasks.view'), {})).projects, [])
    const it = await s.service.getTiDependencies(s.ctx.itDre, {})
    assert.equal(it.projects.some((p) => p.project.key === 'DRE'), false)
  })

  it('sem nenhuma pessoa de TI configurada, só o Responsável TI de cada projeto conta', async () => {
    const s = await scenario()
    await s.settings.updateItPeople(s.ctx.admin, { user_ids: [] })
    const data = await s.service.getTiDependencies(s.ctx.douglas, {})
    assert.deepEqual(data.projects.map((p) => p.project.key), ['DRE'])
    assert.deepEqual(data.projects[0].blocked, [])
  })
})

describe('application/platform-settings — Pessoas de TI', () => {
  it('settings.manage lê e troca a lista; histórico com os nomes; usuário inexistente recusado', async () => {
    const s = await scenario()
    const current = await s.settings.getItPeople(s.ctx.admin)
    assert.deepEqual(current.users.map((u) => u.name), ['Equipo de Informática'])
    assert.ok(current.candidates.some((u) => u.name === 'Douglas'))
    const saved = await s.settings.updateItPeople(s.ctx.admin, { user_ids: [s.users.victor.id, s.users.douglas.id, s.users.victor.id] })
    assert.deepEqual(saved.user_ids, [s.users.victor.id, s.users.douglas.id])
    const entry = s.deps.store.audit.filter((e) => e.action === 'platform_settings.update').pop()
    assert.deepEqual(entry.oldValue, { it_people: ['Equipo de Informática'] })
    assert.deepEqual(entry.newValue, { it_people: ['Douglas', 'Equipo de Informática'] })
    await assert.rejects(() => s.settings.updateItPeople(s.ctx.admin, { user_ids: ['nao_existe'] }), (err) => err.details.fields.user_ids === 'invalid_option')
    await assert.rejects(() => s.settings.updateItPeople(s.ctx.admin, { user_ids: 'x' }), (err) => err.details.fields.user_ids === 'invalid_type')
    await assert.rejects(() => s.settings.updateItPeople(s.ctx.ana, { user_ids: [] }), (err) => err.code === 'FORBIDDEN')
    await assert.rejects(() => s.settings.getItPeople(s.ctx.ana), (err) => err.code === 'FORBIDDEN')
  })

  it('a configuração geral (platform.manage) não troca a lista e não a perde ao salvar outra coisa', async () => {
    const s = await scenario()
    await assert.rejects(() => s.settings.updateSettings(s.ctx.admin, { it_people: [] }), (err) => err.details.fields.it_people === 'unknown_field')
    await s.settings.updateSettings(s.ctx.admin, { platform_name: 'Avanza Somax' })
    assert.deepEqual((await s.settings.getItPeople(s.ctx.admin)).user_ids, [s.users.victor.id])
    const general = s.deps.store.audit.filter((e) => e.action === 'platform_settings.update').pop()
    assert.deepEqual(Object.keys(general.newValue), ['platform_name'])
  })
})
