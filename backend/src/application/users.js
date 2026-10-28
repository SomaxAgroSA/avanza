/**
 * Casos de uso de usuários.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const { parsePagination, parseSort, buildPageMeta } = require('../core/pagination')
const rbac = require('../domain/rbac')
const userDomain = require('../domain/user')
const { buildAuditEntry, diff } = require('./audit')
const { toUserDto } = require('./presenters')
const { currentPasswordPolicy } = require('./platform-settings')
const { emailContext } = require('./email')
const { createAccountLinkService } = require('./account-links')

/** Senha conferida pela política vigente do Configurador geral. */
async function passwordRule(deps) {
  const policy = await currentPasswordPolicy(deps)
  return rules.custom((value) => userDomain.passwordIssue(value, policy))
}

async function createSchema(deps) {
  return {
    name: [rules.required(), rules.maxLength(120)],
    email: [rules.required(), rules.email()],
    password: [rules.required(), await passwordRule(deps)],
    role_id: [rules.required(), rules.maxLength(40)],
    locale: [rules.oneOf(userDomain.LOCALES)],
  }
}

const UPDATE_SCHEMA = {
  name: [rules.required(), rules.maxLength(120)],
  email: [rules.required(), rules.email()],
  role_id: [rules.required(), rules.maxLength(40)],
  locale: [rules.oneOf(userDomain.LOCALES)],
  theme: [rules.oneOf(userDomain.THEMES)],
  email_notifications: [rules.boolean()],
}

const LIST_SCHEMA = {
  search: [rules.maxLength(100)],
  status: [rules.oneOf([userDomain.USER_STATUS.ACTIVE, userDomain.USER_STATUS.DISABLED])],
  role_id: [rules.maxLength(40)],
}

/** Campos públicos ordenáveis -> campo da entidade/coluna. */
const SORTABLE = { name: 'name', email: 'email', status: 'status', created_at: 'created', last_login_at: 'last_login_at' }

/** Mapeamento entidade (camelCase) -> nome público (auditoria/API). */
const PUBLIC_KEYS = { name: 'name', email: 'email', roleId: 'role_id', locale: 'locale', theme: 'theme', status: 'status', emailNotifications: 'email_notifications' }

function toPublic(obj) {
  const out = {}
  Object.keys(obj).forEach((key) => {
    out[PUBLIC_KEYS[key] || key] = obj[key]
  })
  return out
}

/** A API usa snake_case; internamente a entidade usa camelCase. */
function fromPublic(data) {
  const out = Object.assign({}, data)
  if (out.role_id !== undefined) {
    out.roleId = out.role_id
    delete out.role_id
  }
  if (out.email_notifications !== undefined) {
    out.emailNotifications = out.email_notifications
    delete out.email_notifications
  }
  return out
}

function createUserService(deps) {
  async function findUserOrFail(id) {
    const user = id ? await deps.userRepository.findById(id) : null
    if (!user) throw appError('USER_NOT_FOUND')
    return user
  }

  async function roleCodeOf(user) {
    const role = user.roleId ? await deps.roleRepository.findById(user.roleId) : null
    return role ? role.code : null
  }

  async function findAssignableRole(principal, roleId) {
    const role = await deps.roleRepository.findById(roleId)
    if (!role) throw appError('ROLE_NOT_FOUND')
    rbac.assertCanAssignRole(principal, role, await deps.roleRepository.getPermissionCodes(role.id))
    return role
  }

  async function listUsers(ctx, query) {
    rbac.assertCan(ctx.principal, 'users.view')
    const q = query || {}
    const filters = assertValid(
      { search: q.search || undefined, status: q.status || undefined, role_id: q.role_id || undefined },
      LIST_SCHEMA,
    )
    const pagination = parsePagination(q)
    const result = await deps.userRepository.list({
      search: filters.search,
      status: filters.status,
      roleId: filters.role_id,
      sort: parseSort(q.sort, SORTABLE, 'name'),
      pagination,
    })
    return { items: result.items.map(toUserDto), meta: buildPageMeta(pagination, result.total) }
  }

  async function getUser(ctx, id) {
    rbac.assertAuthenticated(ctx.principal)
    if (id !== ctx.principal.userId) rbac.assertCan(ctx.principal, 'users.view')
    return toUserDto(await findUserOrFail(id))
  }

  /**
   * `send_invite: true` dispensa a senha: a pessoa recebe por e-mail um link para criar a dela
   * (exige o envio de e-mail ligado).
   */
  async function createUser(ctx, input) {
    rbac.assertCan(ctx.principal, 'users.create')
    const source = Object.assign({}, input || {})
    const invite = source.send_invite === true
    if (source.send_invite !== undefined && typeof source.send_invite !== 'boolean') {
      throw appError('VALIDATION_ERROR', undefined, { fields: { send_invite: 'invalid_type' } })
    }
    delete source.send_invite
    const schema = await createSchema(deps)
    if (invite) delete schema.password
    const data = fromPublic(assertValid(source, schema))
    const mail = invite ? await emailContext(deps) : null
    if (invite && !mail) throw appError('EMAIL_NOT_CONFIGURED')
    const role = await findAssignableRole(ctx.principal, data.roleId)
    const email = userDomain.normalizeEmail(data.email)
    if (await deps.userRepository.emailExists(email)) throw appError('EMAIL_ALREADY_IN_USE')

    const user = await deps.unitOfWork.run(async (repos) => {
      const created = await repos.userRepository.create({
        name: data.name,
        email,
        // convite: senha aleatória que ninguém conhece (a pessoa cria a dela pelo link)
        password: invite ? deps.tokens.generate() : data.password,
        roleId: role.id,
        status: userDomain.USER_STATUS.ACTIVE,
        locale: data.locale || 'pt-BR',
        theme: 'system',
      })
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'user',
          entityId: created.id,
          action: 'user.created',
          newValue: { name: created.name, email: created.email, role_id: role.id, status: created.status },
        }),
      )
      if (invite) await createAccountLinkService(deps).inviteOnCreate(repos, ctx, created, mail)
      return created
    })
    return toUserDto(user)
  }

  async function updateUser(ctx, id, input) {
    rbac.assertAuthenticated(ctx.principal)
    const target = await findUserOrFail(id)
    userDomain.assertCanEdit(ctx.principal, { id: target.id, roleCode: await roleCodeOf(target) })

    // Valida só os campos enviados (atualização parcial).
    const source = input || {}
    const schema = {}
    Object.keys(UPDATE_SCHEMA).forEach((key) => {
      if (source[key] !== undefined) schema[key] = UPDATE_SCHEMA[key]
    })
    const data = fromPublic(assertValid(source, schema))
    if (data.email !== undefined) data.email = userDomain.normalizeEmail(data.email)

    const isSelf = target.id === ctx.principal.userId
    const changingAccess =
      (data.roleId !== undefined && data.roleId !== target.roleId) ||
      (data.email !== undefined && data.email !== target.email)
    if (changingAccess) {
      // Perfil e e-mail são dados de acesso: exigem users.edit e não podem ser alterados pelo próprio usuário.
      if (isSelf && !rbac.isSuperAdmin(ctx.principal)) throw appError('FORBIDDEN')
      rbac.assertCan(ctx.principal, 'users.edit')
    }
    if (data.roleId !== undefined && data.roleId !== target.roleId) await findAssignableRole(ctx.principal, data.roleId)
    if (data.email !== undefined && data.email !== target.email && (await deps.userRepository.emailExists(data.email, target.id))) {
      throw appError('EMAIL_ALREADY_IN_USE')
    }

    const changes = diff(target, data, ['name', 'email', 'roleId', 'locale', 'theme', 'emailNotifications'])
    if (!changes) return toUserDto(target)

    const updated = await deps.unitOfWork.run(async (repos) => {
      const saved = await repos.userRepository.update(target.id, changes.newValue)
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'user',
          entityId: target.id,
          action: 'user.updated',
          oldValue: toPublic(changes.oldValue),
          newValue: toPublic(changes.newValue),
        }),
      )
      return saved
    })
    return toUserDto(updated)
  }

  async function changeUserStatus(ctx, id, status) {
    rbac.assertAuthenticated(ctx.principal)
    const data = assertValid({ status }, { status: [rules.required(), LIST_SCHEMA.status[0]] })
    const target = await findUserOrFail(id)
    userDomain.assertCanChangeStatus(ctx.principal, { id: target.id, roleCode: await roleCodeOf(target) }, data.status)
    if (target.status === data.status) return toUserDto(target)

    const updated = await deps.unitOfWork.run(async (repos) => {
      const saved = await repos.userRepository.update(target.id, { status: data.status })
      if (data.status === userDomain.USER_STATUS.DISABLED) {
        await repos.sessionRepository.revokeAllForUser(target.id, deps.clock.now())
      }
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'user',
          entityId: target.id,
          action: data.status === userDomain.USER_STATUS.DISABLED ? 'user.disabled' : 'user.enabled',
          oldValue: { status: target.status },
          newValue: { status: data.status },
        }),
      )
      return saved
    })
    return toUserDto(updated)
  }

  /**
   * Redefinição de senha por quem tem users.edit. Para a própria conta, usar a troca de senha
   * (que exige a senha atual). Encerra todas as sessões do usuário.
   */
  async function resetPassword(ctx, id, input) {
    rbac.assertCan(ctx.principal, 'users.edit')
    const target = await findUserOrFail(id)
    if (target.id === ctx.principal.userId) throw appError('USE_CHANGE_PASSWORD')
    userDomain.assertCanEdit(ctx.principal, { id: target.id, roleCode: await roleCodeOf(target) })
    const data = assertValid(input, { password: [rules.required(), await passwordRule(deps)] })

    await deps.unitOfWork.run(async (repos) => {
      await repos.userRepository.update(target.id, { password: data.password })
      const count = await repos.sessionRepository.revokeAllForUser(target.id, deps.clock.now())
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'user',
          entityId: target.id,
          action: 'user.password_reset',
          newValue: { sessions_revoked: count },
        }),
      )
    })
    return { reset: true }
  }

  /**
   * Foto do usuário (opcional; sem foto, as iniciais): o próprio usuário ou quem tem users.edit (SUPER_ADMIN
   * só por SUPER_ADMIN). `upload`: { name, size, head, handle } — PNG, JPG ou WebP até 2 MB (domain/user.js).
   */
  async function setAvatar(ctx, id, upload) {
    rbac.assertAuthenticated(ctx.principal)
    const target = await findUserOrFail(id)
    userDomain.assertCanEdit(ctx.principal, { id: target.id, roleCode: await roleCodeOf(target) })
    const checked = userDomain.inspectAvatar(upload)
    if (checked.error) throw appError('VALIDATION_ERROR', undefined, { fields: { avatar: checked.error } })
    const updated = await deps.unitOfWork.run(async (repos) => {
      const saved = await repos.userRepository.setAvatar(target.id, upload.handle, checked.mime)
      await repos.auditRepository.record(
        buildAuditEntry(ctx, { entityType: 'user', entityId: target.id, action: 'user.avatar_updated', newValue: { avatar: checked.name } }),
      )
      return saved
    })
    return toUserDto(updated)
  }

  async function removeAvatar(ctx, id) {
    rbac.assertAuthenticated(ctx.principal)
    const target = await findUserOrFail(id)
    userDomain.assertCanEdit(ctx.principal, { id: target.id, roleCode: await roleCodeOf(target) })
    if (!target.avatarUrl) return toUserDto(target)
    const updated = await deps.unitOfWork.run(async (repos) => {
      const saved = await repos.userRepository.clearAvatar(target.id)
      await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'user', entityId: target.id, action: 'user.avatar_removed' }))
      return saved
    })
    return toUserDto(updated)
  }

  /** Chave da foto no Storage: qualquer pessoa autenticada vê (aparece nas listas, tarefas e comentários). */
  async function avatarKey(ctx, id) {
    rbac.assertAuthenticated(ctx.principal)
    const key = id ? await deps.userRepository.avatarKeyOf(id) : null
    if (!key) throw appError('NOT_FOUND')
    return key
  }

  return { listUsers, getUser, createUser, updateUser, changeUserStatus, resetPassword, setAvatar, removeAvatar, avatarKey }
}

module.exports = { createUserService }
