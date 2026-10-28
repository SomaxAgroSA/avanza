const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createRoleService } = require('../../src/application/roles')
const { createUserService } = require('../../src/application/users')
const { createPrincipal } = require('../../src/domain/rbac')
const { DEFAULT_ROLE_PERMISSIONS } = require('../../src/domain/permissions')

async function ctxFor(deps, roleCode, userId) {
  const role = await deps.roleRepository.findByCode(roleCode)
  const principal = createPrincipal({
    userId: userId || 'actor',
    roleId: role.id,
    roleCode,
    permissions: await deps.roleRepository.getPermissionCodes(role.id),
  })
  return { principal, ip: '1.1.1.1', userAgent: 'ua', correlationId: 'c' }
}

describe('application/roles', () => {
  it('lista perfis com contagem de permissões e usuários', async () => {
    const deps = createFakeDeps()
    const roles = createRoleService(deps)
    await seedUser(deps, { roleCode: 'MEMBER' })
    const list = await roles.listRoles(await ctxFor(deps, 'ADMIN'))
    const member = list.find((r) => r.code === 'MEMBER')
    assert.equal(member.user_count, 1)
    assert.deepEqual(member.permissions, DEFAULT_ROLE_PERMISSIONS.MEMBER.slice().sort())
  })

  it('VIEWER não pode listar perfis', async () => {
    const deps = createFakeDeps()
    await assert.rejects(async () => createRoleService(deps).listRoles(await ctxFor(deps, 'VIEWER')), { code: 'FORBIDDEN' })
  })

  it('atualiza permissões e audita valores antigo e novo', async () => {
    const deps = createFakeDeps()
    const roles = createRoleService(deps)
    const viewer = await deps.roleRepository.findByCode('VIEWER')

    const updated = await roles.updateRolePermissions(await ctxFor(deps, 'ADMIN'), viewer.id, ['tasks.view', 'tasks.view', 'kanban.view'])

    assert.deepEqual(updated.permissions, ['kanban.view', 'tasks.view'])
    const entry = deps.store.audit.at(-1)
    assert.equal(entry.action, 'role.permissions_updated')
    assert.deepEqual(entry.oldValue.permissions, DEFAULT_ROLE_PERMISSIONS.VIEWER.slice().sort())
    assert.deepEqual(entry.newValue.permissions, ['kanban.view', 'tasks.view'])
  })

  it('perfil inexistente retorna ROLE_NOT_FOUND', async () => {
    const deps = createFakeDeps()
    await assert.rejects(async () => createRoleService(deps).updateRolePermissions(await ctxFor(deps, 'ADMIN'), 'nope', []), {
      code: 'ROLE_NOT_FOUND',
    })
  })

  it('cria perfil customizado com código normalizado e rejeita duplicado', async () => {
    const deps = createFakeDeps()
    const roles = createRoleService(deps)
    const created = await roles.createRole(await ctxFor(deps, 'ADMIN'), { code: 'qa_lead', name: 'QA Lead' })
    assert.equal(created.code, 'QA_LEAD')
    assert.equal(created.is_system, false)
    await assert.rejects(async () => roles.createRole(await ctxFor(deps, 'ADMIN'), { code: 'QA_LEAD', name: 'Outro' }), {
      code: 'ROLE_CODE_IN_USE',
    })
  })

  it('não exclui perfil de sistema nem perfil em uso', async () => {
    const deps = createFakeDeps()
    const roles = createRoleService(deps)
    const admin = await ctxFor(deps, 'ADMIN')
    await assert.rejects(async () => roles.deleteRole(admin, (await deps.roleRepository.findByCode('VIEWER')).id), { code: 'ROLE_IMMUTABLE' })

    const custom = await roles.createRole(admin, { code: 'TEMP', name: 'Temp' })
    await seedUser(deps, { roleId: custom.id })
    await assert.rejects(() => roles.deleteRole(admin, custom.id), { code: 'ROLE_IN_USE' })
  })
})

describe('application/users', () => {
  const validInput = async (deps, overrides) =>
    Object.assign(
      {
        name: 'Carlos',
        email: 'Carlos@Example.com',
        password: 'senhaForte123',
        role_id: (await deps.roleRepository.findByCode('MEMBER')).id,
      },
      overrides,
    )

  it('cria usuário com e-mail normalizado, status ativo e auditoria sem senha', async () => {
    const deps = createFakeDeps()
    const users = createUserService(deps)
    const created = await users.createUser(await ctxFor(deps, 'ADMIN'), await validInput(deps))
    assert.equal(created.email, 'carlos@example.com')
    assert.equal(created.status, 'active')
    assert.equal('password' in created, false)
    const entry = deps.store.audit.at(-1)
    assert.equal(entry.action, 'user.created')
    assert.equal(JSON.stringify(entry).includes('senhaForte123'), false)
  })

  it('exige users.create', async () => {
    const deps = createFakeDeps()
    await assert.rejects(async () => createUserService(deps).createUser(await ctxFor(deps, 'MANAGER'), await validInput(deps)), { code: 'FORBIDDEN' })
  })

  it('rejeita senha fraca e e-mail duplicado', async () => {
    const deps = createFakeDeps()
    const users = createUserService(deps)
    const admin = await ctxFor(deps, 'ADMIN')
    await assert.rejects(async () => users.createUser(admin, await validInput(deps, { password: 'fraca' })), (err) => {
      return err.code === 'VALIDATION_ERROR' && err.details.fields.password === 'too_short'
    })
    await users.createUser(admin, await validInput(deps))
    await assert.rejects(async () => users.createUser(admin, await validInput(deps, { email: 'carlos@example.com' })), {
      code: 'EMAIL_ALREADY_IN_USE',
    })
  })

  it('perfil inválido e escalonamento são bloqueados', async () => {
    const deps = createFakeDeps()
    const users = createUserService(deps)
    await assert.rejects(async () => users.createUser(await ctxFor(deps, 'ADMIN'), await validInput(deps, { role_id: 'nope' })), {
      code: 'ROLE_NOT_FOUND',
    })
    const superRole = await deps.roleRepository.findByCode('SUPER_ADMIN')
    await assert.rejects(async () => users.createUser(await ctxFor(deps, 'ADMIN'), await validInput(deps, { role_id: superRole.id })), {
      code: 'PRIVILEGE_ESCALATION',
    })
  })

  it('lista com paginação e exige users.view', async () => {
    const deps = createFakeDeps()
    const users = createUserService(deps)
    for (let i = 0; i < 25; i++) await seedUser(deps)
    const page = await users.listUsers(await ctxFor(deps, 'MANAGER'), { page: '2', perPage: '10' })
    assert.equal(page.items.length, 10)
    assert.deepEqual(page.meta, { page: 2, perPage: 10, total: 25, totalPages: 3 })
    await assert.rejects(async () => users.listUsers(await ctxFor(deps, 'MEMBER'), {}), { code: 'FORBIDDEN' })
  })

  it('desativar usuário revoga todas as sessões dele', async () => {
    const deps = createFakeDeps()
    const users = createUserService(deps)
    const target = await seedUser(deps)
    await deps.sessionRepository.create({
      userId: target.id,
      tokenHash: 'h',
      remember: false,
      expiresAt: new Date('2030-01-01'),
      lastSeenAt: new Date(),
    })
    const updated = await users.changeUserStatus(await ctxFor(deps, 'ADMIN'), target.id, 'disabled')
    assert.equal(updated.status, 'disabled')
    assert.ok(deps.store.sessions[0].revokedAt)
    assert.equal(deps.store.audit.at(-1).action, 'user.disabled')
  })

  it('atualiza dados e audita somente campos alterados', async () => {
    const deps = createFakeDeps()
    const users = createUserService(deps)
    const target = await seedUser(deps, { name: 'Maria' })
    const updated = await users.updateUser(await ctxFor(deps, 'ADMIN'), target.id, { name: 'Maria Silva', locale: 'es' })
    assert.equal(updated.name, 'Maria Silva')
    const entry = deps.store.audit.at(-1)
    assert.deepEqual(entry.oldValue, { name: 'Maria', locale: 'pt-BR' })
    assert.deepEqual(entry.newValue, { name: 'Maria Silva', locale: 'es' })
  })

  it('usuário comum edita o próprio nome, mas não o próprio perfil de acesso', async () => {
    const deps = createFakeDeps()
    const users = createUserService(deps)
    const me = await seedUser(deps, { roleCode: 'MEMBER' })
    const ctx = await ctxFor(deps, 'MEMBER', me.id)
    assert.equal((await users.updateUser(ctx, me.id, { name: 'Novo' })).name, 'Novo')
    await assert.rejects(async () => users.updateUser(ctx, me.id, { role_id: (await deps.roleRepository.findByCode('ADMIN')).id }), {
      code: 'FORBIDDEN',
    })
  })

  it('foto: opcional; o próprio usuário ou quem tem users.edit envia, troca e remove (com histórico); qualquer um vê', async () => {
    const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]
    const photo = (name, head, size) => ({ name, head, size: size === undefined ? 50000 : size, handle: { name } })
    const deps = createFakeDeps()
    const users = createUserService(deps)
    const me = await seedUser(deps, { roleCode: 'MEMBER', name: 'Maria' })
    const other = await seedUser(deps, { roleCode: 'MEMBER' })
    const admin = await ctxFor(deps, 'ADMIN')
    const self = await ctxFor(deps, 'MEMBER', me.id)

    // sem foto: as iniciais (avatar_url nulo) e a foto não existe
    assert.equal((await users.getUser(admin, me.id)).avatar_url, null)
    await assert.rejects(async () => users.avatarKey(self, me.id), { code: 'NOT_FOUND' })

    const sent = await users.setAvatar(admin, me.id, photo('maria.png', PNG))
    assert.match(sent.avatar_url, new RegExp(`^/api/v1/users/${me.id}/avatar\\?v=`))
    assert.equal(deps.store.audit.at(-1).action, 'user.avatar_updated')
    assert.deepEqual(deps.store.audit.at(-1).newValue, { avatar: 'maria.png' })
    assert.match(await users.avatarKey(await ctxFor(deps, 'VIEWER', other.id), me.id), new RegExp(`^users/${me.id}/`))

    // a própria pessoa troca; a URL muda (o navegador não mostra a antiga do cache)
    const changed = await users.setAvatar(self, me.id, photo('nova.jpg', [0xff, 0xd8, 0xff, 0xe0]))
    assert.notEqual(changed.avatar_url, sent.avatar_url)

    // só imagem PNG, JPG ou WebP até 2 MB, conferida pelo conteúdo
    await assert.rejects(async () => users.setAvatar(self, me.id, null), { code: 'VALIDATION_ERROR', details: { fields: { avatar: 'required' } } })
    await assert.rejects(async () => users.setAvatar(self, me.id, photo('foto.gif', Array.from(Buffer.from('GIF89a')))), { details: { fields: { avatar: 'unsupported_type' } } })
    await assert.rejects(async () => users.setAvatar(self, me.id, photo('foto.png', Array.from(Buffer.from('%PDF-1.7')))), { code: 'VALIDATION_ERROR' })
    await assert.rejects(async () => users.setAvatar(self, me.id, photo('grande.png', PNG, 3 * 1024 * 1024)), { details: { fields: { avatar: 'file_too_large' } } })

    // outra pessoa sem users.edit não mexe na foto de ninguém
    await assert.rejects(async () => users.setAvatar(await ctxFor(deps, 'MEMBER', other.id), me.id, photo('x.png', PNG)), { code: 'FORBIDDEN' })
    await assert.rejects(async () => users.removeAvatar(await ctxFor(deps, 'MEMBER', other.id), me.id), { code: 'FORBIDDEN' })

    const removed = await users.removeAvatar(self, me.id)
    assert.equal(removed.avatar_url, null)
    assert.equal(deps.store.audit.at(-1).action, 'user.avatar_removed')
    // remover de novo não grava outro histórico
    const before = deps.store.audit.length
    await users.removeAvatar(self, me.id)
    assert.equal(deps.store.audit.length, before)
  })

  it('usuário inexistente retorna USER_NOT_FOUND', async () => {
    const deps = createFakeDeps()
    await assert.rejects(async () => createUserService(deps).getUser(await ctxFor(deps, 'ADMIN'), 'nope'), { code: 'USER_NOT_FOUND' })
  })
})
