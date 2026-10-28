const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createPlatformSettingsService } = require('../../src/application/platform-settings')
const { createAuthService } = require('../../src/application/auth')
const { createUserService } = require('../../src/application/users')
const rbac = require('../../src/domain/rbac')

const ascii = (text) => text.split('').map((c) => c.charCodeAt(0))
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]

async function setup() {
  const deps = createFakeDeps({ start: '2026-10-01T12:00:00.000Z' })
  const service = createPlatformSettingsService(deps)
  const admin = await seedUser(deps, { email: 'admin@example.com', roleCode: 'ADMIN' })
  const manager = await seedUser(deps, { email: 'gestor@example.com', roleCode: 'MANAGER' })
  const principalOf = async (user) => {
    const role = await deps.roleRepository.findById(user.roleId)
    return rbac.createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: await deps.roleRepository.getPermissionCodes(role.id), sessionId: 's1' })
  }
  const ctxOf = async (user) => ({ principal: await principalOf(user), ip: '10.0.0.1', userAgent: 'test', correlationId: 'c1' })
  return { deps, service, admin, manager, ctxOf }
}

const codeOf = async (fn) => {
  try {
    await fn()
  } catch (err) {
    return err.code
  }
  return 'OK'
}
const fieldsOf = async (fn) => {
  try {
    await fn()
  } catch (err) {
    return err.details && err.details.fields
  }
  return null
}

describe('application/platform-settings — configurações', () => {
  it('só quem tem platform.manage lê e altera; o padrão aparece enquanto ninguém mudou', async () => {
    const { service, admin, manager, ctxOf } = await setup()
    assert.equal(rbac.can((await ctxOf(manager)).principal, 'platform.manage'), false)
    assert.equal(await codeOf(async () => service.getSettings(await ctxOf(manager))), 'FORBIDDEN')
    assert.equal(await codeOf(async () => service.updateSettings(await ctxOf(manager), { lockout_threshold: 8 })), 'FORBIDDEN')
    const view = await service.getSettings(await ctxOf(admin))
    assert.equal(view.values.audit_retention_months, 3)
    assert.equal(view.values.platform_name, 'Avanza')
    assert.deepEqual(view.retention_options, [1, 3, 6, 12, 24, 0])
    assert.deepEqual(view.limits.lockout_threshold, { min: 3, max: 20 })
    assert.deepEqual(view.branding, { logo_light: null, logo_dark: null, favicon: null })
  })

  it('alterar grava, devolve os valores e registra antes/depois no histórico; sem mudança não registra', async () => {
    const { deps, service, admin, ctxOf } = await setup()
    const result = await service.updateSettings(await ctxOf(admin), { lockout_threshold: 8, platform_name: 'Portal da Obra' })
    assert.equal(result.values.lockout_threshold, 8)
    assert.equal((await service.getSettings(await ctxOf(admin))).values.platform_name, 'Portal da Obra')
    const entry = deps.store.audit.at(-1)
    assert.equal(entry.action, 'platform_settings.update')
    assert.equal(entry.entityType, 'platform_settings')
    assert.deepEqual(entry.oldValue, { lockout_threshold: 5, platform_name: 'Avanza' })
    assert.deepEqual(entry.newValue, { lockout_threshold: 8, platform_name: 'Portal da Obra' })
    const count = deps.store.audit.length
    await service.updateSettings(await ctxOf(admin), { lockout_threshold: 8 })
    assert.equal(deps.store.audit.length, count)
  })

  it('valores fora dos limites voltam como erro de validação por campo', async () => {
    const { service, admin, ctxOf } = await setup()
    assert.deepEqual(await fieldsOf(async () => service.updateSettings(await ctxOf(admin), { lockout_threshold: 1, password_min_length: 4 })), {
      lockout_threshold: 'too_small',
      password_min_length: 'too_small',
    })
  })

  it('prévia (dry_run) de encurtar a retenção conta o que seria apagado e não grava', async () => {
    const { deps, service, admin, ctxOf } = await setup()
    deps.store.audit.push({ id: 'old1', action: 'x', entityType: 'task', entityId: 't', createdAt: new Date('2026-04-01T00:00:00Z') })
    deps.store.audit.push({ id: 'old2', action: 'x', entityType: 'task', entityId: 't', createdAt: new Date('2026-08-15T00:00:00Z') })
    deps.store.audit.push({ id: 'new1', action: 'x', entityType: 'task', entityId: 't', createdAt: new Date('2026-09-20T00:00:00Z') })
    const preview = await service.updateSettings(await ctxOf(admin), { audit_retention_months: 1, dry_run: true })
    assert.deepEqual(preview, { dry_run: true, audit_to_delete: 2 })
    assert.equal((await service.getSettings(await ctxOf(admin))).values.audit_retention_months, 3)
    // alongar não apaga nada
    assert.deepEqual(await service.updateSettings(await ctxOf(admin), { audit_retention_months: 12, dry_run: true }), { dry_run: true, audit_to_delete: 0 })
  })
})

describe('application/platform-settings — limpeza diária do histórico', () => {
  it('apaga o que passou do prazo e registra quantos saíram; "manter sempre" não apaga', async () => {
    const { deps, service, admin, ctxOf } = await setup()
    deps.store.audit.length = 0
    deps.store.audit.push({ id: 'a1', action: 'x', entityType: 'task', entityId: 't', createdAt: new Date('2026-05-01T00:00:00Z') })
    deps.store.audit.push({ id: 'a2', action: 'x', entityType: 'task', entityId: 't', createdAt: new Date('2026-09-01T00:00:00Z') })
    const result = await service.purgeAuditLogs()
    assert.equal(result.removed, 1)
    assert.deepEqual(deps.store.audit.map((e) => e.id).slice(0, 1), ['a2'])
    const entry = deps.store.audit.at(-1)
    assert.equal(entry.action, 'audit_log.purge')
    assert.equal(entry.userId, null)
    assert.deepEqual(entry.newValue, { removed: 1, before: '2026-07-01T12:00:00.000Z', retention_months: 3 })
    entry.createdAt = deps.clock.now() // o fake data o histórico em jan/2026; o registro da limpeza é de agora
    // nada a apagar: não registra de novo
    const count = deps.store.audit.length
    assert.equal((await service.purgeAuditLogs()).removed, 0)
    assert.equal(deps.store.audit.length, count)

    // "Limpar agora": só platform.manage; quem pediu fica no histórico
    assert.equal(await codeOf(async () => service.runRetentionNow(await ctxOf((await setup()).manager))), 'FORBIDDEN')
    deps.store.audit.push({ id: 'a3', action: 'x', entityType: 'task', entityId: 't', createdAt: new Date('2026-06-01T00:00:00Z') })
    assert.equal((await service.runRetentionNow(await ctxOf(admin))).removed, 1)
    assert.equal(deps.store.audit.at(-1).userId, admin.id)
    deps.store.audit.at(-1).createdAt = deps.clock.now()

    await service.updateSettings(await ctxOf(admin), { audit_retention_months: 0 })
    deps.store.audit.push({ id: 'a0', action: 'x', entityType: 'task', entityId: 't', createdAt: new Date('2020-01-01T00:00:00Z') })
    assert.deepEqual(await service.purgeAuditLogs(), { removed: 0, skipped: true })
  })
})

describe('application/platform-settings — políticas aplicadas', () => {
  const ctx = { ip: '10.0.0.1', userAgent: 'test', correlationId: 'c1' }

  it('login: o bloqueio segue o número de tentativas e o tempo configurados', async () => {
    const { deps, service, admin, ctxOf } = await setup()
    await service.updateSettings(await ctxOf(admin), { lockout_threshold: 3, lockout_base_minutes: 15 })
    await seedUser(deps, { email: 'ana@example.com', password: 'senhaForte123' })
    const auth = createAuthService(deps)
    for (let i = 0; i < 3; i++) assert.equal(await codeOf(() => auth.login({ email: 'ana@example.com', password: 'errada123456' }, ctx)), 'INVALID_CREDENTIALS')
    await assert.rejects(
      () => auth.login({ email: 'ana@example.com', password: 'senhaForte123' }, ctx),
      (err) => err.code === 'ACCOUNT_LOCKED' && err.details.retry_after_seconds === 900,
    )
  })

  it('senha: trocar, criar e redefinir seguem a política vigente; a política é lida por quem está logado', async () => {
    const { deps, service, admin, manager, ctxOf } = await setup()
    await service.updateSettings(await ctxOf(admin), { password_min_length: 12, password_require_mixed_case: true, password_require_symbol: true })
    assert.deepEqual(await service.passwordPolicy(await ctxOf(manager)), { min_length: 12, max_length: 72, require_letters_numbers: true, require_mixed_case: true, require_symbol: true })
    assert.equal(await codeOf(() => service.passwordPolicy({ principal: null })), 'UNAUTHENTICATED')

    const auth = createAuthService(deps)
    assert.deepEqual(await fieldsOf(async () => auth.changePassword(await ctxOf(manager), { current_password: 'senhaForte123', new_password: 'semmaiuscula12#' })), {
      new_password: 'needs_mixed_case',
    })
    assert.equal((await auth.changePassword(await ctxOf(manager), { current_password: 'senhaForte123', new_password: 'ComMaiuscula12#' })).changed, true)

    const users = createUserService(deps)
    const role = await deps.roleRepository.findByCode('MEMBER')
    assert.deepEqual(await fieldsOf(async () => users.createUser(await ctxOf(admin), { name: 'Bia', email: 'bia@example.com', password: 'Curta1#', role_id: role.id })), {
      password: 'too_short',
    })
    const bia = await users.createUser(await ctxOf(admin), { name: 'Bia', email: 'bia@example.com', password: 'SenhaDaBia12#', role_id: role.id })
    assert.deepEqual(await fieldsOf(async () => users.resetPassword(await ctxOf(admin), bia.id, { password: 'semsimbolo12AB' })), { password: 'needs_symbol' })
  })
})

describe('application/platform-settings — identidade', () => {
  it('logo e ícone: tipo conferido, histórico, informação pública com endereço versionado; remover', async () => {
    const { deps, service, admin, manager, ctxOf } = await setup()
    assert.deepEqual(await service.publicInfo(), { name: 'Avanza', logo_light_url: null, logo_dark_url: null, favicon_url: null, password_reset: false })
    assert.equal(await codeOf(async () => service.uploadBranding(await ctxOf(manager), 'logo_light', { name: 'm.png', size: 12, bytes: PNG })), 'FORBIDDEN')

    const view = await service.uploadBranding(await ctxOf(admin), 'logo_light', { name: 'marca.png', size: 12, bytes: PNG, handle: {} })
    assert.deepEqual(view.branding.logo_light, { name: 'marca.png', mime: 'image/png', size: 12 })
    assert.equal(deps.store.audit.at(-1).action, 'platform_settings.branding_update')
    assert.deepEqual(deps.store.audit.at(-1).newValue, { slot: 'logo_light', name: 'marca.png', size: 12 })
    const info = await service.publicInfo()
    assert.match(info.logo_light_url, /^\/api\/v1\/platform\/branding\/logo_light\?v=\d+$/)
    assert.equal(info.favicon_url, null)
    assert.equal((await service.brandingFile('logo_light')).mime, 'image/png')
    assert.equal(await codeOf(() => service.brandingFile('favicon')), 'NOT_FOUND')
    assert.equal(await codeOf(() => service.brandingFile('../etc')), 'NOT_FOUND')

    assert.deepEqual(await fieldsOf(async () => service.uploadBranding(await ctxOf(admin), 'logo_dark', { name: 'm.svg', size: 30, bytes: ascii('<svg onload="x()"></svg>') })), { file: 'unsafe_svg' })
    assert.deepEqual(await fieldsOf(async () => service.uploadBranding(await ctxOf(admin), 'banner', { name: 'm.png', size: 12, bytes: PNG })), { slot: 'invalid_slot' })
    assert.deepEqual(await fieldsOf(async () => service.uploadBranding(await ctxOf(admin), 'favicon', null)), { file: 'required' })
    assert.deepEqual(await fieldsOf(async () => service.uploadBranding(await ctxOf(admin), 'favicon', { name: 'f.png', size: 2 * 1024 * 1024, bytes: PNG })), { file: 'file_too_large' })

    await service.removeBranding(await ctxOf(admin), 'logo_light')
    assert.equal((await service.publicInfo()).logo_light_url, null)
    assert.equal(deps.store.audit.at(-1).action, 'platform_settings.branding_remove')
  })
})
