/**
 * Infraestrutura dos webhooks: cadastros, entregas, cliente HTTP ($http) e HMAC ($security), e o
 * gancho no histórico — cada registro gravado vira entrega para quem assina o evento (mesma transação).
 */

const { toDate, toPbDate, findOrNull } = require('./pb-helpers')

function parseJson(record, field, fallback) {
  const raw = record.getString(field)
  if (!raw || raw === 'null') return fallback
  try {
    return JSON.parse(raw)
  } catch (_) {
    return fallback
  }
}

function createWebhookRepository(app) {
  const COLLECTION = 'webhooks'
  const toEntity = (record) => ({
    id: record.id,
    name: record.getString('name'),
    url: record.getString('url'),
    events: parseJson(record, 'events', []),
    secret: record.getString('secret'),
    active: record.getBool('active'),
    lastStatus: record.getInt('last_status') || null,
    lastDeliveryAt: toDate(record.getDateTime('last_delivery_at')),
    consecutiveFailures: record.getInt('consecutive_failures'),
    createdBy: record.getString('created_by') || null,
    createdAt: toDate(record.getDateTime('created')),
  })
  const FIELDS = { name: 'name', url: 'url', events: 'events', secret: 'secret', active: 'active', lastStatus: 'last_status', consecutiveFailures: 'consecutive_failures' }
  function apply(record, data) {
    Object.keys(data).forEach((key) => {
      if (FIELDS[key]) record.set(FIELDS[key], data[key])
      else if (key === 'lastDeliveryAt') record.set('last_delivery_at', toPbDate(data[key]))
    })
  }
  return {
    list() {
      return app.findRecordsByFilter(COLLECTION, '', 'created', 0, 0).map(toEntity)
    },
    listActive() {
      return app.findRecordsByFilter(COLLECTION, 'active = true', 'created', 0, 0).map(toEntity)
    },
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      apply(record, data)
      record.set('created_by', data.createdBy || '')
      record.set('consecutive_failures', 0)
      app.save(record)
      return toEntity(record)
    },
    update(id, patch) {
      const record = app.findRecordById(COLLECTION, id)
      apply(record, patch)
      app.save(record)
      return toEntity(record)
    },
    delete(id) {
      app.delete(app.findRecordById(COLLECTION, id))
    },
  }
}

function createWebhookDeliveryRepository(app) {
  const COLLECTION = 'webhook_deliveries'
  const toEntity = (record) => ({
    id: record.id,
    webhookId: record.getString('webhook_id'),
    event: record.getString('event'),
    payload: parseJson(record, 'payload', {}),
    status: record.getString('status'),
    attempts: record.getInt('attempts'),
    responseStatus: record.getInt('response_status') || null,
    responseBody: record.getString('response_body'),
    error: record.getString('error'),
    durationMs: record.getInt('duration_ms'),
    nextAttemptAt: toDate(record.getDateTime('next_attempt_at')),
    deliveredAt: toDate(record.getDateTime('delivered_at')),
    createdAt: toDate(record.getDateTime('created')),
  })
  const FIELDS = { status: 'status', attempts: 'attempts', responseStatus: 'response_status', responseBody: 'response_body', error: 'error', durationMs: 'duration_ms' }
  const DATES = { nextAttemptAt: 'next_attempt_at', deliveredAt: 'delivered_at' }
  return {
    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('webhook_id', data.webhookId)
      record.set('event', data.event)
      record.set('payload', data.payload)
      record.set('status', 'pending')
      record.set('attempts', 0)
      record.set('next_attempt_at', toPbDate(data.nextAttemptAt))
      app.save(record)
      return toEntity(record)
    },
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    listByWebhook(webhookId, limit) {
      return app.findRecordsByFilter(COLLECTION, 'webhook_id = {:w}', '-created', limit, 0, { w: webhookId }).map(toEntity)
    },
    listDue(now, limit) {
      return app
        .findRecordsByFilter(COLLECTION, "status = 'pending' && (next_attempt_at = '' || next_attempt_at <= {:now})", 'created', limit, 0, { now: toPbDate(now) })
        .map(toEntity)
    },
    update(id, patch) {
      const record = app.findRecordById(COLLECTION, id)
      Object.keys(patch).forEach((key) => {
        if (FIELDS[key]) record.set(FIELDS[key], patch[key])
        else if (DATES[key]) record.set(DATES[key], toPbDate(patch[key]))
      })
      app.save(record)
      return toEntity(record)
    },
    /** Entregas encerradas (sucesso ou falha) mais antigas que a data; as pendentes ficam. */
    purgeBefore(date) {
      const c = toPbDate(date)
      const total = app.countRecords(COLLECTION, $dbx.exp("status != 'pending' AND created < {:c}", { c }))
      if (total > 0) app.db().newQuery("DELETE FROM webhook_deliveries WHERE status != 'pending' AND created < {:c}").bind({ c }).execute()
      return total
    },
  }
}

/** POST com tempo limite; `status` 0 nunca volta — falha de conexão lança. */
function createHttpClient() {
  return {
    post(url, body, headers, timeoutSeconds) {
      const res = $http.send({ url, method: 'POST', body, headers, timeout: timeoutSeconds })
      let text = ''
      try {
        text = toString(res.body)
      } catch (_) {
        text = ''
      }
      return { status: res.statusCode, body: text }
    },
  }
}

function createCrypto() {
  return {
    hmacSha256Hex(secret, data) {
      return $security.hs256(data, secret)
    },
  }
}

/**
 * Histórico que também enfileira webhooks: cada registro do catálogo de eventos vira entrega para os
 * webhooks ativos que o assinam, na mesma transação do registro.
 */
function withWebhooks(auditRepository, repos) {
  const { enqueueForEntry } = require('../application/webhooks')
  return Object.assign({}, auditRepository, {
    record(entry) {
      auditRepository.record(entry)
      enqueueForEntry(repos, entry, new Date())
    },
  })
}

function createWebhookRepositories(app) {
  return {
    webhookRepository: createWebhookRepository(app),
    webhookDeliveryRepository: createWebhookDeliveryRepository(app),
  }
}

module.exports = { createWebhookRepositories, createHttpClient, createCrypto, withWebhooks }
