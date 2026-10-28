/**
 * Erros de aplicação padronizados.
 *
 * Cada erro possui um código estável (contrato da API /api/v1) e um status HTTP.
 * Este módulo é puro: não depende do PocketBase e roda tanto no JSVM quanto no Node (testes).
 */

const ERROR_DEFINITIONS = Object.freeze({
  VALIDATION_ERROR: { status: 400, message: 'Invalid data' },
  BAD_REQUEST: { status: 400, message: 'Bad request' },
  USE_CHANGE_PASSWORD: { status: 400, message: 'Use the change password flow for your own account' },
  UNAUTHENTICATED: { status: 401, message: 'Authentication required' },
  INVALID_CREDENTIALS: { status: 401, message: 'Invalid email or password' },
  SESSION_EXPIRED: { status: 401, message: 'Session expired' },
  ACCOUNT_DISABLED: { status: 403, message: 'Account disabled' },
  FORBIDDEN: { status: 403, message: 'You do not have permission to perform this action' },
  CSRF_CHECK_FAILED: { status: 403, message: 'Request blocked by CSRF protection' },
  PRIVILEGE_ESCALATION: { status: 403, message: 'You cannot grant access you do not have' },
  CANNOT_EDIT_OWN_ROLE: { status: 403, message: 'You cannot change the permissions of your own role' },
  CANNOT_DISABLE_SELF: { status: 403, message: 'You cannot disable your own account' },
  ROLE_IMMUTABLE: { status: 403, message: 'This role cannot be changed' },
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  ROUTE_NOT_FOUND: { status: 404, message: 'Route not found' },
  ROLE_NOT_FOUND: { status: 404, message: 'Role not found' },
  USER_NOT_FOUND: { status: 404, message: 'User not found' },
  SESSION_NOT_FOUND: { status: 404, message: 'Session not found' },
  PROJECT_NOT_FOUND: { status: 404, message: 'Project not found' },
  MEMBER_NOT_FOUND: { status: 404, message: 'Project member not found' },
  FIELD_NOT_FOUND: { status: 404, message: 'Custom field not found' },
  TASK_TYPE_NOT_FOUND: { status: 404, message: 'Task type not found' },
  TASK_NOT_FOUND: { status: 404, message: 'Task not found' },
  COMMENT_NOT_FOUND: { status: 404, message: 'Comment not found' },
  TAG_NOT_FOUND: { status: 404, message: 'Tag not found' },
  RELATION_NOT_FOUND: { status: 404, message: 'Relation not found' },
  SPRINT_NOT_FOUND: { status: 404, message: 'Sprint not found' },
  MILESTONE_NOT_FOUND: { status: 404, message: 'Milestone not found' },
  GROUP_NOT_FOUND: { status: 404, message: 'Project group not found' },
  PLAN_ITEM_NOT_FOUND: { status: 404, message: 'Board item not found' },
  PLAN_STATUS_NOT_FOUND: { status: 404, message: 'Board status label not found' },
  PLAN_RESOURCE_NOT_FOUND: { status: 404, message: 'Board resource label not found' },
  PLAN_RESOURCE_NAME_IN_USE: { status: 409, message: 'A resource label with this name already exists' },
  PLAN_LINK_NOT_FOUND: { status: 404, message: 'Board dependency not found' },
  PLAN_DEPENDENCY_PENDING: { status: 409, message: 'This item has a pending dependency' },
  PLAN_UPDATE_NOT_FOUND: { status: 404, message: 'Board item update not found' },
  PLAN_FILE_NOT_FOUND: { status: 404, message: 'Board item file not found' },
  PLAN_JOURNAL_NOT_FOUND: { status: 404, message: 'Project journal entry not found' },
  PLAN_ISSUE_NOT_FOUND: { status: 404, message: 'Project issue not found' },
  PLAN_COLUMN_NOT_FOUND: { status: 404, message: 'Board column not found' },
  DOC_SPACE_NOT_FOUND: { status: 404, message: 'Documentation space not found' },
  DOC_PAGE_NOT_FOUND: { status: 404, message: 'Documentation page not found' },
  DOC_VERSION_NOT_FOUND: { status: 404, message: 'Page version not found' },
  DOC_FILE_NOT_FOUND: { status: 404, message: 'Documentation file not found' },
  DOC_SPACE_KEY_IN_USE: { status: 409, message: 'Space key already in use' },
  DOC_PAGE_CYCLE: { status: 409, message: 'A page cannot be moved under itself' },
  DOC_PAGE_TOO_DEEP: { status: 409, message: 'Too many page levels' },
  DOC_PAGE_IS_HOME: { status: 409, message: 'The space home page cannot be moved or deleted' },
  ATTACHMENT_NOT_FOUND: { status: 404, message: 'Attachment not found' },
  NOTIFICATION_NOT_FOUND: { status: 404, message: 'Notification not found' },
  STATUS_NOT_FOUND: { status: 404, message: 'Status not found' },
  PRIORITY_NOT_FOUND: { status: 404, message: 'Priority not found' },
  CONFLICT: { status: 409, message: 'Conflict' },
  EMAIL_ALREADY_IN_USE: { status: 409, message: 'Email already in use' },
  EMAIL_NOT_CONFIGURED: { status: 409, message: 'Email delivery is not configured' },
  EMAIL_SEND_FAILED: { status: 502, message: 'The mail server refused or did not answer' },
  RESET_TOKEN_INVALID: { status: 400, message: 'The link is invalid, expired or was already used' },
  USER_ALREADY_ACTIVE: { status: 409, message: 'The user has already signed in' },
  API_TOKEN_INVALID: { status: 401, message: 'Invalid, expired or revoked API token' },
  API_TOKEN_NOT_FOUND: { status: 404, message: 'API token not found' },
  API_TOKEN_LIMIT: { status: 409, message: 'Too many active API tokens' },
  TOKEN_NOT_ALLOWED: { status: 403, message: 'This action requires signing in with the browser' },
  WEBHOOK_NOT_FOUND: { status: 404, message: 'Webhook not found' },
  WEBHOOK_DELIVERY_NOT_FOUND: { status: 404, message: 'Webhook delivery not found' },
  ROLE_CODE_IN_USE: { status: 409, message: 'Role code already in use' },
  ROLE_IN_USE: { status: 409, message: 'Role is assigned to users' },
  PROJECT_KEY_IN_USE: { status: 409, message: 'Project key already in use' },
  PROJECT_ARCHIVED: { status: 409, message: 'Project is archived' },
  PROJECT_NOT_ARCHIVED: { status: 409, message: 'Archive the project before deleting it' },
  MEMBER_ALREADY_EXISTS: { status: 409, message: 'User is already a member of this project' },
  CANNOT_REMOVE_OWNER: { status: 409, message: 'The project owner cannot be removed' },
  OWNER_ROLE_LOCKED: { status: 409, message: "The project owner's role cannot be changed" },
  FIELD_NAME_IN_USE: { status: 409, message: 'Field name already in use' },
  FIELD_IN_USE: { status: 409, message: 'Field is used by task types' },
  TASK_TYPE_KEY_IN_USE: { status: 409, message: 'Task type key already in use' },
  TASK_TYPE_IN_USE: { status: 409, message: 'Task type is used by tasks' },
  STATUS_KEY_IN_USE: { status: 409, message: 'Status key already in use' },
  STATUS_IN_USE: { status: 409, message: 'Status is used by tasks' },
  STATUS_IS_DEFAULT: { status: 409, message: 'The default status cannot be removed' },
  PRIORITY_KEY_IN_USE: { status: 409, message: 'Priority key already in use' },
  PRIORITY_IN_USE: { status: 409, message: 'Priority is used by tasks' },
  TAG_NAME_IN_USE: { status: 409, message: 'Tag name already in use' },
  TRANSITION_NOT_ALLOWED: { status: 409, message: 'This status change is not allowed' },
  RELATION_EXISTS: { status: 409, message: 'These tasks are already related this way' },
  RELATION_CYCLE: { status: 409, message: 'This relation would create a cycle' },
  NOT_IN_BACKLOG: { status: 409, message: 'The task is no longer in the backlog' },
  PRIORITY_IS_DEFAULT: { status: 409, message: 'The default priority cannot be removed' },
  RATE_LIMITED: { status: 429, message: 'Too many requests, try again later' },
  ACCOUNT_LOCKED: { status: 429, message: 'Too many failed sign-in attempts for this account' },
  INTERNAL_ERROR: { status: 500, message: 'Unexpected error' },
})

/**
 * Cria um erro de aplicação. Códigos desconhecidos viram INTERNAL_ERROR.
 * Não usa `class extends Error` para manter compatibilidade com o JSVM (goja).
 */
function appError(code, message, details) {
  const known = Object.prototype.hasOwnProperty.call(ERROR_DEFINITIONS, code)
  const finalCode = known ? code : 'INTERNAL_ERROR'
  const def = ERROR_DEFINITIONS[finalCode]
  const err = new Error(message || def.message)
  err.name = 'AppError'
  err.code = finalCode
  err.status = def.status
  err.details = details || {}
  return err
}

function isAppError(err) {
  return !!err && err.name === 'AppError' && typeof err.code === 'string'
}

/**
 * Converte qualquer erro em { status, error } seguro para resposta.
 * Erros inesperados nunca expõem a mensagem interna (pode conter dados sensíveis).
 */
function toErrorPayload(err) {
  const safe = isAppError(err) ? err : appError('INTERNAL_ERROR')
  return {
    status: safe.status,
    error: { code: safe.code, message: safe.message, details: safe.details || {} },
  }
}

module.exports = { ERROR_DEFINITIONS, appError, isAppError, toErrorPayload }
