const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const email = require('../../src/domain/email')
const authToken = require('../../src/domain/auth-token')

describe('domain/email — configurações do envio', () => {
  it('desligado por padrão; ligar exige servidor, remetente e endereço da plataforma', () => {
    assert.equal(email.DEFAULT_SETTINGS.enabled, false)
    assert.deepEqual(email.validateEmailSettings({ enabled: true }, email.DEFAULT_SETTINGS).fields, {
      host: 'required',
      sender_address: 'required',
      app_url: 'required',
    })
    const ok = email.validateEmailSettings(
      { enabled: true, host: 'smtp.empresa.com', port: 587, sender_name: 'Portal', sender_address: 'Portal@Empresa.com ', app_url: 'https://kamban.empresa.com/' },
      email.DEFAULT_SETTINGS,
    )
    assert.deepEqual(ok.fields, {})
    assert.equal(ok.values.sender_address, 'portal@empresa.com')
    assert.equal(ok.values.app_url, 'https://kamban.empresa.com')
  })

  it('valida cada campo; a senha só muda quando enviada (nunca volta na leitura)', () => {
    const bad = email.validateEmailSettings(
      { host: 'smtp empresa', port: 70000, sender_address: 'x', app_url: 'ftp://x', tls: 'sim', extra: 1, password: 'a'.repeat(201) },
      email.DEFAULT_SETTINGS,
    )
    assert.deepEqual(bad.fields, {
      host: 'invalid_format',
      port: 'too_large',
      sender_address: 'invalid_email',
      app_url: 'invalid_url',
      tls: 'invalid_type',
      extra: 'unknown_field',
      password: 'too_long',
    })
    assert.equal(email.validateEmailSettings({ app_url: 'https://x.com/?a=1' }, email.DEFAULT_SETTINGS).fields.app_url, 'invalid_url')
    assert.equal(email.validateEmailSettings({ password: 'segredo' }, email.DEFAULT_SETTINGS).password, 'segredo')
    assert.equal(email.validateEmailSettings({ password: '' }, email.DEFAULT_SETTINGS).password, undefined)
    // null remove a senha (servidor sem autenticação)
    assert.equal(email.validateEmailSettings({ password: null }, email.DEFAULT_SETTINGS).password, '')
    assert.equal(email.validateEmailSettings({ host: 'smtp.x.com' }, email.DEFAULT_SETTINGS).password, undefined)
  })

  it('fila: novas tentativas em 1, 5, 15 e 60 minutos; depois da 5ª falha desiste', () => {
    const now = new Date('2026-10-01T12:00:00Z')
    assert.equal(email.nextAttemptAt(1, now).toISOString(), '2026-10-01T12:01:00.000Z')
    assert.equal(email.nextAttemptAt(2, now).toISOString(), '2026-10-01T12:05:00.000Z')
    assert.equal(email.nextAttemptAt(4, now).toISOString(), '2026-10-01T13:00:00.000Z')
    assert.equal(email.nextAttemptAt(5, now), null)
  })
})

describe('domain/email — modelos', () => {
  it('redefinição de senha no idioma da pessoa, com link, prazo e sem HTML injetado', () => {
    const msg = email.renderEmail('password_reset', 'pt-BR', { platform: 'Portal <Obra>', name: 'Ana <b>', link: 'https://k.com/reset-password?token=abc' })
    assert.equal(msg.subject, 'Redefinir sua senha — Portal <Obra>')
    assert.match(msg.html, /Portal &lt;Obra&gt;/)
    assert.match(msg.html, /Ana &lt;b&gt;/)
    assert.match(msg.html, /href="https:\/\/k\.com\/reset-password\?token=abc"/)
    assert.match(msg.text, /https:\/\/k\.com\/reset-password\?token=abc/)
    assert.match(msg.text, /60 minutos/)
    assert.equal(email.renderEmail('password_reset', 'en', { platform: 'K', name: 'Ana', link: 'https://k' }).subject, 'Reset your password — K')
    assert.equal(email.renderEmail('invite', 'es', { platform: 'K', name: 'Ana', inviter: 'Rafa', link: 'https://k' }).subject, 'Te invitaron a K')
    // idioma desconhecido cai no pt-BR
    assert.equal(email.renderEmail('test', 'fr', { platform: 'K' }).subject, 'Teste de e-mail — K')
  })

  it('notificação: frase do tipo, contexto, trecho e link para o item', () => {
    const task = email.renderNotificationEmail(
      { type: 'mention', taskId: 't1', data: { code: 'CRM-12', title: 'Nova tela', comment: 'Pode revisar?' } },
      { locale: 'pt-BR', actorName: 'Carla', platform: 'KAMBAN', appUrl: 'https://k.com' },
    )
    assert.equal(task.subject, 'Carla mencionou você em CRM-12')
    assert.match(task.html, /Nova tela/)
    assert.match(task.html, /Pode revisar\?/)
    assert.match(task.html, /href="https:\/\/k\.com\/tasks\/t1"/)
    const status = email.renderNotificationEmail(
      { type: 'status_changed', taskId: 't1', data: { code: 'CRM-12', title: 'X', status: 'Em teste' } },
      { locale: 'en', actorName: 'Carla', platform: 'KAMBAN', appUrl: 'https://k.com' },
    )
    assert.equal(status.subject, 'Carla changed the status of CRM-12 to Em teste')
    const item = email.renderNotificationEmail(
      { type: 'plan_reply', planItemId: 'i9', projectId: 'p1', data: { name: 'Kickoff', project: 'ERP', update: 'Ok!' } },
      { locale: 'es', actorName: 'Rafa', platform: 'KAMBAN', appUrl: 'https://k.com' },
    )
    assert.equal(item.subject, 'Rafa respondió tu actualización en “Kickoff”')
    assert.match(item.html, /href="https:\/\/k\.com\/project-management\/p1\?item=i9"/)
    const due = email.renderNotificationEmail({ type: 'due_soon', taskId: 't2', data: { code: 'CRM-3', title: 'Y' } }, { locale: 'pt-BR', actorName: null, platform: 'KAMBAN', appUrl: 'https://k.com' })
    assert.equal(due.subject, 'CRM-3 vence amanhã')
  })
})

describe('domain/auth-token — links de redefinição e convite', () => {
  it('redefinição vale 60 minutos; convite, 7 dias; usado ou vencido não vale', () => {
    const now = new Date('2026-10-01T12:00:00Z')
    assert.equal(authToken.expiresAt('reset', now).toISOString(), '2026-10-01T13:00:00.000Z')
    assert.equal(authToken.expiresAt('invite', now).toISOString(), '2026-10-08T12:00:00.000Z')
    const token = { purpose: 'reset', expiresAt: new Date('2026-10-01T13:00:00Z'), usedAt: null }
    assert.equal(authToken.tokenState(token, now), 'valid')
    assert.equal(authToken.tokenState(Object.assign({}, token, { usedAt: now }), now), 'used')
    assert.equal(authToken.tokenState(token, new Date('2026-10-01T13:00:01Z')), 'expired')
    assert.equal(authToken.tokenState(null, now), 'invalid')
  })

  it('no máximo 3 pedidos de redefinição por hora para a mesma conta', () => {
    assert.equal(authToken.canRequestReset(2), true)
    assert.equal(authToken.canRequestReset(3), false)
  })
})
