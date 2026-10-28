const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const webhook = require('../../src/domain/webhook')

describe('domain/webhook — eventos', () => {
  it('catálogo público de eventos (nomes estáveis) com grupos; assinatura por evento ou por grupo inteiro', () => {
    assert.ok(webhook.EVENTS.includes('task.created'))
    assert.ok(webhook.EVENTS.includes('plan_item.updated'))
    assert.equal(webhook.EVENTS.includes('auth.login'), false)
    assert.ok(webhook.EVENT_GROUPS.includes('task'))
    assert.equal(webhook.matches(['task.created'], 'task.created'), true)
    assert.equal(webhook.matches(['task.*'], 'task.deleted'), true)
    assert.equal(webhook.matches(['task.*'], 'comment.added'), false)
    // fora do catálogo nunca dispara, nem com o grupo
    assert.equal(webhook.matches(['user.*'], 'user.password_reset'), false)
    assert.equal(webhook.isPublicEvent('auth.login'), false)
  })
})

describe('domain/webhook — endereço', () => {
  it('produção exige https, sem usuário/senha no endereço; nunca metadados da nuvem nem link-local', () => {
    assert.equal(webhook.urlIssue('https://hooks.empresa.com/kamban', false), null)
    assert.equal(webhook.urlIssue('https://10.0.0.5:8443/hook', false), null)
    assert.equal(webhook.urlIssue('http://hooks.empresa.com', false), 'insecure_url')
    assert.equal(webhook.urlIssue('ftp://x', false), 'invalid_url')
    assert.equal(webhook.urlIssue('https://user:pass@hooks.empresa.com', false), 'invalid_url')
    assert.equal(webhook.urlIssue('https://169.254.169.254/latest', false), 'blocked_host')
    assert.equal(webhook.urlIssue('https://metadata.google.internal/x', false), 'blocked_host')
    assert.equal(webhook.urlIssue('https://localhost/x', false), 'blocked_host')
    assert.equal(webhook.urlIssue('https://127.0.0.1:9000/x', false), 'blocked_host')
    assert.equal(webhook.urlIssue('https://[::1]/x', false), 'blocked_host')
    assert.equal(webhook.urlIssue(`https://x.com/${'a'.repeat(500)}`, false), 'too_long')
  })

  it('em desenvolvimento/teste aceita http e a própria máquina (receptor local); metadados continuam bloqueados', () => {
    assert.equal(webhook.urlIssue('http://127.0.0.1:9000/hook', true), null)
    assert.equal(webhook.urlIssue('http://localhost:3000', true), null)
    assert.equal(webhook.urlIssue('http://169.254.169.254', true), 'blocked_host')
  })
})

describe('domain/webhook — entrada, entregas e assinatura', () => {
  it('valida nome, endereço, eventos e ativo; na edição só o que veio', () => {
    const ok = webhook.webhookInput({ name: ' CRM ', url: 'https://hooks.x.com/a', events: ['task.*', 'comment.added', 'task.*'] }, { allowInsecure: false })
    assert.deepEqual(ok.fields, {})
    assert.deepEqual(ok.values, { name: 'CRM', url: 'https://hooks.x.com/a', events: ['task.*', 'comment.added'], active: true })
    const bad = webhook.webhookInput({ name: '', url: 'http://x.com', events: ['auth.login'], active: 'sim' }, { allowInsecure: false })
    assert.deepEqual(bad.fields, { name: 'required', url: 'insecure_url', events: 'invalid_option', active: 'invalid_type' })
    assert.equal(webhook.webhookInput({ events: [] }, { allowInsecure: false }).fields.events, 'required')
    const partial = webhook.webhookInput({ active: false }, { allowInsecure: false, partial: true })
    assert.deepEqual(partial, { values: { active: false }, fields: {} })
  })

  it('novas tentativas em 1, 5, 30, 120 e 720 minutos; na 6ª falha desiste; 2xx é sucesso', () => {
    const now = new Date('2026-10-01T12:00:00Z')
    assert.equal(webhook.nextAttemptAt(1, now).toISOString(), '2026-10-01T12:01:00.000Z')
    assert.equal(webhook.nextAttemptAt(5, now).toISOString(), '2026-10-02T00:00:00.000Z')
    assert.equal(webhook.nextAttemptAt(6, now), null)
    assert.equal(webhook.isSuccess(204), true)
    assert.equal(webhook.isSuccess(301), false)
    assert.equal(webhook.isSuccess(0), false)
  })

  it('carga do evento e o texto assinado (timestamp.corpo)', () => {
    const payload = webhook.buildPayload({
      deliveryId: 'd1',
      event: 'task.updated',
      occurredAt: new Date('2026-10-01T12:00:00Z'),
      entry: { entityType: 'task', entityId: 't1', userId: 'u1', oldValue: { title: 'A' }, newValue: { title: 'B' } },
    })
    assert.deepEqual(payload, {
      id: 'd1',
      event: 'task.updated',
      occurred_at: '2026-10-01T12:00:00.000Z',
      actor: { id: 'u1' },
      entity: { type: 'task', id: 't1' },
      data: { title: 'B' },
      previous: { title: 'A' },
    })
    assert.equal(webhook.signingString(1790000000, '{"a":1}'), '1790000000.{"a":1}')
    assert.match(webhook.newSecret('a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'), /^whsec_[A-Za-z0-9]{32}$/)
  })
})
