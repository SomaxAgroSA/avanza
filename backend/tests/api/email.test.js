/**
 * E-mail (integrações) — API contra um PocketBase real e isolado, enviando para um SMTP de teste:
 * configurações (senha nunca volta), e-mail de teste, fila, "Esqueci minha senha" ponta a ponta,
 * convite, notificação por e-mail (e quem desligou não recebe) e servidor fora do ar.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startPocketBase, createClient } = require('../support/pb-harness')
const { startSmtpSink } = require('../support/smtp-sink')

const PASSWORD = 'SenhaTeste123'
const tokenOf = (message) => /reset-password\?token=([A-Za-z0-9_-]+)/.exec(message.text)[1]

describe('API E-mail', { timeout: 180000 }, () => {
  let pb
  let smtp
  let root
  let gestor
  let mario
  let roles

  before(async () => {
    pb = await startPocketBase()
    smtp = await startSmtpSink()
    root = createClient(pb.api)
    await root.login(pb.admin.email, pb.admin.password)
    roles = (await root.get('/roles')).body.data
    const make = async (name, email, role) => {
      const created = (await root.post('/users', { name, email, password: PASSWORD, role_id: roles.find((r) => r.code === role).id })).body.data
      const client = createClient(pb.api)
      await client.login(email, PASSWORD)
      return { client, user: created }
    }
    gestor = await make('Gil', 'gil@example.com', 'MANAGER')
    mario = await make('Mário', 'mario@example.com', 'MEMBER')
  })

  after(async () => {
    if (pb) await pb.stop()
    if (smtp) await smtp.stop()
  })

  const flush = async () => {
    const res = await root.post('/settings/email/outbox/flush')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body.data
  }

  it('configurações só com integrations.manage; a senha do SMTP nunca volta; e-mail de teste chega', async () => {
    assert.equal((await gestor.client.get('/settings/email')).status, 403)
    assert.equal((await root.post('/settings/email/test', {})).body.error.code, 'EMAIL_NOT_CONFIGURED')
    const saved = await root.patch('/settings/email', {
      enabled: true,
      host: '127.0.0.1',
      port: smtp.port,
      username: 'kamban',
      password: 'segredo-do-smtp',
      sender_name: 'Portal',
      sender_address: 'portal@empresa.test',
      app_url: pb.baseUrl,
    })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    assert.equal(saved.body.data.has_password, true)
    assert.equal(JSON.stringify(saved.body).includes('segredo-do-smtp'), false)
    const read = await root.get('/settings/email')
    assert.equal(JSON.stringify(read.body).includes('segredo-do-smtp'), false)
    const history = (await root.get('/audit-logs?entity_type=email_settings')).body.data
    assert.equal(JSON.stringify(history).includes('segredo-do-smtp'), false)
    const test = await root.post('/settings/email/test', {})
    assert.equal(test.status, 200, JSON.stringify(test.body))
    const message = await smtp.waitFor((m) => m.subject === 'Teste de e-mail — Avanza')
    assert.deepEqual(message.to, [pb.admin.email])
    assert.equal(message.from, 'portal@empresa.test')
    // o PocketBase autenticou com a senha configurada (que a API nunca devolve)
    assert.deepEqual(smtp.auth.at(-1), { username: 'kamban', password: 'segredo-do-smtp' })
    assert.equal((await createClient(pb.api).get('/platform')).body.data.password_reset, true)
  })

  it('"Esqueci minha senha": o link chega, define a senha pela política, vale uma vez; e-mail desconhecido responde igual', async () => {
    const anon = createClient(pb.api)
    assert.deepEqual((await anon.post('/auth/password-reset/request', { email: 'ninguem@example.com' })).body.data, { requested: true })
    assert.deepEqual((await anon.post('/auth/password-reset/request', { email: 'MARIO@example.com' })).body.data, { requested: true })
    assert.equal((await flush()).sent, 1)
    const message = await smtp.waitFor((m) => m.to[0] === 'mario@example.com' && /Redefinir/.test(m.subject))
    assert.match(message.html, new RegExp(`href="${pb.baseUrl.replace(/[.]/g, '\\.')}/reset-password\\?token=`))
    const token = tokenOf(message)
    const check = (await anon.get(`/auth/password-reset/check?token=${token}`)).body.data
    assert.equal(check.valid, true)
    assert.equal(check.purpose, 'reset')
    assert.equal(check.policy.min_length, 10)
    assert.equal((await anon.post('/auth/password-reset/confirm', { token, password: 'curta' })).body.error.details.fields.password, 'too_short')
    const done = await anon.post('/auth/password-reset/confirm', { token, password: 'SenhaNovaDoMario1' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.equal((await createClient(pb.api).login('mario@example.com', PASSWORD)).status, 401)
    assert.equal((await createClient(pb.api).login('mario@example.com', 'SenhaNovaDoMario1')).status, 200)
    // a sessão aberta antes foi encerrada
    assert.equal((await mario.client.get('/auth/me')).status, 401)
    assert.equal((await anon.post('/auth/password-reset/confirm', { token, password: 'OutraSenha12345' })).body.error.code, 'RESET_TOKEN_INVALID')
    assert.equal((await anon.get('/auth/password-reset/check?token=nao-existe')).body.data.valid, false)
  })

  it('convite: cria sem senha, o link chega e a pessoa cria a dela; depois de entrar não há reenvio', async () => {
    const created = await root.post('/users', { name: 'Bia', email: 'bia@example.com', role_id: roles.find((r) => r.code === 'MEMBER').id, send_invite: true })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    await flush()
    const message = await smtp.waitFor((m) => m.to[0] === 'bia@example.com')
    assert.equal(message.subject, 'Você foi convidado para o Avanza')
    assert.match(message.text, /Admin Teste convidou você/)
    const token = tokenOf(message)
    assert.equal((await createClient(pb.api).get(`/auth/password-reset/check?token=${token}`)).body.data.purpose, 'invite')
    assert.equal((await createClient(pb.api).post('/auth/password-reset/confirm', { token, password: 'SenhaDaBia12345' })).status, 200)
    const bia = createClient(pb.api)
    assert.equal((await bia.login('bia@example.com', 'SenhaDaBia12345')).status, 200)
    assert.equal((await root.post(`/users/${created.body.data.id}/invite`)).body.error.code, 'USER_ALREADY_ACTIVE')
    assert.equal((await gestor.client.post(`/users/${created.body.data.id}/invite`)).status, 403)
  })

  it('notificação vira e-mail para quem não desligou; servidor fora do ar fica na fila para nova tentativa', async () => {
    const project = (await root.post('/projects', { name: 'CRM', key: 'CRM' })).body.data
    await root.post(`/projects/${project.id}/members`, { user_id: gestor.user.id, role: 'member' })
    await root.post(`/projects/${project.id}/members`, { user_id: mario.user.id, role: 'member' })
    const doc = (await root.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO')

    // Mário desliga as notificações por e-mail; Gil continua recebendo
    const marioAgain = createClient(pb.api)
    await marioAgain.login('mario@example.com', 'SenhaNovaDoMario1')
    const off = await marioAgain.patch(`/users/${mario.user.id}`, { email_notifications: false })
    assert.equal(off.status, 200, JSON.stringify(off.body))
    assert.equal(off.body.data.email_notifications, false)

    await root.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: 'Para o Mário', assignee_id: mario.user.id })
    await root.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: 'Para o Gil', assignee_id: gestor.user.id })
    smtp.failNext()
    const first = await flush()
    assert.equal(first.retrying, 1)
    const outbox = (await root.get('/settings/email/outbox')).body.data
    assert.equal(outbox.counts.pending, 1)
    assert.match(outbox.recent[0].last_error, /451/)
    assert.equal(outbox.recent.filter((m) => m.to === 'mario@example.com' && m.kind === 'notification').length, 0)
  })
})
