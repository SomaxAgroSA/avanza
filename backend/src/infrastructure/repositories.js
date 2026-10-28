/**
 * Repositórios Postgres — implementam as portas descritas em application/ports.js.
 *
 * Únicos módulos do backend que conhecem tabelas e colunas (os nomes das collections do PocketBase,
 * ADR-044). Cada arquivo em ./repositories cobre uma área; todos recebem o banco (`db`, que já usa a
 * transação aberta no contexto — infrastructure/database.js) e `ctx` = { storage, secrets, bcryptCost }.
 */

const core = require('./repositories/core')
const platform = require('./repositories/platform')
const webhooks = require('./repositories/webhooks')
const projects = require('./repositories/projects')
const taskConfig = require('./repositories/task-config')
const tasks = require('./repositories/tasks')
const plan = require('./repositories/plan')
const docs = require('./repositories/docs')

function createRepositories(db, ctx) {
  const repos = {
    userRepository: core.createUserRepository(db, ctx),
    roleRepository: core.createRoleRepository(db, ctx),
    permissionRepository: core.createPermissionRepository(db, ctx),
    sessionRepository: core.createSessionRepository(db, ctx),
    auditRepository: core.createAuditRepository(db, ctx),
    loginAttemptRepository: core.createLoginAttemptRepository(db, ctx),

    platformSettingsRepository: platform.createPlatformSettingsRepository(db, ctx),
    apiTokenRepository: platform.createApiTokenRepository(db, ctx),
    emailSettingsRepository: platform.createEmailSettingsRepository(db, ctx),
    emailOutboxRepository: platform.createEmailOutboxRepository(db, ctx),
    authTokenRepository: platform.createAuthTokenRepository(db, ctx),

    webhookRepository: webhooks.createWebhookRepository(db, ctx),
    webhookDeliveryRepository: webhooks.createWebhookDeliveryRepository(db, ctx),

    projectRepository: projects.createProjectRepository(db, ctx),
    projectMemberRepository: projects.createProjectMemberRepository(db, ctx),
    projectFileRepository: projects.createProjectFileRepository(db, ctx),

    customFieldRepository: taskConfig.createCustomFieldRepository(db, ctx),
    taskTypeRepository: taskConfig.createTaskTypeRepository(db, ctx),
    taskTypeFieldRepository: taskConfig.createTaskTypeFieldRepository(db, ctx),
    statusRepository: taskConfig.createLookupRepository(db, ctx, 'task_statuses', { hasCategory: true, taskColumn: 'status_id' }),
    priorityRepository: taskConfig.createLookupRepository(db, ctx, 'task_priorities', { hasCategory: false, taskColumn: 'priority_id' }),
    tagRepository: taskConfig.createTagRepository(db, ctx),

    taskRepository: tasks.createTaskRepository(db, ctx),
    taskTagRepository: tasks.createTaskTagRepository(db, ctx),
    taskValueRepository: tasks.createTaskValueRepository(db, ctx),
    commentRepository: tasks.createCommentRepository(db, ctx),
    attachmentRepository: tasks.createAttachmentRepository(db, ctx),
    notificationRepository: tasks.createNotificationRepository(db, ctx),
    sprintRepository: tasks.createSprintRepository(db, ctx),
    milestoneRepository: tasks.createMilestoneRepository(db, ctx),
    relationRepository: tasks.createRelationRepository(db, ctx),

    projectGroupRepository: plan.createProjectGroupRepository(db, ctx),
    planStatusRepository: plan.createPlanStatusRepository(db, ctx),
    planResourceRepository: plan.createPlanResourceRepository(db, ctx),
    planItemRepository: plan.createPlanItemRepository(db, ctx),
    planLinkRepository: plan.createPlanLinkRepository(db, ctx),
    planSettingsRepository: plan.createPlanSettingsRepository(db, ctx),
    planUpdateRepository: plan.createPlanUpdateRepository(db, ctx),
    planFileRepository: plan.createPlanFileRepository(db, ctx),
    planJournalRepository: plan.createPlanJournalRepository(db, ctx),
    planIssueRepository: plan.createPlanIssueRepository(db, ctx),
    planColumnRepository: plan.createPlanColumnRepository(db, ctx),

    docSpaceRepository: docs.createDocSpaceRepository(db, ctx),
    docPageRepository: docs.createDocPageRepository(db, ctx),
    docPageVersionRepository: docs.createDocPageVersionRepository(db, ctx),
    docFileRepository: docs.createDocFileRepository(db, ctx),
  }
  // o histórico também enfileira as entregas dos webhooks que assinam o evento (na mesma transação)
  repos.auditRepository = webhooks.withWebhooks(repos.auditRepository, repos)
  return repos
}

module.exports = { createRepositories }
