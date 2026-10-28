/**
 * Quadro do projeto — GP-5: colunas personalizadas (gestor define; quem edita preenche).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createPlanService } = require('../../src/application/plan')
const { createPlanInteractionService } = require('../../src/application/plan-interaction')
const { createPlanColumnsService } = require('../../src/application/plan-columns')
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
  const columns = createPlanColumnsService(deps)
  const group = await plan.createGroup(ctx.gabi, project.id, { name: 'Iniciação', color: 'blue' })
  const a = await plan.createItem(ctx.mario, project.id, { group_id: group.id, name: 'Kickoff' })
  const b = await plan.createItem(ctx.mario, project.id, { group_id: group.id, name: 'Plano' })
  const actions = (action) => deps.store.audit.filter((x) => x.action === action)
  const board = (who = 'lia') => plan.getPlan(ctx[who], project.id)
  return { deps, ctx, users: { gabi, mario, lia, otto }, project, plan, columns, group, a, b, actions, board }
}

describe('application/plan-columns — definir colunas (gestor)', () => {
  it('o gestor adiciona colunas; o quadro traz as colunas na ordem; quem não é gestor não mexe', async () => {
    const s = await setup()
    const fornecedor = await s.columns.createColumn(s.ctx.gabi, s.project.id, { name: 'Fornecedor', type: 'text' })
    const custo = await s.columns.createColumn(s.ctx.gabi, s.project.id, { name: 'Custo', type: 'number', settings: { unit: 'R$' } })
    assert.deepEqual([fornecedor.name, fornecedor.type, custo.settings], ['Fornecedor', 'text', { unit: 'R$' }])
    assert.deepEqual((await s.board()).columns.map((c) => c.name), ['Fornecedor', 'Custo'])
    assert.equal(await codeOf(() => s.columns.createColumn(s.ctx.mario, s.project.id, { name: 'X', type: 'text' })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.columns.createColumn(s.ctx.gabi, s.project.id, { name: 'X', type: 'formula' })), 'VALIDATION_ERROR:{"type":"invalid_option"}')
    assert.equal(s.actions('plan_column.created').length, 2)
  })

  it('preencher: quem edita o quadro grava o valor na célula (validado pelo tipo); histórico com o nome da coluna; soma no rodapé', async () => {
    const s = await setup()
    const custo = await s.columns.createColumn(s.ctx.gabi, s.project.id, { name: 'Custo', type: 'number' })
    const fase = await s.columns.createColumn(s.ctx.gabi, s.project.id, { name: 'Fase', type: 'dropdown', settings: { options: [{ name: 'Piloto', color: 'blue' }] } })
    const dono = await s.columns.createColumn(s.ctx.gabi, s.project.id, { name: 'Aprovador', type: 'people' })
    const piloto = fase.settings.options[0].id
    await s.plan.updateItem(s.ctx.mario, s.a.id, { custom: { [custo.id]: 1200.5, [fase.id]: piloto, [dono.id]: s.users.gabi.id } })
    await s.plan.updateItem(s.ctx.mario, s.b.id, { custom: { [custo.id]: 300 } })
    const data = await s.board()
    assert.deepEqual(data.items.find((i) => i.id === s.a.id).custom, { [custo.id]: 1200.5, [fase.id]: piloto, [dono.id]: s.users.gabi.id })
    assert.equal(data.groups[0].summary.custom_sums[custo.id], 1500.5)
    const audit = s.actions('plan_item.updated')[0]
    assert.deepEqual(audit.newValue, { 'cf:Custo': 1200.5, 'cf:Fase': 'Piloto', 'cf:Aprovador': 'Gabi' })

    // limpar, tipo errado, opção que não existe, pessoa de fora, leitor não edita, coluna de outro quadro
    await s.plan.updateItem(s.ctx.mario, s.b.id, { custom: { [custo.id]: null } })
    assert.deepEqual((await s.board()).items.find((i) => i.id === s.b.id).custom, {})
    assert.equal(await codeOf(() => s.plan.updateItem(s.ctx.mario, s.a.id, { custom: { [custo.id]: 'mil' } })), 'VALIDATION_ERROR:{"custom":"invalid_type"}')
    assert.equal(await codeOf(() => s.plan.updateItem(s.ctx.mario, s.a.id, { custom: { [fase.id]: 'nope' } })), 'VALIDATION_ERROR:{"custom":"invalid_option"}')
    assert.equal(await codeOf(() => s.plan.updateItem(s.ctx.mario, s.a.id, { custom: { [dono.id]: s.users.otto.id } })), 'VALIDATION_ERROR:{"custom":"not_member"}')
    assert.equal(await codeOf(() => s.plan.updateItem(s.ctx.mario, s.a.id, { custom: { outra: 'x' } })), 'VALIDATION_ERROR:{"custom":"invalid_option"}')
    assert.equal(await codeOf(() => s.plan.updateItem(s.ctx.lia, s.a.id, { custom: { [custo.id]: 1 } })), 'FORBIDDEN')
    const sub = await s.plan.createItem(s.ctx.mario, s.project.id, { parent_id: s.a.id, name: 'Pauta' })
    assert.equal(await codeOf(() => s.plan.updateItem(s.ctx.mario, sub.id, { custom: { [custo.id]: 1 } })), 'VALIDATION_ERROR:{"custom":"subitems_not_supported"}')
  })

  it('renomear e editar as opções (opção removida limpa os valores); duplicar copia definição e valores; excluir apaga os valores', async () => {
    const s = await setup()
    const fase = await s.columns.createColumn(s.ctx.gabi, s.project.id, { name: 'Fase', type: 'dropdown', settings: { options: [{ name: 'Piloto', color: 'blue' }, { name: 'Produção', color: 'green' }] } })
    const [piloto, producao] = fase.settings.options
    await s.plan.updateItem(s.ctx.mario, s.a.id, { custom: { [fase.id]: piloto.id } })
    await s.plan.updateItem(s.ctx.mario, s.b.id, { custom: { [fase.id]: producao.id } })

    const renamed = await s.columns.updateColumn(s.ctx.gabi, fase.id, { name: 'Etapa', settings: { options: [piloto] } })
    assert.equal(renamed.name, 'Etapa')
    const after = await s.board()
    assert.deepEqual(after.items.find((i) => i.id === s.a.id).custom, { [fase.id]: piloto.id })
    assert.deepEqual(after.items.find((i) => i.id === s.b.id).custom, {})

    const copy = await s.columns.duplicateColumn(s.ctx.gabi, fase.id)
    assert.equal(copy.name, 'Etapa (cópia)')
    assert.equal((await s.board()).items.find((i) => i.id === s.a.id).custom[copy.id], piloto.id)

    await s.columns.deleteColumn(s.ctx.gabi, fase.id)
    const final = await s.board()
    assert.deepEqual(final.columns.map((c) => c.name), ['Etapa (cópia)'])
    assert.deepEqual(Object.keys(final.items.find((i) => i.id === s.a.id).custom), [copy.id])
    assert.equal(await codeOf(() => s.columns.deleteColumn(s.ctx.mario, copy.id)), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.columns.deleteColumn(s.ctx.otto, copy.id)), 'PLAN_COLUMN_NOT_FOUND')
    assert.deepEqual(['plan_column.updated', 'plan_column.duplicated', 'plan_column.deleted'].map((x) => s.actions(x).length), [1, 1, 1])
  })

  it('alterar o tipo: prévia (dry_run) diz quantos valores se perdem sem gravar; ao confirmar converte', async () => {
    const s = await setup()
    const col = await s.columns.createColumn(s.ctx.gabi, s.project.id, { name: 'Valor', type: 'text' })
    await s.plan.updateItem(s.ctx.mario, s.a.id, { custom: { [col.id]: '12,5' } })
    await s.plan.updateItem(s.ctx.mario, s.b.id, { custom: { [col.id]: 'a combinar' } })
    assert.deepEqual(await s.columns.changeType(s.ctx.gabi, col.id, { type: 'number', dry_run: true }), { converted: 1, lost: 1 })
    assert.equal((await s.board()).columns[0].type, 'text')
    const changed = await s.columns.changeType(s.ctx.gabi, col.id, { type: 'number' })
    assert.equal(changed.type, 'number')
    const data = await s.board()
    assert.equal(data.items.find((i) => i.id === s.a.id).custom[col.id], 12.5)
    assert.deepEqual(data.items.find((i) => i.id === s.b.id).custom, {})
    assert.deepEqual(s.actions('plan_column.type_changed')[0].newValue, { column: 'Valor', column_type: 'number', lost_values: 1 })
  })

  it('até 30 colunas por quadro; duplicar o elemento leva os valores', async () => {
    const s = await setup()
    const col = await s.columns.createColumn(s.ctx.gabi, s.project.id, { name: 'Nota', type: 'text' })
    await s.plan.updateItem(s.ctx.mario, s.a.id, { custom: { [col.id]: 'importante' } })
    const copy = await createPlanInteractionService(s.deps).duplicateItem(s.ctx.mario, s.a.id)
    assert.equal((await s.board()).items.find((i) => i.id === copy.id).custom[col.id], 'importante')
    for (let i = 1; i < 30; i++) await s.columns.createColumn(s.ctx.gabi, s.project.id, { name: `C${i}`, type: 'text' })
    assert.equal(await codeOf(() => s.columns.createColumn(s.ctx.gabi, s.project.id, { name: 'Demais', type: 'text' })), 'VALIDATION_ERROR:{"columns":"too_many"}')
  })
})
