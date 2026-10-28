const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createLookupService } = require('../../src/application/lookups')
const { createPrincipal } = require('../../src/domain/rbac')

async function ctxFor(deps, roleCode) {
  const user = await seedUser(deps, { roleCode })
  const role = await deps.roleRepository.findById(user.roleId)
  return {
    principal: createPrincipal({ userId: user.id, roleId: role.id, roleCode, permissions: await deps.roleRepository.getPermissionCodes(role.id) }),
    ip: '1.1.1.1',
    userAgent: 'ua',
    correlationId: 'c',
  }
}

async function setup() {
  const deps = createFakeDeps()
  const statuses = createLookupService(deps, 'status')
  const priorities = createLookupService(deps, 'priority')
  const admin = await ctxFor(deps, 'ADMIN')
  return { deps, statuses, priorities, admin, member: await ctxFor(deps, 'MEMBER'), viewer: await ctxFor(deps, 'VIEWER') }
}

async function codeOf(fn) {
  try {
    await fn()
  } catch (err) {
    return err.code === 'VALIDATION_ERROR' ? `${err.code}:${JSON.stringify(err.details.fields)}` : err.code
  }
  return 'OK'
}

describe('application/lookups (status e prioridades)', () => {
  it('o primeiro item criado vira o padrão; a chave é normalizada', async () => {
    const { deps, statuses, admin } = await setup()
    const backlog = await statuses.create(admin, { key: 'backlog', name: 'Backlog', category: 'backlog', color: 'gray' })
    const dev = await statuses.create(admin, { key: 'EM dev', name: 'Desenvolvimento', category: 'in_progress', color: 'blue' })
    assert.equal(backlog.key, 'BACKLOG')
    assert.equal(backlog.is_default, true)
    assert.equal(dev.key, 'EM_DEV')
    assert.equal(dev.is_default, false)
    assert.deepEqual((await statuses.list(admin, {})).map((s) => [s.key, s.order]), [['BACKLOG', 0], ['EM_DEV', 1]])
    assert.equal(deps.store.audit.at(-1).action, 'status.created')
  })

  it('status exige categoria válida; prioridade não tem categoria', async () => {
    const { statuses, priorities, admin } = await setup()
    assert.equal(await codeOf(() => statuses.create(admin, { key: 'X1', name: 'X', color: 'gray' })), 'VALIDATION_ERROR:{"category":"required"}')
    assert.equal(await codeOf(() => statuses.create(admin, { key: 'X1', name: 'X', category: 'doing', color: 'gray' })), 'VALIDATION_ERROR:{"category":"invalid_option"}')
    const high = await priorities.create(admin, { key: 'HIGH', name: 'Alta', color: 'orange' })
    assert.equal(high.category, undefined)
  })

  it('chave duplicada e chave imutável', async () => {
    const { statuses, admin } = await setup()
    const s = await statuses.create(admin, { key: 'TODO', name: 'A fazer', category: 'todo', color: 'gray' })
    assert.equal(await codeOf(() => statuses.create(admin, { key: 'todo', name: 'Outro', category: 'todo', color: 'gray' })), 'STATUS_KEY_IN_USE')
    assert.equal(await codeOf(() => statuses.update(admin, s.id, { key: 'NOVA' })), 'VALIDATION_ERROR:{"key":"immutable"}')
  })

  it('marcar outro item como padrão desmarca o anterior; o padrão não pode ser desmarcado direto', async () => {
    const { priorities, admin } = await setup()
    const low = await priorities.create(admin, { key: 'LOW', name: 'Baixa', color: 'green' })
    const medium = await priorities.create(admin, { key: 'MEDIUM', name: 'Média', color: 'amber' })
    await priorities.update(admin, medium.id, { is_default: true })
    const list = await priorities.list(admin, {})
    assert.deepEqual(list.map((p) => [p.key, p.is_default]), [['LOW', false], ['MEDIUM', true]])
    assert.equal(await codeOf(() => priorities.update(admin, medium.id, { is_default: false })), 'VALIDATION_ERROR:{"is_default":"default_required"}')
    assert.equal(low.is_default, true)
  })

  it('não desativa nem exclui o padrão; padrão precisa estar ativo', async () => {
    const { statuses, admin } = await setup()
    const backlog = await statuses.create(admin, { key: 'BACKLOG', name: 'Backlog', category: 'backlog', color: 'gray' })
    const off = await statuses.create(admin, { key: 'OLD', name: 'Antigo', category: 'todo', color: 'gray', is_active: false })
    assert.equal(await codeOf(() => statuses.update(admin, backlog.id, { is_active: false })), 'VALIDATION_ERROR:{"is_active":"default_must_be_active"}')
    assert.equal(await codeOf(() => statuses.delete(admin, backlog.id)), 'STATUS_IS_DEFAULT')
    assert.equal(await codeOf(() => statuses.update(admin, off.id, { is_default: true })), 'VALIDATION_ERROR:{"is_default":"default_must_be_active"}')
  })

  it('item em uso por tarefas não pode ser excluído', async () => {
    const { deps, statuses, admin } = await setup()
    await statuses.create(admin, { key: 'BACKLOG', name: 'Backlog', category: 'backlog', color: 'gray' })
    const done = await statuses.create(admin, { key: 'DONE', name: 'Concluído', category: 'done', color: 'green' })
    deps.store.lookupTaskCounts[done.id] = 3
    assert.equal(await codeOf(() => statuses.delete(admin, done.id)), 'STATUS_IN_USE')
    deps.store.lookupTaskCounts[done.id] = 0
    assert.deepEqual(await statuses.delete(admin, done.id), { deleted: true })
    assert.equal(deps.store.audit.at(-1).action, 'status.deleted')
  })

  it('reordenação exige a lista completa', async () => {
    const { statuses, admin } = await setup()
    const a = await statuses.create(admin, { key: 'A1', name: 'A', category: 'todo', color: 'gray' })
    const b = await statuses.create(admin, { key: 'B1', name: 'B', category: 'todo', color: 'gray' })
    assert.equal(await codeOf(() => statuses.reorder(admin, [b.id])), 'VALIDATION_ERROR:{"ids":"invalid_order"}')
    assert.deepEqual((await statuses.reorder(admin, [b.id, a.id])).map((s) => s.key), ['B1', 'A1'])
  })

  it('leitura com tasks.view; inativos e escrita só com settings.manage', async () => {
    const { statuses, admin, member, viewer } = await setup()
    await statuses.create(admin, { key: 'BACKLOG', name: 'Backlog', category: 'backlog', color: 'gray' })
    await statuses.create(admin, { key: 'OLD', name: 'Antigo', category: 'todo', color: 'gray', is_active: false })
    assert.deepEqual((await statuses.list(viewer, { include_inactive: '1' })).map((s) => s.key), ['BACKLOG'])
    assert.deepEqual((await statuses.list(admin, { include_inactive: '1' })).map((s) => s.key), ['BACKLOG', 'OLD'])
    assert.equal(await codeOf(() => statuses.create(member, { key: 'X1', name: 'X', category: 'todo', color: 'gray' })), 'FORBIDDEN')
  })
})
