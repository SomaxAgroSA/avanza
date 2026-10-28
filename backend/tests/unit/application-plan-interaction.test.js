/**
 * Quadro do projeto — GP-2 (interação): arrastar/mover, duplicar, seleção em massa, dependências
 * com regra do quadro e importação de elementos.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createPlanService } = require('../../src/application/plan')
const { createPlanInteractionService } = require('../../src/application/plan-interaction')
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
  const gabi = await seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const mario = await seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  const lia = await seedUser(deps, { roleCode: 'MEMBER', name: 'Lia' })
  const project = await deps.projectRepository.create({ name: 'Clover 6', key: 'CLV', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  for (const [u, role] of [
    [gabi, 'manager'],
    [mario, 'member'],
    [lia, 'viewer'],
  ]) {
    await deps.projectMemberRepository.add({ projectId: project.id, userId: u.id, role })
  }
  const ctx = { gabi: await ctxOf(deps, gabi), mario: await ctxOf(deps, mario), lia: await ctxOf(deps, lia) }
  const plan = createPlanService(deps)
  const gp2 = createPlanInteractionService(deps)
  const board = (who) => plan.getPlan(ctx[who || 'gabi'], project.id)
  const status = async (name) => (await board()).statuses.find((x) => x.name === name)
  const ini = await plan.createGroup(ctx.gabi, project.id, { name: 'Iniciação', color: 'blue' })
  const pl = await plan.createGroup(ctx.gabi, project.id, { name: 'Planejamento', color: 'green' })
  const item = (groupId, name, extra) => plan.createItem(ctx.mario, project.id, Object.assign({ group_id: groupId, name }, extra))
  const names = async (groupId) =>
    (await board())
      .items.filter((i) => i.group_id === groupId && !i.parent_id)
      .sort((a, b) => a.position - b.position)
      .map((i) => i.name)
  const actions = (action) => deps.store.audit.filter((a) => a.action === action)
  return { deps, ctx, project, plan, gp2, board, status, ini, pl, item, names, actions }
}

describe('application/plan-interaction — mover e duplicar', () => {
  it('reordena no grupo (sem histórico), muda de grupo com os subelementos (com histórico) e reordena subelementos', async () => {
    const s = await setup()
    const a = await s.item(s.ini.id, 'A')
    const b = await s.item(s.ini.id, 'B')
    const c = await s.item(s.ini.id, 'C')
    const sub1 = await s.plan.createItem(s.ctx.mario, s.project.id, { parent_id: a.id, name: 'a1' })
    const sub2 = await s.plan.createItem(s.ctx.mario, s.project.id, { parent_id: a.id, name: 'a2' })

    await s.gp2.moveItem(s.ctx.mario, c.id, { next_id: a.id })
    assert.deepEqual(await s.names(s.ini.id), ['C', 'A', 'B'])
    assert.equal(s.actions('plan_item.updated').length, 0)

    await s.gp2.moveItem(s.ctx.mario, a.id, { group_id: s.pl.id })
    assert.deepEqual(await s.names(s.pl.id), ['A'])
    assert.ok((await s.board()).items.filter((i) => i.parent_id === a.id).every((i) => i.group_id === s.pl.id))
    assert.equal(s.actions('plan_item.updated').at(-1).newValue.plan_group, 'Planejamento')

    await s.gp2.moveItem(s.ctx.mario, sub2.id, { next_id: sub1.id })
    const subs = (await s.board()).items.filter((i) => i.parent_id === a.id).sort((x, y) => x.position - y.position)
    assert.deepEqual(subs.map((i) => i.name), ['a2', 'a1'])
    // subelemento não muda de grupo sozinho; leitor não move
    assert.equal(await codeOf(() => s.gp2.moveItem(s.ctx.mario, sub1.id, { group_id: s.ini.id })), 'VALIDATION_ERROR:{"group_id":"follows_parent"}')
    assert.equal(await codeOf(() => s.gp2.moveItem(s.ctx.lia, b.id, { next_id: c.id })), 'FORBIDDEN')
  })

  it('sem folga entre os vizinhos, renumera e mantém a ordem', async () => {
    const s = await setup()
    const a = await s.item(s.ini.id, 'A')
    const b = await s.item(s.ini.id, 'B')
    const c = await s.item(s.ini.id, 'C')
    await s.deps.planItemRepository.update(a.id, { position: 1 })
    await s.deps.planItemRepository.update(b.id, { position: 1 + 1e-7 })
    await s.gp2.moveItem(s.ctx.mario, c.id, { prev_id: a.id })
    assert.deepEqual(await s.names(s.ini.id), ['A', 'C', 'B'])
  })

  it('duplica logo depois do original, com os subelementos e sem as dependências', async () => {
    const s = await setup()
    const a = await s.item(s.ini.id, 'Kickoff', { estimated_hours: 2, status_id: (await s.status('Feito')).id })
    await s.item(s.ini.id, 'Depois')
    await s.plan.createItem(s.ctx.mario, s.project.id, { parent_id: a.id, name: 'Pauta', estimated_hours: 1 })
    const other = await s.item(s.pl.id, 'Outro')
    await s.gp2.createLink(s.ctx.mario, a.id, { type: 'depends_on', item_id: other.id })

    const copy = await s.gp2.duplicateItem(s.ctx.mario, a.id)
    assert.equal(copy.name, 'Kickoff (cópia)')
    assert.equal(copy.estimated_hours, 2)
    assert.deepEqual(await s.names(s.ini.id), ['Kickoff', 'Kickoff (cópia)', 'Depois'])
    assert.deepEqual((await s.board()).items.filter((i) => i.parent_id === copy.id).map((i) => i.name), ['Pauta'])
    assert.equal((await s.board()).links.length, 1)
    assert.equal(s.actions('plan_item.duplicated').length, 1)
  })
})

describe('application/plan-interaction — seleção em massa', () => {
  it('muda o status e acrescenta/tira recursos de vários, numa transação, com histórico de cada um', async () => {
    const s = await setup()
    const r1 = await s.plan.createResource(s.ctx.mario, s.project.id, { name: 'Cliente' })
    const r2 = await s.plan.createResource(s.ctx.mario, s.project.id, { name: 'Consultor' })
    const a = await s.item(s.ini.id, 'A', { resource_ids: [r2.id] })
    const b = await s.item(s.ini.id, 'B')
    const feito = await s.status('Feito')
    const result = await s.gp2.bulkItems(s.ctx.mario, s.project.id, { ids: [a.id, b.id], action: 'update', status_id: feito.id, add_resource_ids: [r1.id], remove_resource_ids: [r2.id] })
    assert.deepEqual(result, { updated: 2 })
    const items = (await s.board()).items
    assert.ok(items.every((i) => i.status_id === feito.id))
    assert.deepEqual(items.find((i) => i.id === a.id).resource_ids, [r1.id])
    assert.equal(s.actions('plan_item.updated').length, 2)
  })

  it('move, duplica e exclui vários; ids de outro projeto ou inexistentes recusam tudo', async () => {
    const s = await setup()
    const a = await s.item(s.ini.id, 'A')
    const b = await s.item(s.ini.id, 'B')
    await s.plan.createItem(s.ctx.mario, s.project.id, { parent_id: a.id, name: 'a1' })
    assert.deepEqual(await s.gp2.bulkItems(s.ctx.mario, s.project.id, { ids: [a.id, b.id], action: 'move', group_id: s.pl.id }), { moved: 2 })
    assert.deepEqual(await s.names(s.pl.id), ['A', 'B'])
    assert.deepEqual(await s.gp2.bulkItems(s.ctx.mario, s.project.id, { ids: [a.id], action: 'duplicate' }), { duplicated: 1 })
    assert.deepEqual(await s.names(s.pl.id), ['A', 'A (cópia)', 'B'])
    assert.equal(await codeOf(() => s.gp2.bulkItems(s.ctx.mario, s.project.id, { ids: [a.id, 'naoexiste'], action: 'delete' })), 'VALIDATION_ERROR:{"ids":"invalid_option"}')
    assert.equal((await s.board()).items.length, 5)
    assert.deepEqual(await s.gp2.bulkItems(s.ctx.mario, s.project.id, { ids: [a.id, b.id], action: 'delete' }), { deleted: 3 })
    assert.deepEqual(await s.names(s.pl.id), ['A (cópia)'])
    assert.equal(await codeOf(() => s.gp2.bulkItems(s.ctx.lia, s.project.id, { ids: [b.id], action: 'delete' })), 'FORBIDDEN')
  })
})

describe('application/plan-interaction — dependências e regra do quadro', () => {
  it('cria "depende de", "bloqueia" e "relacionado"; recusa próprio, repetida e ciclo; o quadro mostra quem está bloqueado', async () => {
    const s = await setup()
    const a = await s.item(s.ini.id, 'Levantamento')
    const b = await s.item(s.ini.id, 'Proposta')
    const c = await s.item(s.pl.id, 'Plano')
    const link = await s.gp2.createLink(s.ctx.mario, b.id, { type: 'depends_on', item_id: a.id })
    assert.deepEqual({ from: link.from_id, to: link.to_id, type: link.type }, { from: a.id, to: b.id, type: 'blocks' })
    await s.gp2.createLink(s.ctx.mario, b.id, { type: 'blocks', item_id: c.id })
    await s.gp2.createLink(s.ctx.mario, a.id, { type: 'relates', item_id: c.id })
    assert.equal(await codeOf(() => s.gp2.createLink(s.ctx.mario, a.id, { type: 'relates', item_id: a.id })), 'VALIDATION_ERROR:{"item_id":"self"}')
    assert.equal(await codeOf(() => s.gp2.createLink(s.ctx.mario, c.id, { type: 'relates', item_id: a.id })), 'VALIDATION_ERROR:{"item_id":"duplicate"}')
    assert.equal(await codeOf(() => s.gp2.createLink(s.ctx.mario, a.id, { type: 'depends_on', item_id: c.id })), 'VALIDATION_ERROR:{"item_id":"cycle"}')
    assert.equal(await codeOf(() => s.gp2.createLink(s.ctx.lia, a.id, { type: 'blocks', item_id: c.id })), 'FORBIDDEN')

    const blocked = async (id) => (await s.board()).items.find((i) => i.id === id).blocked
    assert.equal(await blocked(b.id), true)
    assert.equal(await blocked(c.id), true)
    assert.equal(await blocked(a.id), false)
    await s.plan.updateItem(s.ctx.mario, a.id, { status_id: (await s.status('Feito')).id })
    assert.equal(await blocked(b.id), false)
    assert.equal(s.actions('plan_item.linked').length, 3)
    assert.deepEqual(s.actions('plan_item.linked')[0].newValue, { link_type: 'depends_on', linked_item: 'Levantamento' })

    // desfazer; excluir o elemento apaga as ligações dele
    await s.gp2.deleteLink(s.ctx.mario, link.id)
    assert.equal(s.actions('plan_item.unlinked').length, 1)
    await s.plan.deleteItem(s.ctx.mario, c.id)
    assert.deepEqual((await s.board()).links, [])
  })

  it('regra "impedir" (gestor): não inicia nem conclui com dependência aberta; "só sinalizar" deixa', async () => {
    const s = await setup()
    const a = await s.item(s.ini.id, 'Levantamento')
    const b = await s.item(s.ini.id, 'Proposta')
    await s.gp2.createLink(s.ctx.mario, b.id, { type: 'depends_on', item_id: a.id })
    assert.equal((await s.board()).settings.dependency_rule, 'warn')
    assert.equal(await codeOf(() => s.gp2.updateSettings(s.ctx.mario, s.project.id, { dependency_rule: 'block' })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.gp2.updateSettings(s.ctx.gabi, s.project.id, { dependency_rule: 'x' })), 'VALIDATION_ERROR:{"dependency_rule":"invalid_option"}')
    assert.deepEqual(await s.gp2.updateSettings(s.ctx.gabi, s.project.id, { dependency_rule: 'block' }), { dependency_rule: 'block' })
    assert.equal(s.actions('plan_settings.updated').length, 1)

    assert.equal(await codeOf(async () => s.plan.updateItem(s.ctx.mario, b.id, { status_id: (await s.status('Em progresso')).id })), 'PLAN_DEPENDENCY_PENDING')
    assert.equal(await codeOf(async () => s.gp2.bulkItems(s.ctx.mario, s.project.id, { ids: [b.id], action: 'update', status_id: (await s.status('Feito')).id })), 'PLAN_DEPENDENCY_PENDING')
    // "Parado" não inicia nem conclui: pode
    assert.equal(await codeOf(async () => s.plan.updateItem(s.ctx.mario, b.id, { status_id: (await s.status('Parado')).id })), 'OK')
    await s.plan.updateItem(s.ctx.mario, a.id, { status_id: (await s.status('Feito')).id })
    assert.equal(await codeOf(async () => s.plan.updateItem(s.ctx.mario, b.id, { status_id: (await s.status('Em progresso')).id })), 'OK')

    await s.gp2.updateSettings(s.ctx.gabi, s.project.id, { dependency_rule: 'warn' })
    await s.plan.updateItem(s.ctx.mario, a.id, { status_id: (await s.status('Planejado')).id })
    assert.equal(await codeOf(async () => s.plan.updateItem(s.ctx.mario, b.id, { status_id: (await s.status('Feito')).id })), 'OK')
  })
})

describe('application/plan-interaction — importar elementos', () => {
  it('cria grupos, etiquetas e recursos que faltam (gestor), elementos e subelementos, com um registro no histórico', async () => {
    const s = await setup()
    const result = await s.gp2.importItems(s.ctx.gabi, s.project.id, {
      rows: [
        { group: 'iniciação', name: 'Kickoff', status: 'feito', start_date: '2026-01-26', end_date: '2026-01-27', resources: ['Cliente'], estimated_hours: 1 },
        { group: 'Iniciação', parent: 'Kickoff', name: 'Pauta', estimated_hours: 2 },
        { group: '3.0 Execução', name: 'Configurar ambiente', status: 'Aguardando', resources: ['cliente', 'Consultor'] },
      ],
    })
    assert.deepEqual(result, { created: { groups: 1, statuses: 1, resources: 2, items: 2, subitems: 1 } })
    const board = await s.board()
    assert.deepEqual(board.groups.map((g) => `${g.number} ${g.name}`), ['1.0 Iniciação', '2.0 Planejamento', '3.0 Execução'])
    const kickoff = board.items.find((i) => i.name === 'Kickoff')
    assert.equal(kickoff.status_id, (await s.status('Feito')).id)
    assert.equal(kickoff.duration_days, 2)
    assert.equal(board.items.find((i) => i.name === 'Pauta').parent_id, kickoff.id)
    assert.deepEqual(board.resources.map((r) => r.name), ['Cliente', 'Consultor'])
    assert.equal(s.actions('plan_item.imported').length, 1)
  })

  it('tudo ou nada: aponta a linha e o campo; membro não cria grupo nem etiqueta de status', async () => {
    const s = await setup()
    const rows = [
      { group: 'Iniciação', name: 'Ok' },
      { group: 'Nova fase', name: 'X' },
      { group: 'Iniciação', name: 'Y', status: 'Inexistente' },
      { group: 'Iniciação', parent: 'Sem pai', name: 'Z' },
      { group: 'Iniciação', name: '', progress: 150 },
    ]
    let error
    try {
      await s.gp2.importItems(s.ctx.mario, s.project.id, { rows })
    } catch (err) {
      error = err
    }
    assert.equal(error.code, 'VALIDATION_ERROR')
    assert.deepEqual(error.details.rows, {
      1: { group: 'invalid_option' },
      2: { status: 'invalid_option' },
      3: { parent: 'invalid_option' },
      4: { name: 'required', progress: 'too_large' },
    })
    assert.equal((await s.board()).items.length, 0)
    assert.equal(await codeOf(() => s.gp2.importItems(s.ctx.lia, s.project.id, { rows: [{ group: 'Iniciação', name: 'X' }] })), 'FORBIDDEN')
  })
})
