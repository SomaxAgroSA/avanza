/**
 * Casos de uso de projetos e membros.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const { parsePagination, parseSort, buildPageMeta } = require('../core/pagination')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const { USER_STATUS } = require('../domain/user')
const { URGENCY_LEVELS } = require('../domain/task')
const { buildAuditEntry, diff } = require('./audit')
const { iso, toUserSummary } = require('./presenters')

const keyRule = rules.custom((value) => (typeof value !== 'string' ? 'invalid_type' : projectDomain.keyIssue(projectDomain.normalizeKey(value))))

const FIELD_RULES = {
  name: [rules.required(), rules.maxLength(120)],
  description: [rules.maxLength(10000)],
  icon: [rules.oneOf(projectDomain.PROJECT_ICONS)],
  cover: [rules.oneOf(projectDomain.PROJECT_COVERS)],
  status: [rules.oneOf(projectDomain.PROJECT_STATUS)],
  priority: [rules.oneOf(projectDomain.PROJECT_PRIORITY)],
  urgency: [rules.oneOf(URGENCY_LEVELS)],
  area_id: [rules.custom((value) => (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) ? null : 'invalid_type'))],
  parent_id: [rules.custom((value) => (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) ? null : 'invalid_type'))],
  start_date: [rules.isoDate()],
  due_date: [rules.isoDate()],
}

const CREATE_SCHEMA = Object.assign({ key: [rules.required(), keyRule] }, FIELD_RULES)

const LIST_SCHEMA = {
  view: [rules.oneOf(['all', 'mine', 'archived'])],
  search: [rules.maxLength(100)],
  status: [rules.oneOf(projectDomain.PROJECT_STATUS)],
  priority: [rules.oneOf(projectDomain.PROJECT_PRIORITY)],
  urgency: [rules.oneOf(URGENCY_LEVELS.concat(['none']))],
  // `none` = sem área
  area_id: [rules.custom((value) => (value === 'none' || (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value)) ? null : 'invalid_type'))],
  // `none` = projetos sem pai
  parent_id: [rules.custom((value) => (value === 'none' || (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value)) ? null : 'invalid_type'))],
  owner_id: [rules.maxLength(40)],
}

const MEMBER_SCHEMA = {
  user_id: [rules.required(), rules.maxLength(40)],
  role: [rules.required(), rules.oneOf(projectDomain.MEMBER_ROLES)],
}

const SORTABLE = { name: 'name', key: 'key', created_at: 'created', due_date: 'due_date', status: 'status', priority: 'priority' }

/** Campos auditáveis no formato público (`areas` = áreas por id; `parentName` = nome do projeto pai). */
function auditView(project, areas, parentName) {
  return {
    name: project.name,
    description: project.description,
    icon: project.icon,
    cover: project.cover,
    status: project.status,
    priority: project.priority,
    urgency: project.urgency || null,
    area: project.areaId && areas[project.areaId] ? areas[project.areaId].name : null,
    parent_project: project.parentId ? parentName(project.parentId) : null,
    start_date: iso(project.startDate),
    due_date: iso(project.dueDate),
  }
}

function createProjectService(deps) {
  const projects = deps.projectRepository
  const members = deps.projectMemberRepository

  function areasById() {
    const map = {}
    deps.areaRepository.list({ includeInactive: true }).forEach((area) => {
      map[area.id] = area
    })
    return map
  }

  /** Área ativa escolhida no formulário (inativa ou inexistente = opção inválida). */
  function activeArea(id, areas) {
    const area = areas[id]
    if (!area || area.isActive === false) throw appError('VALIDATION_ERROR', undefined, { fields: { area_id: 'invalid_option' } })
    return area
  }

  function parentName(id) {
    const parent = projects.findById(id)
    return parent ? parent.name : null
  }

  /**
   * Projeto pai escolhido (§25): precisa existir, a pessoa precisa poder editá-lo e a regra de um
   * só nível tem de valer. `project` = quem recebe o pai (null na criação).
   */
  function resolveParent(ctx, parentId, project) {
    const parent = projects.findById(parentId)
    let editable = false
    if (parent) {
      const membership = members.find(parent.id, ctx.principal.userId)
      const access = projectDomain.resolveAccess(ctx.principal, parent, membership)
      // gestor do pai (o arquivado é recusado depois, com motivo próprio)
      editable = access.canView && access.isManager && rbac.can(ctx.principal, 'projects.edit')
    }
    const hasChildren = project ? (projects.countChildren([project.id])[project.id] || 0) > 0 : false
    const issue = projectDomain.parentIssue(project, editable ? parent : null, hasChildren)
    if (issue) throw appError('VALIDATION_ERROR', undefined, { fields: { parent_id: issue } })
    return parent
  }

  function load(ctx, id) {
    rbac.assertAuthenticated(ctx.principal)
    const project = id ? projects.findById(id) : null
    if (!project) throw appError('PROJECT_NOT_FOUND')
    const membership = members.find(project.id, ctx.principal.userId)
    return { project, membership, access: projectDomain.resolveAccess(ctx.principal, project, membership) }
  }

  function present(ctx, project, extra) {
    const info = extra || {}
    const owner = info.owner !== undefined ? info.owner : deps.userRepository.findById(project.ownerId)
    const memberCount = info.memberCount !== undefined ? info.memberCount : members.countByProjects([project.id])[project.id] || 0
    const role = info.role !== undefined ? info.role : (members.find(project.id, ctx.principal.userId) || {}).role || null
    const access = projectDomain.resolveAccess(ctx.principal, project, role ? { role } : null)
    const area = project.areaId ? (info.areas || areasById())[project.areaId] : null
    const parent = project.parentId ? (info.parents ? info.parents[project.parentId] : projects.findById(project.parentId)) : null
    const childCount = info.childCounts ? info.childCounts[project.id] || 0 : projects.countChildren([project.id])[project.id] || 0
    return {
      id: project.id,
      name: project.name,
      key: project.key,
      description: project.description || '',
      icon: project.icon || 'folder',
      cover: project.cover || 'violet',
      status: project.status,
      priority: project.priority,
      urgency: project.urgency || null,
      area: area ? { id: area.id, key: area.key, name: area.name, color: area.color || 'gray' } : null,
      parent: parent ? { id: parent.id, key: parent.key, name: parent.name, icon: parent.icon || 'folder', cover: parent.cover || 'green' } : null,
      child_count: childCount,
      owner: owner ? toUserSummary(owner) : null,
      start_date: iso(project.startDate),
      due_date: iso(project.dueDate),
      archived_at: iso(project.archivedAt),
      created_at: iso(project.createdAt),
      updated_at: iso(project.updatedAt),
      member_count: memberCount,
      my_role: access.role,
      capabilities: projectDomain.capabilities(access, project),
    }
  }

  function audit(repos, ctx, project, action, oldValue, newValue) {
    repos.auditRepository.record(
      buildAuditEntry(ctx, { entityType: 'project', entityId: project.id, action, oldValue, newValue }),
    )
  }

  // ------------------------------------------------------------------ projetos

  function listProjects(ctx, query) {
    rbac.assertCan(ctx.principal, 'projects.view')
    const q = query || {}
    const pick = (key) => (q[key] === undefined || q[key] === '' ? undefined : q[key])
    const filters = assertValid(
      { view: pick('view'), search: pick('search'), status: pick('status'), priority: pick('priority'), urgency: pick('urgency'), area_id: pick('area_id'), parent_id: pick('parent_id'), owner_id: pick('owner_id') },
      LIST_SCHEMA,
    )
    const pagination = parsePagination(q)
    const result = projects.list({
      scope: { userId: ctx.principal.userId, viewAll: rbac.can(ctx.principal, 'projects.view_all') },
      view: filters.view || 'all',
      search: filters.search,
      status: filters.status,
      priority: filters.priority,
      urgency: filters.urgency,
      areaId: filters.area_id,
      parentId: filters.parent_id,
      ownerId: filters.owner_id,
      sort: parseSort(q.sort, SORTABLE, 'name'),
      pagination,
    })

    const ids = result.items.map((p) => p.id)
    const counts = members.countByProjects(ids)
    const roles = members.rolesForUser(ctx.principal.userId, ids)
    const areas = areasById()
    const owners = {}
    deps.userRepository.findManyByIds(result.items.map((p) => p.ownerId)).forEach((u) => {
      owners[u.id] = u
    })
    const parents = {}
    projects.findManyByIds(result.items.filter((p) => p.parentId).map((p) => p.parentId)).forEach((p) => {
      parents[p.id] = p
    })
    const childCounts = projects.countChildren(ids)
    return {
      items: result.items.map((p) =>
        present(ctx, p, { owner: owners[p.ownerId] || null, memberCount: counts[p.id] || 0, role: roles[p.id] || null, areas, parents, childCounts }),
      ),
      meta: buildPageMeta(pagination, result.total),
    }
  }

  function getProject(ctx, id) {
    const { project, access } = load(ctx, id)
    projectDomain.assertAccess(access, project, 'brief')
    return present(ctx, project)
  }

  function createProject(ctx, input) {
    rbac.assertCan(ctx.principal, 'projects.create')
    const data = assertValid(input, CREATE_SCHEMA)
    const key = projectDomain.normalizeKey(data.key)
    const datesIssue = projectDomain.datesIssue(data.start_date || null, data.due_date || null)
    if (datesIssue) throw appError('VALIDATION_ERROR', undefined, { fields: { due_date: datesIssue } })
    if (projects.findByKey(key)) throw appError('PROJECT_KEY_IN_USE')
    const area = data.area_id ? activeArea(data.area_id, areasById()) : null
    const parent = data.parent_id ? resolveParent(ctx, data.parent_id, null) : null

    const project = deps.unitOfWork.run((repos) => {
      const created = repos.projectRepository.create({
        name: data.name,
        key,
        description: data.description || '',
        icon: data.icon || 'folder',
        cover: data.cover || 'violet',
        status: data.status || 'planning',
        priority: data.priority || 'medium',
        urgency: data.urgency || null,
        areaId: area ? area.id : null,
        parentId: parent ? parent.id : null,
        ownerId: ctx.principal.userId,
        createdBy: ctx.principal.userId,
        startDate: data.start_date || null,
        dueDate: data.due_date || null,
      })
      repos.projectMemberRepository.add({ projectId: created.id, userId: ctx.principal.userId, role: 'manager' })
      const created_ = { name: created.name, key, status: created.status, priority: created.priority }
      if (parent) created_.parent_project = parent.name
      audit(repos, ctx, created, 'project.created', null, created_)
      return created
    })
    return present(ctx, project, { memberCount: 1, role: 'manager', childCounts: {} })
  }

  function updateProject(ctx, id, input) {
    const { project, access } = load(ctx, id)
    projectDomain.assertAccess(access, project, 'edit')
    const source = input || {}

    if (source.key !== undefined && projectDomain.normalizeKey(source.key) !== project.key) {
      throw appError('VALIDATION_ERROR', undefined, { fields: { key: 'immutable' } })
    }
    const schema = {}
    Object.keys(FIELD_RULES).forEach((field) => {
      if (source[field] !== undefined && source[field] !== null) schema[field] = FIELD_RULES[field]
    })
    const data = assertValid(source, schema)
    const areas = areasById()
    let areaId = project.areaId || null
    if (source.area_id === null) areaId = null
    else if (data.area_id !== undefined && data.area_id !== areaId) areaId = activeArea(data.area_id, areas).id
    let parentId = project.parentId || null
    if (source.parent_id === null) parentId = null
    else if (data.parent_id !== undefined && data.parent_id !== parentId) parentId = resolveParent(ctx, data.parent_id, project).id

    // Datas podem ser limpas com null; a validação do intervalo considera os valores já salvos.
    const pickDate = (field, current) => (source[field] === null ? null : data[field] !== undefined ? data[field] : current)
    const startDate = pickDate('start_date', project.startDate)
    const dueDate = pickDate('due_date', project.dueDate)
    const datesIssue = projectDomain.datesIssue(startDate, dueDate)
    if (datesIssue) throw appError('VALIDATION_ERROR', undefined, { fields: { due_date: datesIssue } })

    const next = Object.assign({}, project, {
      name: data.name !== undefined ? data.name : project.name,
      description: data.description !== undefined ? data.description : project.description,
      icon: data.icon || project.icon,
      cover: data.cover || project.cover,
      status: data.status || project.status,
      priority: data.priority || project.priority,
      urgency: source.urgency === null ? null : data.urgency !== undefined ? data.urgency : project.urgency || null,
      areaId,
      parentId,
      startDate,
      dueDate,
    })
    const before = auditView(project, areas, parentName)
    const changes = diff(before, auditView(next, areas, parentName), Object.keys(before))
    if (!changes) return present(ctx, project)

    const saved = deps.unitOfWork.run((repos) => {
      const updated = repos.projectRepository.update(project.id, {
        name: next.name,
        description: next.description,
        icon: next.icon,
        cover: next.cover,
        status: next.status,
        priority: next.priority,
        urgency: next.urgency,
        areaId: next.areaId,
        parentId: next.parentId,
        startDate: next.startDate,
        dueDate: next.dueDate,
      })
      audit(repos, ctx, project, 'project.updated', changes.oldValue, changes.newValue)
      return updated
    })
    return present(ctx, saved)
  }

  function setArchived(ctx, id, archived) {
    const { project, access } = load(ctx, id)
    projectDomain.assertAccess(access, project, 'archive')
    if (!!project.archivedAt === archived) return present(ctx, project)
    const saved = deps.unitOfWork.run((repos) => {
      const updated = repos.projectRepository.update(project.id, { archivedAt: archived ? deps.clock.now() : null })
      audit(repos, ctx, project, archived ? 'project.archived' : 'project.unarchived', null, null)
      return updated
    })
    return present(ctx, saved)
  }

  function deleteProject(ctx, id) {
    const { project, access } = load(ctx, id)
    projectDomain.assertAccess(access, project, 'delete')
    deps.unitOfWork.run((repos) => {
      repos.projectMemberRepository.removeAllForProject(project.id)
      // os subprojetos continuam, agora sem pai
      repos.projectRepository.clearParent(project.id)
      repos.projectRepository.delete(project.id)
      audit(repos, ctx, project, 'project.deleted', { name: project.name, key: project.key }, null)
    })
    return { deleted: true }
  }

  function transferOwnership(ctx, id, input) {
    const { project, access } = load(ctx, id)
    projectDomain.assertAccess(access, project, 'transfer')
    const data = assertValid(input, { user_id: [rules.required(), rules.maxLength(40)] })
    const target = deps.userRepository.findById(data.user_id)
    if (!target) throw appError('USER_NOT_FOUND')
    if (target.status !== USER_STATUS.ACTIVE) throw appError('VALIDATION_ERROR', undefined, { fields: { user_id: 'user_disabled' } })
    if (target.id === project.ownerId) return present(ctx, project)

    const previousOwner = deps.userRepository.findById(project.ownerId)
    const saved = deps.unitOfWork.run((repos) => {
      const membership = repos.projectMemberRepository.find(project.id, target.id)
      if (!membership) repos.projectMemberRepository.add({ projectId: project.id, userId: target.id, role: 'manager' })
      else if (membership.role !== 'manager') repos.projectMemberRepository.updateRole(project.id, target.id, 'manager')
      const updated = repos.projectRepository.update(project.id, { ownerId: target.id })
      audit(repos, ctx, project, 'project.owner_changed', { owner: previousOwner ? previousOwner.name : null }, { owner: target.name })
      return updated
    })
    return present(ctx, saved)
  }

  // ------------------------------------------------------------------ membros

  function listMembers(ctx, id) {
    const { project, access } = load(ctx, id)
    projectDomain.assertAccess(access, project, 'view')
    const rows = members.listByProject(project.id)
    const users = {}
    deps.userRepository.findManyByIds(rows.map((m) => m.userId)).forEach((u) => {
      users[u.id] = u
    })
    return rows
      .filter((m) => users[m.userId])
      .map((m) => ({
        user: Object.assign(toUserSummary(users[m.userId]), { status: users[m.userId].status }),
        role: m.role,
        is_owner: m.userId === project.ownerId,
        joined_at: iso(m.createdAt),
      }))
      .sort((a, b) => (a.is_owner !== b.is_owner ? (a.is_owner ? -1 : 1) : a.user.name.localeCompare(b.user.name)))
  }

  function addMember(ctx, id, input) {
    const { project, access } = load(ctx, id)
    projectDomain.assertAccess(access, project, 'manage_members')
    const data = assertValid(input, MEMBER_SCHEMA)
    const user = deps.userRepository.findById(data.user_id)
    if (!user) throw appError('USER_NOT_FOUND')
    if (user.status !== USER_STATUS.ACTIVE) throw appError('VALIDATION_ERROR', undefined, { fields: { user_id: 'user_disabled' } })
    if (members.find(project.id, user.id)) throw appError('MEMBER_ALREADY_EXISTS')

    deps.unitOfWork.run((repos) => {
      repos.projectMemberRepository.add({ projectId: project.id, userId: user.id, role: data.role })
      audit(repos, ctx, project, 'project.member_added', null, { member: user.name, user_id: user.id, role: data.role })
    })
    return listMembers(ctx, id)
  }

  function updateMemberRole(ctx, id, userId, input) {
    const { project, access } = load(ctx, id)
    projectDomain.assertAccess(access, project, 'manage_members')
    const membership = members.find(project.id, userId)
    if (!membership) throw appError('MEMBER_NOT_FOUND')
    if (userId === project.ownerId) throw appError('OWNER_ROLE_LOCKED')
    const data = assertValid(input, { role: MEMBER_SCHEMA.role })
    if (membership.role === data.role) return listMembers(ctx, id)

    const user = deps.userRepository.findById(userId)
    deps.unitOfWork.run((repos) => {
      repos.projectMemberRepository.updateRole(project.id, userId, data.role)
      const name = user ? user.name : userId
      audit(repos, ctx, project, 'project.member_role_changed', { member: name, role: membership.role }, { member: name, role: data.role })
    })
    return listMembers(ctx, id)
  }

  /** Remove um membro. O próprio membro pode sair do projeto; o dono nunca é removido. */
  function removeMember(ctx, id, userId) {
    const { project, access } = load(ctx, id)
    projectDomain.assertAccess(access, project, 'view')
    if (userId === project.ownerId) throw appError('CANNOT_REMOVE_OWNER')
    const leaving = userId === ctx.principal.userId
    if (!leaving) projectDomain.assertAccess(access, project, 'manage_members')
    const membership = members.find(project.id, userId)
    if (!membership) throw appError('MEMBER_NOT_FOUND')

    const user = deps.userRepository.findById(userId)
    deps.unitOfWork.run((repos) => {
      repos.projectMemberRepository.remove(project.id, userId)
      audit(repos, ctx, project, leaving ? 'project.member_left' : 'project.member_removed', { member: user ? user.name : userId, role: membership.role }, null)
    })
    return { removed: true }
  }

  function memberCandidates(ctx, id, query) {
    const { project, access } = load(ctx, id)
    projectDomain.assertAccess(access, project, 'manage_members')
    const data = assertValid({ search: (query || {}).search || undefined }, { search: [rules.maxLength(100)] })
    const excludeIds = members.listByProject(project.id).map((m) => m.userId)
    return deps.userRepository.searchActive({ search: data.search || '', excludeIds, limit: 20 }).map(toUserSummary)
  }

  return {
    listProjects,
    getProject,
    createProject,
    updateProject,
    archiveProject: (ctx, id) => setArchived(ctx, id, true),
    unarchiveProject: (ctx, id) => setArchived(ctx, id, false),
    deleteProject,
    transferOwnership,
    listMembers,
    addMember,
    updateMemberRole,
    removeMember,
    memberCandidates,
  }
}

module.exports = { createProjectService }
