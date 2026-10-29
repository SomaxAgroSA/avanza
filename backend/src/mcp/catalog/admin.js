/**
 * Ferramentas MCP de administração: usuários, perfis e permissões, histórico de auditoria, Configurador
 * geral, e-mail (SMTP), webhooks e os tokens de API de todos. Cada ferramenta delega para o caso de uso
 * da rota equivalente (http/routes.js); permissões, regras anti-escalonamento e histórico são os dos
 * casos de uso.
 *
 * Fora daqui, de propósito: envio de imagens (foto, logo, ícone), a senha do SMTP (fica na tela), a
 * própria senha/sessões/tokens e revogar token (só pelo navegador — `assertBrowserSession`), e a
 * importação de ícones.
 */

const userDomain = require('../../domain/user')
const { PERMISSIONS } = require('../../domain/permissions')
const settingsDomain = require('../../domain/platform-settings')
const webhookDomain = require('../../domain/webhook')
const { READ, ADD, CHANGE, ACTION, DELETE, schema, id, text, oneOf, bool, int, date, PAGE, pick, without, pageQuery, page } = require('../kit')

const USER_ID = id('User id (from list_users).')
const ROLE_ID = id('Role id (from list_roles).')
const WEBHOOK_ID = id('Webhook id (from list_webhooks).')

const PERMISSION_CODES = PERMISSIONS.map((p) => p.code)
const permissionList = (description) => ({ type: 'array', items: { type: 'string', enum: PERMISSION_CODES }, maxItems: 500, description })

const ROLE_FIELDS = { name: text(60, 'Role name.'), description: text(255, 'What the role is for.') }

const USER_STATUSES = [userDomain.USER_STATUS.ACTIVE, userDomain.USER_STATUS.DISABLED]

const PASSWORD = (description) => ({ type: 'string', maxLength: userDomain.PASSWORD_MAX, description })

const intLimit = (key, description) => int(settingsDomain.LIMITS[key].min, settingsDomain.LIMITS[key].max, description)

const PLATFORM_FIELDS = {
  platform_name: text(settingsDomain.NAME_MAX, 'Platform name (login screen, browser tab, e-mails).'),
  audit_retention_months: {
    type: 'integer',
    enum: settingsDomain.RETENTION_MONTHS.slice(),
    description: 'Months the audit history is kept (0 = forever). Shortening it deletes older records in the daily purge.',
  },
  lockout_threshold: intLimit('lockout_threshold', 'Failed logins before the account is locked for a while.'),
  lockout_base_minutes: intLimit('lockout_base_minutes', 'First lock duration in minutes (doubles on each new lock).'),
  lockout_max_minutes: intLimit('lockout_max_minutes', 'Longest lock in minutes (not below lockout_base_minutes).'),
  password_min_length: intLimit('password_min_length', 'Minimum password length (letters and digits are always required).'),
  password_require_mixed_case: bool('Passwords need upper and lower case letters.'),
  password_require_symbol: bool('Passwords need a symbol.'),
}

/** Sem `password`: a senha do SMTP só se troca pela tela. */
const EMAIL_FIELDS = {
  enabled: bool('Turns e-mail sending on (needs host, sender_address and app_url).'),
  host: text(255, 'SMTP server host.'),
  port: int(1, 65535, 'SMTP port (587 STARTTLS, 465 TLS).'),
  username: text(200, 'SMTP user (empty = no authentication).'),
  tls: bool('Implicit TLS from the start (port 465); false uses STARTTLS when offered.'),
  sender_name: text(80, 'Sender name (empty = platform name).'),
  sender_address: text(254, 'Sender e-mail address.'),
  app_url: text(300, 'Public address of Avanza used in e-mail links (e.g. https://avanza.example.com).'),
}

const EVENT_NAMES = webhookDomain.EVENTS.concat(webhookDomain.EVENT_GROUPS.map((group) => `${group}.*`))

const WEBHOOK_FIELDS = {
  name: text(80, 'Webhook name.'),
  url: text(500, 'HTTPS address that receives the signed POST (private and loopback hosts are refused).'),
  events: { type: 'array', items: { type: 'string', enum: EVENT_NAMES }, maxItems: 100, description: 'Events to send (see list_webhook_events); "group.*" subscribes a whole group.' },
  active: bool('Whether deliveries are sent. Turning it back on resets the failure count.'),
}

const historyTool = (name, title, entityType, idKey, idSchema, what, permission) => ({
  name,
  title,
  description: `Returns the change history of ${what} (who changed what and when), newest first, paginated. Requires ${permission} or audit.view.`,
  inputSchema: schema(Object.assign({ [idKey]: idSchema }, PAGE), [idKey]),
  annotations: READ,
  run: async (args, { services, ctx }) => page(await services.audit.listEntityHistory(ctx, entityType, args[idKey], pageQuery(args))),
})

const TOOLS = [
  // ---------------------------------------------------------------- usuários
  {
    name: 'list_users',
    title: 'List users',
    description: 'Lists the platform users, paginated: name, email, status, role_id, locale and last login. Requires users.view.',
    inputSchema: schema(
      Object.assign(
        {
          search: text(100, 'Text to match in the name or email.'),
          status: oneOf(USER_STATUSES, 'Only users with this status.'),
          role_id: ROLE_ID,
          sort: text(100, 'Comma-separated fields, "-" prefix for descending: name, email, status, created_at, last_login_at. Default: name.'),
        },
        PAGE,
      ),
    ),
    annotations: READ,
    run: async (args, { services, ctx }) => page(await services.users.listUsers(ctx, Object.assign(pick(args, ['search', 'status', 'role_id', 'sort']), pageQuery(args)))),
  },
  {
    name: 'get_user',
    title: 'Get user',
    description: 'Returns a user: name, email, status, role_id, locale, theme, e-mail notifications and last login. Requires users.view (except for the user themself).',
    inputSchema: schema({ user_id: USER_ID }, ['user_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.users.getUser(ctx, args.user_id),
  },
  {
    name: 'create_user',
    title: 'Create user',
    description:
      'Creates an active user with a role. Prefer send_invite: true (the person gets an e-mail link to create their own password; needs e-mail configured). Otherwise send a password typed by the user in the chat. The role cannot have permissions the caller lacks. Requires users.create.',
    inputSchema: schema(
      {
        name: text(120, 'Full name.'),
        email: text(254, 'E-mail (login; unique).'),
        role_id: ROLE_ID,
        locale: oneOf(userDomain.LOCALES, 'Interface language (default pt-BR).'),
        send_invite: bool('E-mail an invitation link instead of setting a password.'),
        password: PASSWORD('Initial password, only when send_invite is not true; it must follow the password policy.'),
      },
      ['name', 'email', 'role_id'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.users.createUser(ctx, args),
  },
  {
    name: 'update_user',
    title: 'Update user',
    description: 'Changes a user (only the fields sent). Changing email or role needs users.edit and cannot be done on one\'s own account; only a SUPER_ADMIN edits a SUPER_ADMIN. Requires users.edit.',
    inputSchema: schema(
      {
        user_id: USER_ID,
        name: text(120, 'Full name.'),
        email: text(254, 'E-mail (login; unique).'),
        role_id: ROLE_ID,
        locale: oneOf(userDomain.LOCALES, 'Interface language.'),
        theme: oneOf(userDomain.THEMES, 'Interface theme.'),
        email_notifications: bool('Receive notifications by e-mail.'),
      },
      ['user_id'],
    ),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.users.updateUser(ctx, args.user_id, without(args, 'user_id')),
  },
  {
    name: 'set_user_status',
    title: 'Enable or disable user',
    description:
      'Enables (active) or disables a user. A disabled user cannot log in, their sessions end and their API tokens stop working; nobody disables themself. Requires users.disable. Confirm with the user first.',
    inputSchema: schema({ user_id: USER_ID, status: oneOf(USER_STATUSES, 'New status.') }, ['user_id', 'status']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.users.changeUserStatus(ctx, args.user_id, args.status),
  },
  {
    name: 'resend_user_invite',
    title: 'Resend invite',
    description: 'E-mails a new invitation link (to create a password) to a user who never logged in. Needs e-mail configured. Requires users.create.',
    inputSchema: schema({ user_id: USER_ID }, ['user_id']),
    annotations: ACTION,
    run: (args, { services, ctx }) => services.accountLinks.resendInvite(ctx, args.user_id),
  },
  {
    name: 'reset_user_password',
    title: 'Reset user password',
    description:
      'Sets a new password for another user and ends all their sessions. Prefer resend_user_invite or the "forgot my password" link; use this only with a password the user typed in the chat, which becomes the new one (it must follow the password policy). Not for one\'s own account. Requires users.edit. Confirm with the user first.',
    inputSchema: schema({ user_id: USER_ID, password: PASSWORD('The new password, exactly as the user typed it.') }, ['user_id', 'password']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.users.resetPassword(ctx, args.user_id, pick(args, ['password'])),
  },
  historyTool('get_user_history', 'User history', 'user', 'user_id', USER_ID, 'a user', 'users.view'),

  // ---------------------------------------------------------------- perfis e permissões
  {
    name: 'list_permissions',
    title: 'Permission catalog',
    description: 'Lists every permission code of the platform with its module (e.g. tasks.edit, settings.manage). Requires permissions.manage.',
    inputSchema: schema({}),
    annotations: READ,
    run: (_args, { services, ctx }) => services.roles.listPermissions(ctx),
  },
  {
    name: 'list_roles',
    title: 'List roles',
    description: 'Lists the roles with their permission codes and user count. Requires permissions.manage, users.view, users.create or users.edit.',
    inputSchema: schema({}),
    annotations: READ,
    run: (_args, { services, ctx }) => services.roles.listRoles(ctx),
  },
  {
    name: 'get_role',
    title: 'Get role',
    description: 'Returns a role with its permission codes and user count. Requires permissions.manage, users.view, users.create or users.edit.',
    inputSchema: schema({ role_id: ROLE_ID }, ['role_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.roles.getRole(ctx, args.role_id),
  },
  {
    name: 'create_role',
    title: 'Create role',
    description: 'Creates a role. It cannot grant permissions the caller lacks (PRIVILEGE_ESCALATION). Requires permissions.manage.',
    inputSchema: schema(
      Object.assign(
        {
          code: text(32, 'Unique code: uppercase letters, digits and underscores, starting with a letter (e.g. QA_LEAD).'),
          permissions: permissionList('Permission codes of the role (see list_permissions).'),
        },
        ROLE_FIELDS,
      ),
      ['code', 'name'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.roles.createRole(ctx, args),
  },
  {
    name: 'update_role',
    title: 'Update role',
    description: 'Renames a role or changes its description (send the name even when unchanged). SUPER_ADMIN cannot change. Requires permissions.manage.',
    inputSchema: schema(Object.assign({ role_id: ROLE_ID }, ROLE_FIELDS), ['role_id', 'name']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.roles.updateRole(ctx, args.role_id, without(args, 'role_id')),
  },
  {
    name: 'set_role_permissions',
    title: 'Set role permissions',
    description:
      'Replaces the permissions of a role (every user with the role is affected at once). Not for SUPER_ADMIN nor the caller\'s own role; cannot grant permissions the caller lacks. Requires permissions.manage.',
    inputSchema: schema({ role_id: ROLE_ID, permissions: permissionList('The full list of permission codes the role will have.') }, ['role_id', 'permissions']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.roles.updateRolePermissions(ctx, args.role_id, args.permissions),
  },
  {
    name: 'delete_role',
    title: 'Delete role',
    description: 'Deletes a role. System roles and roles still assigned to users (ROLE_IN_USE) are refused. Requires permissions.manage. Confirm with the user first.',
    inputSchema: schema({ role_id: ROLE_ID }, ['role_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.roles.deleteRole(ctx, args.role_id),
  },
  historyTool('get_role_history', 'Role history', 'role', 'role_id', ROLE_ID, 'a role', 'permissions.manage'),

  // ---------------------------------------------------------------- auditoria
  {
    name: 'list_audit_logs',
    title: 'Audit log',
    description: 'Searches the audit history of the whole platform, newest first, paginated: action, entity, old/new values, who and when. Requires audit.view.',
    inputSchema: schema(
      Object.assign(
        {
          entity_type: text(50, 'Entity type, e.g. task, project, user, role, status, task_type, custom_field, webhook, platform_settings.'),
          entity_id: text(40, 'Entity id.'),
          user_id: text(40, 'Only changes made by this user id.'),
          action: text(80, 'Action, e.g. task.updated, user.disabled.'),
          from: date('From'),
          to: date('To'),
        },
        PAGE,
      ),
    ),
    annotations: READ,
    run: async (args, { services, ctx }) => page(await services.audit.listAuditLogs(ctx, Object.assign(pick(args, ['entity_type', 'entity_id', 'user_id', 'action', 'from', 'to']), pageQuery(args)))),
  },

  // ---------------------------------------------------------------- Configurador geral
  {
    name: 'get_platform_settings',
    title: 'Platform settings',
    description: 'Returns the general settings (platform name, password policy, login lockout, audit retention) with defaults, limits and the uploaded branding files. Requires platform.manage.',
    inputSchema: schema({}),
    annotations: READ,
    run: (_args, { services, ctx }) => services.platformSettings.getSettings(ctx),
  },
  {
    name: 'update_platform_settings',
    title: 'Update platform settings',
    description:
      'Changes the general settings (only the fields sent). With dry_run: true nothing is saved and it returns how many audit records a shorter retention would delete (audit_to_delete): use it before shortening the retention and confirm with the user. Requires platform.manage.',
    inputSchema: schema(Object.assign({ dry_run: bool('Only preview the effect; save nothing.') }, PLATFORM_FIELDS)),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.platformSettings.updateSettings(ctx, args),
  },
  {
    name: 'purge_audit_logs',
    title: 'Purge audit history now',
    description: 'Deletes now the audit records older than the retention (the same as the daily purge) and returns how many were removed. It cannot be undone. Requires platform.manage. Confirm with the user first.',
    inputSchema: schema({}),
    annotations: DELETE,
    run: (_args, { services, ctx }) => services.platformSettings.runRetentionNow(ctx),
  },

  // ---------------------------------------------------------------- e-mail
  {
    name: 'get_email_settings',
    title: 'E-mail settings',
    description: 'Returns the e-mail (SMTP) settings and whether a password is stored (has_password); the password itself is never returned. Requires integrations.manage.',
    inputSchema: schema({}),
    annotations: READ,
    run: (_args, { services, ctx }) => services.email.getSettings(ctx),
  },
  {
    name: 'update_email_settings',
    title: 'Update e-mail settings',
    description: 'Changes the e-mail (SMTP) settings (only the fields sent). The SMTP password is not accepted here: the user sets it in Settings → Integrations. Requires integrations.manage.',
    inputSchema: schema(EMAIL_FIELDS),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.email.updateSettings(ctx, args),
  },
  {
    name: 'send_test_email',
    title: 'Send test e-mail',
    description: 'Sends a test e-mail right away (not through the outbox) to the caller or to the given address; EMAIL_SEND_FAILED carries the SMTP reason. Requires integrations.manage.',
    inputSchema: schema({ to: text(254, 'Recipient (default: the caller).') }),
    annotations: ACTION,
    run: (args, { services, ctx }) => services.email.sendTest(ctx, pick(args, ['to'])),
  },
  {
    name: 'get_email_outbox',
    title: 'E-mail outbox',
    description: 'Returns the outbox counts by status and the 20 latest e-mails (recipient, kind, status, attempts, last error). A routine sends pending e-mails every minute. Requires integrations.manage.',
    inputSchema: schema({}),
    annotations: READ,
    run: (_args, { services, ctx }) => services.email.outboxSummary(ctx),
  },

  // ---------------------------------------------------------------- webhooks
  {
    name: 'list_webhooks',
    title: 'List webhooks',
    description: 'Lists the webhooks: name, url, events, active, last status and consecutive failures (20 in a row turn it off). Requires integrations.manage.',
    inputSchema: schema({}),
    annotations: READ,
    run: (_args, { services, ctx }) => services.webhooks.list(ctx),
  },
  {
    name: 'list_webhook_events',
    title: 'Webhook events',
    description: 'Returns the events a webhook can subscribe to and their groups (subscribe a group with "group.*"). Requires integrations.manage.',
    inputSchema: schema({}),
    annotations: READ,
    run: (_args, { services, ctx }) => services.webhooks.events(ctx),
  },
  {
    name: 'create_webhook',
    title: 'Create webhook',
    description:
      'Creates a webhook. The response carries the signing secret, shown only now (and on rotate_webhook_secret): give it to the user to store in the receiving system. Requires integrations.manage.',
    inputSchema: schema(WEBHOOK_FIELDS, ['name', 'url', 'events']),
    annotations: ADD,
    run: (args, { services, ctx }) => services.webhooks.create(ctx, args),
  },
  {
    name: 'update_webhook',
    title: 'Update webhook',
    description: 'Changes a webhook (only the fields sent), including turning it on or off. Requires integrations.manage.',
    inputSchema: schema(Object.assign({ webhook_id: WEBHOOK_ID }, WEBHOOK_FIELDS), ['webhook_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.webhooks.update(ctx, args.webhook_id, without(args, 'webhook_id')),
  },
  {
    name: 'delete_webhook',
    title: 'Delete webhook',
    description: 'Deletes a webhook and its delivery log. Requires integrations.manage. Confirm with the user first.',
    inputSchema: schema({ webhook_id: WEBHOOK_ID }, ['webhook_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.webhooks.remove(ctx, args.webhook_id),
  },
  {
    name: 'rotate_webhook_secret',
    title: 'Rotate webhook secret',
    description: 'Generates a new signing secret (returned only now); the old one stops working at once, so the receiving system must be updated. Requires integrations.manage.',
    inputSchema: schema({ webhook_id: WEBHOOK_ID }, ['webhook_id']),
    annotations: ACTION,
    run: (args, { services, ctx }) => services.webhooks.rotateSecret(ctx, args.webhook_id),
  },
  {
    name: 'test_webhook',
    title: 'Test webhook',
    description: 'Sends a webhook.ping delivery now (even if the webhook is off) and returns the result: HTTP status, response, error and duration. Requires integrations.manage.',
    inputSchema: schema({ webhook_id: WEBHOOK_ID }, ['webhook_id']),
    annotations: ACTION,
    run: (args, { services, ctx }) => services.webhooks.test(ctx, args.webhook_id),
  },
  {
    name: 'list_webhook_deliveries',
    title: 'Webhook deliveries',
    description: 'Lists the 50 latest deliveries of a webhook (kept 30 days): event, status, attempts, HTTP status, error and next attempt. Requires integrations.manage.',
    inputSchema: schema({ webhook_id: WEBHOOK_ID }, ['webhook_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.webhooks.deliveries(ctx, args.webhook_id),
  },
  {
    name: 'redeliver_webhook',
    title: 'Redeliver webhook',
    description: 'Sends a delivery again now, from scratch (e.g. the receiving system was down), and returns the result. Requires integrations.manage.',
    inputSchema: schema({ delivery_id: id('Delivery id (from list_webhook_deliveries).') }, ['delivery_id']),
    annotations: ACTION,
    run: (args, { services, ctx }) => services.webhooks.redeliver(ctx, args.delivery_id),
  },

  // ---------------------------------------------------------------- tokens de API
  {
    name: 'list_api_tokens',
    title: 'API tokens of everyone',
    description:
      'Lists the API tokens of every user (name, prefix, owner, state, expiry, last use; never the value). Revoking a token is only possible in the browser (Settings → Integrations). Requires integrations.manage.',
    inputSchema: schema({}),
    annotations: READ,
    run: (_args, { services, ctx }) => services.apiTokens.listAll(ctx),
  },
]

module.exports = { TOOLS }
