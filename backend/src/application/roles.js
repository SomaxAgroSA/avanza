/**
 * Casos de uso de perfis (roles) e permissões.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const { ROLE_CODES, ONGOING_VIEWS, TASK_VIEWS, TASK_HIDDEN_BOXES, projectListsIssue, projectListsFromText, projectListsToText } = require('../domain/permissions')
const { buildAuditEntry, diff } = require('./audit')
const { toRoleDto } = require('./presenters')

const ROLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/
const MAX_PERMISSIONS = 500

const roleCode = rules.custom((value) => {
  if (typeof value !== 'string') return 'invalid_type'
  return ROLE_CODE_PATTERN.test(value.trim().toUpperCase()) ? null : 'invalid_format'
})

/** Caixas pessoais escondidas (ajuste 24/11): lista só com as conhecidas. */
const hiddenBoxes = rules.custom((value) => {
  if (!Array.isArray(value)) return 'invalid_type'
  return value.every((box) => TASK_HIDDEN_BOXES.indexOf(box) >= 0) ? null : 'invalid_option'
})

/** Listas do menu Projetos (ajuste 25/11): só as conhecidas, ao menos uma (domain/permissions.js). */
const projectLists = rules.custom(projectListsIssue)

const CREATE_SCHEMA = {
  code: [rules.required(), roleCode],
  name: [rules.required(), rules.maxLength(60)],
  description: [rules.maxLength(255)],
  permissions: [rules.stringArray(MAX_PERMISSIONS)],
  ongoing_view: [rules.oneOf(ONGOING_VIEWS)],
  tasks_start: [rules.oneOf(TASK_VIEWS.tasks_start)],
  tasks_list: [rules.oneOf(TASK_VIEWS.tasks_list)],
  tasks_all_box: [rules.oneOf(TASK_VIEWS.tasks_all_box)],
  tasks_hidden_boxes: [hiddenBoxes],
  projects_lists: [projectLists],
}

const UPDATE_SCHEMA = {
  name: [rules.required(), rules.maxLength(60)],
  description: [rules.maxLength(255)],
  ongoing_view: [rules.oneOf(ONGOING_VIEWS)],
  tasks_start: [rules.oneOf(TASK_VIEWS.tasks_start)],
  tasks_list: [rules.oneOf(TASK_VIEWS.tasks_list)],
  tasks_all_box: [rules.oneOf(TASK_VIEWS.tasks_all_box)],
  tasks_hidden_boxes: [hiddenBoxes],
  projects_lists: [projectLists],
}

const READ_ROLES_PERMISSIONS = ['permissions.manage', 'users.view', 'users.create', 'users.edit']

function uniqueSorted(codes) {
  return codes.filter((code, index) => codes.indexOf(code) === index).sort()
}

/** Ajustes de tela do perfil: o nome na API e o da entidade (vista de Em andamento §41, Tarefas 23/11, Projetos 25/11). */
const SCREEN_FIELDS = Object.freeze({
  ongoing_view: 'ongoingView',
  tasks_start: 'tasksStart',
  tasks_list: 'tasksList',
  tasks_all_box: 'tasksAllBox',
  tasks_hidden_boxes: 'tasksHiddenBoxes',
  projects_lists: 'projectsLists',
})

/**
 * Na entidade as listas são um texto, na ordem da tela e sem repetidas: as caixas escondidas (e assim no histórico)
 * e as listas de Projetos visíveis ('' = as quatro; no histórico saem como na API).
 */
function storedValue(api, value) {
  if (api === 'tasks_hidden_boxes') return TASK_HIDDEN_BOXES.filter((box) => value.indexOf(box) >= 0).join(',')
  if (api === 'projects_lists') return projectListsToText(value)
  return value
}

/** Os ajustes vindos da API, com o nome da entidade ('' para os que não vieram, com `fill`). */
function screenValues(data, fill) {
  const out = {}
  Object.keys(SCREEN_FIELDS).forEach((api) => {
    if (data[api] !== undefined) out[SCREEN_FIELDS[api]] = storedValue(api, data[api])
    else if (fill) out[SCREEN_FIELDS[api]] = ''
  })
  return out
}

/** Na auditoria os campos saem como na API (ongoing_view, tasks_start…). */
function publicChanges(values) {
  const out = Object.assign({}, values)
  Object.keys(SCREEN_FIELDS).forEach((api) => {
    const field = SCREEN_FIELDS[api]
    if (out[field] === undefined) return
    out[api] = api === 'projects_lists' ? projectListsFromText(out[field]) : out[field]
    delete out[field]
  })
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

    const role = await deps.unitOfWork.run(async (repos) => {
      const created = await repos.roleRepository.create(Object.assign({ code, name: data.name, description: data.description || '' }, screenValues(data, true)))
      await repos.roleRepository.setPermissionCodes(created.id, permissions)
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'role',
          entityId: created.id,
          action: 'role.created',
          newValue: Object.assign({ code, name: data.name, permissions }, publicChanges(screenValues(data, true))),
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
    // ajustes de tela (Em andamento §41, Tarefas 23/11, Projetos 25/11): na API ongoing_view…; na entidade ongoingView…
    const fields = Object.keys(SCREEN_FIELDS).map((api) => SCREEN_FIELDS[api])
    const current = Object.assign({}, role)
    fields.forEach((field) => {
      current[field] = role[field] || ''
    })
    const next = Object.assign({ name: data.name, description: data.description }, screenValues(data, false))
    const changes = diff(current, next, ['name', 'description'].concat(fields))
    if (!changes) return await present(role)

    const updated = await deps.unitOfWork.run(async (repos) => {
      const saved = await repos.roleRepository.update(role.id, changes.newValue)
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'role',
          entityId: role.id,
          action: 'role.updated',
          oldValue: publicChanges(changes.oldValue),
          newValue: publicChanges(changes.newValue),
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
