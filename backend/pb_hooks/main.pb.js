/// <reference path="../pb_data/types.d.ts" />

/**
 * Registro das rotas da API /api/v1.
 *
 * IMPORTANTE (JSVM): cada handler roda numa VM isolada e não enxerga variáveis deste arquivo.
 * Por isso todo handler faz `require` do módulo de rotas; a lógica vive em src/.
 */

const JSON_BODY_LIMIT = $apis.bodyLimit(1024 * 1024) // 1 MB para rotas JSON

// Sem middleware global em JS: no PocketBase, um middleware em JS segura uma VM do pool durante todo
// o e.next() — inclusive nas conexões do tempo real, que ficam abertas por horas. Com muita gente
// conectada o pool acabava e cada requisição criava VMs na hora (lento e com muita memória). Por isso
// o envelope de erros fica preso só às rotas da API e os cabeçalhos do frontend, à rota dos arquivos.
// Ver docs/plano-migracao-supabase.md §4.

// Erros da plataforma (rate limit, limite do corpo) no envelope padrão do /api/v1.
// Prioridade entre securityHeaders (-1010) e rateLimit (-1000) do PocketBase.
const API_ERRORS = new Middleware(
  (e) => {
    try {
      return e.next()
    } catch (err) {
      return require(`${__hooks}/src/http/handler.js`).renderPlatformError(e, err)
    }
  },
  -1005,
  'kamban_api_errors',
)

/** Rota da API /api/v1: sempre com o envelope de erros da plataforma. */
function apiRoute(method, path, handler, ...middlewares) {
  routerAdd(method, path, handler, API_ERRORS, ...middlewares)
}

// health / docs
apiRoute('GET', '/api/v1/health', (e) => require(`${__hooks}/src/http/routes.js`).health(e))
apiRoute('GET', '/api/v1/openapi.json', (e) => require(`${__hooks}/src/http/routes.js`).openapi(e))

// auth
apiRoute('POST', '/api/v1/auth/login', (e) => require(`${__hooks}/src/http/routes.js`).login(e), JSON_BODY_LIMIT)
apiRoute('POST', '/api/v1/auth/logout', (e) => require(`${__hooks}/src/http/routes.js`).logout(e))
apiRoute('GET', '/api/v1/auth/me', (e) => require(`${__hooks}/src/http/routes.js`).me(e))
apiRoute('GET', '/api/v1/auth/sessions', (e) => require(`${__hooks}/src/http/routes.js`).listSessions(e))
apiRoute('POST', '/api/v1/auth/password', (e) => require(`${__hooks}/src/http/routes.js`).changePassword(e), JSON_BODY_LIMIT)
apiRoute('POST', '/api/v1/auth/sessions/revoke-others', (e) => require(`${__hooks}/src/http/routes.js`).revokeOtherSessions(e))
apiRoute('DELETE', '/api/v1/auth/sessions/{id}', (e) => require(`${__hooks}/src/http/routes.js`).revokeSession(e))

// permissions & roles
apiRoute('GET', '/api/v1/permissions', (e) => require(`${__hooks}/src/http/routes.js`).listPermissions(e))
apiRoute('GET', '/api/v1/roles', (e) => require(`${__hooks}/src/http/routes.js`).listRoles(e))
apiRoute('POST', '/api/v1/roles', (e) => require(`${__hooks}/src/http/routes.js`).createRole(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/roles/{id}', (e) => require(`${__hooks}/src/http/routes.js`).getRole(e))
apiRoute('PATCH', '/api/v1/roles/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateRole(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/roles/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteRole(e))
apiRoute(
  'PUT',
  '/api/v1/roles/{id}/permissions',
  (e) => require(`${__hooks}/src/http/routes.js`).updateRolePermissions(e),
  JSON_BODY_LIMIT,
)

// users
apiRoute('GET', '/api/v1/users', (e) => require(`${__hooks}/src/http/routes.js`).listUsers(e))
apiRoute('POST', '/api/v1/users', (e) => require(`${__hooks}/src/http/routes.js`).createUser(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/users/{id}', (e) => require(`${__hooks}/src/http/routes.js`).getUser(e))
apiRoute('PATCH', '/api/v1/users/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateUser(e), JSON_BODY_LIMIT)
apiRoute(
  'PATCH',
  '/api/v1/users/{id}/status',
  (e) => require(`${__hooks}/src/http/routes.js`).changeUserStatus(e),
  JSON_BODY_LIMIT,
)

apiRoute(
  'POST',
  '/api/v1/users/{id}/password',
  (e) => require(`${__hooks}/src/http/routes.js`).resetUserPassword(e),
  JSON_BODY_LIMIT,
)
apiRoute('GET', '/api/v1/users/{id}/history', (e) => require(`${__hooks}/src/http/routes.js`).userHistory(e))

// audit
apiRoute('GET', '/api/v1/audit-logs', (e) => require(`${__hooks}/src/http/routes.js`).listAuditLogs(e))

// projects
apiRoute('GET', '/api/v1/projects', (e) => require(`${__hooks}/src/http/routes.js`).listProjects(e))
apiRoute('POST', '/api/v1/projects', (e) => require(`${__hooks}/src/http/routes.js`).createProject(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/projects/{id}', (e) => require(`${__hooks}/src/http/routes.js`).getProject(e))
apiRoute('PATCH', '/api/v1/projects/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateProject(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/projects/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteProject(e))
apiRoute('POST', '/api/v1/projects/{id}/archive', (e) => require(`${__hooks}/src/http/routes.js`).archiveProject(e))
apiRoute('POST', '/api/v1/projects/{id}/unarchive', (e) => require(`${__hooks}/src/http/routes.js`).unarchiveProject(e))
apiRoute('PUT', '/api/v1/projects/{id}/owner', (e) => require(`${__hooks}/src/http/routes.js`).transferProject(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/projects/{id}/history', (e) => require(`${__hooks}/src/http/routes.js`).projectHistory(e))
apiRoute('GET', '/api/v1/projects/{id}/members', (e) => require(`${__hooks}/src/http/routes.js`).listProjectMembers(e))
apiRoute('POST', '/api/v1/projects/{id}/members', (e) => require(`${__hooks}/src/http/routes.js`).addProjectMember(e), JSON_BODY_LIMIT)
apiRoute(
  'GET',
  '/api/v1/projects/{id}/member-candidates',
  (e) => require(`${__hooks}/src/http/routes.js`).projectMemberCandidates(e),
)
apiRoute(
  'PATCH',
  '/api/v1/projects/{id}/members/{userId}',
  (e) => require(`${__hooks}/src/http/routes.js`).updateProjectMember(e),
  JSON_BODY_LIMIT,
)
apiRoute('DELETE', '/api/v1/projects/{id}/members/{userId}', (e) => require(`${__hooks}/src/http/routes.js`).removeProjectMember(e))

// custom fields & task types
apiRoute('GET', '/api/v1/custom-fields', (e) => require(`${__hooks}/src/http/routes.js`).listCustomFields(e))
apiRoute('POST', '/api/v1/custom-fields', (e) => require(`${__hooks}/src/http/routes.js`).createCustomField(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/custom-fields/{id}', (e) => require(`${__hooks}/src/http/routes.js`).getCustomField(e))
apiRoute('PATCH', '/api/v1/custom-fields/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateCustomField(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/custom-fields/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteCustomField(e))
apiRoute('GET', '/api/v1/task-types', (e) => require(`${__hooks}/src/http/routes.js`).listTaskTypes(e))
apiRoute('POST', '/api/v1/task-types', (e) => require(`${__hooks}/src/http/routes.js`).createTaskType(e), JSON_BODY_LIMIT)
apiRoute('PUT', '/api/v1/task-types/order', (e) => require(`${__hooks}/src/http/routes.js`).reorderTaskTypes(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/task-types/{id}', (e) => require(`${__hooks}/src/http/routes.js`).getTaskType(e))
apiRoute('PATCH', '/api/v1/task-types/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateTaskType(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/task-types/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteTaskType(e))
apiRoute('PUT', '/api/v1/task-types/{id}/fields', (e) => require(`${__hooks}/src/http/routes.js`).setTaskTypeFields(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/task-types/{id}/history', (e) => require(`${__hooks}/src/http/routes.js`).taskTypeHistory(e))

// statuses, priorities & areas (rotas fixas como /order antes de /{id})
apiRoute('GET', '/api/v1/statuses', (e) => require(`${__hooks}/src/http/routes.js`).listStatuses(e))
apiRoute('POST', '/api/v1/statuses', (e) => require(`${__hooks}/src/http/routes.js`).createStatus(e), JSON_BODY_LIMIT)
apiRoute('PUT', '/api/v1/statuses/order', (e) => require(`${__hooks}/src/http/routes.js`).reorderStatuses(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/statuses/{id}', (e) => require(`${__hooks}/src/http/routes.js`).getStatus(e))
apiRoute('PATCH', '/api/v1/statuses/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateStatus(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/statuses/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteStatus(e))
apiRoute('GET', '/api/v1/priorities', (e) => require(`${__hooks}/src/http/routes.js`).listPriorities(e))
apiRoute('POST', '/api/v1/priorities', (e) => require(`${__hooks}/src/http/routes.js`).createPriority(e), JSON_BODY_LIMIT)
apiRoute('PUT', '/api/v1/priorities/order', (e) => require(`${__hooks}/src/http/routes.js`).reorderPriorities(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/priorities/{id}', (e) => require(`${__hooks}/src/http/routes.js`).getPriority(e))
apiRoute('PATCH', '/api/v1/priorities/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updatePriority(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/priorities/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deletePriority(e))
apiRoute('GET', '/api/v1/areas', (e) => require(`${__hooks}/src/http/routes.js`).listAreas(e))
apiRoute('POST', '/api/v1/areas', (e) => require(`${__hooks}/src/http/routes.js`).createArea(e), JSON_BODY_LIMIT)
apiRoute('PUT', '/api/v1/areas/order', (e) => require(`${__hooks}/src/http/routes.js`).reorderAreas(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/areas/{id}', (e) => require(`${__hooks}/src/http/routes.js`).getArea(e))
apiRoute('PATCH', '/api/v1/areas/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateArea(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/areas/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteArea(e))

// tasks
apiRoute('GET', '/api/v1/tasks', (e) => require(`${__hooks}/src/http/routes.js`).listTasks(e))
apiRoute('POST', '/api/v1/tasks', (e) => require(`${__hooks}/src/http/routes.js`).createTask(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/tasks/{id}', (e) => require(`${__hooks}/src/http/routes.js`).getTask(e))
apiRoute('PATCH', '/api/v1/tasks/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateTask(e), JSON_BODY_LIMIT)
apiRoute('PUT', '/api/v1/tasks/{id}/report', (e) => require(`${__hooks}/src/http/routes.js`).setTaskReport(e), JSON_BODY_LIMIT)
apiRoute('PUT', '/api/v1/tasks/{id}/urgency', (e) => require(`${__hooks}/src/http/routes.js`).setTaskUrgency(e), JSON_BODY_LIMIT)
apiRoute('PUT', '/api/v1/tasks/{id}/area', (e) => require(`${__hooks}/src/http/routes.js`).setTaskArea(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/tasks/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteTask(e))
apiRoute('GET', '/api/v1/tasks/{id}/history', (e) => require(`${__hooks}/src/http/routes.js`).taskHistory(e))
apiRoute('GET', '/api/v1/tasks/{id}/comments', (e) => require(`${__hooks}/src/http/routes.js`).listTaskComments(e))
apiRoute('POST', '/api/v1/tasks/{id}/comments', (e) => require(`${__hooks}/src/http/routes.js`).createTaskComment(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/tasks/{id}/mention-candidates', (e) => require(`${__hooks}/src/http/routes.js`).taskMentionCandidates(e))
apiRoute('PATCH', '/api/v1/comments/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateComment(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/comments/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteComment(e))

// attachments (upload: um arquivo por requisição de até 20 MB; o front envia um por vez)
apiRoute('GET', '/api/v1/tasks/{id}/attachments', (e) => require(`${__hooks}/src/http/routes.js`).listTaskAttachments(e))
apiRoute('POST', '/api/v1/tasks/{id}/attachments', (e) => require(`${__hooks}/src/http/routes.js`).uploadTaskAttachments(e), $apis.bodyLimit(21 * 1024 * 1024))
apiRoute('GET', '/api/v1/attachments/{id}/file', (e) => require(`${__hooks}/src/http/routes.js`).attachmentFile(e))
apiRoute('DELETE', '/api/v1/attachments/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteAttachment(e))

// kanban
apiRoute('GET', '/api/v1/projects/{id}/board', (e) => require(`${__hooks}/src/http/routes.js`).projectBoard(e))
apiRoute('POST', '/api/v1/tasks/{id}/move', (e) => require(`${__hooks}/src/http/routes.js`).moveTask(e), JSON_BODY_LIMIT)

// backlog e sprints
apiRoute('GET', '/api/v1/projects/{id}/backlog', (e) => require(`${__hooks}/src/http/routes.js`).projectBacklog(e))
apiRoute('POST', '/api/v1/tasks/{id}/rank', (e) => require(`${__hooks}/src/http/routes.js`).rankTask(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/projects/{id}/sprints', (e) => require(`${__hooks}/src/http/routes.js`).listSprints(e))
apiRoute('POST', '/api/v1/projects/{id}/sprints', (e) => require(`${__hooks}/src/http/routes.js`).createSprint(e), JSON_BODY_LIMIT)
apiRoute('PUT', '/api/v1/projects/{id}/sprints/order', (e) => require(`${__hooks}/src/http/routes.js`).reorderSprints(e), JSON_BODY_LIMIT)
apiRoute('PATCH', '/api/v1/sprints/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateSprint(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/sprints/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteSprint(e))

// relacionamentos e fork
apiRoute('GET', '/api/v1/tasks/{id}/relations', (e) => require(`${__hooks}/src/http/routes.js`).listTaskRelations(e))
apiRoute('POST', '/api/v1/tasks/{id}/relations', (e) => require(`${__hooks}/src/http/routes.js`).createTaskRelation(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/relations/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteTaskRelation(e))
apiRoute('POST', '/api/v1/tasks/{id}/fork', (e) => require(`${__hooks}/src/http/routes.js`).forkTask(e), JSON_BODY_LIMIT)

// timeline e marcos (expansão, Onda 1)
apiRoute('GET', '/api/v1/projects/{id}/timeline', (e) => require(`${__hooks}/src/http/routes.js`).projectTimeline(e))
apiRoute('GET', '/api/v1/projects/{id}/milestones', (e) => require(`${__hooks}/src/http/routes.js`).listMilestones(e))
apiRoute('POST', '/api/v1/projects/{id}/milestones', (e) => require(`${__hooks}/src/http/routes.js`).createMilestone(e), JSON_BODY_LIMIT)
apiRoute('PATCH', '/api/v1/milestones/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateMilestone(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/milestones/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteMilestone(e))
apiRoute('GET', '/api/v1/projects/{id}/charter', (e) => require(`${__hooks}/src/http/routes.js`).getCharter(e))
apiRoute('PUT', '/api/v1/projects/{id}/charter', (e) => require(`${__hooks}/src/http/routes.js`).updateCharter(e), JSON_BODY_LIMIT)
apiRoute('POST', '/api/v1/projects/{id}/charter/items', (e) => require(`${__hooks}/src/http/routes.js`).createCharterItem(e), JSON_BODY_LIMIT)
apiRoute('PUT', '/api/v1/projects/{id}/charter/order', (e) => require(`${__hooks}/src/http/routes.js`).reorderCharterItems(e), JSON_BODY_LIMIT)
apiRoute('PATCH', '/api/v1/charter-items/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateCharterItem(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/charter-items/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteCharterItem(e))
apiRoute('GET', '/api/v1/charter-items/{id}/measurements', (e) => require(`${__hooks}/src/http/routes.js`).listCharterMeasurements(e))
apiRoute('POST', '/api/v1/charter-items/{id}/measurements', (e) => require(`${__hooks}/src/http/routes.js`).addCharterMeasurement(e), JSON_BODY_LIMIT)

// quadro do projeto (Gerenciamento de Projetos — módulo à parte das tarefas)
apiRoute('GET', '/api/v1/projects/{id}/plan', (e) => require(`${__hooks}/src/http/routes.js`).projectPlan(e))
apiRoute('GET', '/api/v1/projects/{id}/groups', (e) => require(`${__hooks}/src/http/routes.js`).listProjectGroups(e))
apiRoute('POST', '/api/v1/projects/{id}/groups', (e) => require(`${__hooks}/src/http/routes.js`).createProjectGroup(e), JSON_BODY_LIMIT)
apiRoute('PATCH', '/api/v1/groups/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateProjectGroup(e), JSON_BODY_LIMIT)
apiRoute('PUT', '/api/v1/groups/{id}/move', (e) => require(`${__hooks}/src/http/routes.js`).moveProjectGroup(e), JSON_BODY_LIMIT)
apiRoute('POST', '/api/v1/groups/{id}/duplicate', (e) => require(`${__hooks}/src/http/routes.js`).duplicateProjectGroup(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/groups/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteProjectGroup(e))
apiRoute('POST', '/api/v1/projects/{id}/plan/items', (e) => require(`${__hooks}/src/http/routes.js`).createPlanItem(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/plan/items/{id}', (e) => require(`${__hooks}/src/http/routes.js`).getPlanItem(e))
apiRoute('PATCH', '/api/v1/plan/items/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updatePlanItem(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/plan/items/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deletePlanItem(e))
apiRoute('POST', '/api/v1/projects/{id}/plan/statuses', (e) => require(`${__hooks}/src/http/routes.js`).createPlanStatus(e), JSON_BODY_LIMIT)
apiRoute('PATCH', '/api/v1/plan/statuses/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updatePlanStatus(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/plan/statuses/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deletePlanStatus(e))
apiRoute('POST', '/api/v1/projects/{id}/plan/resources', (e) => require(`${__hooks}/src/http/routes.js`).createPlanResource(e), JSON_BODY_LIMIT)
apiRoute('PATCH', '/api/v1/plan/resources/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updatePlanResource(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/plan/resources/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deletePlanResource(e))
apiRoute('PUT', '/api/v1/plan/items/{id}/move', (e) => require(`${__hooks}/src/http/routes.js`).movePlanItem(e), JSON_BODY_LIMIT)
apiRoute('POST', '/api/v1/plan/items/{id}/duplicate', (e) => require(`${__hooks}/src/http/routes.js`).duplicatePlanItem(e), JSON_BODY_LIMIT)
apiRoute('POST', '/api/v1/projects/{id}/plan/items/bulk', (e) => require(`${__hooks}/src/http/routes.js`).bulkPlanItems(e), JSON_BODY_LIMIT)
apiRoute('POST', '/api/v1/plan/items/{id}/links', (e) => require(`${__hooks}/src/http/routes.js`).createPlanLink(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/plan/links/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deletePlanLink(e))
apiRoute('PATCH', '/api/v1/projects/{id}/plan/settings', (e) => require(`${__hooks}/src/http/routes.js`).updatePlanSettings(e), JSON_BODY_LIMIT)
apiRoute('POST', '/api/v1/projects/{id}/plan/import', (e) => require(`${__hooks}/src/http/routes.js`).importPlanItems(e), JSON_BODY_LIMIT)
// quadro — GP-3 (painel do elemento: atualizações, arquivos e histórico)
apiRoute('GET', '/api/v1/plan/items/{id}/updates', (e) => require(`${__hooks}/src/http/routes.js`).listPlanUpdates(e))
// multipart: imagens coladas/anexadas seguem com o texto (até 10, 50 MB no total)
apiRoute('POST', '/api/v1/plan/items/{id}/updates', (e) => require(`${__hooks}/src/http/routes.js`).createPlanUpdate(e), $apis.bodyLimit(51 * 1024 * 1024))
apiRoute('PATCH', '/api/v1/plan/updates/{id}', (e) => require(`${__hooks}/src/http/routes.js`).editPlanUpdate(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/plan/updates/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deletePlanUpdate(e))
apiRoute('GET', '/api/v1/plan/items/{id}/mention-candidates', (e) => require(`${__hooks}/src/http/routes.js`).planMentionCandidates(e))
apiRoute('POST', '/api/v1/plan/updates/{id}/files', (e) => require(`${__hooks}/src/http/routes.js`).addPlanUpdateFiles(e), $apis.bodyLimit(51 * 1024 * 1024))
apiRoute('GET', '/api/v1/plan/files/{id}/file', (e) => require(`${__hooks}/src/http/routes.js`).planFile(e))
apiRoute('DELETE', '/api/v1/plan/files/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deletePlanFile(e))
apiRoute('GET', '/api/v1/plan/items/{id}/history', (e) => require(`${__hooks}/src/http/routes.js`).planItemHistory(e))
// quadro — GP-4 (Gestão: diário e problemas; linha de base do Cronograma; relatório e saúde)
apiRoute('GET', '/api/v1/projects/{id}/plan/journal', (e) => require(`${__hooks}/src/http/routes.js`).listPlanJournal(e))
apiRoute('POST', '/api/v1/projects/{id}/plan/journal', (e) => require(`${__hooks}/src/http/routes.js`).createPlanJournalEntry(e), JSON_BODY_LIMIT)
apiRoute('PATCH', '/api/v1/plan/journal/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updatePlanJournalEntry(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/plan/journal/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deletePlanJournalEntry(e))
apiRoute('GET', '/api/v1/projects/{id}/plan/issues', (e) => require(`${__hooks}/src/http/routes.js`).listPlanIssues(e))
apiRoute('POST', '/api/v1/projects/{id}/plan/issues', (e) => require(`${__hooks}/src/http/routes.js`).createPlanIssue(e), JSON_BODY_LIMIT)
apiRoute('PATCH', '/api/v1/plan/issues/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updatePlanIssue(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/plan/issues/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deletePlanIssue(e))
apiRoute('PUT', '/api/v1/projects/{id}/plan/baseline', (e) => require(`${__hooks}/src/http/routes.js`).savePlanBaseline(e))
apiRoute('DELETE', '/api/v1/projects/{id}/plan/baseline', (e) => require(`${__hooks}/src/http/routes.js`).clearPlanBaseline(e))
apiRoute('GET', '/api/v1/projects/{id}/plan/report', (e) => require(`${__hooks}/src/http/routes.js`).planReport(e))
// quadro — GP-5 (colunas personalizadas: o gestor define; os valores vão no PATCH do elemento, `custom`)
apiRoute('POST', '/api/v1/projects/{id}/plan/columns', (e) => require(`${__hooks}/src/http/routes.js`).createPlanColumn(e), JSON_BODY_LIMIT)
apiRoute('PATCH', '/api/v1/plan/columns/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updatePlanColumn(e), JSON_BODY_LIMIT)
apiRoute('POST', '/api/v1/plan/columns/{id}/type', (e) => require(`${__hooks}/src/http/routes.js`).changePlanColumnType(e), JSON_BODY_LIMIT)
apiRoute('POST', '/api/v1/plan/columns/{id}/duplicate', (e) => require(`${__hooks}/src/http/routes.js`).duplicatePlanColumn(e))
apiRoute('DELETE', '/api/v1/plan/columns/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deletePlanColumn(e))

// documentação (expansão, Onda 2) — rotas fixas antes das com {id}
const DOC_BODY_LIMIT = $apis.bodyLimit(4 * 1024 * 1024) // conteúdo do editor (JSON) até ~3 MB
apiRoute('GET', '/api/v1/docs/search', (e) => require(`${__hooks}/src/http/routes.js`).searchDocs(e))
apiRoute('GET', '/api/v1/docs/recent', (e) => require(`${__hooks}/src/http/routes.js`).recentDocs(e))
apiRoute('GET', '/api/v1/docs/spaces', (e) => require(`${__hooks}/src/http/routes.js`).listDocSpaces(e))
apiRoute('POST', '/api/v1/docs/spaces', (e) => require(`${__hooks}/src/http/routes.js`).createDocSpace(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/docs/spaces/{id}', (e) => require(`${__hooks}/src/http/routes.js`).getDocSpace(e))
apiRoute('PATCH', '/api/v1/docs/spaces/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateDocSpace(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/docs/spaces/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteDocSpace(e))
apiRoute('POST', '/api/v1/docs/spaces/{id}/pages', (e) => require(`${__hooks}/src/http/routes.js`).createDocPage(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/docs/pages/{id}', (e) => require(`${__hooks}/src/http/routes.js`).getDocPage(e))
apiRoute('DELETE', '/api/v1/docs/pages/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteDocPage(e))
apiRoute('GET', '/api/v1/docs/pages/{id}/draft', (e) => require(`${__hooks}/src/http/routes.js`).getDocDraft(e))
apiRoute('PUT', '/api/v1/docs/pages/{id}/draft', (e) => require(`${__hooks}/src/http/routes.js`).saveDocDraft(e), DOC_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/docs/pages/{id}/draft', (e) => require(`${__hooks}/src/http/routes.js`).discardDocDraft(e))
apiRoute('POST', '/api/v1/docs/pages/{id}/publish', (e) => require(`${__hooks}/src/http/routes.js`).publishDocPage(e), DOC_BODY_LIMIT)
apiRoute('PUT', '/api/v1/docs/pages/{id}/move', (e) => require(`${__hooks}/src/http/routes.js`).moveDocPage(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/docs/pages/{id}/versions', (e) => require(`${__hooks}/src/http/routes.js`).listDocVersions(e))
apiRoute('GET', '/api/v1/docs/pages/{id}/versions/{version}', (e) => require(`${__hooks}/src/http/routes.js`).getDocVersion(e))
apiRoute('POST', '/api/v1/docs/pages/{id}/versions/{version}/restore', (e) => require(`${__hooks}/src/http/routes.js`).restoreDocVersion(e), JSON_BODY_LIMIT)
apiRoute('POST', '/api/v1/docs/pages/{id}/files', (e) => require(`${__hooks}/src/http/routes.js`).uploadDocFiles(e), $apis.bodyLimit(21 * 1024 * 1024))
apiRoute('GET', '/api/v1/docs/files/{id}', (e) => require(`${__hooks}/src/http/routes.js`).docFile(e))

// relatórios
apiRoute('GET', '/api/v1/reports', (e) => require(`${__hooks}/src/http/routes.js`).getReport(e))
apiRoute('GET', '/api/v1/reports/tasks', (e) => require(`${__hooks}/src/http/routes.js`).listReportTasks(e))

// notifications (rotas fixas antes de /{id})
apiRoute('GET', '/api/v1/notifications', (e) => require(`${__hooks}/src/http/routes.js`).listNotifications(e))
apiRoute('GET', '/api/v1/notifications/unread-count', (e) => require(`${__hooks}/src/http/routes.js`).notificationsUnreadCount(e))
apiRoute('POST', '/api/v1/notifications/read-all', (e) => require(`${__hooks}/src/http/routes.js`).readAllNotifications(e))
apiRoute('POST', '/api/v1/notifications/{id}/read', (e) => require(`${__hooks}/src/http/routes.js`).readNotification(e))

apiRoute('POST', '/api/v1/notifications/due-reminders', (e) => require(`${__hooks}/src/http/routes.js`).runDueRemindersNow(e))

// lembretes de prazo todo dia às 08:00 (horário do servidor)
cronAdd('kamban_due_reminders', '0 8 * * *', () => require(`${__hooks}/src/http/routes.js`).runDueReminders())
cronAdd('kamban_login_attempts_cleanup', '30 3 * * *', () => require(`${__hooks}/src/http/routes.js`).purgeLoginAttempts())
// retenção do histórico de auditoria (Configurador geral) todo dia às 03:45
cronAdd('kamban_audit_retention', '45 3 * * *', () => require(`${__hooks}/src/http/routes.js`).purgeAuditLogs())

// Configurador geral: identidade pública (login, título e ícone) e configurações (platform.manage)
apiRoute('GET', '/api/v1/platform', (e) => require(`${__hooks}/src/http/routes.js`).platformInfo(e))
apiRoute('GET', '/api/v1/platform/branding/{slot}', (e) => require(`${__hooks}/src/http/routes.js`).platformBranding(e))
apiRoute('GET', '/api/v1/settings/platform', (e) => require(`${__hooks}/src/http/routes.js`).getPlatformSettings(e))
apiRoute('PATCH', '/api/v1/settings/platform', (e) => require(`${__hooks}/src/http/routes.js`).updatePlatformSettings(e), JSON_BODY_LIMIT)
apiRoute('POST', '/api/v1/settings/platform/branding/{slot}', (e) => require(`${__hooks}/src/http/routes.js`).uploadPlatformBranding(e), $apis.bodyLimit(2 * 1024 * 1024))
apiRoute('DELETE', '/api/v1/settings/platform/branding/{slot}', (e) => require(`${__hooks}/src/http/routes.js`).removePlatformBranding(e))
apiRoute('POST', '/api/v1/settings/platform/purge-audit', (e) => require(`${__hooks}/src/http/routes.js`).runAuditRetention(e))
// e-mail (integrações): configurações, teste e fila; links de senha e convite (públicos)
cronAdd('kamban_email_outbox', '* * * * *', () => require(`${__hooks}/src/http/routes.js`).flushEmailOutbox())
apiRoute('GET', '/api/v1/settings/email', (e) => require(`${__hooks}/src/http/routes.js`).getEmailSettings(e))
apiRoute('PATCH', '/api/v1/settings/email', (e) => require(`${__hooks}/src/http/routes.js`).updateEmailSettings(e), JSON_BODY_LIMIT)
apiRoute('POST', '/api/v1/settings/email/test', (e) => require(`${__hooks}/src/http/routes.js`).sendTestEmail(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/settings/email/outbox', (e) => require(`${__hooks}/src/http/routes.js`).emailOutbox(e))
apiRoute('POST', '/api/v1/settings/email/outbox/flush', (e) => require(`${__hooks}/src/http/routes.js`).flushEmailOutboxNow(e))
apiRoute('POST', '/api/v1/auth/password-reset/request', (e) => require(`${__hooks}/src/http/routes.js`).requestPasswordReset(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/auth/password-reset/check', (e) => require(`${__hooks}/src/http/routes.js`).checkPasswordReset(e))
apiRoute('POST', '/api/v1/auth/password-reset/confirm', (e) => require(`${__hooks}/src/http/routes.js`).confirmPasswordReset(e), JSON_BODY_LIMIT)
apiRoute('POST', '/api/v1/users/{id}/invite', (e) => require(`${__hooks}/src/http/routes.js`).resendInvite(e))
// tokens de API pessoais (Minha conta) e de todos (Integrações)
apiRoute('GET', '/api/v1/auth/tokens', (e) => require(`${__hooks}/src/http/routes.js`).listMyApiTokens(e))
apiRoute('POST', '/api/v1/auth/tokens', (e) => require(`${__hooks}/src/http/routes.js`).createApiToken(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/auth/tokens/{id}', (e) => require(`${__hooks}/src/http/routes.js`).revokeApiToken(e))
apiRoute('GET', '/api/v1/settings/api-tokens', (e) => require(`${__hooks}/src/http/routes.js`).listAllApiTokens(e))
apiRoute('DELETE', '/api/v1/settings/api-tokens/{id}', (e) => require(`${__hooks}/src/http/routes.js`).revokeApiToken(e))
// webhooks (Integrações): rotas fixas antes de /{id}; envio a cada minuto
cronAdd('kamban_webhooks', '* * * * *', () => require(`${__hooks}/src/http/routes.js`).flushWebhooks())
apiRoute('GET', '/api/v1/settings/webhooks', (e) => require(`${__hooks}/src/http/routes.js`).listWebhooks(e))
apiRoute('POST', '/api/v1/settings/webhooks', (e) => require(`${__hooks}/src/http/routes.js`).createWebhook(e), JSON_BODY_LIMIT)
apiRoute('GET', '/api/v1/settings/webhooks/events', (e) => require(`${__hooks}/src/http/routes.js`).webhookEvents(e))
apiRoute('PATCH', '/api/v1/settings/webhooks/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateWebhook(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/settings/webhooks/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteWebhook(e))
apiRoute('POST', '/api/v1/settings/webhooks/{id}/rotate-secret', (e) => require(`${__hooks}/src/http/routes.js`).rotateWebhookSecret(e))
apiRoute('POST', '/api/v1/settings/webhooks/{id}/test', (e) => require(`${__hooks}/src/http/routes.js`).testWebhook(e))
apiRoute('GET', '/api/v1/settings/webhooks/{id}/deliveries', (e) => require(`${__hooks}/src/http/routes.js`).webhookDeliveries(e))
apiRoute('POST', '/api/v1/settings/webhook-deliveries/{id}/redeliver', (e) => require(`${__hooks}/src/http/routes.js`).redeliverWebhook(e))
// tempo real: assinaturas da conexão SSE (/api/realtime) passam pela sessão; avisos depois de gravar
onRealtimeSubscribeRequest((e) => require(`${__hooks}/src/http/realtime.js`).authorizeSubscriptions(e))
onRecordAfterCreateSuccess((e) => require(`${__hooks}/src/http/realtime.js`).recordChanged(e, 'create'), ...require(`${__hooks}/src/domain/realtime.js`).WATCHED)
onRecordAfterUpdateSuccess((e) => require(`${__hooks}/src/http/realtime.js`).recordChanged(e, 'update'), ...require(`${__hooks}/src/domain/realtime.js`).WATCHED)
onRecordAfterDeleteSuccess((e) => require(`${__hooks}/src/http/realtime.js`).recordChanged(e, 'delete'), ...require(`${__hooks}/src/domain/realtime.js`).WATCHED)

apiRoute('GET', '/api/v1/auth/password-policy', (e) => require(`${__hooks}/src/http/routes.js`).passwordPolicy(e))

// tags
apiRoute('GET', '/api/v1/tags', (e) => require(`${__hooks}/src/http/routes.js`).listTags(e))
apiRoute('POST', '/api/v1/tags', (e) => require(`${__hooks}/src/http/routes.js`).createTag(e), JSON_BODY_LIMIT)
apiRoute('PATCH', '/api/v1/tags/{id}', (e) => require(`${__hooks}/src/http/routes.js`).updateTag(e), JSON_BODY_LIMIT)
apiRoute('DELETE', '/api/v1/tags/{id}', (e) => require(`${__hooks}/src/http/routes.js`).deleteTag(e))

// Qualquer outra rota /api/v1 responde no envelope padrão.
;['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].forEach((method) => {
  apiRoute(method, '/api/v1/{path...}', (e) => require(`${__hooks}/src/http/routes.js`).notFound(e))
})

// Comando de console para criar/atualizar o super administrador a partir de variáveis de ambiente.
$app.rootCmd.addCommand(
  new Command({
    use: 'kamban-admin',
    short: 'Cria ou atualiza o SUPER_ADMIN (KAMBAN_ADMIN_EMAIL, KAMBAN_ADMIN_PASSWORD, KAMBAN_ADMIN_NAME)',
    run: () => {
      require(`${__hooks}/src/infrastructure/bootstrap-admin.js`).run($app)
    },
  }),
)

// tempo real: sinal de vida (o PocketBase fecha a conexão após 5 min sem mensagens)
cronAdd('kamban_realtime_keepalive', '*/3 * * * *', () => require(`${__hooks}/src/http/realtime.js`).keepAlive())

// Frontend (SPA do --publicDir) com os cabeçalhos de segurança, numa rota própria (o PocketBase só
// registra a dele quando não há uma): o JS roda só ao servir um arquivo, nunca na API nem no tempo real.
routerAdd(
  'GET',
  '/{path...}',
  // a mesma pasta que o PocketBase serviria (opção --publicDir do serve, ou o padrão dele)
  $apis.static($app.rootCmd.persistentFlags().lookup('publicDir').value.string(), true),
  new Middleware(
    (e) => {
      const headers = e.response.header()
      headers.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
          "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
      )
      headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
      headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
      return e.next()
    },
    -1004,
    'kamban_security_headers',
  ),
)
