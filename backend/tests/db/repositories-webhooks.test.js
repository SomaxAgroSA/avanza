const { describe, it, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { createTestDatabase } = require('../support/db-harness')
const { insertRow } = require('../../src/infrastructure/sql')
const core = require('../../src/infrastructure/repositories/core')
const webhooks = require('../../src/infrastructure/repositories/webhooks')

describe('repositórios dos webhooks (Postgres)', () => {
  let t
  let user
  let hooks
  let deliveries

  before(async () => {
    t = await createTestDatabase()
    const role = await t.db.one("SELECT id FROM roles WHERE code = 'ADMIN'")
    user = await insertRow(t.db, 'users', { email: 'webhooks@avanza.test', name: 'W', role_id: role.id, status: 'active' })
    hooks = webhooks.createWebhookRepository(t.db, {})
    deliveries = webhooks.createWebhookDeliveryRepository(t.db, {})
  })
  after(() => t.drop())
  beforeEach(() => t.db.exec('DELETE FROM webhooks'))

  /** "created" fixo: gravações no mesmo milissegundo empatariam na ordenação. */
  async function stamp(table, rows, base) {
    for (const [i, row] of rows.entries()) await t.db.exec(`UPDATE ${table} SET created = $2 WHERE id = $1`, [row.id, new Date((base || Date.UTC(2026, 9, 1)) + i * 1000)])
  }

  function newHook(data) {
    return hooks.create(Object.assign({ name: 'Integração', url: 'https://destino.test/hook', events: ['task.created'], secret: 'whsec_x', active: true, createdBy: user.id }, data))
  }

  it('cadastros: criam, listam (ativos e todos), atualizam e apagam com as entregas', async () => {
    const a = await newHook({ name: 'A', events: ['task.created', 'project.*'] })
    const b = await newHook({ name: 'B', active: false, createdBy: undefined, lastStatus: 500 })
    await stamp('webhooks', [a, b])
    assert.deepEqual(
      [a.name, a.url, a.events, a.secret, a.active, a.lastStatus, a.lastDeliveryAt, a.consecutiveFailures, a.createdBy],
      ['A', 'https://destino.test/hook', ['task.created', 'project.*'], 'whsec_x', true, null, null, 0, user.id],
    )
    assert.ok(a.createdAt instanceof Date)
    assert.deepEqual([b.createdBy, b.lastStatus], [null, 500])
    assert.deepEqual((await hooks.list()).map((w) => w.id), [a.id, b.id])
    assert.deepEqual((await hooks.listActive()).map((w) => w.id), [a.id])
    assert.equal(await hooks.findById('naoexiste000000'), null)

    const at = new Date('2026-10-28T12:00:00.000Z')
    const updated = await hooks.update(a.id, { lastStatus: 0, lastDeliveryAt: at, consecutiveFailures: 3, active: false, events: ['task.deleted'], ignored: 1 })
    assert.deepEqual([updated.lastStatus, updated.lastDeliveryAt.getTime(), updated.consecutiveFailures, updated.active, updated.events], [null, at.getTime(), 3, false, ['task.deleted']])
    assert.deepEqual(await hooks.listActive(), [])
    await assert.rejects(hooks.update('naoexiste000000', { name: 'x' }), /não encontrado/)

    await deliveries.create({ webhookId: a.id, event: 'task.deleted', payload: { id: 1 }, nextAttemptAt: at })
    await hooks.delete(a.id)
    assert.equal(await hooks.findById(a.id), null)
    assert.equal((await t.db.one('SELECT count(*) AS n FROM webhook_deliveries WHERE webhook_id = $1', [a.id])).n, 0)
  })

  it('entregas: fila dos vencidos, histórico por webhook, atualização e limpeza das encerradas', async () => {
    const hook = await newHook()
    const now = new Date('2026-10-28T12:00:00.000Z')
    const due1 = await deliveries.create({ webhookId: hook.id, event: 'task.created', payload: { event: 'task.created', data: { list: [1, 2] } }, nextAttemptAt: new Date(now.getTime() - 60000) })
    const due2 = await deliveries.create({ webhookId: hook.id, event: 'webhook.ping', payload: { ping: true }, nextAttemptAt: null })
    const future = await deliveries.create({ webhookId: hook.id, event: 'task.created', payload: {}, nextAttemptAt: new Date(now.getTime() + 60000) })
    const done = await deliveries.create({ webhookId: hook.id, event: 'task.created', payload: {}, nextAttemptAt: now })
    await stamp('webhook_deliveries', [due1, due2, future, done])
    assert.deepEqual(
      [due1.status, due1.attempts, due1.responseStatus, due1.responseBody, due1.error, due1.durationMs, due1.deliveredAt, due1.payload],
      ['pending', 0, null, '', '', 0, null, { event: 'task.created', data: { list: [1, 2] } }],
    )

    const delivered = await deliveries.update(done.id, { status: 'success', attempts: 1, responseStatus: 200, responseBody: 'ok', error: '', durationMs: 12.7, deliveredAt: now })
    assert.deepEqual([delivered.status, delivered.responseStatus, delivered.responseBody, delivered.durationMs, delivered.deliveredAt.getTime()], ['success', 200, 'ok', 12, now.getTime()])
    const failedConnect = await deliveries.update(future.id, { attempts: 1, responseStatus: 0, error: 'ECONNREFUSED' })
    assert.deepEqual([failedConnect.responseStatus, failedConnect.error, failedConnect.status], [null, 'ECONNREFUSED', 'pending'])

    assert.deepEqual((await deliveries.listDue(now, 50)).map((d) => d.id), [due1.id, due2.id])
    assert.deepEqual((await deliveries.listDue(now, 1)).map((d) => d.id), [due1.id])
    assert.deepEqual((await deliveries.listByWebhook(hook.id, 50)).map((d) => d.id), [done.id, future.id, due2.id, due1.id])
    assert.deepEqual((await deliveries.listByWebhook(hook.id, 2)).map((d) => d.id), [done.id, future.id])
    assert.equal((await deliveries.findById(due1.id)).webhookId, hook.id)
    assert.equal(await deliveries.findById('naoexiste000000'), null)

    // só as encerradas e anteriores à data saem; as pendentes ficam mesmo antigas
    await deliveries.update(due2.id, { status: 'failed' })
    assert.equal(await deliveries.purgeBefore(new Date(Date.UTC(2026, 9, 1, 0, 0, 1))), 0)
    assert.equal(await deliveries.purgeBefore(new Date(Date.UTC(2026, 9, 2))), 2)
    assert.deepEqual((await deliveries.listByWebhook(hook.id, 50)).map((d) => d.id), [future.id, due1.id])
  })

  describe('histórico com webhooks', () => {
    let repos
    before(() => {
      repos = {
        webhookRepository: hooks,
        webhookDeliveryRepository: deliveries,
      }
      repos.auditRepository = webhooks.withWebhooks(core.createAuditRepository(t.db, {}), repos)
    })

    const entry = (action) => ({ entityType: 'task', entityId: 't1', action, newValue: { title: 'Tarefa' }, userId: user.id, ip: '', userAgent: '', correlationId: '' })

    it('cada registro do catálogo vira entrega para os webhooks ativos que assinam o evento (na mesma transação)', async () => {
      const subscribed = await newHook({ name: 'Assina', events: ['task.created'] })
      const wildcard = await newHook({ name: 'Tudo de tarefa', events: ['task.*'] })
      await newHook({ name: 'Outro evento', events: ['project.created'] })
      await newHook({ name: 'Desligado', events: ['task.created'], active: false })

      await t.db.transaction(async () => {
        await repos.auditRepository.record(entry('task.created'))
        // dentro da transação a entrega já aparece
        assert.equal((await t.db.one('SELECT count(*) AS n FROM webhook_deliveries')).n, 2)
      })
      const rows = await t.db.query('SELECT webhook_id, event, status, payload FROM webhook_deliveries ORDER BY webhook_id')
      assert.deepEqual(rows.map((r) => r.webhook_id).sort(), [subscribed.id, wildcard.id].sort())
      assert.ok(rows.every((r) => r.event === 'task.created' && r.status === 'pending' && r.payload && typeof r.payload === 'object'))
      assert.ok(await t.db.one("SELECT id FROM audit_logs WHERE action = 'task.created'"))
      const due = await deliveries.listDue(new Date(Date.now() + 1000), 50)
      assert.equal(due.length, 2)

      // ações fora do catálogo só vão para o histórico
      await repos.auditRepository.record(entry('role.updated'))
      assert.equal((await t.db.one('SELECT count(*) AS n FROM webhook_deliveries')).n, 2)
      // as outras funções do histórico continuam lá
      assert.equal(typeof repos.auditRepository.list, 'function')
      assert.equal((await repos.auditRepository.list({ filters: { action: 'role.updated' }, pagination: { offset: 0, perPage: 5 } })).total, 1)
    })

    it('desfazer a transação desfaz o histórico e as entregas', async () => {
      await newHook({ events: ['task.deleted'] })
      await assert.rejects(
        t.db.transaction(async () => {
          await repos.auditRepository.record(entry('task.deleted'))
          throw new Error('desfaz')
        }),
        /desfaz/,
      )
      assert.equal((await t.db.one("SELECT count(*) AS n FROM audit_logs WHERE action = 'task.deleted'")).n, 0)
      assert.equal((await t.db.one('SELECT count(*) AS n FROM webhook_deliveries')).n, 0)
    })
  })
})
