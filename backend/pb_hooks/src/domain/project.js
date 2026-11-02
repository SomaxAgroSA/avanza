/**
 * Regras de negócio de projetos.
 *
 * Acesso a um projeto = permissão global (RBAC) E vínculo com o projeto:
 * - enxerga: membro, dono ou quem tem `projects.view_all`;
 * - administra (editar, membros, arquivar): gestor do projeto (o dono é gestor) ou `projects.view_all`;
 * - transfere a posse / exclui: dono ou `projects.view_all`; excluir só projeto arquivado.
 * Quem não enxerga recebe PROJECT_NOT_FOUND (não confirma a existência — proteção contra IDOR).
 */

const { appError } = require('../core/errors')
const rbac = require('./rbac')

const PROJECT_STATUS = Object.freeze(['planning', 'active', 'paused', 'completed', 'cancelled'])
const PROJECT_PRIORITY = Object.freeze(['low', 'medium', 'high', 'critical'])
/** `it` = Responsável TI: só vê o resumo do projeto (nome, objetivo e o que precisamos dele) e as próprias tarefas. */
const MEMBER_ROLES = Object.freeze(['manager', 'member', 'viewer', 'it'])
const PROJECT_ICONS = Object.freeze([
  'folder', 'rocket', 'briefcase', 'code', 'database', 'globe', 'shield', 'users', 'chart', 'settings',
  'layers', 'zap', 'star', 'box', 'truck', 'building', 'cpu', 'headphones', 'book', 'target',
])
const PROJECT_COVERS = Object.freeze(['violet', 'indigo', 'blue', 'cyan', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'slate'])

const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/

function normalizeKey(key) {
  return String(key || '').trim().toUpperCase()
}

function keyIssue(key) {
  return KEY_PATTERN.test(key) ? null : 'invalid_format'
}

function datesIssue(start, due) {
  if (start && due && due.getTime() < start.getTime()) return 'due_before_start'
  return null
}

/** Calcula o vínculo do principal com o projeto. `membership` = { role } ou null. */
function resolveAccess(principal, project, membership) {
  const viewAll = rbac.can(principal, 'projects.view_all')
  const isOwner = !!principal && project.ownerId === principal.userId
  const memberRole = membership ? membership.role : null
  // Responsável TI: fora de tudo por padrão (canView = false); só o resumo e as próprias tarefas
  const limited = !viewAll && !isOwner && memberRole === 'it' && rbac.can(principal, 'projects.view')
  return {
    principal,
    viewAll,
    isOwner,
    role: isOwner ? 'owner' : memberRole,
    isManager: isOwner || memberRole === 'manager' || viewAll,
    limited,
    canView: rbac.can(principal, 'projects.view') && (viewAll || isOwner || (!!membership && !limited)),
    get canEdit() {
      return this.canView && rbac.can(principal, 'projects.edit') && this.isManager && !project.archivedAt
    },
  }
}

/**
 * Verifica se a ação é permitida; lança o erro adequado caso contrário.
 * Ações: brief | view | edit | manage_members | archive | transfer | delete
 * (`brief` = resumo do projeto, também liberado para o Responsável TI).
 */
function assertAccess(access, project, action) {
  if (action === 'brief') {
    if (!access.canView && !access.limited) throw appError('PROJECT_NOT_FOUND')
    return
  }
  if (!access.canView) throw appError('PROJECT_NOT_FOUND')
  if (action === 'view') return

  const principal = access.principal
  const archived = !!project.archivedAt

  if (action === 'edit' || action === 'manage_members' || action === 'archive') {
    if (!rbac.can(principal, 'projects.edit') || !access.isManager) throw appError('FORBIDDEN')
    if (archived && action !== 'archive') throw appError('PROJECT_ARCHIVED')
    return
  }
  if (action === 'transfer') {
    if (!rbac.can(principal, 'projects.edit') || !(access.isOwner || access.viewAll)) throw appError('FORBIDDEN')
    if (archived) throw appError('PROJECT_ARCHIVED')
    return
  }
  if (action === 'delete') {
    if (!rbac.can(principal, 'projects.delete') || !(access.isOwner || access.viewAll)) throw appError('FORBIDDEN')
    if (!archived) throw appError('PROJECT_NOT_ARCHIVED')
    return
  }
  throw appError('FORBIDDEN')
}

function allowed(access, project, action) {
  try {
    assertAccess(access, project, action)
    return true
  } catch (_) {
    return false
  }
}

/** Capacidades do usuário atual no projeto (a interface usa para habilitar ações). */
function capabilities(access, project) {
  return {
    edit: allowed(access, project, 'edit'),
    manage_members: allowed(access, project, 'manage_members'),
    archive: allowed(access, project, 'archive'),
    delete: allowed(access, project, 'delete'),
    transfer: allowed(access, project, 'transfer'),
  }
}

module.exports = {
  PROJECT_STATUS,
  PROJECT_PRIORITY,
  MEMBER_ROLES,
  PROJECT_ICONS,
  PROJECT_COVERS,
  normalizeKey,
  keyIssue,
  datesIssue,
  resolveAccess,
  assertAccess,
  capabilities,
}
