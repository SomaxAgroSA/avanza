/**
 * Casos de uso dos webhooks (regras de negócio §18). Quem gerencia integrações cadastra endereços e
 * eventos; cada ação do catálogo gravada no histórico vira uma entrega (na mesma transação) e uma
 * rotina por minuto envia o POST assinado, com novas tentativas. 20 tentativas seguidas com falha
 * desligam o webhook sozinho.
 *
 * Portas: `webhookRepository` { list, listActive, findById, create, update, delete },
 * `webhookDeliveryRepository` { create, findById, listByWebhook, listDue, update, purgeBefore },
 * `httpClient` { post(url, body, headers, timeoutSeconds) → { status, body } (lança se não conectar) },
 * `crypto` { hmacSha256Hex(secret, data) }, `allowInsecureWebhooks` (desenvolvimento/teste).
 */

const { appError } = require('../core/errors')
const rbac = require('../domain/rbac')
const webhookDomain = require('../domain/webhook')
const { buildAuditEntry, truncate } = require('./audit')
const { iso } = require('./presenters')

const PERMISSION = 'integrations.manage'
const FLUSH_LIMIT = 50
const KEEP_DAYS = 30

function presentWebhook(w) {
  return {
    id: w.id,
    name: w.name,
    url: w.url,
    events: w.events,
    active: w.active,
    last_status: w.lastStatus || null,
    last_delivery_at: iso(w.lastDeliveryAt),
    consecutive_failures: w.consecutiveFailures || 0,
    created_at: iso(w.createdAt),
  }
}

function presentDelivery(d) {
  return {
    id: d.id,
    webhook_id: d.webhookId,
    event: d.event,
    status: d.status,
    attempts: d.attempts,
    response_status: d.responseStatus || null,
    response_body: d.responseBody || null,
    error: d.error || null,
    duration_ms: d.durationMs === undefined ? null : d.durationMs,
    next_attempt_at: iso(d.nextAttemptAt),
    delivered_at: iso(d.deliveredAt),
    created_at: iso(d.createdAt),
  }
}

/**
 * Cria as entregas de um registro do histórico (chamado pela infraestrutura ao gravar o histórico,
 * dentro da mesma transação). Só eventos do catálogo e webhooks ativos que assinam o evento.
 */
function enqueueForEntry(repos, entry, now) {
  if (!entry || !webhookDomain.isPublicEvent(entry.action)) return 0
  const targets = repos.webhookRepository.listActive().filter((w) => webhookDomain.matches(w.events, entry.action))
  targets.forEach((w) => {
    repos.webhookDeliveryRepository.create({
      webhookId: w.id,
      event: entry.action,
      payload: webhookDomain.buildPayload({ deliveryId: '', event: entry.action, occurredAt: now, entry }),
      nextAttemptAt: now,
    })
  })
  return targets.length
}

function createWebhookService(deps) {
  function findOrFail(id) {
    const webhook = id ? deps.webhookRepository.findById(id) : null
    if (!webhook) throw appError('WEBHOOK_NOT_FOUND')
    return webhook
  }

  function secret() {
    return webhookDomain.newSecret(deps.tokens.generate())
  }

  function invalid(fields) {
    return appError('VALIDATION_ERROR', undefined, { fields })
  }

  function list(ctx) {
    rbac.assertCan(ctx.principal, PERMISSION)
    return deps.webhookRepository.list().map(presentWebhook)
  }

  function events(ctx) {
    rbac.assertCan(ctx.principal, PERMISSION)
    return { events: webhookDomain.EVENTS, groups: webhookDomain.EVENT_GROUPS }
  }

  /** O segredo de assinatura só aparece aqui (e ao gerar um novo). */
  function create(ctx, raw) {
    rbac.assertCan(ctx.principal, PERMISSION)
    const input = webhookDomain.webhookInput(raw, { allowInsecure: !!deps.allowInsecureWebhooks })
    if (Object.keys(input.fields).length > 0) throw invalid(input.fields)
    const value = secret()
    const created = deps.unitOfWork.run((repos) => {
      const webhook = repos.webhookRepository.create(Object.assign({}, input.values, { secret: value, createdBy: ctx.principal.userId }))
      repos.auditRepository.record(
        buildAuditEntry(ctx, { entityType: 'webhook', entityId: webhook.id, action: 'webhook.created', newValue: { name: webhook.name, url: webhook.url, events: webhook.events } }),
      )
      return webhook
    })
    return Object.assign({ secret: value }, presentWebhook(created))
  }

  function update(ctx, id, raw) {
    rbac.assertCan(ctx.principal, PERMISSION)
    const webhook = findOrFail(id)
    const input = webhookDomain.webhookInput(raw, { allowInsecure: !!deps.allowInsecureWebhooks, partial: true })
    if (Object.keys(input.fields).length > 0) throw invalid(input.fields)
    const changed = Object.keys(input.values).filter((key) => JSON.stringify(input.values[key]) !== JSON.stringify(webhook[key]))
    if (changed.length === 0) return presentWebhook(webhook)
    const patch = changed.reduce((acc, key) => Object.assign(acc, { [key]: input.values[key] }), {})
    // religar zera a contagem de falhas
    if (patch.active === true) patch.consecutiveFailures = 0
    const updated = deps.unitOfWork.run((repos) => {
      const saved = repos.webhookRepository.update(webhook.id, patch)
      const pick = (source) => changed.reduce((acc, key) => Object.assign(acc, { [key]: source[key] }), {})
      repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'webhook', entityId: webhook.id, action: 'webhook.updated', oldValue: pick(webhook), newValue: pick(saved) }))
      return saved
    })
    return presentWebhook(updated)
  }

  function remove(ctx, id) {
    rbac.assertCan(ctx.principal, PERMISSION)
    const webhook = findOrFail(id)
    deps.unitOfWork.run((repos) => {
      repos.webhookRepository.delete(webhook.id)
      repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'webhook', entityId: webhook.id, action: 'webhook.deleted', oldValue: { name: webhook.name, url: webhook.url } }))
    })
    return { deleted: true }
  }

  function rotateSecret(ctx, id) {
    rbac.assertCan(ctx.principal, PERMISSION)
    const webhook = findOrFail(id)
    const value = secret()
    deps.unitOfWork.run((repos) => {
      repos.webhookRepository.update(webhook.id, { secret: value })
      repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'webhook', entityId: webhook.id, action: 'webhook.secret_rotated', newValue: { name: webhook.name } }))
    })
    return { secret: value }
  }

  function deliveries(ctx, id) {
    rbac.assertCan(ctx.principal, PERMISSION)
    findOrFail(id)
    return deps.webhookDeliveryRepository.listByWebhook(id, 50).map(presentDelivery)
  }

  /** Envia uma entrega agora; grava o resultado e a próxima tentativa (ou a desistência). */
  function deliver(delivery, webhook, now) {
    const body = JSON.stringify(Object.assign({}, delivery.payload, { id: delivery.id }))
    const timestamp = Math.floor(now.getTime() / 1000)
    const signature = deps.crypto.hmacSha256Hex(webhook.secret, webhookDomain.signingString(timestamp, body))
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Avanza-Webhooks',
      'X-Kamban-Event': delivery.event,
      'X-Kamban-Delivery': delivery.id,
      'X-Kamban-Timestamp': String(timestamp),
      'X-Kamban-Signature': `sha256=${signature}`,
    }
    const started = Date.now()
    let status = 0
    let responseBody = ''
    let error = ''
    try {
      const response = deps.httpClient.post(webhook.url, body, headers, webhookDomain.TIMEOUT_SECONDS)
      status = response.status
      responseBody = truncate(String(response.body || ''), 1000)
    } catch (err) {
      error = truncate(String((err && err.message) || err), 500)
    }
    const durationMs = Date.now() - started
    const attempts = delivery.attempts + 1
    const ok = webhookDomain.isSuccess(status)
    const next = ok ? null : webhookDomain.nextAttemptAt(attempts, now)
    const deliveryPatch = { attempts, responseStatus: status, responseBody, error: ok ? '' : error || `HTTP ${status}`, durationMs, deliveredAt: now }
    if (ok) deliveryPatch.status = 'success'
    else if (next) Object.assign(deliveryPatch, { status: 'pending', nextAttemptAt: next })
    else deliveryPatch.status = 'failed'
    const updated = deps.webhookDeliveryRepository.update(delivery.id, deliveryPatch)

    const failures = ok ? 0 : (webhook.consecutiveFailures || 0) + 1
    const webhookPatch = { lastStatus: status, lastDeliveryAt: now, consecutiveFailures: failures }
    const disable = !ok && webhook.active && failures >= webhookDomain.DISABLE_AFTER_FAILURES
    if (disable) webhookPatch.active = false
    deps.webhookRepository.update(webhook.id, webhookPatch)
    if (disable) {
      deps.auditRepository.record(
        buildAuditEntry(
          { ip: '', userAgent: 'kamban-cron', correlationId: '' },
          { entityType: 'webhook', entityId: webhook.id, action: 'webhook.disabled', newValue: { name: webhook.name, failures }, userId: null },
        ),
      )
    }
    return updated
  }

  /** Rotina (cron, por minuto): envia as entregas que venceram e apaga as com mais de 30 dias. */
  function flush() {
    const now = deps.clock.now()
    const result = { sent: 0, failed: 0, retrying: 0 }
    const cache = {}
    deps.webhookDeliveryRepository.listDue(now, FLUSH_LIMIT).forEach((delivery) => {
      const webhook = cache[delivery.webhookId] || deps.webhookRepository.findById(delivery.webhookId)
      if (!webhook) return
      cache[webhook.id] = webhook
      // webhook desligado depois de enfileirar: a entrega fica parada até ele voltar
      if (!webhook.active) return
      const done = deliver(delivery, webhook, now)
      if (done.status === 'success') result.sent++
      else if (done.status === 'failed') result.failed++
      else result.retrying++
      cache[webhook.id] = deps.webhookRepository.findById(webhook.id)
    })
    deps.webhookDeliveryRepository.purgeBefore(new Date(now.getTime() - KEEP_DAYS * 86400000))
    return result
  }

  /** "Enviar teste": entrega de `webhook.ping` na hora (mesmo desligado), com o resultado. */
  function test(ctx, id) {
    rbac.assertCan(ctx.principal, PERMISSION)
    const webhook = findOrFail(id)
    const now = deps.clock.now()
    const delivery = deps.webhookDeliveryRepository.create({
      webhookId: webhook.id,
      event: webhookDomain.PING_EVENT,
      payload: webhookDomain.buildPayload({ deliveryId: '', event: webhookDomain.PING_EVENT, occurredAt: now, entry: { entityType: 'webhook', entityId: webhook.id, userId: ctx.principal.userId, newValue: { message: 'ping' } } }),
      nextAttemptAt: null,
    })
    return presentDelivery(deliver(Object.assign({}, delivery, { attempts: webhookDomain.MAX_ATTEMPTS - 1 }), webhook, now))
  }

  /** Reenviar uma entrega (ex.: o sistema de destino estava fora): tenta agora, do zero. */
  function redeliver(ctx, deliveryId) {
    rbac.assertCan(ctx.principal, PERMISSION)
    const delivery = deliveryId ? deps.webhookDeliveryRepository.findById(deliveryId) : null
    if (!delivery) throw appError('WEBHOOK_DELIVERY_NOT_FOUND')
    const webhook = findOrFail(delivery.webhookId)
    const fresh = deps.webhookDeliveryRepository.update(delivery.id, { status: 'pending', attempts: 0 })
    return presentDelivery(deliver(fresh, webhook, deps.clock.now()))
  }

  return { list, events, create, update, remove, rotateSecret, deliveries, test, redeliver, flush }
}

module.exports = { createWebhookService, enqueueForEntry }
