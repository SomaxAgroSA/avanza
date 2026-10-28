/**
 * Links de uso único por e-mail (regras de negócio §16): "Esqueci minha senha" (60 minutos) e convite
 * para criar a senha (7 dias). Só o hash do token é guardado; pedir de novo invalida o link anterior.
 * O pedido de redefinição sempre responde igual — não revela se o e-mail tem conta.
 *
 * Porta: `authTokenRepository` { create, findByHash, markUsed, invalidateForUser, countSince }.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const userDomain = require('../domain/user')
const tokenDomain = require('../domain/auth-token')
const emailDomain = require('../domain/email')
const { buildAuditEntry } = require('./audit')
const { emailContext } = require('./email')
const { currentPasswordPolicy } = require('./platform-settings')

const RESET_PATH = '/reset-password'

/**
 * Cria o link (invalidando o anterior do mesmo tipo) e põe o e-mail na fila — dentro da transação.
 * `mail` = await emailContext(deps); `inviter` = nome de quem convidou.
 */
async function issueLink(deps, repos, user, purpose, mail, inviter) {
  const now = deps.clock.now()
  await repos.authTokenRepository.invalidateForUser(user.id, purpose, now)
  const token = deps.tokens.generate()
  await repos.authTokenRepository.create({ userId: user.id, purpose, tokenHash: deps.tokens.hash(token), expiresAt: tokenDomain.expiresAt(purpose, now), createdAt: now })
  const kind = purpose === 'reset' ? 'password_reset' : 'invite'
  const message = emailDomain.renderEmail(kind, user.locale, { platform: mail.platform, name: user.name, inviter, link: `${mail.appUrl}${RESET_PATH}?token=${encodeURIComponent(token)}` })
  await repos.emailOutboxRepository.enqueue({ to: user.email, kind, subject: message.subject, html: message.html, text: message.text })
}

function createAccountLinkService(deps) {
  async function inviterName(ctx) {
    const me = ctx.principal ? await deps.userRepository.findById(ctx.principal.userId) : null
    return me ? me.name : ''
  }

  async function requestReset(input, ctx) {
    const data = assertValid(input, { email: [rules.required(), rules.email()] })
    const user = await deps.userRepository.findByEmail(userDomain.normalizeEmail(data.email))
    const mail = await emailContext(deps)
    const now = deps.clock.now()
    // mesma resposta para tudo: conta inexistente, desativada, envio desligado ou pedidos demais
    if (!user || user.status !== userDomain.USER_STATUS.ACTIVE || !mail) return { requested: true }
    const recent = await deps.authTokenRepository.countSince(user.id, 'reset', new Date(now.getTime() - 3600000))
    if (!tokenDomain.canRequestReset(recent)) return { requested: true }
    await deps.unitOfWork.run(async (repos) => {
      await issueLink(deps, repos, user, 'reset', mail)
      await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'user', entityId: user.id, action: 'auth.password_reset_requested', userId: null }))
    })
    return { requested: true }
  }

  async function findToken(token) {
    const found = typeof token === 'string' && token ? await deps.authTokenRepository.findByHash(deps.tokens.hash(token)) : null
    const state = tokenDomain.tokenState(found, deps.clock.now())
    const user = found ? await deps.userRepository.findById(found.userId) : null
    if (state === 'valid' && (!user || user.status !== userDomain.USER_STATUS.ACTIVE)) return { state: 'invalid' }
    return { state, token: found, user }
  }

  /** Tela de nova senha: o link vale? Para quê? E as exigências da senha (a pessoa não está logada). */
  async function checkToken(token) {
    const found = await findToken(token)
    if (found.state !== 'valid') return { valid: false, state: found.state }
    return { valid: true, state: 'valid', purpose: found.token.purpose, name: found.user.name, policy: await currentPasswordPolicy(deps) }
  }

  async function confirm(input, ctx) {
    const policy = await currentPasswordPolicy(deps)
    const data = assertValid(input, {
      token: [rules.required(), rules.maxLength(200)],
      password: [rules.required(), rules.custom((value) => userDomain.passwordIssue(value, policy))],
    })
    const found = await findToken(data.token)
    if (found.state !== 'valid') throw appError('RESET_TOKEN_INVALID')
    const now = deps.clock.now()
    const purpose = found.token.purpose
    await deps.unitOfWork.run(async (repos) => {
      await repos.userRepository.update(found.user.id, { password: data.password })
      await repos.authTokenRepository.markUsed(found.token.id, now)
      const revoked = await repos.sessionRepository.revokeAllForUser(found.user.id, now)
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'user',
          entityId: found.user.id,
          action: purpose === 'reset' ? 'auth.password_reset' : 'auth.invite_accepted',
          newValue: { sessions_revoked: revoked || 0 },
          userId: found.user.id,
        }),
      )
    })
    // a senha nova libera um eventual bloqueio por tentativas
    await deps.loginAttemptRepository.clear(deps.tokens.hash(`login:${found.user.email}`))
    return { changed: true, purpose }
  }

  /** Convite na criação do usuário (users.createUser), dentro da mesma transação. */
  async function inviteOnCreate(repos, ctx, user, mail) {
    await issueLink(deps, repos, user, 'invite', mail, await inviterName(ctx))
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'user', entityId: user.id, action: 'user.invited', newValue: { email: user.email } }))
  }

  /** Reenviar o convite a quem ainda não entrou (o link anterior deixa de valer). */
  async function resendInvite(ctx, userId) {
    rbac.assertCan(ctx.principal, 'users.create')
    const user = await deps.userRepository.findById(userId)
    if (!user) throw appError('USER_NOT_FOUND')
    if (user.lastLoginAt) throw appError('USER_ALREADY_ACTIVE')
    const mail = await emailContext(deps)
    if (!mail) throw appError('EMAIL_NOT_CONFIGURED')
    await deps.unitOfWork.run(async (repos) => {
      await issueLink(deps, repos, user, 'invite', mail, await inviterName(ctx))
      await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'user', entityId: user.id, action: 'user.invited', newValue: { email: user.email, resent: true } }))
    })
    return { invited: true }
  }

  return { requestReset, checkToken, confirm, inviteOnCreate, resendInvite }
}

module.exports = { createAccountLinkService }
