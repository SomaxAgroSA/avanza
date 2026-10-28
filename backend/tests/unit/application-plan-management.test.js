/**
 * Quadro do projeto — GP-4: Gestão (Diário e Problemas), linha de base do Cronograma, resumo do quadro
 * (Bateria) e relatório com a saúde do projeto.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createPlanService } = require('../../src/application/plan')
const { createPlanManagementService } = require('../../src/application/plan-management')
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
  deps.locale = 'pt-BR'
  deps.clock = { now: () => new Date('2024-02-10T15:00:00Z') }
  const gabi = await seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const mario = await seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  const lia = await seedUser(deps, { roleCode: 'MEMBER', name: 'Lia' })
  const otto = await seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' })
  const project = await deps.projectRepository.create({ name: 'Clover 6', key: 'CLV', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  for (const [u, role] of [
    [gabi, 'manager'],
    [mario, 'member'],
    [lia, 'viewer'],
  ]) {
    await deps.projectMemberRepository.add({ projectId: project.id, userId: u.id, role })
  }
  const ctx = { gabi: await ctxOf(deps, gabi), mario: await ctxOf(deps, mario), lia: await ctxOf(deps, lia), otto: await ctxOf(deps, otto) }
  const plan = createPlanService(deps)
  const mgmt = createPlanManagementService(deps)
  const actions = (action) => deps.store.audit.filter((a) => a.action === action)
  return { deps, ctx, users: { gabi, mario, lia, otto }, project, plan, mgmt, actions }
}

describe('application/plan-management — diário do projeto', () => {
  it('quem edita o quadro registra; lista do dia mais recente; autor ou gestor edita/exclui; leitor só vê', async () => {
    const s = await setup()
    const first = await s.mgmt.createJournalEntry(s.ctx.mario, s.project.id, { entry_date: '2024-02-01', content: 'Reunião de abertura do projeto.' })
    assert.equal(first.author.name, 'Mário')
    assert.deepEqual(first.capabilities, { edit: true, delete: true })
    await s.mgmt.createJournalEntry(s.ctx.gabi, s.project.id, { entry_date: '2024-02-05', content: 'Plano aprovado pelo patrocinador.' })
    const view = await s.mgmt.listJournal(s.ctx.lia, s.project.id)
    assert.deepEqual(view.entries.map((e) => e.entry_date), ['2024-02-05', '2024-02-01'])
    assert.deepEqual(view.capabilities, { create: false })
    assert.deepEqual(view.entries[1].capabilities, { edit: false, delete: false })

    assert.equal(await codeOf(() => s.mgmt.createJournalEntry(s.ctx.lia, s.project.id, { entry_date: '2024-02-06', content: 'x' })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.mgmt.createJournalEntry(s.ctx.mario, s.project.id, { content: '' })), 'VALIDATION_ERROR:{"entry_date":"required","content":"required"}')
    const other = (await s.mgmt.listJournal(s.ctx.mario, s.project.id)).entries[0]
    assert.equal(await codeOf(() => s.mgmt.updateJournalEntry(s.ctx.mario, other.id, { content: 'Mudei' })), 'FORBIDDEN')
    assert.equal((await s.mgmt.updateJournalEntry(s.ctx.gabi, first.id, { content: 'Reunião de abertura (ata enviada).' })).content, 'Reunião de abertura (ata enviada).')
    await s.mgmt.deleteJournalEntry(s.ctx.mario, first.id)
    assert.equal((await s.mgmt.listJournal(s.ctx.mario, s.project.id)).entries.length, 1)
    assert.equal(await codeOf(() => s.mgmt.listJournal(s.ctx.otto, s.project.id)), 'PROJECT_NOT_FOUND')
    assert.equal(await codeOf(() => s.mgmt.deleteJournalEntry(s.ctx.otto, other.id)), 'PLAN_JOURNAL_NOT_FOUND')
    assert.deepEqual(
      ['plan_journal.created', 'plan_journal.updated', 'plan_journal.deleted'].map((a) => s.actions(a).length),
      [2, 1, 1],
    )
  })
})

describe('application/plan-management — gestão dos problemas', () => {
  it('numerados por projeto; situação e responsável; resolvido guarda o dia; quem abriu ou o gestor exclui', async () => {
    const s = await setup()
    const p1 = await s.mgmt.createIssue(s.ctx.mario, s.project.id, { opened_on: '2024-02-05', description: 'Cliente sem acesso à VPN' })
    const p2 = await s.mgmt.createIssue(s.ctx.gabi, s.project.id, { opened_on: '2024-02-06', description: 'Atraso na entrega do servidor', state: 'in_progress', owner_id: s.users.mario.id })
    assert.deepEqual([p1.number, p1.state, p1.owner], [1, 'pending', null])
    assert.deepEqual([p2.number, p2.owner.name], [2, 'Mário'])
    assert.equal(await codeOf(() => s.mgmt.createIssue(s.ctx.mario, s.project.id, { opened_on: '2024-02-06', description: 'x', owner_id: s.users.otto.id })), 'VALIDATION_ERROR:{"owner_id":"not_member"}')
    assert.equal(await codeOf(() => s.mgmt.createIssue(s.ctx.lia, s.project.id, { opened_on: '2024-02-06', description: 'x' })), 'FORBIDDEN')

    const resolved = await s.mgmt.updateIssue(s.ctx.mario, p2.id, { state: 'resolved' })
    assert.deepEqual([resolved.state, resolved.resolved_on], ['resolved', '2024-02-10'])
    assert.equal((await s.mgmt.updateIssue(s.ctx.mario, p2.id, { state: 'pending' })).resolved_on, null)

    const view = await s.mgmt.listIssues(s.ctx.lia, s.project.id)
    assert.deepEqual(view.issues.map((i) => i.number), [1, 2])
    assert.deepEqual(view.capabilities, { create: false })
    assert.equal(await codeOf(() => s.mgmt.deleteIssue(s.ctx.mario, p2.id)), 'FORBIDDEN')
    await s.mgmt.deleteIssue(s.ctx.mario, p1.id)
    await s.mgmt.deleteIssue(s.ctx.gabi, p2.id)
    assert.equal((await s.mgmt.createIssue(s.ctx.mario, s.project.id, { opened_on: '2024-02-07', description: 'Novo' })).number, 3)
    assert.equal(s.actions('plan_issue.created').length, 3)
    assert.deepEqual(s.actions('plan_issue.updated')[0].newValue, { issue: '#2', issue_state: 'resolved' })
    assert.equal(s.actions('plan_issue.deleted').length, 2)
  })

  it('projeto arquivado: só leitura', async () => {
    const s = await setup()
    await s.deps.projectRepository.update(s.project.id, { archivedAt: new Date() })
    assert.equal(await codeOf(() => s.mgmt.createIssue(s.ctx.gabi, s.project.id, { opened_on: '2024-02-07', description: 'x' })), 'PROJECT_ARCHIVED')
    assert.equal(await codeOf(() => s.mgmt.createJournalEntry(s.ctx.gabi, s.project.id, { entry_date: '2024-02-07', content: 'x' })), 'PROJECT_ARCHIVED')
  })
})

describe('application/plan-management — linha de base, Bateria e relatório', () => {
  async function board(s) {
    const group = await s.plan.createGroup(s.ctx.gabi, s.project.id, { name: 'Iniciação', color: 'blue' })
    const statuses = (await s.plan.getPlan(s.ctx.gabi, s.project.id)).statuses
    const st = (category) => statuses.find((x) => x.category === category).id
    const kickoff = await s.plan.createItem(s.ctx.mario, s.project.id, { group_id: group.id, name: 'Kickoff', status_id: st('done'), start_date: '2024-01-26', end_date: '2024-01-27', estimated_hours: 4 })
    const plano = await s.plan.createItem(s.ctx.mario, s.project.id, { group_id: group.id, name: 'Plano', status_id: st('in_progress'), start_date: '2024-02-01', end_date: '2024-02-05', estimated_hours: 10 })
    return { group, kickoff, plano, st }
  }

  it('o gestor salva a linha de base (cronograma de agora) e limpa; o quadro traz as datas de base e o resumo geral', async () => {
    const s = await setup()
    const b = await board(s)
    assert.equal(await codeOf(() => s.mgmt.saveBaseline(s.ctx.mario, s.project.id)), 'FORBIDDEN')
    assert.deepEqual(await s.mgmt.saveBaseline(s.ctx.gabi, s.project.id), { saved_at: '2024-02-10T15:00:00.000Z', items: 2 })
    await s.plan.updateItem(s.ctx.mario, b.plano.id, { end_date: '2024-02-09' })
    const data = await s.plan.getPlan(s.ctx.lia, s.project.id)
    assert.equal(data.settings.baseline_at, '2024-02-10T15:00:00.000Z')
    const plano = data.items.find((i) => i.id === b.plano.id)
    assert.deepEqual([plano.baseline_start, plano.baseline_end, plano.end_date], ['2024-02-01', '2024-02-05', '2024-02-09'])
    // Bateria: distribuição de status de todo o quadro
    assert.equal(data.summary.items, 2)
    assert.equal(data.summary.estimated_hours, 14)
    assert.deepEqual(data.summary.status_counts.map((c) => c.count).sort(), [1, 1])
    assert.equal(s.actions('plan_settings.baseline_saved').length, 1)

    await s.mgmt.clearBaseline(s.ctx.gabi, s.project.id)
    const cleared = await s.plan.getPlan(s.ctx.lia, s.project.id)
    assert.equal(cleared.settings.baseline_at, null)
    assert.equal(cleared.items[0].baseline_start, null)
    assert.equal(s.actions('plan_settings.baseline_cleared').length, 1)
  })

  it('relatório: hoje no fuso de quem consulta; indicadores, recursos, grupos e saúde com os fatores (inclui os problemas em aberto)', async () => {
    const s = await setup()
    await board(s)
    await s.mgmt.createIssue(s.ctx.mario, s.project.id, { opened_on: '2024-02-05', description: 'VPN' })
    const report = await s.mgmt.getReport(s.ctx.lia, s.project.id, { tz_offset: '180' })
    assert.equal(report.today, '2024-02-10')
    assert.deepEqual(report.summary, { total: 2, done: 1, open: 1, overdue: 1, stuck: 0, canceled: 0, progress: 29 })
    assert.equal(report.groups[0].name, 'Iniciação')
    assert.equal(report.health.factors.find((f) => f.key === 'issues').value, 1)
    assert.equal(report.health.level, 'critical')
    assert.equal((await s.mgmt.getReport(s.ctx.lia, s.project.id, { tz_offset: '-840' })).today, '2024-02-11')
    assert.equal(await codeOf(() => s.mgmt.getReport(s.ctx.lia, s.project.id, { tz_offset: 'x' })), 'VALIDATION_ERROR:{"tz_offset":"invalid_type"}')
    assert.equal(await codeOf(() => s.mgmt.getReport(s.ctx.otto, s.project.id, {})), 'PROJECT_NOT_FOUND')
  })
})
