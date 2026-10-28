/**
 * Regras de negócio do usuário.
 */

const { appError } = require('../core/errors')
const { ROLE_CODES } = require('./permissions')
const rbac = require('./rbac')

const USER_STATUS = Object.freeze({ ACTIVE: 'active', DISABLED: 'disabled' })
const LOCALES = Object.freeze(['pt-BR', 'en', 'es'])
const THEMES = Object.freeze(['light', 'dark', 'system'])

const PASSWORD_MIN = 10
const PASSWORD_MAX = 72 // limite do bcrypt

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

/**
 * Retorna o código do problema da senha ou null quando aceitável. `policy` vem do Configurador geral
 * (domain/platform-settings.passwordPolicy); sem ela, a regra padrão (10 caracteres, letras e números).
 */
function passwordIssue(password, policy) {
  const min = policy ? policy.min_length : PASSWORD_MIN
  if (typeof password !== 'string' || password.length < min) return 'too_short'
  if (password.length > PASSWORD_MAX) return 'too_long'
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'weak_password'
  if (policy && policy.require_mixed_case && (!/[a-z]/.test(password) || !/[A-Z]/.test(password))) return 'needs_mixed_case'
  if (policy && policy.require_symbol && !/[^A-Za-z0-9]/.test(password)) return 'needs_symbol'
  return null
}

function assertCanAuthenticate(user) {
  if (user.status !== USER_STATUS.ACTIVE) throw appError('ACCOUNT_DISABLED')
}

/**
 * Alterar status (ativar/desativar):
 * - exige users.disable;
 * - ninguém desativa a si mesmo;
 * - apenas SUPER_ADMIN altera um SUPER_ADMIN.
 */
function assertCanChangeStatus(principal, target, nextStatus) {
  rbac.assertCan(principal, 'users.disable')
  if (target.id === principal.userId && nextStatus === USER_STATUS.DISABLED) throw appError('CANNOT_DISABLE_SELF')
  if (target.roleCode === ROLE_CODES.SUPER_ADMIN && !rbac.isSuperAdmin(principal)) throw appError('FORBIDDEN')
}

/** Editar dados de outro usuário: exige users.edit e protege SUPER_ADMIN. */
function assertCanEdit(principal, target) {
  if (target.id === principal.userId) return // edição do próprio perfil (dados pessoais)
  rbac.assertCan(principal, 'users.edit')
  if (target.roleCode === ROLE_CODES.SUPER_ADMIN && !rbac.isSuperAdmin(principal)) throw appError('FORBIDDEN')
}

module.exports = {
  USER_STATUS,
  LOCALES,
  THEMES,
  PASSWORD_MIN,
  PASSWORD_MAX,
  normalizeEmail,
  passwordIssue,
  assertCanAuthenticate,
  assertCanChangeStatus,
  assertCanEdit,
}
