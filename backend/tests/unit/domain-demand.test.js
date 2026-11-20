const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const demand = require('../../src/domain/demand')
const { createPrincipal } = require('../../src/domain/rbac')

const AREAS = [
  { key: 'ti', name: 'TI', user_ids: ['cesar', 'jorge', 'carlos'] },
  { key: 'fin', name: 'Finanças', user_ids: ['fabi'] },
]

const principal = (userId, permissions) => createPrincipal({ userId, roleId: 'r', roleCode: 'MEMBER', permissions: permissions || ['tasks.view', 'projects.view'] })

function task(extra) {
  return Object.assign({ id: 't1', reporterId: 'ana', demandOwnerId: 'cesar', assigneeId: null, demandStatus: 'unassigned', demandPastAssignees: [] }, extra)
}

describe('domain/demand — projeto de sistema e demanda', () => {
  it('reconhece a caixa das demandas e a tarefa-demanda', () => {
    assert.equal(demand.isSystemProject({ kind: 'demands' }), true)
    assert.equal(demand.isSystemProject({ kind: '' }), false)
    assert.equal(demand.isDemandsProject({ kind: 'demands' }), true)
    assert.equal(demand.isDemandsProject(null), false)
    assert.equal(demand.isDemand(task()), true)
    assert.equal(demand.isDemand({ demandStatus: '' }), false)
  })
})

describe('domain/demand — equipe', () => {
  it('equipe = as outras pessoas da área do responsável', () => {
    assert.deepEqual(demand.teamOf(AREAS, 'cesar'), { ownerId: 'cesar', inArea: true, areaKey: 'ti', areaName: 'TI', memberIds: ['jorge', 'carlos'] })
    assert.deepEqual(demand.teamOf(AREAS, 'fabi').memberIds, [])
  })

  it('responsável fora de área: qualquer pessoa pode receber', () => {
    const team = demand.teamOf(AREAS, 'zeca')
    assert.equal(team.inArea, false)
    assert.equal(demand.canReceive(team, 'jorge'), true)
    assert.equal(demand.canReceive(team, ''), false)
  })

  it('na área: só a equipe ou o próprio responsável recebem', () => {
    const team = demand.teamOf(AREAS, 'cesar')
    assert.equal(demand.canReceive(team, 'jorge'), true)
    assert.equal(demand.canReceive(team, 'cesar'), true)
    assert.equal(demand.canReceive(team, 'fabi'), false)
  })

  it('colegas de área incluem a própria pessoa; fora de área, ninguém', () => {
    assert.deepEqual(demand.areaMatesOf(AREAS, 'jorge'), ['cesar', 'jorge', 'carlos'])
    assert.deepEqual(demand.areaMatesOf(AREAS, 'zeca'), [])
  })
})

describe('domain/demand — visibilidade e acesso', () => {
  const team = demand.teamOf(AREAS, 'cesar')

  it('veem: quem pediu, responsável, atribuída (atual e anterior) e a equipe do responsável', () => {
    const t = task({ assigneeId: 'carlos', demandPastAssignees: ['zeca'] })
    ;['ana', 'cesar', 'carlos', 'zeca', 'jorge'].forEach((id) => assert.equal(demand.seesDemand(t, id, team), true, id))
    assert.equal(demand.seesDemand(t, 'fabi', team), false)
  })

  it('acesso: quem participa colabora; a equipe só vê; projects.view_all vê e colabora', () => {
    const t = task({ assigneeId: 'carlos' })
    assert.equal(demand.demandAccess(principal('ana'), t, team).role, 'member')
    assert.equal(demand.demandAccess(principal('cesar'), t, team).role, 'member')
    assert.equal(demand.demandAccess(principal('carlos'), t, team).role, 'member')
    const mate = demand.demandAccess(principal('jorge'), t, team)
    assert.equal(mate.canView, true)
    assert.equal(mate.role, 'viewer')
    const stranger = demand.demandAccess(principal('fabi'), t, team)
    assert.equal(stranger.canView, false)
    const admin = demand.demandAccess(principal('root', ['tasks.view', 'projects.view', 'projects.view_all']), t, team)
    assert.equal(admin.canView, true)
    assert.equal(admin.isManager, true)
    assert.equal(admin.role, 'member')
  })
})

describe('domain/demand — ações e passos', () => {
  it('só o responsável atribui, até antes de "Para validar"', () => {
    assert.equal(demand.actionIssue('cesar', task(), 'assign'), null)
    assert.equal(demand.actionIssue('jorge', task(), 'assign'), 'FORBIDDEN')
    assert.equal(demand.actionIssue('cesar', task({ demandStatus: 'to_validate', assigneeId: 'jorge' }), 'assign'), 'DEMAND_STATE_CONFLICT')
  })

  it('quem executa começa, passa e conclui; quem pediu valida e devolve', () => {
    const assigned = task({ demandStatus: 'assigned', assigneeId: 'jorge' })
    assert.deepEqual(demand.demandActions('jorge', assigned), { assign: false, start: true, pass: true, conclude: true, validate: false, return: false })
    const running = task({ demandStatus: 'in_progress', assigneeId: 'jorge' })
    assert.deepEqual(demand.demandActions('jorge', running), { assign: false, start: false, pass: true, conclude: true, validate: false, return: false })
    const waiting = task({ demandStatus: 'to_validate', assigneeId: 'jorge' })
    assert.deepEqual(demand.demandActions('ana', waiting), { assign: false, start: false, pass: false, conclude: false, validate: true, return: true })
    assert.equal(demand.actionIssue('jorge', waiting, 'conclude'), 'DEMAND_STATE_CONFLICT')
    assert.equal(demand.actionIssue('carlos', running, 'conclude'), 'FORBIDDEN')
    assert.deepEqual(demand.demandActions('ana', task({ demandStatus: 'done', assigneeId: 'jorge' })), { assign: false, start: false, pass: false, conclude: false, validate: false, return: false })
  })

  it('tarefa de projeto não tem ações de demanda', () => {
    assert.equal(demand.actionIssue('cesar', { demandStatus: '', demandOwnerId: 'cesar' }, 'assign'), 'FORBIDDEN')
  })

  it('passo seguinte: trocar quem executa volta para Atribuída; mesma pessoa mantém o passo', () => {
    assert.equal(demand.nextStatus(task(), 'assign', 'jorge'), 'assigned')
    const running = task({ demandStatus: 'in_progress', assigneeId: 'jorge' })
    assert.equal(demand.nextStatus(running, 'assign', 'jorge'), 'in_progress')
    assert.equal(demand.nextStatus(running, 'assign', 'carlos'), 'assigned')
    assert.equal(demand.nextStatus(running, 'pass', 'carlos'), 'assigned')
    assert.equal(demand.nextStatus(task({ demandStatus: 'assigned' }), 'start'), 'in_progress')
    assert.equal(demand.nextStatus(running, 'conclude'), 'to_validate')
    assert.equal(demand.nextStatus(task({ demandStatus: 'to_validate' }), 'validate'), 'done')
    assert.equal(demand.nextStatus(task({ demandStatus: 'to_validate' }), 'return'), 'in_progress')
  })

  it('quem sai da demanda entra na lista de quem já esteve atribuído (sem repetir)', () => {
    assert.deepEqual(demand.pastAssigneesAfter(task({ assigneeId: 'jorge' }), 'carlos'), ['jorge'])
    assert.deepEqual(demand.pastAssigneesAfter(task({ assigneeId: 'jorge', demandPastAssignees: ['jorge'] }), 'carlos'), ['jorge'])
    assert.deepEqual(demand.pastAssigneesAfter(task({ assigneeId: 'jorge' }), 'jorge'), [])
    assert.deepEqual(demand.pastAssigneesAfter(task(), 'jorge'), [])
  })

  it('comentário obrigatório e com limite', () => {
    assert.equal(demand.noteIssue(''), 'required')
    assert.equal(demand.noteIssue('   '), 'required')
    assert.equal(demand.noteIssue(undefined), 'required')
    assert.equal(demand.noteIssue('x'.repeat(demand.NOTE_MAX + 1)), 'too_long')
    assert.equal(demand.noteIssue('Entreguei a vista.'), null)
  })
})

describe('domain/demand — status do fluxo que acompanha o passo', () => {
  const statuses = [
    { id: 'bk', category: 'backlog', order: 0, isDefault: true, isActive: true },
    { id: 'todo', category: 'todo', order: 1, isActive: true },
    { id: 'dev', category: 'in_progress', order: 2, isActive: true },
    { id: 'hom', category: 'in_progress', order: 3, isActive: true },
    { id: 'old', category: 'done', order: 4, isActive: false },
    { id: 'ok', category: 'done', order: 5, isActive: true },
  ]

  it('cada passo vai para o primeiro status ativo da categoria', () => {
    assert.equal(demand.workflowStatusFor('unassigned', statuses, 'x'), 'bk')
    assert.equal(demand.workflowStatusFor('assigned', statuses, 'x'), 'todo')
    assert.equal(demand.workflowStatusFor('in_progress', statuses, 'x'), 'dev')
    assert.equal(demand.workflowStatusFor('to_validate', statuses, 'x'), 'dev')
    assert.equal(demand.workflowStatusFor('done', statuses, 'x'), 'ok')
  })

  it('sem status da categoria: padrão (atribuída) ou fica o atual', () => {
    const minimal = [{ id: 'bk', category: 'backlog', order: 0, isDefault: true, isActive: true }]
    assert.equal(demand.workflowStatusFor('assigned', minimal, 'x'), 'bk')
    assert.equal(demand.workflowStatusFor('in_progress', minimal, 'x'), 'x')
    assert.equal(demand.workflowStatusFor('done', minimal, 'x'), 'x')
  })
})
