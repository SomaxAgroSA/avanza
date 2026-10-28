/**
 * Regras de autorização (RBAC).
 *
 * O "principal" representa o usuário autenticado na requisição atual.
 * Nenhuma regra aqui confia no frontend: toda verificação acontece no backend.
 */

const { appError } = require('../core/errors')
const { ROLE_CODES, isKnownPermission } = require('./permissions')

function createPrincipal(input) {
  return Object.freeze({
    userId: input.userId,
    roleId: input.roleId,
    roleCode: input.roleCode,
    permissions: Object.freeze((input.permissions || []).slice()),
    sessionId: input.sessionId || null,
  })
}

function isSuperAdmin(principal) {
  return !!principal && principal.roleCode === ROLE_CODES.SUPER_ADMIN
}

function can(principal, permission) {
  if (!principal) return false
  if (isSuperAdmin(principal)) return true
  return principal.permissions.indexOf(permission) >= 0
}

function assertAuthenticated(principal) {
  if (!principal) throw appError('UNAUTHENTICATED')
}

function assertCan(principal, permission) {
  assertAuthenticated(principal)
  if (!can(principal, permission)) throw appError('FORBIDDEN', undefined, { permission })
}

/** Permissões em `codes` que o principal não possui (usado para impedir escalonamento). */
function missingPermissions(principal, codes) {
  return codes.filter((code) => !can(principal, code))
}

/**
 * Regras para alterar as permissões de um perfil:
 * - exige permissions.manage;
 * - SUPER_ADMIN é imutável;
 * - ninguém além do SUPER_ADMIN altera o próprio perfil;
 * - só aceita códigos do catálogo;
 * - não é possível conceder permissões que o próprio ator não possui.
 */
function assertCanUpdateRolePermissions(principal, role, permissionCodes) {
  assertCan(principal, 'permissions.manage')
  if (role.code === ROLE_CODES.SUPER_ADMIN) throw appError('ROLE_IMMUTABLE')
  if (!isSuperAdmin(principal) && principal.roleId === role.id) throw appError('CANNOT_EDIT_OWN_ROLE')

  const unknown = permissionCodes.filter((code) => !isKnownPermission(code))
  if (unknown.length > 0) {
    throw appError('VALIDATION_ERROR', undefined, { fields: { permissions: 'invalid_option' }, unknown })
  }

  const missing = missingPermissions(principal, permissionCodes)
  if (missing.length > 0) throw appError('PRIVILEGE_ESCALATION', undefined, { permissions: missing })
}

/** Regras para atribuir um perfil a um usuário (criação ou edição). */
function assertCanAssignRole(principal, role, rolePermissionCodes) {
  assertAuthenticated(principal)
  if (role.code === ROLE_CODES.SUPER_ADMIN && !isSuperAdmin(principal)) {
    throw appError('PRIVILEGE_ESCALATION', undefined, { role: role.code })
  }
  const missing = missingPermissions(principal, rolePermissionCodes)
  if (missing.length > 0) throw appError('PRIVILEGE_ESCALATION', undefined, { permissions: missing })
}

module.exports = {
  createPrincipal,
  isSuperAdmin,
  can,
  assertAuthenticated,
  assertCan,
  assertCanUpdateRolePermissions,
  assertCanAssignRole,
}
