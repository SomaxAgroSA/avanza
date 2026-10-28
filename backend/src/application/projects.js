/**
 * Casos de uso de projetos e membros.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const { parsePagination, parseSort, buildPageMeta } = require('../core/pagination')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const { colorRule } = require('../domain/color')
const { USER_STATUS } = require('../domain/user')
const { buildAuditEntry, diff } = require('./audit')
const { iso, toUserSummary } = require('./presenters')

const keyRule = rules.custom((value) => (typeof value !== 'string' ? 'invalid_type' : projectDomain.keyIssue(projectDomain.normalizeKey(value))))

const FIELD_RULES = {
  name: [rules.required(), rules.maxLength(120)],
  description: [rules.maxLength(10000)],
  icon: [rules.oneOf(projectDomain.PROJECT_ICONS)],
  cover: [colorRule(projectDomain.PROJECT_COVERS)],
  status: [rules.oneOf(projectDomain.PROJECT_STATUS)],
  priority: [rules.oneOf(projectDomain.PROJECT_PRIORITY)],
  start_date: [rules.isoDate()],
  due_date: [rules.isoDate()],
}

const CREATE_SCHEMA = Object.assign({ key: [rules.required(), keyRule] }, FIELD_RULES)

const LIST_SCHEMA = {
  view: [rules.oneOf(['all', 'mine', 'archived'])],
  search: [rules.maxLength(100)],
  status: [rules.oneOf(projectDomain.PROJECT_STATUS)],
  priority: [rules.oneOf(projectDomain.PROJECT_PRIORITY)],
  owner_id: [rules.maxLength(40)],
}

const MEMBER_SCHEMA = {
  user_id: [rules.required(), rules.maxLength(40)],
  role: [rules.required(), rules.oneOf(projectDomain.MEMBER_ROLES)],
}

const SORTABLE = { name: 'name', key: 'key', created_at: 'created', due_date: 'due_date', status: 'status', priority: 'priority' }

/** Campos auditáveis no formato público. */
function auditView(project) {
  return {
    name: project.name,
    description: project.description,
    icon: project.icon,
    cover: project.cover,
    status: project.status,
    priority: project.priority,
    start_date: iso(project.startDate),
    due_date: iso(project.dueDate),
  }
}

function createProjectService(deps) {
  const projects = deps.projectRepository
  const members = deps.projectMemberRepository

  async function load(ctx, id) {
    rbac.assertAuthenticated(ctx.principal)
    const project = id ? await projects.findById(id) : null
    if (!project) throw appError('PROJECT_NOT_FOUND')
    const membership = await members.find(project.id, ctx.principal.userId)
    return { project, membership, access: projectDomain.resolveAccess(ctx.principal, project, membership) }
  }

  async function present(ctx, project, extra) {
    const info = extra || {}
    const owner = info.owner !== undefined ? info.owner : await deps.userRepository.findById(project.ownerId)
    const memberCount = info.memberCount !== undefined ? info.memberCount : (await members.countByProjects([project.id]))[project.id] || 0
    const role = info.role !== undefined ? info.role : ((await members.find(project.id, ctx.principal.userId)) || {}).role || null
    const access = projectDomain.resolveAccess(ctx.principal, project, role ? { role } : null)
    return {
      id: project.id,
      name: project.name,
      key: project.key,
      description: project.description || '',
      icon: project.icon || 'folder',
      cover: project.cover || 'violet',
      status: project.status,
      priority: project.priority,
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

  async function audit(repos, ctx, project, action, oldValue, newValue) {
    await repos.auditRepository.record(
      buildAuditEntry(ctx, { entityType: 'project', entityId: project.id, action, oldValue, newValue }),
    )
  }

  // ------------------------------------------------------------------ projetos

  async function listProjects(ctx, query) {
    rbac.assertCan(ctx.principal, 'projects.view')
    const q = query || {}
    const pick = (key) => (q[key] === undefined || q[key] === '' ? undefined : q[key])
    const filters = assertValid(
      { view: pick('view'), search: pick('search'), status: pick('status'), priority: pick('priority'), owner_id: pick('owner_id') },
      LIST_SCHEMA,
    )
    const pagination = parsePagination(q)
    const result = await projects.list({
      scope: { userId: ctx.principal.userId, viewAll: rbac.can(ctx.principal, 'projects.view_all') },
      view: filters.view || 'all',
      search: filters.search,
      status: filters.status,
      priority: filters.priority,
      ownerId: filters.owner_id,
      sort: parseSort(q.sort, SORTABLE, 'name'),
      pagination,
    })

    const ids = result.items.map((p) => p.id)
    const counts = await members.countByProjects(ids)
    const roles = await members.rolesForUser(ctx.principal.userId, ids)
    const owners = {}
    ;(await deps.userRepository.findManyByIds(result.items.map((p) => p.ownerId))).forEach((u) => {
      owners[u.id] = u
    })
    return {
      items: await Promise.all(
        result.items.map((p) =>
          present(ctx, p, { owner: owners[p.ownerId] || null, memberCount: counts[p.id] || 0, role: roles[p.id] || null }),
        ),
      ),
      meta: buildPageMeta(pagination, result.total),
    }
  }

  async function getProject(ctx, id) {
    const { project, access } = await load(ctx, id)
    projectDomain.assertAccess(access, project, 'view')
    return present(ctx, project)
  }

  async function createProject(ctx, input) {
    rbac.assertCan(ctx.principal, 'projects.create')
    const data = assertValid(input, CREATE_SCHEMA)
    const key = projectDomain.normalizeKey(data.key)
    const datesIssue = projectDomain.datesIssue(data.start_date || null, data.due_date || null)
    if (datesIssue) throw appError('VALIDATION_ERROR', undefined, { fields: { due_date: datesIssue } })
    if (await projects.findByKey(key)) throw appError('PROJECT_KEY_IN_USE')

    const project = await deps.unitOfWork.run(async (repos) => {
      const created = await repos.projectRepository.create({
        name: data.name,
        key,
        description: data.description || '',
        icon: data.icon || 'folder',
        cover: data.cover || 'violet',
        status: data.status || 'planning',
        priority: data.priority || 'medium',
        ownerId: ctx.principal.userId,
        createdBy: ctx.principal.userId,
        startDate: data.start_date || null,
        dueDate: data.due_date || null,
      })
      await repos.projectMemberRepository.add({ projectId: created.id, userId: ctx.principal.userId, role: 'manager' })
      await audit(repos, ctx, created, 'project.created', null, { name: created.name, key, status: created.status, priority: created.priority })
      return created
    })
    return present(ctx, project, { memberCount: 1, role: 'manager' })
  }

  async function updateProject(ctx, id, input) {
    const { project, access } = await load(ctx, id)
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
      startDate,
      dueDate,
    })
    const changes = diff(auditView(project), auditView(next), Object.keys(auditView(project)))
    if (!changes) return present(ctx, project)

    const saved = await deps.unitOfWork.run(async (repos) => {
      const updated = await repos.projectRepository.update(project.id, {
        name: next.name,
        description: next.description,
        icon: next.icon,
        cover: next.cover,
        status: next.status,
        priority: next.priority,
        startDate: next.startDate,
        dueDate: next.dueDate,
      })
      await audit(repos, ctx, project, 'project.updated', changes.oldValue, changes.newValue)
      return updated
    })
    return present(ctx, saved)
  }

  async function setArchived(ctx, id, archived) {
    const { project, access } = await load(ctx, id)
    projectDomain.assertAccess(access, project, 'archive')
    if (!!project.archivedAt === archived) return present(ctx, project)
    const saved = await deps.unitOfWork.run(async (repos) => {
      const updated = await repos.projectRepository.update(project.id, { archivedAt: archived ? deps.clock.now() : null })
      await audit(repos, ctx, project, archived ? 'project.archived' : 'project.unarchived', null, null)
      return updated
    })
    return present(ctx, saved)
  }

  async function deleteProject(ctx, id) {
    const { project, access } = await load(ctx, id)
    projectDomain.assertAccess(access, project, 'delete')
    await deps.unitOfWork.run(async (repos) => {
      await repos.projectMemberRepository.removeAllForProject(project.id)
      await repos.projectRepository.delete(project.id)
      await audit(repos, ctx, project, 'project.deleted', { name: project.name, key: project.key }, null)
    })
    return { deleted: true }
  }

  async function transferOwnership(ctx, id, input) {
    const { project, access } = await load(ctx, id)
    projectDomain.assertAccess(access, project, 'transfer')
    const data = assertValid(input, { user_id: [rules.required(), rules.maxLength(40)] })
    const target = await deps.userRepository.findById(data.user_id)
    if (!target) throw appError('USER_NOT_FOUND')
    if (target.status !== USER_STATUS.ACTIVE) throw appError('VALIDATION_ERROR', undefined, { fields: { user_id: 'user_disabled' } })
    if (target.id === project.ownerId) return present(ctx, project)

    const previousOwner = await deps.userRepository.findById(project.ownerId)
    const saved = await deps.unitOfWork.run(async (repos) => {
      const membership = await repos.projectMemberRepository.find(project.id, target.id)
      if (!membership) await repos.projectMemberRepository.add({ projectId: project.id, userId: target.id, role: 'manager' })
      else if (membership.role !== 'manager') await repos.projectMemberRepository.updateRole(project.id, target.id, 'manager')
      const updated = await repos.projectRepository.update(project.id, { ownerId: target.id })
      await audit(repos, ctx, project, 'project.owner_changed', { owner: previousOwner ? previousOwner.name : null }, { owner: target.name })
      return updated
    })
    return present(ctx, saved)
  }

  // ------------------------------------------------------------------ membros

  async function listMembers(ctx, id) {
    const { project, access } = await load(ctx, id)
    projectDomain.assertAccess(access, project, 'view')
    const rows = await members.listByProject(project.id)
    const users = {}
    ;(await deps.userRepository.findManyByIds(rows.map((m) => m.userId))).forEach((u) => {
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

  async function addMember(ctx, id, input) {
    const { project, access } = await load(ctx, id)
    projectDomain.assertAccess(access, project, 'manage_members')
    const data = assertValid(input, MEMBER_SCHEMA)
    const user = await deps.userRepository.findById(data.user_id)
    if (!user) throw appError('USER_NOT_FOUND')
    if (user.status !== USER_STATUS.ACTIVE) throw appError('VALIDATION_ERROR', undefined, { fields: { user_id: 'user_disabled' } })
    if (await members.find(project.id, user.id)) throw appError('MEMBER_ALREADY_EXISTS')

    await deps.unitOfWork.run(async (repos) => {
      await repos.projectMemberRepository.add({ projectId: project.id, userId: user.id, role: data.role })
      await audit(repos, ctx, project, 'project.member_added', null, { member: user.name, user_id: user.id, role: data.role })
    })
    return listMembers(ctx, id)
  }

  async function updateMemberRole(ctx, id, userId, input) {
    const { project, access } = await load(ctx, id)
    projectDomain.assertAccess(access, project, 'manage_members')
    const membership = await members.find(project.id, userId)
    if (!membership) throw appError('MEMBER_NOT_FOUND')
    if (userId === project.ownerId) throw appError('OWNER_ROLE_LOCKED')
    const data = assertValid(input, { role: MEMBER_SCHEMA.role })
    if (membership.role === data.role) return listMembers(ctx, id)

    const user = await deps.userRepository.findById(userId)
    await deps.unitOfWork.run(async (repos) => {
      await repos.projectMemberRepository.updateRole(project.id, userId, data.role)
      const name = user ? user.name : userId
      await audit(repos, ctx, project, 'project.member_role_changed', { member: name, role: membership.role }, { member: name, role: data.role })
    })
    return listMembers(ctx, id)
  }

  /** Remove um membro. O próprio membro pode sair do projeto; o dono nunca é removido. */
  async function removeMember(ctx, id, userId) {
    const { project, access } = await load(ctx, id)
    projectDomain.assertAccess(access, project, 'view')
    if (userId === project.ownerId) throw appError('CANNOT_REMOVE_OWNER')
    const leaving = userId === ctx.principal.userId
    if (!leaving) projectDomain.assertAccess(access, project, 'manage_members')
    const membership = await members.find(project.id, userId)
    if (!membership) throw appError('MEMBER_NOT_FOUND')

    const user = await deps.userRepository.findById(userId)
    await deps.unitOfWork.run(async (repos) => {
      await repos.projectMemberRepository.remove(project.id, userId)
      await audit(repos, ctx, project, leaving ? 'project.member_left' : 'project.member_removed', { member: user ? user.name : userId, role: membership.role }, null)
    })
    return { removed: true }
  }

  async function memberCandidates(ctx, id, query) {
    const { project, access } = await load(ctx, id)
    projectDomain.assertAccess(access, project, 'manage_members')
    const data = assertValid({ search: (query || {}).search || undefined }, { search: [rules.maxLength(100)] })
    const excludeIds = (await members.listByProject(project.id)).map((m) => m.userId)
    return (await deps.userRepository.searchActive({ search: data.search || '', excludeIds, limit: 20 })).map(toUserSummary)
  }

  return {
    listProjects,
    getProject,
    createProject,
    updateProject,
    archiveProject: async (ctx, id) => setArchived(ctx, id, true),
    unarchiveProject: async (ctx, id) => setArchived(ctx, id, false),
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
