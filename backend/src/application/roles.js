/**
 * Casos de uso de perfis (roles) e permissões.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const { ROLE_CODES } = require('../domain/permissions')
const { hiddenScreensIssue, screenStartsIssue, normalizeHidden, normalizeStarts } = require('../domain/screens')
const { buildAuditEntry, diff } = require('./audit')
const { toRoleDto } = require('./presenters')

const ROLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/
const MAX_PERMISSIONS = 500

const roleCode = rules.custom((value) => {
  if (typeof value !== 'string') return 'invalid_type'
  return ROLE_CODE_PATTERN.test(value.trim().toUpperCase()) ? null : 'invalid_format'
})

/** "O que aparece" do perfil (§48): as partes escondidas e onde cada módulo abre (domain/screens.js). */
const hiddenScreens = rules.custom(hiddenScreensIssue)
const screenStarts = rules.custom(screenStartsIssue)

const CREATE_SCHEMA = {
  code: [rules.required(), roleCode],
  name: [rules.required(), rules.maxLength(60)],
  description: [rules.maxLength(255)],
  permissions: [rules.stringArray(MAX_PERMISSIONS)],
  hidden_screens: [hiddenScreens],
  screen_starts: [screenStarts],
}

const UPDATE_SCHEMA = {
  name: [rules.required(), rules.maxLength(60)],
  description: [rules.maxLength(255)],
  hidden_screens: [hiddenScreens],
  screen_starts: [screenStarts],
}

const READ_ROLES_PERMISSIONS = ['permissions.manage', 'users.view', 'users.create', 'users.edit']

function uniqueSorted(codes) {
  return codes.filter((code, index) => codes.indexOf(code) === index).sort()
}

/**
 * "O que aparece" que vai ser gravado (§48): as escondidas na ordem do catálogo e o "Abre em" só com itens visíveis
 * (um item que acabou de ser escondido perde a entrada; a tela abre no primeiro visível). `current` = o que o perfil
 * já tem, para o campo que não veio. Um "Abre em" num item escondido é recusado (VALIDATION_ERROR).
 */
function screenValues(data, current) {
  const hidden = normalizeHidden(data.hidden_screens !== undefined ? data.hidden_screens : current.hiddenScreens)
  if (data.screen_starts !== undefined) {
    const kept = normalizeStarts(data.screen_starts, hidden)
    if (Object.keys(kept).length !== Object.keys(data.screen_starts).length) throw appError('VALIDATION_ERROR', undefined, { fields: { screen_starts: 'invalid_option' } })
    return { hiddenScreens: hidden, screenStarts: kept }
  }
  return { hiddenScreens: hidden, screenStarts: normalizeStarts(current.screenStarts, hidden) }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function withoutScreens(values) {
  const out = Object.assign({}, values)
  delete out.hiddenScreens
  delete out.screenStarts
  return out
}

/** Na auditoria os campos saem como na API (hidden_screens, screen_starts). */
function publicScreens(values) {
  const out = {}
  if (values.hiddenScreens !== undefined) out.hidden_screens = values.hiddenScreens
  if (values.screenStarts !== undefined) out.screen_starts = values.screenStarts
  return out
}

function createRoleService(deps) {
  async function findRoleOrFail(id) {
    const role = id ? await deps.roleRepository.findById(id) : null
    if (!role) throw appError('ROLE_NOT_FOUND')
    return role
  }

  async function present(role) {
    return toRoleDto(role, {
      permissions: await deps.roleRepository.getPermissionCodes(role.id),
      userCount: await deps.userRepository.countByRole(role.id),
    })
  }

  function assertCanReadRoles(principal) {
    rbac.assertAuthenticated(principal)
    if (!READ_ROLES_PERMISSIONS.some((code) => rbac.can(principal, code))) throw appError('FORBIDDEN')
  }

  async function listPermissions(ctx) {
    rbac.assertCan(ctx.principal, 'permissions.manage')
    return (await deps.permissionRepository.list()).map((p) => ({ id: p.id, code: p.code, module: p.module }))
  }

  async function listRoles(ctx) {
    assertCanReadRoles(ctx.principal)
    return await Promise.all((await deps.roleRepository.list()).map(present))
  }

  async function getRole(ctx, id) {
    assertCanReadRoles(ctx.principal)
    return await present(await findRoleOrFail(id))
  }

  async function createRole(ctx, input) {
    rbac.assertCan(ctx.principal, 'permissions.manage')
    const data = assertValid(input, CREATE_SCHEMA)
    const code = data.code.trim().toUpperCase()
    if (await deps.roleRepository.findByCode(code)) throw appError('ROLE_CODE_IN_USE')

    const permissions = uniqueSorted(data.permissions || [])
    rbac.assertCanUpdateRolePermissions(ctx.principal, { id: null, code }, permissions)

    // perfil novo vê tudo, a menos que já venha com o que esconder (§48)
    const screens = screenValues(data, { hiddenScreens: [], screenStarts: {} })
    const role = await deps.unitOfWork.run(async (repos) => {
      const created = await repos.roleRepository.create(Object.assign({ code, name: data.name, description: data.description || '' }, screens))
      await repos.roleRepository.setPermissionCodes(created.id, permissions)
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'role',
          entityId: created.id,
          action: 'role.created',
          newValue: Object.assign({ code, name: data.name, permissions }, publicScreens(screens)),
        }),
      )
      return created
    })
    return await present(role)
  }

  async function updateRole(ctx, id, input) {
    rbac.assertCan(ctx.principal, 'permissions.manage')
    const role = await findRoleOrFail(id)
    if (role.code === ROLE_CODES.SUPER_ADMIN) throw appError('ROLE_IMMUTABLE')
    const data = assertValid(input, UPDATE_SCHEMA)
    const changes = diff(role, { name: data.name, description: data.description }, ['name', 'description']) || { oldValue: {}, newValue: {} }
    // "O que aparece" (§48): listas e objetos comparados pelo conteúdo; omitir os campos não os muda
    const current = { hiddenScreens: normalizeHidden(role.hiddenScreens), screenStarts: normalizeStarts(role.screenStarts, role.hiddenScreens) }
    const screens = screenValues(data, current)
    ;['hiddenScreens', 'screenStarts'].forEach((field) => {
      if (same(current[field], screens[field])) return
      changes.oldValue[field] = current[field]
      changes.newValue[field] = screens[field]
    })
    if (Object.keys(changes.newValue).length === 0) return await present(role)

    const updated = await deps.unitOfWork.run(async (repos) => {
      const saved = await repos.roleRepository.update(role.id, changes.newValue)
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'role',
          entityId: role.id,
          action: 'role.updated',
          oldValue: Object.assign(withoutScreens(changes.oldValue), publicScreens(changes.oldValue)),
          newValue: Object.assign(withoutScreens(changes.newValue), publicScreens(changes.newValue)),
        }),
      )
      return saved
    })
    return await present(updated)
  }

  async function updateRolePermissions(ctx, id, codes) {
    rbac.assertCan(ctx.principal, 'permissions.manage')
    const data = assertValid({ permissions: codes }, { permissions: [rules.required(), rules.stringArray(MAX_PERMISSIONS)] })
    const role = await findRoleOrFail(id)
    const next = uniqueSorted(data.permissions)
    rbac.assertCanUpdateRolePermissions(ctx.principal, role, next)

    const previous = uniqueSorted(await deps.roleRepository.getPermissionCodes(role.id))
    await deps.unitOfWork.run(async (repos) => {
      await repos.roleRepository.setPermissionCodes(role.id, next)
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'role',
          entityId: role.id,
          action: 'role.permissions_updated',
          oldValue: { permissions: previous },
          newValue: { permissions: next },
        }),
      )
    })
    return await present(role)
  }

  async function deleteRole(ctx, id) {
    rbac.assertCan(ctx.principal, 'permissions.manage')
    const role = await findRoleOrFail(id)
    if (role.isSystem) throw appError('ROLE_IMMUTABLE')
    if ((await deps.userRepository.countByRole(role.id)) > 0) throw appError('ROLE_IN_USE')

    await deps.unitOfWork.run(async (repos) => {
      await repos.roleRepository.delete(role.id)
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'role',
          entityId: role.id,
          action: 'role.deleted',
          oldValue: { code: role.code, name: role.name },
        }),
      )
    })
    return { deleted: true }
  }

  return { listPermissions, listRoles, getRole, createRole, updateRole, updateRolePermissions, deleteRole }
}

module.exports = { createRoleService }
