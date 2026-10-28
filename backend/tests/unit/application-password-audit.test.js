const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createAuthService } = require('../../src/application/auth')
const { createUserService } = require('../../src/application/users')
const { createAuditService } = require('../../src/application/audit-logs')
const { createPrincipal } = require('../../src/domain/rbac')

const baseCtx = { ip: '10.0.0.1', userAgent: 'ua', correlationId: 'c' }

async function loggedIn(deps, email, password) {
  const auth = createAuthService(deps)
  const { token } = await auth.login({ email, password }, baseCtx)
  const { principal, session } = await auth.authenticate(token)
  return { auth, token, ctx: Object.assign({ principal, session }, baseCtx) }
}

async function ctxFor(deps, roleCode, userId) {
  const role = await deps.roleRepository.findByCode(roleCode)
  return Object.assign(
    {
      principal: createPrincipal({
        userId: userId || 'actor',
        roleId: role.id,
        roleCode,
        permissions: await deps.roleRepository.getPermissionCodes(role.id),
      }),
    },
    baseCtx,
  )
}

describe('application/auth — troca da própria senha', () => {
  it('exige a senha atual correta', async () => {
    const deps = createFakeDeps()
    await seedUser(deps, { email: 'ana@x.com', password: 'senhaAntiga123' })
    const { auth, ctx } = await loggedIn(deps, 'ana@x.com', 'senhaAntiga123')
    await assert.rejects(
      () => auth.changePassword(ctx, { current_password: 'errada12345', new_password: 'senhaNova12345' }),
      (err) => err.code === 'VALIDATION_ERROR' && err.details.fields.current_password === 'incorrect',
    )
  })

  it('valida a política e rejeita senha igual à atual', async () => {
    const deps = createFakeDeps()
    await seedUser(deps, { email: 'ana@x.com', password: 'senhaAntiga123' })
    const { auth, ctx } = await loggedIn(deps, 'ana@x.com', 'senhaAntiga123')
    await assert.rejects(
      () => auth.changePassword(ctx, { current_password: 'senhaAntiga123', new_password: 'curta' }),
      (err) => err.details.fields.new_password === 'too_short',
    )
    await assert.rejects(
      () => auth.changePassword(ctx, { current_password: 'senhaAntiga123', new_password: 'senhaAntiga123' }),
      (err) => err.details.fields.new_password === 'same_as_current',
    )
  })

  it('troca a senha, mantém a sessão atual, encerra as outras e audita', async () => {
    const deps = createFakeDeps()
    const user = await seedUser(deps, { email: 'ana@x.com', password: 'senhaAntiga123' })
    const other = await loggedIn(deps, 'ana@x.com', 'senhaAntiga123')
    const { auth, token, ctx } = await loggedIn(deps, 'ana@x.com', 'senhaAntiga123')

    const result = await auth.changePassword(ctx, { current_password: 'senhaAntiga123', new_password: 'senhaNova12345' })

    assert.equal(result.other_sessions_revoked, 1)
    assert.equal(await deps.userRepository.verifyPassword(user.id, 'senhaNova12345'), true)
    assert.equal((await auth.authenticate(token)).reason, null)
    assert.equal((await auth.authenticate(other.token)).reason, 'revoked')
    const entry = deps.store.audit.at(-1)
    assert.equal(entry.action, 'auth.password_changed')
    assert.equal(JSON.stringify(entry).includes('senhaNova12345'), false)
  })
})

describe('application/users — redefinição de senha pelo administrador', () => {
  it('exige users.edit', async () => {
    const deps = createFakeDeps()
    const target = await seedUser(deps)
    await assert.rejects(async () => createUserService(deps).resetPassword(await ctxFor(deps, 'MANAGER'), target.id, { password: 'senhaNova12345' }), {
      code: 'FORBIDDEN',
    })
  })

  it('não redefine a própria senha por esta rota nem a de um SUPER_ADMIN (sem ser SUPER_ADMIN)', async () => {
    const deps = createFakeDeps()
    const users = createUserService(deps)
    const me = await seedUser(deps, { roleCode: 'ADMIN' })
    const root = await seedUser(deps, { roleCode: 'SUPER_ADMIN' })
    await assert.rejects(async () => users.resetPassword(await ctxFor(deps, 'ADMIN', me.id), me.id, { password: 'senhaNova12345' }), {
      code: 'USE_CHANGE_PASSWORD',
    })
    await assert.rejects(async () => users.resetPassword(await ctxFor(deps, 'ADMIN', me.id), root.id, { password: 'senhaNova12345' }), {
      code: 'FORBIDDEN',
    })
  })

  it('redefine, encerra todas as sessões do usuário e audita sem a senha', async () => {
    const deps = createFakeDeps()
    const target = await seedUser(deps, { email: 'alvo@x.com', password: 'senhaAntiga123' })
    const session = await loggedIn(deps, 'alvo@x.com', 'senhaAntiga123')
    await createUserService(deps).resetPassword(await ctxFor(deps, 'ADMIN'), target.id, { password: 'senhaNova12345' })

    assert.equal(await deps.userRepository.verifyPassword(target.id, 'senhaNova12345'), true)
    assert.equal((await session.auth.authenticate(session.token)).reason, 'revoked')
    const entry = deps.store.audit.at(-1)
    assert.equal(entry.action, 'user.password_reset')
    assert.equal(JSON.stringify(entry).includes('senhaNova12345'), false)
  })
})

describe('application/audit-logs', () => {
  async function seedAudit(deps) {
    const admin = await seedUser(deps, { name: 'Admin', roleCode: 'ADMIN' })
    const users = createUserService(deps)
    const ctx = await ctxFor(deps, 'ADMIN', admin.id)
    const created = await users.createUser(ctx, {
      name: 'Carlos',
      email: 'carlos@x.com',
      password: 'senhaForte123',
      role_id: (await deps.roleRepository.findByCode('MEMBER')).id,
    })
    await users.updateUser(ctx, created.id, { name: 'Carlos Silva' })
    return { admin, created }
  }

  it('exige audit.view', async () => {
    const deps = createFakeDeps()
    await assert.rejects(async () => createAuditService(deps).listAuditLogs(await ctxFor(deps, 'MANAGER'), {}), { code: 'FORBIDDEN' })
  })

  it('lista do mais recente para o mais antigo, com autor e paginação', async () => {
    const deps = createFakeDeps()
    const { admin, created } = await seedAudit(deps)
    const page = await createAuditService(deps).listAuditLogs(await ctxFor(deps, 'ADMIN'), { perPage: '1' })
    assert.equal(page.meta.total, 2)
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].action, 'user.updated')
    assert.equal(page.items[0].entity_id, created.id)
    assert.deepEqual(page.items[0].user, { id: admin.id, name: 'Admin', email: admin.email })
    assert.deepEqual(page.items[0].new_value, { name: 'Carlos Silva' })
    assert.ok(page.items[0].created_at)
  })

  it('filtra por entidade e ação e valida datas', async () => {
    const deps = createFakeDeps()
    const { created } = await seedAudit(deps)
    const audit = createAuditService(deps)
    const ctx = await ctxFor(deps, 'ADMIN')
    const page = await audit.listAuditLogs(ctx, { entity_type: 'user', entity_id: created.id, action: 'user.created' })
    assert.equal(page.items.length, 1)
    await assert.rejects(() => audit.listAuditLogs(ctx, { from: 'ontem' }), (err) => err.details.fields.from === 'invalid_date')
  })

  it('quem vê usuários pode consultar o histórico de um usuário específico', async () => {
    const deps = createFakeDeps()
    const { created } = await seedAudit(deps)
    const audit = createAuditService(deps)
    const page = await audit.listEntityHistory(await ctxFor(deps, 'MANAGER'), 'user', created.id)
    assert.equal(page.items.length, 2)
    await assert.rejects(async () => audit.listEntityHistory(await ctxFor(deps, 'MEMBER'), 'user', created.id), { code: 'FORBIDDEN' })
    await assert.rejects(async () => audit.listEntityHistory(await ctxFor(deps, 'ADMIN'), 'user', 'nope'), { code: 'USER_NOT_FOUND' })
  })
})
