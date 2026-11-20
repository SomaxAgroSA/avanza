const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createCompanyService } = require('../../src/application/companies')
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
  return { deps, companies: createCompanyService(deps), admin: await ctxFor(deps, 'ADMIN'), manager: await ctxFor(deps, 'MANAGER'), viewer: await ctxFor(deps, 'VIEWER') }
}

describe('application/companies (§46)', () => {
  it('cria com nome e sigla normalizados; grava o histórico', async () => {
    const { deps, companies, admin } = await setup()
    const created = await companies.create(admin, { name: '  Somax   Paraguay ', short_code: ' smx-py ' })
    assert.equal(created.name, 'Somax Paraguay')
    assert.equal(created.short_code, 'SMX-PY')
    assert.equal(created.active, true)
    assert.ok(created.created_at)
    const entry = deps.store.audit.at(-1)
    assert.equal(entry.action, 'company.created')
    assert.equal(entry.entityType, 'company')
    assert.deepEqual(entry.newValue, { name: 'Somax Paraguay', short_code: 'SMX-PY', active: true })
  })

  it('nome único sem diferença de maiúsculas; validações de nome e sigla', async () => {
    const { companies, admin } = await setup()
    await companies.create(admin, { name: 'Somax Paraguay' })
    assert.equal(await codeOf(() => companies.create(admin, { name: 'SOMAX paraguay' })), 'COMPANY_NAME_IN_USE')
    assert.equal(await codeOf(() => companies.create(admin, {})), 'VALIDATION_ERROR:{"name":"required"}')
    assert.equal(await codeOf(() => companies.create(admin, { name: 'X', short_code: 'A B' })), 'VALIDATION_ERROR:{"short_code":"invalid_format"}')
    assert.equal(await codeOf(() => companies.create(admin, { name: 'X', active: 'sim' })), 'VALIDATION_ERROR:{"active":"invalid_type"}')
  })

  it('só quem gerencia a plataforma (platform.manage) cria e altera', async () => {
    const { companies, admin, manager } = await setup()
    assert.equal(await codeOf(() => companies.create(manager, { name: 'Agro' })), 'FORBIDDEN')
    const agro = await companies.create(admin, { name: 'Agro' })
    assert.equal(await codeOf(() => companies.update(manager, agro.id, { name: 'Agro 2' })), 'FORBIDDEN')
  })

  it('altera nome, sigla e estado (desativar em vez de excluir); sem mudança, sem histórico', async () => {
    const { deps, companies, admin } = await setup()
    const agro = await companies.create(admin, { name: 'Agro', short_code: 'AG' })
    await companies.create(admin, { name: 'Somax' })
    assert.equal(await codeOf(() => companies.update(admin, agro.id, { name: 'somax' })), 'COMPANY_NAME_IN_USE')
    // a própria empresa pode trocar só as maiúsculas
    assert.equal((await companies.update(admin, agro.id, { name: 'AGRO' })).name, 'AGRO')
    const off = await companies.update(admin, agro.id, { active: false, short_code: '' })
    assert.equal(off.active, false)
    assert.equal(off.short_code, '')
    const entry = deps.store.audit.at(-1)
    assert.equal(entry.action, 'company.updated')
    assert.deepEqual(entry.oldValue, { short_code: 'AG', active: true })
    assert.deepEqual(entry.newValue, { short_code: '', active: false })
    const count = deps.store.audit.length
    await companies.update(admin, agro.id, { active: false })
    assert.equal(deps.store.audit.length, count)
    assert.equal(await codeOf(() => companies.update(admin, 'nao-existe', { active: true })), 'COMPANY_NOT_FOUND')
  })

  it('lista: qualquer pessoa autenticada vê as ativas; as inativas e as contagens só com platform.manage', async () => {
    const { deps, companies, admin, viewer } = await setup()
    const agro = await companies.create(admin, { name: 'Agro' })
    const somax = await companies.create(admin, { name: 'Somax' })
    await companies.update(admin, agro.id, { active: false })
    await deps.projectRepository.create({ name: 'CRM', key: 'CRM', ownerId: 'x', kind: '', companyId: somax.id })
    await deps.taskRepository.create({ projectId: 'dem', number: 1, code: 'DEM-1', title: 'Demanda', companyId: somax.id })
    assert.deepEqual((await companies.list(viewer, {})).map((c) => c.name), ['Somax'])
    assert.equal((await companies.list(viewer, {}))[0].usage_count, undefined)
    // sem a permissão, include_inactive é ignorado
    assert.deepEqual((await companies.list(viewer, { include_inactive: 'true' })).map((c) => c.name), ['Somax'])
    const all = await companies.list(admin, { include_inactive: 'true' })
    assert.deepEqual(all.map((c) => [c.name, c.active, c.project_count, c.demand_count, c.usage_count]), [
      ['Agro', false, 0, 0, 0],
      ['Somax', true, 1, 1, 2],
    ])
  })
})
