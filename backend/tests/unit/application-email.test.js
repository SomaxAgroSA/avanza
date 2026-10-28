const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createEmailService } = require('../../src/application/email')
const { createAccountLinkService } = require('../../src/application/account-links')
const { createUserService } = require('../../src/application/users')
const { createAuthService } = require('../../src/application/auth')
const { createNotifier } = require('../../src/application/notifications')
const rbac = require('../../src/domain/rbac')

const CONFIG = { enabled: true, host: 'smtp.empresa.com', port: 587, sender_name: 'Portal', sender_address: 'portal@empresa.com', app_url: 'https://kamban.empresa.com' }
const anon = { ip: '10.0.0.9', userAgent: 'test', correlationId: 'c0' }

async function setup() {
  const deps = createFakeDeps({ start: '2026-10-01T12:00:00.000Z' })
  const admin = await seedUser(deps, { email: 'admin@example.com', name: 'Admin', roleCode: 'ADMIN' })
  const manager = await seedUser(deps, { email: 'gestor@example.com', roleCode: 'MANAGER' })
  const ctxOf = async (user) => {
    const role = await deps.roleRepository.findById(user.roleId)
    return {
      principal: rbac.createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: await deps.roleRepository.getPermissionCodes(role.id), sessionId: 's1' }),
      ip: '10.0.0.1',
      userAgent: 'test',
      correlationId: 'c1',
    }
  }
  const email = createEmailService(deps)
  const links = createAccountLinkService(deps)
  return { deps, admin, manager, ctxOf, email, links }
}

const codeOf = async (fn) => {
  try {
    await fn()
  } catch (err) {
    return err.code
  }
  return 'OK'
}
const fieldsOf = async (fn) => {
  try {
    await fn()
  } catch (err) {
    return err.details && err.details.fields
  }
  return null
}
const tokenIn = (text) => /token=([A-Za-z0-9_-]+)/.exec(text)[1]

describe('application/email — configurações e teste', () => {
  it('só integrations.manage; a senha nunca volta e não vai para o histórico', async () => {
    const { deps, admin, manager, ctxOf, email } = await setup()
    assert.equal(await codeOf(async () => email.getSettings(await ctxOf(manager))), 'FORBIDDEN')
    assert.equal((await email.getSettings(await ctxOf(admin))).values.enabled, false)
    const saved = await email.updateSettings(await ctxOf(admin), Object.assign({ password: 'segredo-smtp' }, CONFIG))
    assert.equal(saved.values.host, 'smtp.empresa.com')
    assert.equal(saved.has_password, true)
    assert.equal(JSON.stringify(saved).includes('segredo-smtp'), false)
    const entry = deps.store.audit.at(-1)
    assert.equal(entry.action, 'email_settings.update')
    assert.equal(JSON.stringify(entry).includes('segredo-smtp'), false)
    assert.equal(entry.newValue.password_changed, true)
    assert.deepEqual(await fieldsOf(async () => email.updateSettings(await ctxOf(admin), { port: 0 })), { port: 'too_small' })
  })

  it('e-mail de teste: exige o envio ligado; vai para quem pediu; falha do servidor vira erro legível', async () => {
    const { deps, admin, ctxOf, email } = await setup()
    assert.equal(await codeOf(async () => email.sendTest(await ctxOf(admin), {})), 'EMAIL_NOT_CONFIGURED')
    await email.updateSettings(await ctxOf(admin), CONFIG)
    assert.deepEqual(await email.sendTest(await ctxOf(admin), {}), { sent: true, to: 'admin@example.com' })
    const sent = deps.mailer.sent.at(-1)
    assert.equal(sent.to, 'admin@example.com')
    assert.equal(sent.fromAddress, 'portal@empresa.com')
    assert.equal(sent.subject, 'Teste de e-mail — Avanza')
    deps.mailer.failNext('535 authentication failed')
    await assert.rejects(
      async () => email.sendTest(await ctxOf(admin), {}),
      (err) => err.code === 'EMAIL_SEND_FAILED' && err.details.reason === '535 authentication failed',
    )
  })

  it('fila: envia o que venceu, apaga o corpo depois de enviar e tenta de novo com espera crescente', async () => {
    const { deps, admin, ctxOf, email } = await setup()
    await email.updateSettings(await ctxOf(admin), CONFIG)
    await deps.emailOutboxRepository.enqueue({ to: 'a@x.com', kind: 'notification', subject: 'Oi', html: '<p>token=abc</p>', text: 'token=abc' })
    await deps.emailOutboxRepository.enqueue({ to: 'b@x.com', kind: 'notification', subject: 'Olá', html: '<p>x</p>', text: 'x' })
    deps.mailer.failNext('timeout')
    const result = await email.flushOutbox()
    assert.deepEqual(result, { sent: 1, failed: 0, retrying: 1 })
    const [first, second] = deps.store.emailOutbox
    assert.equal(first.status, 'pending')
    assert.equal(first.attempts, 1)
    assert.equal(first.lastError, 'timeout')
    assert.equal(first.nextAttemptAt.toISOString(), '2026-10-01T12:01:00.000Z')
    assert.equal(second.status, 'sent')
    assert.equal(second.html, '')
    assert.equal(second.text, '')
    // ainda não venceu: não tenta
    assert.deepEqual(await email.flushOutbox(), { sent: 0, failed: 0, retrying: 0 })
    deps.clock.advanceMinutes(1)
    assert.deepEqual(await email.flushOutbox(), { sent: 1, failed: 0, retrying: 0 })
    assert.equal(first.html, '')
    // envio desligado: a fila espera
    await deps.emailOutboxRepository.enqueue({ to: 'c@x.com', kind: 'notification', subject: 'Z', html: 'z', text: 'z' })
    await email.updateSettings(await ctxOf(admin), { enabled: false })
    assert.deepEqual(await email.flushOutbox(), { sent: 0, failed: 0, retrying: 0, skipped: true })
  })

  it('depois de 5 falhas desiste, apaga o corpo e marca como falha', async () => {
    const { deps, admin, ctxOf, email } = await setup()
    await email.updateSettings(await ctxOf(admin), CONFIG)
    await deps.emailOutboxRepository.enqueue({ to: 'a@x.com', kind: 'notification', subject: 'Oi', html: 'h', text: 't' })
    for (let i = 0; i < 5; i++) {
      deps.mailer.failNext('recusado')
      await email.flushOutbox()
      deps.clock.advanceMinutes(60)
    }
    const item = deps.store.emailOutbox[0]
    assert.equal(item.status, 'failed')
    assert.equal(item.attempts, 5)
    assert.equal(item.html, '')
    assert.deepEqual((await email.outboxSummary(await ctxOf(admin))).counts, { pending: 0, sent: 0, failed: 1 })
  })
})

describe('application/account-links — esqueci minha senha', () => {
  async function ready() {
    const s = await setup()
    await s.email.updateSettings(await s.ctxOf(s.admin), CONFIG)
    s.ana = await seedUser(s.deps, { email: 'ana@example.com', name: 'Ana', password: 'senhaAntiga123', locale: 'en' })
    return s
  }

  it('pedido: link de uso único no e-mail da pessoa (no idioma dela); e-mail desconhecido responde igual', async () => {
    const { deps, links } = await ready()
    assert.deepEqual(await links.requestReset({ email: ' ANA@example.com ' }, anon), { requested: true })
    const mail = deps.store.emailOutbox.at(-1)
    assert.equal(mail.to, 'ana@example.com')
    assert.equal(mail.kind, 'password_reset')
    assert.equal(mail.subject, 'Reset your password — Avanza')
    assert.match(mail.text, /https:\/\/kamban\.empresa\.com\/reset-password\?token=/)
    assert.equal(deps.store.audit.at(-1).action, 'auth.password_reset_requested')
    const count = deps.store.emailOutbox.length
    assert.deepEqual(await links.requestReset({ email: 'ninguem@example.com' }, anon), { requested: true })
    assert.equal(deps.store.emailOutbox.length, count)
    assert.equal(await codeOf(() => links.requestReset({ email: 'x' }, anon)), 'VALIDATION_ERROR')
  })

  it('no máximo 3 pedidos por hora; sem envio de e-mail ligado, nada sai', async () => {
    const { deps, admin, ctxOf, email, links } = await ready()
    for (let i = 0; i < 5; i++) await links.requestReset({ email: 'ana@example.com' }, anon)
    assert.equal(deps.store.emailOutbox.filter((m) => m.kind === 'password_reset').length, 3)
    deps.clock.advanceMinutes(61)
    await email.updateSettings(await ctxOf(admin), { enabled: false })
    await links.requestReset({ email: 'ana@example.com' }, anon)
    assert.equal(deps.store.emailOutbox.filter((m) => m.kind === 'password_reset').length, 3)
  })

  it('conferir e confirmar: senha pela política, sessões encerradas, link vale uma vez; o novo pedido invalida o anterior', async () => {
    const { deps, links } = await ready()
    await links.requestReset({ email: 'ana@example.com' }, anon)
    const old = tokenIn(deps.store.emailOutbox.at(-1).text)
    await links.requestReset({ email: 'ana@example.com' }, anon)
    const token = tokenIn(deps.store.emailOutbox.at(-1).text)
    assert.equal((await links.checkToken(old)).valid, false)
    const check = await links.checkToken(token)
    assert.equal(check.valid, true)
    assert.equal(check.purpose, 'reset')
    assert.equal(check.policy.min_length, 10)

    const ana = await deps.userRepository.findByEmail('ana@example.com')
    await deps.sessionRepository.create({ userId: ana.id, tokenHash: 'h', expiresAt: new Date('2026-12-01T00:00:00Z'), lastSeenAt: deps.clock.now() })
    assert.deepEqual(await fieldsOf(() => links.confirm({ token, password: 'curta1' }, anon)), { password: 'too_short' })
    assert.deepEqual(await links.confirm({ token, password: 'SenhaNova12345' }, anon), { changed: true, purpose: 'reset' })
    assert.equal(await deps.userRepository.verifyPassword(ana.id, 'SenhaNova12345'), true)
    assert.ok(deps.store.sessions.every((s) => s.userId !== ana.id || s.revokedAt))
    assert.equal(deps.store.audit.at(-1).action, 'auth.password_reset')
    assert.equal(await codeOf(() => links.confirm({ token, password: 'OutraSenha1234' }, anon)), 'RESET_TOKEN_INVALID')
  })

  it('link vencido (60 min) não vale', async () => {
    const { deps, links } = await ready()
    await links.requestReset({ email: 'ana@example.com' }, anon)
    const token = tokenIn(deps.store.emailOutbox.at(-1).text)
    deps.clock.advanceMinutes(61)
    assert.equal((await links.checkToken(token)).valid, false)
    assert.equal((await links.checkToken(token)).state, 'expired')
    assert.equal(await codeOf(() => links.confirm({ token, password: 'SenhaNova12345' }, anon)), 'RESET_TOKEN_INVALID')
  })
})

describe('application/account-links — convites', () => {
  it('criar com convite dispensa a senha; a pessoa cria a dela pelo link (7 dias); reenviar invalida o anterior', async () => {
    const { deps, admin, ctxOf, email, links } = await setup()
    const users = createUserService(deps)
    const member = await deps.roleRepository.findByCode('MEMBER')
    assert.equal(await codeOf(async () => users.createUser(await ctxOf(admin), { name: 'Bia', email: 'bia@example.com', role_id: member.id, send_invite: true })), 'EMAIL_NOT_CONFIGURED')
    await email.updateSettings(await ctxOf(admin), CONFIG)
    assert.deepEqual(await fieldsOf(async () => users.createUser(await ctxOf(admin), { name: 'Bia', email: 'bia@example.com', role_id: member.id })), { password: 'required' })
    const bia = await users.createUser(await ctxOf(admin), { name: 'Bia', email: 'bia@example.com', role_id: member.id, send_invite: true })
    const mail = deps.store.emailOutbox.at(-1)
    assert.equal(mail.kind, 'invite')
    assert.equal(mail.subject, 'Você foi convidado para o Avanza')
    assert.match(mail.text, /Admin convidou você/)
    assert.equal(deps.store.audit.at(-1).action, 'user.invited')

    const first = tokenIn(mail.text)
    await links.resendInvite(await ctxOf(admin), bia.id)
    const token = tokenIn(deps.store.emailOutbox.at(-1).text)
    assert.equal((await links.checkToken(first)).valid, false)
    assert.equal((await links.checkToken(token)).purpose, 'invite')
    deps.clock.advanceMinutes(6 * 24 * 60)
    assert.deepEqual(await links.confirm({ token, password: 'SenhaDaBia12345' }, anon), { changed: true, purpose: 'invite' })
    const auth = createAuthService(deps)
    assert.equal((await auth.login({ email: 'bia@example.com', password: 'SenhaDaBia12345' }, anon)).user.email, 'bia@example.com')
    // já entrou: reenviar convite não faz sentido
    assert.equal(await codeOf(async () => links.resendInvite(await ctxOf(admin), bia.id)), 'USER_ALREADY_ACTIVE')
  })
})

describe('notificações por e-mail', () => {
  it('quem recebe a notificação ganha o e-mail (se não desligou); envio desligado não enfileira', async () => {
    const { deps, admin, ctxOf, email } = await setup()
    await email.updateSettings(await ctxOf(admin), CONFIG)
    const ana = await seedUser(deps, { email: 'ana@example.com', name: 'Ana' })
    const rafa = await seedUser(deps, { email: 'rafa@example.com', name: 'Rafa', emailNotifications: false })
    const project = await deps.projectRepository.create({ name: 'CRM', key: 'CRM', ownerId: admin.id, status: 'active', priority: 'medium' })
    await deps.projectMemberRepository.add({ projectId: project.id, userId: ana.id, role: 'member' })
    await deps.projectMemberRepository.add({ projectId: project.id, userId: rafa.id, role: 'member' })
    const notifier = createNotifier(deps)
    const task = { id: 't1', code: 'CRM-12', title: 'Nova tela' }
    const event = { task, project, actorId: admin.id, entries: [{ userId: ana.id, type: 'mention' }, { userId: rafa.id, type: 'mention' }], data: { comment: 'Pode revisar?' } }
    assert.equal(await notifier.notify(deps, event), 2)
    const mails = deps.store.emailOutbox.filter((m) => m.kind === 'notification')
    assert.equal(mails.length, 1)
    assert.equal(mails[0].to, 'ana@example.com')
    assert.equal(mails[0].subject, 'Admin mencionou você em CRM-12')
    assert.match(mails[0].html, /https:\/\/kamban\.empresa\.com\/tasks\/t1/)

    await email.updateSettings(await ctxOf(admin), { enabled: false })
    await notifier.notify(deps, Object.assign({}, event, { entries: [{ userId: ana.id, type: 'assigned' }] }))
    assert.equal(deps.store.emailOutbox.filter((m) => m.kind === 'notification').length, 1)
  })
})
