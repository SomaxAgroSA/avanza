/**
 * Handlers das rotas /api/v1. Cada função recebe o evento da requisição (http/server.js) e delega
 * para um caso de uso via `handle` — sem regra de negócio aqui.
 */

const { handle } = require('./handler')
const { appError } = require('../core/errors')
const { readUploads, formValue, serveStored } = require('./files')
const { withLock } = require('../infrastructure/locks')

const PUBLIC = { auth: false }

// ---------------------------------------------------------------- health

function health(e) {
  return handle(
    e,
    async ({ e: event, services }) => {
      let database = 'ok'
      try {
        await event.runtime.db.one('SELECT 1')
      } catch (_) {
        database = 'error'
      }
      return {
        status: database === 'ok' ? 200 : 503,
        data: {
          status: database === 'ok' ? 'ok' : 'degraded',
          version: services.config.appVersion,
          checks: { database },
          time: new Date().toISOString(),
        },
      }
    },
    PUBLIC,
  )
}

// ---------------------------------------------------------------- auth

function login(e) {
  return handle(
    e,
    async ({ ctx, services, body, cookies }) => {
      const result = await services.auth.login(body(), ctx)
      cookies.setSession(result.token, result.session.expires_at, result.session.remember)
      return { data: { user: result.user, session: result.session } }
    },
    PUBLIC,
  )
}

function logout(e) {
  return handle(e, async ({ ctx, services, cookies }) => {
    await services.auth.logout(ctx)
    cookies.clearSession()
    return { data: { logged_out: true } }
  })
}

function me(e) {
  return handle(e, async ({ ctx, services }) => ({ data: await services.auth.getMe(ctx) }))
}

function revokeOtherSessions(e) {
  return handle(e, async ({ ctx, services }) => ({ data: await services.auth.revokeOtherSessions(ctx) }))
}

function changePassword(e) {
  return handle(e, async ({ ctx, services, body }) => ({ data: await services.auth.changePassword(ctx, body()) }))
}

function listSessions(e) {
  return handle(e, async ({ ctx, services }) => ({ data: await services.auth.listMySessions(ctx) }))
}

function revokeSession(e) {
  return handle(e, async ({ ctx, services, param, cookies }) => {
    const result = await services.auth.revokeMySession(ctx, param('id'))
    if (result.current) cookies.clearSession()
    return { data: result }
  })
}

// ---------------------------------------------------------------- rbac

function listPermissions(e) {
  return handle(e, async ({ ctx, services }) => ({ data: await services.roles.listPermissions(ctx) }))
}

function listRoles(e) {
  return handle(e, async ({ ctx, services }) => ({ data: await services.roles.listRoles(ctx) }))
}

function getRole(e) {
  return handle(e, async ({ ctx, services, param }) => ({ data: await services.roles.getRole(ctx, param('id')) }))
}

function createRole(e) {
  return handle(e, async ({ ctx, services, body }) => ({ status: 201, data: await services.roles.createRole(ctx, body()) }))
}

function updateRole(e) {
  return handle(e, async ({ ctx, services, body, param }) => ({ data: await services.roles.updateRole(ctx, param('id'), body()) }))
}

function updateRolePermissions(e) {
  return handle(e, async ({ ctx, services, body, param }) => ({
    data: await services.roles.updateRolePermissions(ctx, param('id'), body().permissions),
  }))
}

function deleteRole(e) {
  return handle(e, async ({ ctx, services, param }) => ({ data: await services.roles.deleteRole(ctx, param('id')) }))
}

// ---------------------------------------------------------------- users

/** Aceita apenas os campos públicos conhecidos do body. */
function userInput(body) {
  const input = {}
  ;['name', 'email', 'password', 'role_id', 'locale', 'theme', 'email_notifications', 'send_invite'].forEach((key) => {
    if (body[key] !== undefined) input[key] = body[key]
  })
  return input
}

function listUsers(e) {
  return handle(e, async ({ ctx, services, query }) => {
    const page = await services.users.listUsers(ctx, query())
    return { data: page.items, meta: page.meta }
  })
}

function getUser(e) {
  return handle(e, async ({ ctx, services, param }) => ({ data: await services.users.getUser(ctx, param('id')) }))
}

function createUser(e) {
  return handle(e, async ({ ctx, services, body }) => ({ status: 201, data: await services.users.createUser(ctx, userInput(body())) }))
}

function updateUser(e) {
  return handle(e, async ({ ctx, services, body, param }) => ({
    data: await services.users.updateUser(ctx, param('id'), userInput(body())),
  }))
}

function changeUserStatus(e) {
  return handle(e, async ({ ctx, services, body, param }) => ({
    data: await services.users.changeUserStatus(ctx, param('id'), body().status),
  }))
}

function resetUserPassword(e) {
  return handle(e, async ({ ctx, services, body, param }) => ({
    data: await services.users.resetPassword(ctx, param('id'), { password: body().password }),
  }))
}

function userHistory(e) {
  return handle(e, async ({ ctx, services, param, query }) => {
    const page = await services.audit.listEntityHistory(ctx, 'user', param('id'), query())
    return { data: page.items, meta: page.meta }
  })
}

// ---------------------------------------------------------------- audit

function listAuditLogs(e) {
  return handle(e, async ({ ctx, services, query }) => {
    const page = await services.audit.listAuditLogs(ctx, query())
    return { data: page.items, meta: page.meta }
  })
}

// ---------------------------------------------------------------- projects

function listProjects(e) {
  return handle(e, async ({ ctx, services, query }) => {
    const page = await services.projects.listProjects(ctx, query())
    return { data: page.items, meta: page.meta }
  })
}

const projectAction = (fn, status) => (e) =>
  handle(e, async ({ ctx, services, param, body, query }) => ({
    status: status || 200,
    data: await fn(services.projects, ctx, { id: param('id'), userId: param('userId'), body, query }),
  }))

const getProject = projectAction((s, ctx, r) => s.getProject(ctx, r.id))
const createProject = projectAction((s, ctx, r) => s.createProject(ctx, r.body()), 201)
const updateProject = projectAction((s, ctx, r) => s.updateProject(ctx, r.id, r.body()))
const archiveProject = projectAction((s, ctx, r) => s.archiveProject(ctx, r.id))
const unarchiveProject = projectAction((s, ctx, r) => s.unarchiveProject(ctx, r.id))
const deleteProject = projectAction((s, ctx, r) => s.deleteProject(ctx, r.id))
const transferProject = projectAction((s, ctx, r) => s.transferOwnership(ctx, r.id, r.body()))
const listProjectMembers = projectAction((s, ctx, r) => s.listMembers(ctx, r.id))
const addProjectMember = projectAction((s, ctx, r) => s.addMember(ctx, r.id, r.body()), 201)
const updateProjectMember = projectAction((s, ctx, r) => s.updateMemberRole(ctx, r.id, r.userId, r.body()))
const removeProjectMember = projectAction((s, ctx, r) => s.removeMember(ctx, r.id, r.userId))
const projectMemberCandidates = projectAction((s, ctx, r) => s.memberCandidates(ctx, r.id, r.query()))

function projectHistory(e) {
  return handle(e, async ({ ctx, services, param, query }) => {
    const page = await services.audit.listEntityHistory(ctx, 'project', param('id'), query())
    return { data: page.items, meta: page.meta }
  })
}

// ---------------------------------------------------------------- custom fields & task types

const configAction = (service, fn, status) => (e) =>
  handle(e, async ({ ctx, services, param, body, query }) => ({
    status: status || 200,
    data: await fn(services[service], ctx, { id: param('id'), body, query }),
  }))

const listCustomFields = configAction('customFields', (s, ctx, r) => s.listFields(ctx, r.query()))
const getCustomField = configAction('customFields', (s, ctx, r) => s.getField(ctx, r.id))
const createCustomField = configAction('customFields', (s, ctx, r) => s.createField(ctx, r.body()), 201)
const updateCustomField = configAction('customFields', (s, ctx, r) => s.updateField(ctx, r.id, r.body()))
const deleteCustomField = configAction('customFields', (s, ctx, r) => s.deleteField(ctx, r.id))

/** "Adicionar opção" pela tarefa: 201 quando cria; 200 quando devolve (ou reativa) a opção de mesmo rótulo. */
function addCustomFieldOption(e) {
  return handle(e, async ({ ctx, services, param, body }) => {
    const result = await services.customFields.addOption(ctx, param('id'), body())
    return { status: result.created ? 201 : 200, data: result.option }
  })
}

const listTaskTypes = configAction('taskTypes', (s, ctx, r) => s.listTypes(ctx, r.query()))
const getTaskType = configAction('taskTypes', (s, ctx, r) => s.getType(ctx, r.id))
const createTaskType = configAction('taskTypes', (s, ctx, r) => s.createType(ctx, r.body()), 201)
const updateTaskType = configAction('taskTypes', (s, ctx, r) => s.updateType(ctx, r.id, r.body()))
const deleteTaskType = configAction('taskTypes', (s, ctx, r) => s.deleteType(ctx, r.id))
const reorderTaskTypes = configAction('taskTypes', (s, ctx, r) => s.reorderTypes(ctx, r.body().ids))
const setTaskTypeFields = configAction('taskTypes', (s, ctx, r) => s.setTypeFields(ctx, r.id, r.body().fields))

function taskTypeHistory(e) {
  return handle(e, async ({ ctx, services, param, query }) => {
    const page = await services.audit.listEntityHistory(ctx, 'task_type', param('id'), query())
    return { data: page.items, meta: page.meta }
  })
}

// ---------------------------------------------------------------- statuses & priorities

const listStatuses = configAction('statuses', (s, ctx, r) => s.list(ctx, r.query()))
const getStatus = configAction('statuses', (s, ctx, r) => s.get(ctx, r.id))
const createStatus = configAction('statuses', (s, ctx, r) => s.create(ctx, r.body()), 201)
const updateStatus = configAction('statuses', (s, ctx, r) => s.update(ctx, r.id, r.body()))
const deleteStatus = configAction('statuses', (s, ctx, r) => s.delete(ctx, r.id))
const reorderStatuses = configAction('statuses', (s, ctx, r) => s.reorder(ctx, r.body().ids))

const listPriorities = configAction('priorities', (s, ctx, r) => s.list(ctx, r.query()))
const getPriority = configAction('priorities', (s, ctx, r) => s.get(ctx, r.id))
const createPriority = configAction('priorities', (s, ctx, r) => s.create(ctx, r.body()), 201)
const updatePriority = configAction('priorities', (s, ctx, r) => s.update(ctx, r.id, r.body()))
const deletePriority = configAction('priorities', (s, ctx, r) => s.delete(ctx, r.id))
const reorderPriorities = configAction('priorities', (s, ctx, r) => s.reorder(ctx, r.body().ids))

// ---------------------------------------------------------------- tasks

const taskAction = (fn, status) => configAction('tasks', fn, status)

function listTasks(e) {
  return handle(e, async ({ ctx, services, query }) => {
    const page = await services.tasks.listTasks(ctx, query())
    return { data: page.items, meta: page.meta }
  })
}
const getTask = taskAction((s, ctx, r) => s.getTask(ctx, r.id))
const createTask = taskAction((s, ctx, r) => s.createTask(ctx, r.body()), 201)
const updateTask = taskAction((s, ctx, r) => s.updateTask(ctx, r.id, r.body()))
const deleteTask = taskAction((s, ctx, r) => s.deleteTask(ctx, r.id))

function taskHistory(e) {
  return handle(e, async ({ ctx, services, param, query }) => {
    const page = await services.audit.listEntityHistory(ctx, 'task', param('id'), query())
    return { data: page.items, meta: page.meta }
  })
}

// ---------------------------------------------------------------- tags & comments

const listTags = configAction('tags', (s, ctx) => s.listTags(ctx))
const createTag = configAction('tags', (s, ctx, r) => s.createTag(ctx, r.body()), 201)
const updateTag = configAction('tags', (s, ctx, r) => s.updateTag(ctx, r.id, r.body()))
const deleteTag = configAction('tags', (s, ctx, r) => s.deleteTag(ctx, r.id))

const listTaskComments = configAction('comments', (s, ctx, r) => s.listComments(ctx, r.id))
const createTaskComment = configAction('comments', (s, ctx, r) => s.createComment(ctx, r.id, r.body()), 201)
const taskMentionCandidates = configAction('comments', (s, ctx, r) => s.mentionCandidates(ctx, r.id))
const updateComment = configAction('comments', (s, ctx, r) => s.updateComment(ctx, r.id, r.body()))
const deleteComment = configAction('comments', (s, ctx, r) => s.deleteComment(ctx, r.id))

// ---------------------------------------------------------------- attachments

const listTaskAttachments = configAction('attachments', (s, ctx, r) => s.listAttachments(ctx, r.id))
const deleteAttachment = configAction('attachments', (s, ctx, r) => s.deleteAttachment(ctx, r.id))

/** Multipart: `files` (um ou mais), `field` opcional (campo de imagem/arquivo) ou `comment_id` (anexo do comentário). */
function uploadTaskAttachments(e) {
  return handle(e, async ({ ctx, services, param }) => {
    const files = await readUploads(e, 'files')
    const field = await formValue(e, 'field')
    const commentId = await formValue(e, 'comment_id')
    return { status: 201, data: await services.attachments.uploadAttachments(ctx, param('id'), files, field || undefined, commentId || undefined) }
  })
}

/** Download/visualização: confere acesso e serve o arquivo protegido (Range, CSP sandbox e nosniff). */
function attachmentFile(e) {
  return handle(e, async ({ ctx, services, param }) => {
    const attachment = await services.attachments.fileFor(ctx, param('id'))
    return serveStored(e, await services.deps.attachmentRepository.fileKeyOf(attachment.id), attachment.name)
  })
}

// ---------------------------------------------------------------- kanban

const projectBoard = configAction('board', (s, ctx, r) => s.getBoard(ctx, r.id))
const allProjectsBoard = configAction('board', (s, ctx, r) => s.getAllBoard(ctx, r.query()))
const moveTask = configAction('tasks', (s, ctx, r) => s.moveTask(ctx, r.id, r.body()))

// ---------------------------------------------------------------- backlog e sprints

const projectBacklog = configAction('backlog', (s, ctx, r) => s.getBacklog(ctx, r.id))
const rankTask = configAction('backlog', (s, ctx, r) => s.rankTask(ctx, r.id, r.body()))
const listSprints = configAction('sprints', (s, ctx, r) => s.listSprints(ctx, r.id, r.query()))
const createSprint = configAction('sprints', (s, ctx, r) => s.createSprint(ctx, r.id, r.body()), 201)
const reorderSprints = configAction('sprints', (s, ctx, r) => s.reorderSprints(ctx, r.id, r.body().ids))
const updateSprint = configAction('sprints', (s, ctx, r) => s.updateSprint(ctx, r.id, r.body()))
const deleteSprint = configAction('sprints', (s, ctx, r) => s.deleteSprint(ctx, r.id))

// ---------------------------------------------------------------- relacionamentos e fork

const listTaskRelations = configAction('relations', (s, ctx, r) => s.listRelations(ctx, r.id))
const createTaskRelation = configAction('relations', (s, ctx, r) => s.createRelation(ctx, r.id, r.body()), 201)
const deleteTaskRelation = configAction('relations', (s, ctx, r) => s.deleteRelation(ctx, r.id))
const forkTask = configAction('relations', (s, ctx, r) => s.forkTask(ctx, r.id, r.body()), 201)

// ---------------------------------------------------------------- relatórios

const getReport = configAction('reports', (s, ctx, r) => s.getReport(ctx, r.query()))

// ---------------------------------------------------------------- documentação (expansão, Onda 2)

const listDocSpaces = configAction('docSpaces', (s, ctx) => s.listSpaces(ctx))
const createDocSpace = configAction('docSpaces', (s, ctx, r) => s.createSpace(ctx, r.body()), 201)
const getDocSpace = configAction('docSpaces', (s, ctx, r) => s.getSpace(ctx, r.id))
const updateDocSpace = configAction('docSpaces', (s, ctx, r) => s.updateSpace(ctx, r.id, r.body()))
const deleteDocSpace = configAction('docSpaces', (s, ctx, r) => s.deleteSpace(ctx, r.id))
const createDocPage = configAction('docPages', (s, ctx, r) => s.createPage(ctx, r.id, r.body()), 201)
const getDocPage = configAction('docPages', (s, ctx, r) => s.getPage(ctx, r.id))
const deleteDocPage = configAction('docPages', (s, ctx, r) => s.deletePage(ctx, r.id))
const getDocDraft = configAction('docPages', (s, ctx, r) => s.getDraft(ctx, r.id))
const saveDocDraft = configAction('docPages', (s, ctx, r) => s.saveDraft(ctx, r.id, r.body()))
const discardDocDraft = configAction('docPages', (s, ctx, r) => s.discardDraft(ctx, r.id))
const publishDocPage = configAction('docPages', (s, ctx, r) => s.publishPage(ctx, r.id, r.body()))
const moveDocPage = configAction('docPages', (s, ctx, r) => s.movePage(ctx, r.id, r.body()))
const listDocVersions = configAction('docPages', (s, ctx, r) => s.listVersions(ctx, r.id))
const searchDocs = configAction('docPages', (s, ctx, r) => s.search(ctx, r.query()))
const recentDocs = configAction('docPages', (s, ctx) => s.recent(ctx))

function getDocVersion(e) {
  return handle(e, async ({ ctx, services, param }) => ({ data: await services.docPages.getVersion(ctx, param('id'), param('version')) }))
}

function restoreDocVersion(e) {
  return handle(e, async ({ ctx, services, param }) => ({ data: await services.docPages.restoreVersion(ctx, param('id'), param('version')) }))
}

function uploadDocFiles(e) {
  return handle(e, async ({ ctx, services, param }) => ({ status: 201, data: await services.docPages.uploadFiles(ctx, param('id'), await readUploads(e, 'files')) }))
}

function docFile(e) {
  return handle(e, async ({ ctx, services, param }) => {
    const file = await services.docPages.fileFor(ctx, param('id'))
    // imagens aparecem na página; o resto baixa como anexo
    if (file.kind !== 'image' || e.query().download === '1') e.setHeader('Content-Disposition', 'attachment')
    e.setHeader('Content-Security-Policy', 'sandbox')
    return serveStored(e, await services.deps.docFileRepository.fileKeyOf(file.id), file.name)
  })
}
const projectTimeline = configAction('timeline', (s, ctx, r) => s.getTimeline(ctx, r.id))
const listMilestones = configAction('milestones', (s, ctx, r) => s.listMilestones(ctx, r.id))
const createMilestone = configAction('milestones', (s, ctx, r) => s.createMilestone(ctx, r.id, r.body()), 201)
const updateMilestone = configAction('milestones', (s, ctx, r) => s.updateMilestone(ctx, r.id, r.body()))
const deleteMilestone = configAction('milestones', (s, ctx, r) => s.deleteMilestone(ctx, r.id))
// plano do projeto (Gerenciamento de Projetos, GP-1)
const projectPlan = configAction('plan', (s, ctx, r) => s.getPlan(ctx, r.id))
const listProjectGroups = configAction('plan', (s, ctx, r) => s.listGroups(ctx, r.id))
const createProjectGroup = configAction('plan', (s, ctx, r) => s.createGroup(ctx, r.id, r.body()), 201)
const updateProjectGroup = configAction('plan', (s, ctx, r) => s.updateGroup(ctx, r.id, r.body()))
const moveProjectGroup = configAction('plan', (s, ctx, r) => s.moveGroup(ctx, r.id, r.body()))
const deleteProjectGroup = configAction('plan', (s, ctx, r) => s.deleteGroup(ctx, r.id))
const duplicateProjectGroup = configAction('plan', (s, ctx, r) => s.duplicateGroup(ctx, r.id), 201)
const getPlanItem = configAction('plan', (s, ctx, r) => s.getItem(ctx, r.id))
const createPlanItem = configAction('plan', (s, ctx, r) => s.createItem(ctx, r.id, r.body()), 201)
const updatePlanItem = configAction('plan', (s, ctx, r) => s.updateItem(ctx, r.id, r.body()))
const deletePlanItem = configAction('plan', (s, ctx, r) => s.deleteItem(ctx, r.id))
const createPlanStatus = configAction('plan', (s, ctx, r) => s.createStatus(ctx, r.id, r.body()), 201)
const updatePlanStatus = configAction('plan', (s, ctx, r) => s.updateStatus(ctx, r.id, r.body()))
const deletePlanStatus = configAction('plan', (s, ctx, r) => s.deleteStatus(ctx, r.id))
const createPlanResource = configAction('plan', (s, ctx, r) => s.createResource(ctx, r.id, r.body()), 201)
const updatePlanResource = configAction('plan', (s, ctx, r) => s.updateResource(ctx, r.id, r.body()))
const deletePlanResource = configAction('plan', (s, ctx, r) => s.deleteResource(ctx, r.id))
// quadro — GP-2 (interação)
const movePlanItem = configAction('planInteraction', (s, ctx, r) => s.moveItem(ctx, r.id, r.body()))
const duplicatePlanItem = configAction('planInteraction', (s, ctx, r) => s.duplicateItem(ctx, r.id), 201)
const bulkPlanItems = configAction('planInteraction', (s, ctx, r) => s.bulkItems(ctx, r.id, r.body()))
const createPlanLink = configAction('planInteraction', (s, ctx, r) => s.createLink(ctx, r.id, r.body()), 201)
const deletePlanLink = configAction('planInteraction', (s, ctx, r) => s.deleteLink(ctx, r.id))
const updatePlanSettings = configAction('planInteraction', (s, ctx, r) => s.updateSettings(ctx, r.id, r.body()))
const importPlanItems = configAction('planInteraction', (s, ctx, r) => s.importItems(ctx, r.id, r.body()), 201)
// quadro — GP-3 (painel do elemento)
const listPlanUpdates = configAction('planCollaboration', (s, ctx, r) => s.listUpdates(ctx, r.id))
const editPlanUpdate = configAction('planCollaboration', (s, ctx, r) => s.editUpdate(ctx, r.id, r.body()))
const deletePlanUpdate = configAction('planCollaboration', (s, ctx, r) => s.deleteUpdate(ctx, r.id))
const planMentionCandidates = configAction('planCollaboration', (s, ctx, r) => s.mentionCandidates(ctx, r.id))
const deletePlanFile = configAction('planCollaboration', (s, ctx, r) => s.deleteFile(ctx, r.id))

/** JSON (`content`, `parent_id`) ou multipart com `files` (imagens coladas/anexadas seguem junto). */
function createPlanUpdate(e) {
  return handle(e, async ({ ctx, services, param, body }) => ({ status: 201, data: await services.planCollaboration.createUpdate(ctx, param('id'), body(), await readUploads(e, 'files')) }))
}

/** Multipart `files`: o autor anexa mais à atualização. */
function addPlanUpdateFiles(e) {
  return handle(e, async ({ ctx, services, param }) => ({ status: 201, data: await services.planCollaboration.addFiles(ctx, param('id'), await readUploads(e, 'files')) }))
}

// quadro — GP-4 (gestão, linha de base e relatório)
const listPlanJournal = configAction('planManagement', (s, ctx, r) => s.listJournal(ctx, r.id))
const createPlanJournalEntry = configAction('planManagement', (s, ctx, r) => s.createJournalEntry(ctx, r.id, r.body()), 201)
const updatePlanJournalEntry = configAction('planManagement', (s, ctx, r) => s.updateJournalEntry(ctx, r.id, r.body()))
const deletePlanJournalEntry = configAction('planManagement', (s, ctx, r) => s.deleteJournalEntry(ctx, r.id))
const listPlanIssues = configAction('planManagement', (s, ctx, r) => s.listIssues(ctx, r.id))
const createPlanIssue = configAction('planManagement', (s, ctx, r) => s.createIssue(ctx, r.id, r.body()), 201)
const updatePlanIssue = configAction('planManagement', (s, ctx, r) => s.updateIssue(ctx, r.id, r.body()))
const deletePlanIssue = configAction('planManagement', (s, ctx, r) => s.deleteIssue(ctx, r.id))
const savePlanBaseline = configAction('planManagement', (s, ctx, r) => s.saveBaseline(ctx, r.id))
const clearPlanBaseline = configAction('planManagement', (s, ctx, r) => s.clearBaseline(ctx, r.id))
const planReport = configAction('planManagement', (s, ctx, r) => s.getReport(ctx, r.id, r.query()))
// quadro — GP-5 (colunas personalizadas)
const createPlanColumn = configAction('planColumns', (s, ctx, r) => s.createColumn(ctx, r.id, r.body()), 201)
const updatePlanColumn = configAction('planColumns', (s, ctx, r) => s.updateColumn(ctx, r.id, r.body()))
const changePlanColumnType = configAction('planColumns', (s, ctx, r) => s.changeType(ctx, r.id, r.body()))
const duplicatePlanColumn = configAction('planColumns', (s, ctx, r) => s.duplicateColumn(ctx, r.id), 201)
const deletePlanColumn = configAction('planColumns', (s, ctx, r) => s.deleteColumn(ctx, r.id))

/** Download/visualização: confere acesso; imagens aparecem, o resto baixa como anexo. */
function planFile(e) {
  return handle(e, async ({ ctx, services, param }) => {
    const file = await services.planCollaboration.fileFor(ctx, param('id'))
    if (file.kind !== 'image' || e.query().download === '1') e.setHeader('Content-Disposition', 'attachment')
    e.setHeader('Content-Security-Policy', 'sandbox')
    return serveStored(e, await services.deps.planFileRepository.fileKeyOf(file.id), file.name)
  })
}

function planItemHistory(e) {
  return handle(e, async ({ ctx, services, param, query }) => {
    const page = await services.audit.listEntityHistory(ctx, 'plan_item', param('id'), query())
    return { data: page.items, meta: page.meta }
  })
}
function listReportTasks(e) {
  return handle(e, async ({ ctx, services, query }) => {
    const page = await services.reports.listIndicatorTasks(ctx, query())
    return { data: page.items, meta: page.meta }
  })
}

// ---------------------------------------------------------------- notifications

function listNotifications(e) {
  return handle(e, async ({ ctx, services, query }) => {
    const page = await services.notifications.listNotifications(ctx, query())
    return { data: page.items, meta: page.meta }
  })
}
const notificationsUnreadCount = configAction('notifications', (s, ctx) => s.unreadCount(ctx))
const readNotification = configAction('notifications', (s, ctx, r) => s.markRead(ctx, r.id))
const readAllNotifications = configAction('notifications', (s, ctx) => s.markAllRead(ctx))
const runDueRemindersNow = configAction('notifications', (s, ctx) => s.runDueRemindersNow(ctx))

// ---------------------------------------------------------------- Configurador geral

/** Público: nome e endereços da identidade (tela de login, título e ícone da aba). */
function platformInfo(e) {
  return handle(e, async ({ services }) => ({ data: await services.platformSettings.publicInfo() }), PUBLIC)
}

/** Público: logo/ícone. Arquivo protegido servido com nosniff e CSP sandbox (SVG sem nada ativo). */
function platformBranding(e) {
  return handle(
    e,
    async ({ services, param }) => {
      const file = await services.platformSettings.brandingFile(param('slot'))
      e.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      e.setHeader('Cache-Control', 'public, max-age=86400')
      return serveStored(e, file.key, file.name)
    },
    PUBLIC,
  )
}

const getPlatformSettings = configAction('platformSettings', (s, ctx) => s.getSettings(ctx))
const updatePlatformSettings = configAction('platformSettings', (s, ctx, r) => s.updateSettings(ctx, r.body()))
const removePlatformBranding = (e) => handle(e, async ({ ctx, services, param }) => ({ data: await services.platformSettings.removeBranding(ctx, param('slot')) }))
const passwordPolicy = configAction('platformSettings', (s, ctx) => s.passwordPolicy(ctx))
const runAuditRetention = configAction('platformSettings', (s, ctx) => s.runRetentionNow(ctx))

/** Multipart com um arquivo em `file`; lê o conteúdo inteiro (até o limite) para conferir o tipo e o SVG. */
function uploadPlatformBranding(e) {
  return handle(e, async ({ ctx, services, param }) => {
    const file = (await readUploads(e, 'file'))[0]
    const upload = file ? { name: file.name, size: file.size, bytes: file.bytes, handle: file.handle } : null
    return { data: await services.platformSettings.uploadBranding(ctx, param('slot'), upload) }
  })
}

// ---------------------------------------------------------------- e-mail (integrações)

const getEmailSettings = configAction('email', (s, ctx) => s.getSettings(ctx))
const updateEmailSettings = configAction('email', (s, ctx, r) => s.updateSettings(ctx, r.body()))
const sendTestEmail = configAction('email', (s, ctx, r) => s.sendTest(ctx, r.body()))
const emailOutbox = configAction('email', (s, ctx) => s.outboxSummary(ctx))
const resendInvite = configAction('accountLinks', (s, ctx, r) => s.resendInvite(ctx, r.id))

function flushEmailOutboxNow(e) {
  return handle(e, async ({ ctx, services }) => {
    // uma execução por vez: a rotina por minuto e o "Enviar agora" não mandam o mesmo e-mail duas vezes
    const run = await withLock(e.runtime.db, 'job:email-outbox', () => services.email.flushNow(ctx))
    return { data: run.busy ? { sent: 0, failed: 0, retrying: 0, busy: true } : run.result }
  })
}

/** Público: "Esqueci minha senha" — responde igual exista ou não a conta. */
function requestPasswordReset(e) {
  return handle(e, async ({ ctx, services, body }) => ({ data: await services.accountLinks.requestReset(body(), ctx) }), PUBLIC)
}

/** Público: a tela de nova senha confere o link (e recebe as exigências da senha). */
function checkPasswordReset(e) {
  return handle(e, async ({ services, query }) => ({ data: await services.accountLinks.checkToken(query().token) }), PUBLIC)
}

function confirmPasswordReset(e) {
  return handle(e, async ({ ctx, services, body }) => ({ data: await services.accountLinks.confirm(body(), ctx) }), PUBLIC)
}

// ---------------------------------------------------------------- tokens de API

const listMyApiTokens = configAction('apiTokens', (s, ctx) => s.listMine(ctx))
const createApiToken = configAction('apiTokens', (s, ctx, r) => s.create(ctx, r.body()), 201)
const revokeApiToken = configAction('apiTokens', (s, ctx, r) => s.revoke(ctx, r.id))
const listAllApiTokens = configAction('apiTokens', (s, ctx) => s.listAll(ctx))

// ---------------------------------------------------------------- webhooks

const listWebhooks = configAction('webhooks', (s, ctx) => s.list(ctx))
const webhookEvents = configAction('webhooks', (s, ctx) => s.events(ctx))
const createWebhook = configAction('webhooks', (s, ctx, r) => s.create(ctx, r.body()), 201)
const updateWebhook = configAction('webhooks', (s, ctx, r) => s.update(ctx, r.id, r.body()))
const deleteWebhook = configAction('webhooks', (s, ctx, r) => s.remove(ctx, r.id))
const rotateWebhookSecret = configAction('webhooks', (s, ctx, r) => s.rotateSecret(ctx, r.id))
const testWebhook = configAction('webhooks', (s, ctx, r) => s.test(ctx, r.id))
const webhookDeliveries = configAction('webhooks', (s, ctx, r) => s.deliveries(ctx, r.id))
const redeliverWebhook = configAction('webhooks', (s, ctx, r) => s.redeliver(ctx, r.id))

// ---------------------------------------------------------------- misc

function notFound(e) {
  return handle(
    e,
    async () => {
      throw appError('ROUTE_NOT_FOUND')
    },
    PUBLIC,
  )
}

function openapi(e) {
  const spec = require('./openapi')
  e.setHeader('Cache-Control', 'no-store')
  return e.json(200, spec.build())
}

module.exports = {
  health,
  login,
  logout,
  me,
  listSessions,
  changePassword,
  revokeOtherSessions,
  resetUserPassword,
  userHistory,
  listAuditLogs,
  listProjects,
  getProject,
  createProject,
  updateProject,
  archiveProject,
  unarchiveProject,
  deleteProject,
  transferProject,
  listProjectMembers,
  addProjectMember,
  updateProjectMember,
  removeProjectMember,
  projectMemberCandidates,
  projectHistory,
  listCustomFields,
  getCustomField,
  createCustomField,
  updateCustomField,
  deleteCustomField,
  addCustomFieldOption,
  listTaskTypes,
  getTaskType,
  createTaskType,
  updateTaskType,
  deleteTaskType,
  reorderTaskTypes,
  setTaskTypeFields,
  taskTypeHistory,
  listStatuses,
  getStatus,
  createStatus,
  updateStatus,
  deleteStatus,
  reorderStatuses,
  listPriorities,
  getPriority,
  createPriority,
  updatePriority,
  deletePriority,
  reorderPriorities,
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  taskHistory,
  listTags,
  createTag,
  updateTag,
  deleteTag,
  listTaskComments,
  createTaskComment,
  taskMentionCandidates,
  updateComment,
  deleteComment,
  listTaskAttachments,
  projectBoard,
  allProjectsBoard,
  moveTask,
  projectBacklog,
  listTaskRelations,
  createTaskRelation,
  deleteTaskRelation,
  forkTask,
  getReport,
  listDocSpaces,
  createDocSpace,
  getDocSpace,
  updateDocSpace,
  deleteDocSpace,
  createDocPage,
  getDocPage,
  deleteDocPage,
  getDocDraft,
  saveDocDraft,
  discardDocDraft,
  publishDocPage,
  moveDocPage,
  listDocVersions,
  getDocVersion,
  restoreDocVersion,
  uploadDocFiles,
  docFile,
  searchDocs,
  recentDocs,
  projectTimeline,
  projectPlan,
  listProjectGroups,
  createProjectGroup,
  updateProjectGroup,
  moveProjectGroup,
  deleteProjectGroup,
  duplicateProjectGroup,
  getPlanItem,
  createPlanItem,
  updatePlanItem,
  deletePlanItem,
  createPlanStatus,
  updatePlanStatus,
  deletePlanStatus,
  createPlanResource,
  updatePlanResource,
  deletePlanResource,
  movePlanItem,
  duplicatePlanItem,
  bulkPlanItems,
  createPlanLink,
  deletePlanLink,
  updatePlanSettings,
  importPlanItems,
  listPlanUpdates,
  createPlanUpdate,
  editPlanUpdate,
  deletePlanUpdate,
  planMentionCandidates,
  addPlanUpdateFiles,
  listPlanJournal,
  createPlanJournalEntry,
  updatePlanJournalEntry,
  deletePlanJournalEntry,
  listPlanIssues,
  createPlanIssue,
  updatePlanIssue,
  deletePlanIssue,
  savePlanBaseline,
  clearPlanBaseline,
  planReport,
  createPlanColumn,
  updatePlanColumn,
  changePlanColumnType,
  duplicatePlanColumn,
  deletePlanColumn,
  planFile,
  deletePlanFile,
  planItemHistory,
  listMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  listReportTasks,
  rankTask,
  listSprints,
  createSprint,
  reorderSprints,
  updateSprint,
  deleteSprint,
  listNotifications,
  notificationsUnreadCount,
  readNotification,
  readAllNotifications,
  platformInfo,
  platformBranding,
  getPlatformSettings,
  updatePlatformSettings,
  uploadPlatformBranding,
  removePlatformBranding,
  passwordPolicy,
  getEmailSettings,
  updateEmailSettings,
  sendTestEmail,
  emailOutbox,
  flushEmailOutboxNow,
  requestPasswordReset,
  checkPasswordReset,
  confirmPasswordReset,
  resendInvite,
  listMyApiTokens,
  createApiToken,
  revokeApiToken,
  listAllApiTokens,
  listWebhooks,
  webhookEvents,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  rotateWebhookSecret,
  testWebhook,
  webhookDeliveries,
  redeliverWebhook,
  runAuditRetention,
  runDueRemindersNow,
  uploadTaskAttachments,
  attachmentFile,
  deleteAttachment,
  revokeSession,
  listPermissions,
  listRoles,
  getRole,
  createRole,
  updateRole,
  updateRolePermissions,
  deleteRole,
  listUsers,
  getUser,
  createUser,
  updateUser,
  changeUserStatus,
  notFound,
  openapi,
}
