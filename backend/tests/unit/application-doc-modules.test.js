const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createDocModuleService } = require('../../src/application/doc-modules')
const { createDocSpaceService } = require('../../src/application/doc-spaces')
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
  const gabi = await seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const mario = await seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  const otto = await seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' })
  const project = await deps.projectRepository.create({ name: 'CRM', key: 'CRM', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  await deps.projectMemberRepository.add({ projectId: project.id, userId: gabi.id, role: 'manager' })
  await deps.projectMemberRepository.add({ projectId: project.id, userId: mario.id, role: 'member' })
  const ctx = { gabi: await ctxOf(deps, gabi), mario: await ctxOf(deps, mario), otto: await ctxOf(deps, otto) }
  return { deps, ctx, project, modules: createDocModuleService(deps), spaces: createDocSpaceService(deps) }
}

const actions = (deps) => deps.store.audit.filter((e) => e.entityType === 'doc_module').map((e) => e.action)

describe('application/doc-modules', () => {
  it('quem gerencia a documentação cria módulos (no fim da lista); nome único sem diferença de maiúsculas e acentos', async () => {
    const s = await setup()
    const mkt = await s.modules.createModule(s.ctx.gabi, { name: '  Marketing ', color: 'pink' })
    assert.deepEqual([mkt.name, mkt.color, mkt.position, mkt.space_count], ['Marketing', 'pink', 0, 0])
    const ope = await s.modules.createModule(s.ctx.gabi, { name: 'Operações' })
    assert.deepEqual([ope.position, ope.color], [1, 'blue'])
    assert.equal(await codeOf(() => s.modules.createModule(s.ctx.gabi, { name: 'MARKETING' })), 'DOC_MODULE_NAME_IN_USE')
    assert.equal(await codeOf(() => s.modules.createModule(s.ctx.gabi, { name: 'operacoes' })), 'DOC_MODULE_NAME_IN_USE')
    assert.equal(await codeOf(() => s.modules.createModule(s.ctx.gabi, { name: '   ' })), 'VALIDATION_ERROR:{"name":"required"}')
    assert.equal(await codeOf(() => s.modules.createModule(s.ctx.gabi, { name: 'x'.repeat(61) })), 'VALIDATION_ERROR:{"name":"too_long"}')
    assert.equal(await codeOf(() => s.modules.createModule(s.ctx.gabi, { name: 'TI', color: 'neon' })), 'VALIDATION_ERROR:{"color":"invalid_option"}')
    assert.equal(await codeOf(() => s.modules.createModule(s.ctx.mario, { name: 'Finanças' })), 'FORBIDDEN')
    assert.deepEqual(actions(s.deps), ['doc_module.created', 'doc_module.created'])
    // qualquer pessoa com docs.view lista
    assert.deepEqual((await s.modules.listModules(s.ctx.otto)).map((m) => m.name), ['Marketing', 'Operações'])
  })

  it('lista com a contagem de espaços que a pessoa vê', async () => {
    const s = await setup()
    const mkt = await s.modules.createModule(s.ctx.gabi, { name: 'Marketing' })
    await s.spaces.createSpace(s.ctx.gabi, { key: 'MKT', name: 'Campanhas', visibility: 'company', module_id: mkt.id })
    await s.spaces.createSpace(s.ctx.gabi, { key: 'CRMDOC', name: 'Docs do CRM', visibility: 'project', project_id: s.project.id, module_id: mkt.id })
    assert.equal((await s.modules.listModules(s.ctx.mario))[0].space_count, 2)
    // Otto não participa do projeto: só conta o espaço da empresa
    assert.equal((await s.modules.listModules(s.ctx.otto))[0].space_count, 1)
  })

  it('renomeia, troca a cor e reordena; renomear para um nome em uso falha', async () => {
    const s = await setup()
    const a = await s.modules.createModule(s.ctx.gabi, { name: 'Comercial' })
    const b = await s.modules.createModule(s.ctx.gabi, { name: 'Finanças' })
    const c = await s.modules.createModule(s.ctx.gabi, { name: 'TI' })
    const renamed = await s.modules.updateModule(s.ctx.gabi, b.id, { name: 'Financeiro', color: 'green' })
    assert.deepEqual([renamed.name, renamed.color], ['Financeiro', 'green'])
    assert.equal(await codeOf(() => s.modules.updateModule(s.ctx.gabi, c.id, { name: 'comercial' })), 'DOC_MODULE_NAME_IN_USE')
    // o próprio nome com outra grafia não conflita
    assert.equal((await s.modules.updateModule(s.ctx.gabi, a.id, { name: 'COMERCIAL' })).name, 'COMERCIAL')
    const moved = await s.modules.updateModule(s.ctx.gabi, c.id, { position: 0 })
    assert.equal(moved.position, 0)
    assert.deepEqual((await s.modules.listModules(s.ctx.otto)).map((m) => [m.name, m.position]), [
      ['TI', 0],
      ['COMERCIAL', 1],
      ['Financeiro', 2],
    ])
    assert.equal(await codeOf(() => s.modules.updateModule(s.ctx.gabi, c.id, { position: -1 })), 'VALIDATION_ERROR:{"position":"invalid_type"}')
    assert.equal(await codeOf(() => s.modules.updateModule(s.ctx.mario, c.id, { name: 'X' })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.modules.updateModule(s.ctx.gabi, 'nada', { name: 'X' })), 'DOC_MODULE_NOT_FOUND')
    const updated = s.deps.store.audit.filter((e) => e.action === 'doc_module.updated')
    assert.deepEqual(updated[0].newValue, { name: 'Financeiro', color: 'green' })
    assert.deepEqual(updated[2].oldValue, { position: 2 })
    assert.deepEqual(updated[2].newValue, { position: 0 })
  })

  it('excluir leva os espaços para "Sem módulo" e grava quantos foram', async () => {
    const s = await setup()
    const mkt = await s.modules.createModule(s.ctx.gabi, { name: 'Marketing' })
    const space = await s.spaces.createSpace(s.ctx.gabi, { key: 'MKT', name: 'Campanhas', visibility: 'company', module_id: mkt.id })
    assert.deepEqual(space.module, { id: mkt.id, name: 'Marketing', color: 'blue' })
    assert.equal(await codeOf(() => s.modules.deleteModule(s.ctx.mario, mkt.id)), 'FORBIDDEN')
    assert.deepEqual(await s.modules.deleteModule(s.ctx.gabi, mkt.id), { deleted: true, spaces: 1 })
    assert.equal((await s.spaces.getSpace(s.ctx.otto, 'MKT')).space.module, null)
    assert.deepEqual(await s.modules.listModules(s.ctx.otto), [])
    const removed = s.deps.store.audit.find((e) => e.action === 'doc_module.deleted')
    assert.deepEqual(removed.oldValue, { name: 'Marketing', color: 'blue', spaces: 1 })
    assert.equal(await codeOf(() => s.modules.deleteModule(s.ctx.gabi, mkt.id)), 'DOC_MODULE_NOT_FOUND')
  })
})

describe('application/doc-spaces — módulo do espaço', () => {
  it('cria já no módulo, troca e tira (vai no histórico); módulo inexistente falha', async () => {
    const s = await setup()
    const mkt = await s.modules.createModule(s.ctx.gabi, { name: 'Marketing', color: 'pink' })
    const fin = await s.modules.createModule(s.ctx.gabi, { name: 'Finanças', color: 'green' })
    const created = await s.spaces.createSpace(s.ctx.gabi, { key: 'MKT', name: 'Campanhas', visibility: 'company', module_id: mkt.id })
    assert.deepEqual(created.module, { id: mkt.id, name: 'Marketing', color: 'pink' })
    assert.equal(await codeOf(() => s.spaces.createSpace(s.ctx.gabi, { key: 'OUTRO', name: 'Outro', visibility: 'company', module_id: 'nada' })), 'DOC_MODULE_NOT_FOUND')

    const moved = await s.spaces.updateSpace(s.ctx.gabi, created.id, { module_id: fin.id })
    assert.deepEqual(moved.module, { id: fin.id, name: 'Finanças', color: 'green' })
    const audit = s.deps.store.audit.filter((e) => e.action === 'doc_space.updated').pop()
    assert.deepEqual([audit.oldValue, audit.newValue], [{ module: 'Marketing' }, { module: 'Finanças' }])

    assert.equal((await s.spaces.updateSpace(s.ctx.gabi, created.id, { module_id: '' })).module, null)
    assert.equal((await s.spaces.updateSpace(s.ctx.gabi, created.id, { module_id: mkt.id })).module.id, mkt.id)
    assert.equal((await s.spaces.updateSpace(s.ctx.gabi, created.id, { module_id: null })).module, null)
    assert.equal(await codeOf(() => s.spaces.updateSpace(s.ctx.gabi, created.id, { module_id: 'nada' })), 'DOC_MODULE_NOT_FOUND')
    // a lista traz o módulo de cada espaço
    await s.spaces.updateSpace(s.ctx.gabi, created.id, { module_id: fin.id })
    assert.deepEqual((await s.spaces.listSpaces(s.ctx.otto)).map((x) => [x.key, x.module && x.module.name]), [['MKT', 'Finanças']])
  })

  it('mover para outro módulo exige configurar o espaço (gestor do projeto, no espaço de projeto)', async () => {
    const s = await setup()
    const mkt = await s.modules.createModule(s.ctx.gabi, { name: 'Marketing' })
    const space = await s.spaces.createSpace(s.ctx.gabi, { key: 'CRMDOC', name: 'Docs do CRM', visibility: 'project', project_id: s.project.id })
    assert.equal(space.module, null)
    // Mário edita páginas, mas não configura o espaço
    assert.equal(await codeOf(() => s.spaces.updateSpace(s.ctx.mario, space.id, { module_id: mkt.id })), 'FORBIDDEN')
    assert.equal((await s.spaces.updateSpace(s.ctx.gabi, space.id, { module_id: mkt.id })).module.name, 'Marketing')
  })
})
