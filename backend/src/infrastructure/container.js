/**
 * Composition root do backend: monta dependências concretas (Postgres, Storage, SMTP, HTTP) e os
 * serviços de aplicação. Criado por requisição (barato: só fecha sobre o `runtime` do servidor) para
 * levar o idioma da tela.
 *
 * `runtime` = { config, db, storage, secrets } — montado em src/server.js.
 */

const crypto = require('node:crypto')
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
const { createIconLibraryService } = require('../application/icon-library')
const { createCommentService } = require('../application/comments')
const { createAttachmentService } = require('../application/attachments')
const { createProjectFileService } = require('../application/project-files')
const { createNotificationService } = require('../application/notifications')
const { createBoardService } = require('../application/board')
const { createBacklogService } = require('../application/backlog')
const { createSprintService } = require('../application/sprints')
const { createRelationService } = require('../application/relations')
const { createReportService } = require('../application/reports')
const { createExecutiveService } = require('../application/executive')
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
const { createMailer, createHttpClient, createCrypto } = require('./adapters')
const { guardStorage } = require('./storage')
const contentLocale = require('../domain/content-locale')

const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/** Token aleatório [a-zA-Z0-9] (o mesmo formato do $security.randomString do PocketBase). */
function randomToken(length) {
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length]
  return out
}

/**
 * Transação do Postgres: `fn(repos)` roda numa transação; os mesmos repositórios servem dentro e fora
 * (a conexão da transação fica no contexto assíncrono — infrastructure/database.js).
 */
function createUnitOfWork(db, repos) {
  return {
    run: (fn) => db.transaction(() => fn(repos)),
  }
}

/** `options.locale`: idioma da requisição (cadastros traduzidos — domain/content-locale.js). */
function createContainer(runtime, options) {
  const settings = runtime.config
  const repos = createRepositories(runtime.db, {
    storage: guardStorage(runtime.storage, runtime.db),
    secrets: runtime.secrets,
    bcryptCost: settings.bcryptCost,
  })
  const deps = Object.assign({}, repos, {
    locale: (options && options.locale) || contentLocale.BASE_LOCALE,
    clock: { now: () => new Date() },
    tokens: {
      generate: () => randomToken(48),
      // sha256 em hex, como o PocketBase: sessões e tokens migrados continuam valendo
      hash: (token) => crypto.createHash('sha256').update(String(token)).digest('hex'),
    },
    sessionPolicy: settings.session,
    mailer: createMailer(runtime.db, runtime.secrets),
    httpClient: createHttpClient(),
    crypto: createCrypto(),
    allowInsecureWebhooks: settings.allowInsecureWebhooks,
    unitOfWork: createUnitOfWork(runtime.db, repos),
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
    iconLibrary: createIconLibraryService(deps),
    comments: createCommentService(deps),
    attachments: createAttachmentService(deps),
    projectFiles: createProjectFileService(deps),
    notifications: createNotificationService(deps),
    board: createBoardService(deps),
    backlog: createBacklogService(deps),
    sprints: createSprintService(deps),
    relations: createRelationService(deps),
    reports: createReportService(deps),
    executive: createExecutiveService(deps),
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

module.exports = { createContainer, randomToken }
