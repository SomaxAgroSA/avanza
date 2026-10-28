/**
 * Repositórios Postgres dos webhooks: cadastros, entregas e o gancho no histórico — cada registro
 * gravado vira entrega para quem assina o evento (mesma transação). O POST e o HMAC ficam em
 * infrastructure/adapters.js.
 */

const { toDbDate, toJson, insertRow, updateRow, findRow, deleteRow } = require('../sql')
const { enqueueForEntry } = require('../../application/webhooks')

/** Texto para coluna NOT NULL DEFAULT '' (o PocketBase gravava '' para vazio). */
const text = (value) => (value === undefined || value === null ? '' : String(value))
/** Inteiro para coluna NOT NULL DEFAULT 0 (vazio/null do PocketBase era 0). */
const int = (value) => Math.trunc(Number(value) || 0)

/** Linha que precisa existir (o PocketBase lançava "no rows in result set" em findRecordById). */
function mustExist(row, table, id) {
  if (!row) throw new Error(`Registro não encontrado: ${table}/${id}`)
  return row
}

/** Limite opcional como o do PocketBase: 0/vazio = sem limite. */
const limitOf = (limit) => (limit > 0 ? limit : null)

function createWebhookRepository(db) {
  const TABLE = 'webhooks'
  const toEntity = (row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    events: row.events === null || row.events === undefined ? [] : row.events,
    secret: row.secret,
    active: row.active,
    lastStatus: row.last_status || null,
    lastDeliveryAt: row.last_delivery_at,
    consecutiveFailures: row.consecutive_failures,
    createdBy: row.created_by || null,
    createdAt: row.created,
  })
  const COLUMNS = {
    name: (v) => ['name', text(v)],
    url: (v) => ['url', text(v)],
    events: (v) => ['events', toJson(v)],
    secret: (v) => ['secret', text(v)],
    active: (v) => ['active', !!v],
    lastStatus: (v) => ['last_status', int(v)],
    consecutiveFailures: (v) => ['consecutive_failures', int(v)],
    lastDeliveryAt: (v) => ['last_delivery_at', toDbDate(v)],
  }
  function columnsOf(data) {
    const values = {}
    Object.keys(data).forEach((key) => {
      if (!COLUMNS[key]) return
      const [column, value] = COLUMNS[key](data[key])
      values[column] = value
    })
    return values
  }

  return {
    async list() {
      return (await db.query('SELECT * FROM webhooks ORDER BY created ASC, id ASC')).map(toEntity)
    },

    async listActive() {
      return (await db.query('SELECT * FROM webhooks WHERE active ORDER BY created ASC, id ASC')).map(toEntity)
    },

    async findById(id) {
      const row = await findRow(db, TABLE, id)
      return row ? toEntity(row) : null
    },

    async create(data) {
      const values = Object.assign(columnsOf(data), { created_by: data.createdBy || null, consecutive_failures: 0 })
      return toEntity(await insertRow(db, TABLE, values))
    },

    async update(id, patch) {
      return toEntity(mustExist(await updateRow(db, TABLE, id, columnsOf(patch)), TABLE, id))
    },

    /** As entregas saem junto (cascata). */
    async delete(id) {
      await deleteRow(db, TABLE, id)
    },
  }
}

function createWebhookDeliveryRepository(db) {
  const TABLE = 'webhook_deliveries'
  const toEntity = (row) => ({
    id: row.id,
    webhookId: row.webhook_id,
    event: row.event,
    payload: row.payload === null || row.payload === undefined ? {} : row.payload,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.response_status || null,
    responseBody: row.response_body,
    error: row.error,
    durationMs: row.duration_ms,
    nextAttemptAt: row.next_attempt_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created,
  })
  const TEXTS = { status: 'status', responseBody: 'response_body', error: 'error' }
  const INTS = { attempts: 'attempts', responseStatus: 'response_status', durationMs: 'duration_ms' }
  const DATES = { nextAttemptAt: 'next_attempt_at', deliveredAt: 'delivered_at' }

  return {
    async create(data) {
      const row = await insertRow(db, TABLE, {
        webhook_id: data.webhookId,
        event: text(data.event),
        payload: toJson(data.payload),
        status: 'pending',
        attempts: 0,
        next_attempt_at: toDbDate(data.nextAttemptAt),
      })
      return toEntity(row)
    },

    async findById(id) {
      const row = await findRow(db, TABLE, id)
      return row ? toEntity(row) : null
    },

    async listByWebhook(webhookId, limit) {
      const rows = await db.query('SELECT * FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created DESC, id DESC LIMIT $2', [webhookId, limitOf(limit)])
      return rows.map(toEntity)
    },

    async listDue(now, limit) {
      const rows = await db.query(
        "SELECT * FROM webhook_deliveries WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= $1) ORDER BY created ASC, id ASC LIMIT $2",
        [toDbDate(now), limitOf(limit)],
      )
      return rows.map(toEntity)
    },

    async update(id, patch) {
      const values = {}
      Object.keys(patch).forEach((key) => {
        if (TEXTS[key]) values[TEXTS[key]] = text(patch[key])
        else if (INTS[key]) values[INTS[key]] = int(patch[key])
        else if (DATES[key]) values[DATES[key]] = toDbDate(patch[key])
      })
      return toEntity(mustExist(await updateRow(db, TABLE, id, values), TABLE, id))
    },

    /** Entregas encerradas (sucesso ou falha) mais antigas que a data; as pendentes ficam. */
    async purgeBefore(date) {
      return db.exec("DELETE FROM webhook_deliveries WHERE status <> 'pending' AND created < $1", [toDbDate(date)])
    },
  }
}

/**
 * Histórico que também enfileira webhooks: cada registro do catálogo de eventos vira entrega para os
 * webhooks ativos que o assinam, na mesma transação do registro.
 */
function withWebhooks(auditRepository, repos) {
  return Object.assign({}, auditRepository, {
    async record(entry) {
      await auditRepository.record(entry)
      await enqueueForEntry(repos, entry, new Date())
    },
  })
}

module.exports = { createWebhookRepository, createWebhookDeliveryRepository, withWebhooks }
