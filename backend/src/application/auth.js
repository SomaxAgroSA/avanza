/**
 * Casos de uso de autenticação e sessão.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const sessionDomain = require('../domain/session')
const userDomain = require('../domain/user')
const lockout = require('../domain/lockout')
const rbac = require('../domain/rbac')
const { PERMISSIONS } = require('../domain/permissions')
const { buildAuditEntry, truncate, MAX_USER_AGENT } = require('./audit')
const { toUserDto, toRoleDto, toSessionDto } = require('./presenters')
const { currentPasswordPolicy, currentLockoutPolicy } = require('./platform-settings')
const { assertBrowserSession } = require('./api-tokens')

const passwordInput = rules.custom((value) => {
  if (typeof value !== 'string') return 'invalid_type'
  return value.length > 200 ? 'too_long' : null
})

const LOGIN_SCHEMA = {
  email: [rules.required(), rules.email()],
  password: [rules.required(), passwordInput],
  remember: [rules.boolean()],
}

const EMPTY = Object.freeze({ principal: null, session: null, reason: null })

/** A senha nova segue a política vigente do Configurador geral. */
function changePasswordSchema(policy) {
  return {
    current_password: [rules.required(), passwordInput],
    new_password: [rules.required(), rules.custom((value) => userDomain.passwordIssue(value, policy))],
  }
}

function createAuthService(deps) {
  const policy = sessionDomain.createPolicy(deps.sessionPolicy)

  /** Chave das tentativas: hash do e-mail normalizado (o e-mail nunca é gravado em claro). */
  function attemptKey(email) {
    return deps.tokens.hash(`login:${email}`)
  }

  async function login(input, ctx) {
    const data = assertValid(input, LOGIN_SCHEMA)
    const email = userDomain.normalizeEmail(data.email)
    const key = attemptKey(email)
    const now = deps.clock.now()
    const user = await deps.userRepository.findByEmail(email)

    // bloqueio progressivo por conta: vale igual para e-mails inexistentes (não revela contas)
    const failures = await deps.loginAttemptRepository.listSince(key, new Date(now.getTime() - lockout.WINDOW_MINUTES * 60000))
    const lastFailure = failures.length ? new Date(Math.max.apply(null, failures.map((d) => d.getTime()))) : null
    const until = lockout.lockedUntil(failures.length, lastFailure, await currentLockoutPolicy(deps))
    if (until && until > now) {
      if (user) {
        await deps.auditRepository.record(
          buildAuditEntry(ctx, { entityType: 'user', entityId: user.id, action: 'auth.login_locked', newValue: { failures: failures.length }, userId: null }),
        )
      }
      throw appError('ACCOUNT_LOCKED', undefined, { retry_after_seconds: Math.ceil((until.getTime() - now.getTime()) / 1000) })
    }

    if (!user) {
      await deps.loginAttemptRepository.record(key, now)
      throw appError('INVALID_CREDENTIALS')
    }

    if (!(await deps.userRepository.verifyPassword(user.id, data.password))) {
      await deps.loginAttemptRepository.record(key, now)
      await deps.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'user',
          entityId: user.id,
          action: 'auth.login_failed',
          newValue: { reason: 'invalid_password' },
          userId: null,
        }),
      )
      throw appError('INVALID_CREDENTIALS')
    }

    userDomain.assertCanAuthenticate(user)
    await deps.loginAttemptRepository.clear(key)

    const remember = data.remember === true
    const token = deps.tokens.generate()

    const outcome = await deps.unitOfWork.run(async (repos) => {
      const session = await repos.sessionRepository.create({
        userId: user.id,
        tokenHash: deps.tokens.hash(token),
        ip: ctx.ip || '',
        userAgent: truncate(ctx.userAgent, MAX_USER_AGENT),
        remember,
        expiresAt: sessionDomain.computeExpiry(now, remember, policy),
        lastSeenAt: now,
      })
      const updated = await repos.userRepository.update(user.id, { lastLoginAt: now })
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'user',
          entityId: user.id,
          action: 'auth.login',
          newValue: { session_id: session.id, remember },
          userId: user.id,
        }),
      )
      return { session, user: updated }
    })

    return { token, session: toSessionDto(outcome.session, outcome.session.id), user: toUserDto(outcome.user) }
  }

  /**
   * Resolve o token da sessão em um principal. Nunca lança erro: o chamador decide
   * se a rota exige autenticação. `reason` indica por que a sessão não é válida.
   */
  async function authenticate(token) {
    if (!token) return EMPTY

    const session = await deps.sessionRepository.findByTokenHash(deps.tokens.hash(token))
    if (!session) return { principal: null, session: null, reason: 'invalid' }

    const now = deps.clock.now()
    const evaluation = sessionDomain.evaluate(session, now, policy)
    if (!evaluation.valid) return { principal: null, session: null, reason: evaluation.reason }

    const user = await deps.userRepository.findById(session.userId)
    if (!user || user.status !== userDomain.USER_STATUS.ACTIVE) {
      await deps.sessionRepository.revoke(session.id, now)
      return { principal: null, session: null, reason: 'revoked' }
    }

    const role = user.roleId ? await deps.roleRepository.findById(user.roleId) : null
    const permissions = role ? await deps.roleRepository.getPermissionCodes(role.id) : []
    const current = evaluation.shouldTouch
      ? await deps.sessionRepository.touch(session.id, now, sessionDomain.renewedExpiry(session, now, policy))
      : session

    const principal = rbac.createPrincipal({
      userId: user.id,
      roleId: role ? role.id : null,
      roleCode: role ? role.code : null,
      permissions,
      sessionId: session.id,
    })
    return { principal, session: current, reason: null }
  }

  async function logout(ctx) {
    assertBrowserSession(ctx)
    rbac.assertAuthenticated(ctx.principal)
    await deps.unitOfWork.run(async (repos) => {
      await repos.sessionRepository.revoke(ctx.principal.sessionId, deps.clock.now())
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'user',
          entityId: ctx.principal.userId,
          action: 'auth.logout',
          newValue: { session_id: ctx.principal.sessionId },
        }),
      )
    })
  }

  async function getMe(ctx) {
    rbac.assertAuthenticated(ctx.principal)
    const user = await deps.userRepository.findById(ctx.principal.userId)
    if (!user) throw appError('UNAUTHENTICATED')
    const role = ctx.principal.roleId ? await deps.roleRepository.findById(ctx.principal.roleId) : null
    const permissions = rbac.isSuperAdmin(ctx.principal)
      ? PERMISSIONS.map((p) => p.code)
      : ctx.principal.permissions.slice()
    return {
      user: toUserDto(user),
      role: role ? toRoleDto(role) : null,
      permissions: permissions.sort(),
      session: ctx.session ? toSessionDto(ctx.session, ctx.principal.sessionId) : null,
    }
  }

  async function listMySessions(ctx) {
    rbac.assertAuthenticated(ctx.principal)
    const now = deps.clock.now()
    return (await deps.sessionRepository.listActiveForUser(ctx.principal.userId, now))
      .filter((s) => sessionDomain.evaluate(s, now, policy).valid) // remove sessões expiradas por inatividade
      .map((s) => toSessionDto(s, ctx.principal.sessionId))
  }

  async function revokeMySession(ctx, sessionId) {
    assertBrowserSession(ctx)
    rbac.assertAuthenticated(ctx.principal)
    const session = sessionId ? await deps.sessionRepository.findById(sessionId) : null
    // Sessões de outros usuários respondem como inexistentes (proteção contra IDOR/enumeração).
    if (!session || session.userId !== ctx.principal.userId || session.revokedAt) throw appError('SESSION_NOT_FOUND')

    await deps.unitOfWork.run(async (repos) => {
      await repos.sessionRepository.revoke(session.id, deps.clock.now())
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'user',
          entityId: ctx.principal.userId,
          action: 'auth.session_revoked',
          newValue: { session_id: session.id },
        }),
      )
    })
    return { revoked: true, current: session.id === ctx.principal.sessionId }
  }

  /**
   * Troca da própria senha: exige a senha atual, mantém a sessão corrente
   * e encerra todas as outras sessões do usuário.
   */
  async function changePassword(ctx, input) {
    assertBrowserSession(ctx)
    rbac.assertAuthenticated(ctx.principal)
    const data = assertValid(input, changePasswordSchema(await currentPasswordPolicy(deps)))
    const userId = ctx.principal.userId
    if (!(await deps.userRepository.verifyPassword(userId, data.current_password))) {
      throw appError('VALIDATION_ERROR', undefined, { fields: { current_password: 'incorrect' } })
    }
    if (data.new_password === data.current_password) {
      throw appError('VALIDATION_ERROR', undefined, { fields: { new_password: 'same_as_current' } })
    }

    const revoked = await deps.unitOfWork.run(async (repos) => {
      await repos.userRepository.update(userId, { password: data.new_password })
      const count = await repos.sessionRepository.revokeAllForUser(userId, deps.clock.now(), ctx.principal.sessionId)
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'user',
          entityId: userId,
          action: 'auth.password_changed',
          newValue: { other_sessions_revoked: count },
        }),
      )
      return count
    })
    return { changed: true, other_sessions_revoked: revoked }
  }

  /** Encerra todas as sessões do usuário, exceto a atual. */
  async function revokeOtherSessions(ctx) {
    assertBrowserSession(ctx)
    rbac.assertAuthenticated(ctx.principal)
    const revoked = await deps.unitOfWork.run(async (repos) => {
      const count = await repos.sessionRepository.revokeAllForUser(ctx.principal.userId, deps.clock.now(), ctx.principal.sessionId)
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'user',
          entityId: ctx.principal.userId,
          action: 'auth.other_sessions_revoked',
          newValue: { other_sessions_revoked: count },
        }),
      )
      return count
    })
    return { revoked }
  }

  return { login, authenticate, logout, getMe, listMySessions, revokeMySession, revokeOtherSessions, changePassword }
}

module.exports = { createAuthService }
