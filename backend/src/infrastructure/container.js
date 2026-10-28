/**
 * Composition root do backend: monta dependências concretas (PocketBase) e os serviços de aplicação.
 * Criado por requisição (os handlers do JSVM rodam em VMs isoladas).
 */

const { createRepositories } = require('./repositories')
const { createAuthService } = require('../application/auth')
const { createRoleService } = require('../application/roles')
const { createUserService } = require('../application/users')
const { createAuditService } = require('../application/audit-logs')
const { createProjectService } = require('../application/projects')
const { createCustomFieldService } = require('../application/custom-fields')
const { createTaskTypeService } = require('../application/task-types')
const { createLookupService } = require('../application/lookups')
const { createTaskService } = require('../application/tasks')
const { createTagService } = require('../application/tags')
const { createCommentService } = require('../application/comments')
const { createAttachmentService } = require('../application/attachments')
const { createNotificationService } = require('../application/notifications')
const { createBoardService } = require('../application/board')
const { createBacklogService } = require('../application/backlog')
const { createSprintService } = require('../application/sprints')
const { createRelationService } = require('../application/relations')
const { createReportService } = require('../application/reports')
const { createTimelineService } = require('../application/timeline')
const { createMilestoneService } = require('../application/milestones')
const { createPlanService } = require('../application/plan')
const { createPlanInteractionService } = require('../application/plan-interaction')
const { createPlanCollaborationService } = require('../application/plan-collaboration')
const { createPlanManagementService } = require('../application/plan-management')
const { createPlanColumnsService } = require('../application/plan-columns')
const { createDocSpaceService } = require('../application/doc-spaces')
const { createDocPageService } = require('../application/doc-pages')
const { createPlatformSettingsService } = require('../application/platform-settings')
const { createEmailService } = require('../application/email')
const { createAccountLinkService } = require('../application/account-links')
const { createApiTokenService } = require('../application/api-tokens')
const { createWebhookService } = require('../application/webhooks')
const { createRealtimeService } = require('../application/realtime')
const { createHttpClient, createCrypto } = require('./webhook-repositories')
const { createMailer } = require('./email-repositories')
const contentLocale = require('../domain/content-locale')
const config = require('./config')

function createUnitOfWork(app) {
  return {
    /** Executa `fn(repos)` numa transação; erros de aplicação são repropagados intactos. */
    run(fn) {
      let result
      let failure = null
      try {
        app.runInTransaction((txApp) => {
          try {
            result = fn(createRepositories(txApp))
          } catch (err) {
            failure = err
            throw err
          }
        })
      } catch (outer) {
        throw failure || outer
      }
      return result
    },
  }
}

/** `options.locale`: idioma da requisição (cadastros traduzidos — domain/content-locale.js). */
function createContainer(app, options) {
  const settings = config.load()
  const deps = Object.assign(createRepositories(app), {
    locale: (options && options.locale) || contentLocale.BASE_LOCALE,
    clock: { now: () => new Date() },
    tokens: {
      generate: () => $security.randomString(48),
      hash: (token) => $security.sha256(token),
    },
    sessionPolicy: settings.session,
    mailer: createMailer(app),
    httpClient: createHttpClient(),
    crypto: createCrypto(),
    allowInsecureWebhooks: settings.allowInsecureWebhooks,
    unitOfWork: createUnitOfWork(app),
  })

  return {
    config: settings,
    deps,
    auth: createAuthService(deps),
    roles: createRoleService(deps),
    users: createUserService(deps),
    audit: createAuditService(deps),
    projects: createProjectService(deps),
    customFields: createCustomFieldService(deps),
    taskTypes: createTaskTypeService(deps),
    statuses: createLookupService(deps, 'status'),
    priorities: createLookupService(deps, 'priority'),
    tasks: createTaskService(deps),
    tags: createTagService(deps),
    comments: createCommentService(deps),
    attachments: createAttachmentService(deps),
    notifications: createNotificationService(deps),
    board: createBoardService(deps),
    backlog: createBacklogService(deps),
    sprints: createSprintService(deps),
    relations: createRelationService(deps),
    reports: createReportService(deps),
    timeline: createTimelineService(deps),
    milestones: createMilestoneService(deps),
    plan: createPlanService(deps),
    planInteraction: createPlanInteractionService(deps),
    planCollaboration: createPlanCollaborationService(deps),
    planManagement: createPlanManagementService(deps),
    planColumns: createPlanColumnsService(deps),
    docSpaces: createDocSpaceService(deps),
    docPages: createDocPageService(deps),
    platformSettings: createPlatformSettingsService(deps),
    email: createEmailService(deps),
    accountLinks: createAccountLinkService(deps),
    apiTokens: createApiTokenService(deps),
    webhooks: createWebhookService(deps),
    realtime: createRealtimeService(deps),
  }
}

module.exports = { createContainer }
