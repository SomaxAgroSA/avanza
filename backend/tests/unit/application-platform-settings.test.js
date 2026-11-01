const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createPlatformSettingsService } = require('../../pb_hooks/src/application/platform-settings')
const { createAuthService } = require('../../pb_hooks/src/application/auth')
const { createUserService } = require('../../pb_hooks/src/application/users')
const rbac = require('../../pb_hooks/src/domain/rbac')

const ascii = (text) => text.split('').map((c) => c.charCodeAt(0))
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]

function setup() {
  const deps = createFakeDeps({ start: '2026-10-01T12:00:00.000Z' })
  const service = createPlatformSettingsService(deps)
  const admin = seedUser(deps, { email: 'admin@example.com', roleCode: 'ADMIN' })
  const manager = seedUser(deps, { email: 'gestor@example.com', roleCode: 'MANAGER' })
  const principalOf = (user) => {
    const role = deps.roleRepository.findById(user.roleId)
    return rbac.createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: deps.roleRepository.getPermissionCodes(role.id), sessionId: 's1' })
  }
  const ctxOf = (user) => ({ principal: principalOf(user), ip: '10.0.0.1', userAgent: 'test', correlationId: 'c1' })
  return { deps, service, admin, manager, ctxOf }
}

const codeOf = (fn) => {
  try {
    fn()
  } catch (err) {
    return err.code
  }
  return 'OK'
}
const fieldsOf = (fn) => {
  try {
    fn()
  } catch (err) {
    return err.details && err.details.fields
  }
  return null
}

describe('application/platform-settings — configurações', () => {
  it('só quem tem platform.manage lê e altera; o padrão aparece enquanto ninguém mudou', () => {
    const { service, admin, manager, ctxOf } = setup()
    assert.equal(rbac.can(ctxOf(manager).principal, 'platform.manage'), false)
    assert.equal(codeOf(() => service.getSettings(ctxOf(manager))), 'FORBIDDEN')
    assert.equal(codeOf(() => service.updateSettings(ctxOf(manager), { lockout_threshold: 8 })), 'FORBIDDEN')
    const view = service.getSettings(ctxOf(admin))
    assert.equal(view.values.audit_retention_months, 3)
    assert.equal(view.values.platform_name, 'Avanza')
    assert.deepEqual(view.retention_options, [1, 3, 6, 12, 24, 0])
    assert.deepEqual(view.limits.lockout_threshold, { min: 3, max: 20 })
    assert.deepEqual(view.branding, { logo_light: null, logo_dark: null, favicon: null })
  })

  it('alterar grava, devolve os valores e registra antes/depois no histórico; sem mudança não registra', () => {
    const { deps, service, admin, ctxOf } = setup()
    const result = service.updateSettings(ctxOf(admin), { lockout_threshold: 8, platform_name: 'Portal da Obra' })
    assert.equal(result.values.lockout_threshold, 8)
    assert.equal(service.getSettings(ctxOf(admin)).values.platform_name, 'Portal da Obra')
    const entry = deps.store.audit.at(-1)
    assert.equal(entry.action, 'platform_settings.update')
    assert.equal(entry.entityType, 'platform_settings')
    assert.deepEqual(entry.oldValue, { lockout_threshold: 5, platform_name: 'Avanza' })
    assert.deepEqual(entry.newValue, { lockout_threshold: 8, platform_name: 'Portal da Obra' })
    const count = deps.store.audit.length
    service.updateSettings(ctxOf(admin), { lockout_threshold: 8 })
    assert.equal(deps.store.audit.length, count)
  })

  it('valores fora dos limites voltam como erro de validação por campo', () => {
    const { service, admin, ctxOf } = setup()
    assert.deepEqual(fieldsOf(() => service.updateSettings(ctxOf(admin), { lockout_threshold: 1, password_min_length: 4 })), {
      lockout_threshold: 'too_small',
      password_min_length: 'too_small',
    })
  })

  it('prévia (dry_run) de encurtar a retenção conta o que seria apagado e não grava', () => {
    const { deps, service, admin, ctxOf } = setup()
    deps.store.audit.push({ id: 'old1', action: 'x', entityType: 'task', entityId: 't', createdAt: new Date('2026-04-01T00:00:00Z') })
    deps.store.audit.push({ id: 'old2', action: 'x', entityType: 'task', entityId: 't', createdAt: new Date('2026-08-15T00:00:00Z') })
    deps.store.audit.push({ id: 'new1', action: 'x', entityType: 'task', entityId: 't', createdAt: new Date('2026-09-20T00:00:00Z') })
    const preview = service.updateSettings(ctxOf(admin), { audit_retention_months: 1, dry_run: true })
    assert.deepEqual(preview, { dry_run: true, audit_to_delete: 2 })
    assert.equal(service.getSettings(ctxOf(admin)).values.audit_retention_months, 3)
    // alongar não apaga nada
    assert.deepEqual(service.updateSettings(ctxOf(admin), { audit_retention_months: 12, dry_run: true }), { dry_run: true, audit_to_delete: 0 })
  })
})

describe('application/platform-settings — limpeza diária do histórico', () => {
  it('apaga o que passou do prazo e registra quantos saíram; "manter sempre" não apaga', () => {
    const { deps, service, admin, ctxOf } = setup()
    deps.store.audit.length = 0
    deps.store.audit.push({ id: 'a1', action: 'x', entityType: 'task', entityId: 't', createdAt: new Date('2026-05-01T00:00:00Z') })
    deps.store.audit.push({ id: 'a2', action: 'x', entityType: 'task', entityId: 't', createdAt: new Date('2026-09-01T00:00:00Z') })
    const result = service.purgeAuditLogs()
    assert.equal(result.removed, 1)
    assert.deepEqual(deps.store.audit.map((e) => e.id).slice(0, 1), ['a2'])
    const entry = deps.store.audit.at(-1)
    assert.equal(entry.action, 'audit_log.purge')
    assert.equal(entry.userId, null)
    assert.deepEqual(entry.newValue, { removed: 1, before: '2026-07-01T12:00:00.000Z', retention_months: 3 })
    entry.createdAt = deps.clock.now() // o fake data o histórico em jan/2026; o registro da limpeza é de agora
    // nada a apagar: não registra de novo
    const count = deps.store.audit.length
    assert.equal(service.purgeAuditLogs().removed, 0)
    assert.equal(deps.store.audit.length, count)

    // "Limpar agora": só platform.manage; quem pediu fica no histórico
    assert.equal(codeOf(() => service.runRetentionNow(ctxOf(setup().manager))), 'FORBIDDEN')
    deps.store.audit.push({ id: 'a3', action: 'x', entityType: 'task', entityId: 't', createdAt: new Date('2026-06-01T00:00:00Z') })
    assert.equal(service.runRetentionNow(ctxOf(admin)).removed, 1)
    assert.equal(deps.store.audit.at(-1).userId, admin.id)
    deps.store.audit.at(-1).createdAt = deps.clock.now()

    service.updateSettings(ctxOf(admin), { audit_retention_months: 0 })
    deps.store.audit.push({ id: 'a0', action: 'x', entityType: 'task', entityId: 't', createdAt: new Date('2020-01-01T00:00:00Z') })
    assert.deepEqual(service.purgeAuditLogs(), { removed: 0, skipped: true })
  })
})

describe('application/platform-settings — políticas aplicadas', () => {
  const ctx = { ip: '10.0.0.1', userAgent: 'test', correlationId: 'c1' }

  it('login: o bloqueio segue o número de tentativas e o tempo configurados', () => {
    const { deps, service, admin, ctxOf } = setup()
    service.updateSettings(ctxOf(admin), { lockout_threshold: 3, lockout_base_minutes: 15 })
    seedUser(deps, { email: 'ana@example.com', password: 'senhaForte123' })
    const auth = createAuthService(deps)
    for (let i = 0; i < 3; i++) assert.equal(codeOf(() => auth.login({ email: 'ana@example.com', password: 'errada123456' }, ctx)), 'INVALID_CREDENTIALS')
    assert.throws(
      () => auth.login({ email: 'ana@example.com', password: 'senhaForte123' }, ctx),
      (err) => err.code === 'ACCOUNT_LOCKED' && err.details.retry_after_seconds === 900,
    )
  })

  it('senha: trocar, criar e redefinir seguem a política vigente; a política é lida por quem está logado', () => {
    const { deps, service, admin, manager, ctxOf } = setup()
    service.updateSettings(ctxOf(admin), { password_min_length: 12, password_require_mixed_case: true, password_require_symbol: true })
    assert.deepEqual(service.passwordPolicy(ctxOf(manager)), { min_length: 12, max_length: 72, require_letters_numbers: true, require_mixed_case: true, require_symbol: true })
    assert.equal(codeOf(() => service.passwordPolicy({ principal: null })), 'UNAUTHENTICATED')

    const auth = createAuthService(deps)
    assert.deepEqual(fieldsOf(() => auth.changePassword(ctxOf(manager), { current_password: 'senhaForte123', new_password: 'semmaiuscula12#' })), {
      new_password: 'needs_mixed_case',
    })
    assert.equal(auth.changePassword(ctxOf(manager), { current_password: 'senhaForte123', new_password: 'ComMaiuscula12#' }).changed, true)

    const users = createUserService(deps)
    const role = deps.roleRepository.findByCode('MEMBER')
    assert.deepEqual(fieldsOf(() => users.createUser(ctxOf(admin), { name: 'Bia', email: 'bia@example.com', password: 'Curta1#', role_id: role.id })), {
      password: 'too_short',
    })
    const bia = users.createUser(ctxOf(admin), { name: 'Bia', email: 'bia@example.com', password: 'SenhaDaBia12#', role_id: role.id })
    assert.deepEqual(fieldsOf(() => users.resetPassword(ctxOf(admin), bia.id, { password: 'semsimbolo12AB' })), { password: 'needs_symbol' })
  })
})

describe('application/platform-settings — identidade', () => {
  it('logo e ícone: tipo conferido, histórico, informação pública com endereço versionado; remover', () => {
    const { deps, service, admin, manager, ctxOf } = setup()
    assert.deepEqual(service.publicInfo(), { name: 'Avanza', logo_light_url: null, logo_dark_url: null, favicon_url: null, password_reset: false })
    assert.equal(codeOf(() => service.uploadBranding(ctxOf(manager), 'logo_light', { name: 'm.png', size: 12, bytes: PNG })), 'FORBIDDEN')

    const view = service.uploadBranding(ctxOf(admin), 'logo_light', { name: 'marca.png', size: 12, bytes: PNG, handle: {} })
    assert.deepEqual(view.branding.logo_light, { name: 'marca.png', mime: 'image/png', size: 12 })
    assert.equal(deps.store.audit.at(-1).action, 'platform_settings.branding_update')
    assert.deepEqual(deps.store.audit.at(-1).newValue, { slot: 'logo_light', name: 'marca.png', size: 12 })
    const info = service.publicInfo()
    assert.match(info.logo_light_url, /^\/api\/v1\/platform\/branding\/logo_light\?v=\d+$/)
    assert.equal(info.favicon_url, null)
    assert.equal(service.brandingFile('logo_light').mime, 'image/png')
    assert.equal(codeOf(() => service.brandingFile('favicon')), 'NOT_FOUND')
    assert.equal(codeOf(() => service.brandingFile('../etc')), 'NOT_FOUND')

    assert.deepEqual(fieldsOf(() => service.uploadBranding(ctxOf(admin), 'logo_dark', { name: 'm.svg', size: 30, bytes: ascii('<svg onload="x()"></svg>') })), { file: 'unsafe_svg' })
    assert.deepEqual(fieldsOf(() => service.uploadBranding(ctxOf(admin), 'banner', { name: 'm.png', size: 12, bytes: PNG })), { slot: 'invalid_slot' })
    assert.deepEqual(fieldsOf(() => service.uploadBranding(ctxOf(admin), 'favicon', null)), { file: 'required' })
    assert.deepEqual(fieldsOf(() => service.uploadBranding(ctxOf(admin), 'favicon', { name: 'f.png', size: 2 * 1024 * 1024, bytes: PNG })), { file: 'file_too_large' })

    service.removeBranding(ctxOf(admin), 'logo_light')
    assert.equal(service.publicInfo().logo_light_url, null)
    assert.equal(deps.store.audit.at(-1).action, 'platform_settings.branding_remove')
  })
})
