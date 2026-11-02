const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createLookupService } = require('../../pb_hooks/src/application/lookups')
const { createPrincipal } = require('../../pb_hooks/src/domain/rbac')

function ctxFor(deps, roleCode) {
  const user = seedUser(deps, { roleCode })
  const role = deps.roleRepository.findById(user.roleId)
  return {
    principal: createPrincipal({ userId: user.id, roleId: role.id, roleCode, permissions: deps.roleRepository.getPermissionCodes(role.id) }),
    ip: '1.1.1.1',
    userAgent: 'ua',
    correlationId: 'c',
  }
}

function setup() {
  const deps = createFakeDeps()
  const statuses = createLookupService(deps, 'status')
  const priorities = createLookupService(deps, 'priority')
  const admin = ctxFor(deps, 'ADMIN')
  return { deps, statuses, priorities, admin, member: ctxFor(deps, 'MEMBER'), viewer: ctxFor(deps, 'VIEWER') }
}

function codeOf(fn) {
  try {
    fn()
  } catch (err) {
    return err.code === 'VALIDATION_ERROR' ? `${err.code}:${JSON.stringify(err.details.fields)}` : err.code
  }
  return 'OK'
}

describe('application/lookups (status e prioridades)', () => {
  it('o primeiro item criado vira o padrão; a chave é normalizada', () => {
    const { deps, statuses, admin } = setup()
    const backlog = statuses.create(admin, { key: 'backlog', name: 'Backlog', category: 'backlog', color: 'gray' })
    const dev = statuses.create(admin, { key: 'EM dev', name: 'Desenvolvimento', category: 'in_progress', color: 'blue' })
    assert.equal(backlog.key, 'BACKLOG')
    assert.equal(backlog.is_default, true)
    assert.equal(dev.key, 'EM_DEV')
    assert.equal(dev.is_default, false)
    assert.deepEqual(statuses.list(admin, {}).map((s) => [s.key, s.order]), [['BACKLOG', 0], ['EM_DEV', 1]])
    assert.equal(deps.store.audit.at(-1).action, 'status.created')
  })

  it('status exige categoria válida; prioridade não tem categoria', () => {
    const { statuses, priorities, admin } = setup()
    assert.equal(codeOf(() => statuses.create(admin, { key: 'X1', name: 'X', color: 'gray' })), 'VALIDATION_ERROR:{"category":"required"}')
    assert.equal(codeOf(() => statuses.create(admin, { key: 'X1', name: 'X', category: 'doing', color: 'gray' })), 'VALIDATION_ERROR:{"category":"invalid_option"}')
    const high = priorities.create(admin, { key: 'HIGH', name: 'Alta', color: 'orange' })
    assert.equal(high.category, undefined)
  })

  it('chave duplicada e chave imutável', () => {
    const { statuses, admin } = setup()
    const s = statuses.create(admin, { key: 'TODO', name: 'A fazer', category: 'todo', color: 'gray' })
    assert.equal(codeOf(() => statuses.create(admin, { key: 'todo', name: 'Outro', category: 'todo', color: 'gray' })), 'STATUS_KEY_IN_USE')
    assert.equal(codeOf(() => statuses.update(admin, s.id, { key: 'NOVA' })), 'VALIDATION_ERROR:{"key":"immutable"}')
  })

  it('marcar outro item como padrão desmarca o anterior; o padrão não pode ser desmarcado direto', () => {
    const { priorities, admin } = setup()
    const low = priorities.create(admin, { key: 'LOW', name: 'Baixa', color: 'green' })
    const medium = priorities.create(admin, { key: 'MEDIUM', name: 'Média', color: 'amber' })
    priorities.update(admin, medium.id, { is_default: true })
    const list = priorities.list(admin, {})
    assert.deepEqual(list.map((p) => [p.key, p.is_default]), [['LOW', false], ['MEDIUM', true]])
    assert.equal(codeOf(() => priorities.update(admin, medium.id, { is_default: false })), 'VALIDATION_ERROR:{"is_default":"default_required"}')
    assert.equal(low.is_default, true)
  })

  it('não desativa nem exclui o padrão; padrão precisa estar ativo', () => {
    const { statuses, admin } = setup()
    const backlog = statuses.create(admin, { key: 'BACKLOG', name: 'Backlog', category: 'backlog', color: 'gray' })
    const off = statuses.create(admin, { key: 'OLD', name: 'Antigo', category: 'todo', color: 'gray', is_active: false })
    assert.equal(codeOf(() => statuses.update(admin, backlog.id, { is_active: false })), 'VALIDATION_ERROR:{"is_active":"default_must_be_active"}')
    assert.equal(codeOf(() => statuses.delete(admin, backlog.id)), 'STATUS_IS_DEFAULT')
    assert.equal(codeOf(() => statuses.update(admin, off.id, { is_default: true })), 'VALIDATION_ERROR:{"is_default":"default_must_be_active"}')
  })

  it('item em uso por tarefas não pode ser excluído', () => {
    const { deps, statuses, admin } = setup()
    statuses.create(admin, { key: 'BACKLOG', name: 'Backlog', category: 'backlog', color: 'gray' })
    const done = statuses.create(admin, { key: 'DONE', name: 'Concluído', category: 'done', color: 'green' })
    deps.store.lookupTaskCounts[done.id] = 3
    assert.equal(codeOf(() => statuses.delete(admin, done.id)), 'STATUS_IN_USE')
    deps.store.lookupTaskCounts[done.id] = 0
    assert.deepEqual(statuses.delete(admin, done.id), { deleted: true })
    assert.equal(deps.store.audit.at(-1).action, 'status.deleted')
  })

  it('reordenação exige a lista completa', () => {
    const { statuses, admin } = setup()
    const a = statuses.create(admin, { key: 'A1', name: 'A', category: 'todo', color: 'gray' })
    const b = statuses.create(admin, { key: 'B1', name: 'B', category: 'todo', color: 'gray' })
    assert.equal(codeOf(() => statuses.reorder(admin, [b.id])), 'VALIDATION_ERROR:{"ids":"invalid_order"}')
    assert.deepEqual(statuses.reorder(admin, [b.id, a.id]).map((s) => s.key), ['B1', 'A1'])
  })

  it('leitura com tasks.view; inativos e escrita só com settings.manage', () => {
    const { statuses, admin, member, viewer } = setup()
    statuses.create(admin, { key: 'BACKLOG', name: 'Backlog', category: 'backlog', color: 'gray' })
    statuses.create(admin, { key: 'OLD', name: 'Antigo', category: 'todo', color: 'gray', is_active: false })
    assert.deepEqual(statuses.list(viewer, { include_inactive: '1' }).map((s) => s.key), ['BACKLOG'])
    assert.deepEqual(statuses.list(admin, { include_inactive: '1' }).map((s) => s.key), ['BACKLOG', 'OLD'])
    assert.equal(codeOf(() => statuses.create(member, { key: 'X1', name: 'X', category: 'todo', color: 'gray' })), 'FORBIDDEN')
  })
})

describe('application/lookups — áreas responsáveis (sem padrão)', () => {
  it('cria sem padrão, ignora is_default e não exclui área em uso por tarefa ou projeto', () => {
    const { deps, admin, member } = setup()
    const areas = createLookupService(deps, 'area')
    const ti = areas.create(admin, { key: 'ti', name: 'Dpto. TI', color: 'blue', is_default: true })
    const mkt = areas.create(admin, { key: 'MARKETING', name: 'Marketing', color: 'pink' })
    assert.deepEqual([ti.key, ti.is_default, mkt.is_default], ['TI', false, false])
    assert.equal(areas.update(admin, ti.id, { is_active: false }).is_active, false)
    assert.deepEqual(areas.list(member, {}).map((a) => a.key), ['MARKETING'])

    deps.store.projects.push({ id: 'p1', areaId: mkt.id })
    assert.equal(codeOf(() => areas.delete(admin, mkt.id)), 'AREA_IN_USE')
    assert.deepEqual(areas.delete(admin, ti.id), { deleted: true })
    assert.equal(codeOf(() => areas.create(member, { key: 'X', name: 'X' })), 'FORBIDDEN')
    assert.equal(deps.store.audit.at(-1).action, 'area.deleted')
  })
})
