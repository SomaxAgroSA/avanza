/**
 * Consulta do histórico de auditoria (somente leitura — registros são imutáveis).
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const { parsePagination, buildPageMeta } = require('../core/pagination')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const taskDomain = require('../domain/task')
const { iso } = require('./presenters')

const LIST_SCHEMA = {
  entity_type: [rules.maxLength(50)],
  entity_id: [rules.maxLength(40)],
  user_id: [rules.maxLength(40)],
  action: [rules.maxLength(80)],
  from: [rules.isoDate()],
  to: [rules.isoDate()],
}

/**
 * Histórico por entidade: quem pode ver a entidade pode ver o histórico dela (ou quem tem audit.view).
 * `authorize` confirma a existência e o acesso (evita enumeração por IDs inexistentes).
 */
function byPermission(anyOf, notFound, find) {
  return (deps, principal, id) => {
    const allowed = rbac.can(principal, 'audit.view') || anyOf.some((code) => rbac.can(principal, code))
    if (!allowed) throw appError('FORBIDDEN')
    if (!id || !find(deps, id)) throw appError(notFound)
  }
}

const ENTITY_HISTORY = {
  user: byPermission(['users.view'], 'USER_NOT_FOUND', (deps, id) => deps.userRepository.findById(id)),
  role: byPermission(['permissions.manage'], 'ROLE_NOT_FOUND', (deps, id) => deps.roleRepository.findById(id)),
  task_type: byPermission(['settings.manage'], 'TASK_TYPE_NOT_FOUND', (deps, id) => deps.taskTypeRepository.findById(id)),
  custom_field: byPermission(['settings.manage'], 'FIELD_NOT_FOUND', (deps, id) => deps.customFieldRepository.findById(id)),
  project: (deps, principal, id) => {
    const project = id ? deps.projectRepository.findById(id) : null
    if (!project) throw appError('PROJECT_NOT_FOUND')
    const membership = deps.projectMemberRepository.find(project.id, principal.userId)
    projectDomain.assertAccess(projectDomain.resolveAccess(principal, project, membership), project, 'history')
  },
  // elemento do quadro (GP-3): quem vê o quadro do projeto
  plan_item: (deps, principal, id) => {
    const item = id ? deps.planItemRepository.findById(id) : null
    const project = item ? deps.projectRepository.findById(item.projectId) : null
    if (!item || !project) throw appError('PLAN_ITEM_NOT_FOUND')
    const access = projectDomain.resolveAccess(principal, project, deps.projectMemberRepository.find(project.id, principal.userId))
    if (!access.canView || !rbac.can(principal, 'plan.view')) throw appError('PLAN_ITEM_NOT_FOUND')
  },
  task: (deps, principal, id) => {
    const task = id ? deps.taskRepository.findById(id) : null
    const project = task ? deps.projectRepository.findById(task.projectId) : null
    if (!task || !project) throw appError('TASK_NOT_FOUND')
    const membership = deps.projectMemberRepository.find(project.id, principal.userId)
    taskDomain.assertTaskAccess(taskDomain.scopedAccess(projectDomain.resolveAccess(principal, project, membership), task), project, 'view', task)
  },
}

function createAuditService(deps) {
  function present(entries) {
    const ids = entries.map((e) => e.userId).filter((id, i, all) => id && all.indexOf(id) === i)
    const actors = {}
    if (ids.length > 0) {
      deps.userRepository.findManyByIds(ids).forEach((u) => {
        actors[u.id] = { id: u.id, name: u.name, email: u.email }
      })
    }
    return entries.map((e) => ({
      id: e.id,
      entity_type: e.entityType,
      entity_id: e.entityId,
      action: e.action,
      old_value: e.oldValue || null,
      new_value: e.newValue || null,
      user: e.userId ? actors[e.userId] || { id: e.userId, name: null, email: null } : null,
      ip: e.ip || '',
      correlation_id: e.correlationId || '',
      created_at: iso(e.createdAt),
    }))
  }

  function query(filters, rawQuery) {
    const pagination = parsePagination(rawQuery)
    const result = deps.auditRepository.list({ filters, pagination })
    return { items: present(result.items), meta: buildPageMeta(pagination, result.total) }
  }

  function listAuditLogs(ctx, rawQuery) {
    rbac.assertCan(ctx.principal, 'audit.view')
    const q = rawQuery || {}
    const pick = (key) => (q[key] === undefined || q[key] === '' ? undefined : q[key])
    const data = assertValid(
      {
        entity_type: pick('entity_type'),
        entity_id: pick('entity_id'),
        user_id: pick('user_id'),
        action: pick('action'),
        from: pick('from'),
        to: pick('to'),
      },
      LIST_SCHEMA,
    )
    return query(
      {
        entityType: data.entity_type,
        entityId: data.entity_id,
        userId: data.user_id,
        action: data.action,
        from: data.from,
        to: data.to,
      },
      q,
    )
  }

  function listEntityHistory(ctx, entityType, entityId, rawQuery) {
    rbac.assertAuthenticated(ctx.principal)
    const authorize = ENTITY_HISTORY[entityType]
    if (!authorize) throw appError('NOT_FOUND')
    authorize(deps, ctx.principal, entityId)
    return query({ entityType, entityId }, rawQuery || {})
  }

  return { listAuditLogs, listEntityHistory }
}

module.exports = { createAuditService }
