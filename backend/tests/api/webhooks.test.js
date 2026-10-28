/**
 * Webhooks — API contra um PocketBase real e isolado, entregando para um receptor HTTP local:
 * permissão, validação do endereço, evento do histórico vira entrega, POST assinado (HMAC conferido com
 * o crypto do Node), teste, falha do destino, novo segredo e exclusão.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const crypto = require('node:crypto')
const { startServer, createClient } = require('../support/server-harness')

function startReceiver() {
  const requests = []
  let status = 200
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      requests.push({ headers: req.headers, body, url: req.url })
      res.writeHead(status, { 'Content-Type': 'text/plain' })
      res.end(status === 200 ? 'ok' : 'erro do destino')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}/kamban`,
        requests,
        respond: (code) => {
          status = code
        },
        stop: () => new Promise((r) => server.close(() => r())),
      }),
    )
  })
}

const sign = (secret, ts, body) => crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')

describe('API Webhooks', { timeout: 180000 }, () => {
  let pb
  let receiver
  let root
  let gestor
  let project
  let doc

  before(async () => {
    pb = await startServer()
    receiver = await startReceiver()
    root = createClient(pb.api)
    await root.login(pb.admin.email, pb.admin.password)
    const roles = (await root.get('/roles')).body.data
    await root.post('/users', { name: 'Gil', email: 'gil@example.com', password: 'SenhaTeste123', role_id: roles.find((r) => r.code === 'MANAGER').id })
    gestor = createClient(pb.api)
    await gestor.login('gil@example.com', 'SenhaTeste123')
    project = (await root.post('/projects', { name: 'CRM', key: 'CRM' })).body.data
    doc = (await root.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO')
  })

  after(async () => {
    if (pb) await pb.stop()
    if (receiver) await receiver.stop()
  })

  let hook

  it('cadastro: só integrations.manage; endereço validado; o segredo vem só na criação', async () => {
    assert.equal((await gestor.get('/settings/webhooks')).status, 403)
    const blocked = await root.post('/settings/webhooks', { name: 'X', url: 'http://169.254.169.254/latest', events: ['task.*'] })
    assert.equal(blocked.status, 400)
    assert.equal(blocked.body.error.details.fields.url, 'blocked_host')
    assert.equal((await root.post('/settings/webhooks', { name: 'X', url: receiver.url, events: ['auth.login'] })).body.error.details.fields.events, 'invalid_option')
    const created = await root.post('/settings/webhooks', { name: 'CRM externo', url: receiver.url, events: ['task.*'] })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.match(created.body.data.secret, /^whsec_[A-Za-z0-9]{32}$/)
    hook = created.body.data
    const listed = (await root.get('/settings/webhooks')).body.data
    assert.equal(JSON.stringify(listed).includes(hook.secret), false)
    const catalog = (await root.get('/settings/webhooks/events')).body.data
    assert.ok(catalog.events.includes('task.created'))
  })

  it('evento do catálogo vira entrega; o POST chega assinado e o HMAC confere', async () => {
    const task = (await root.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: 'Avisar o CRM' })).body.data
    const deliveries = (await root.get(`/settings/webhooks/${hook.id}/deliveries`)).body.data
    const delivery = deliveries.find((d) => d.event === 'task.created')
    assert.ok(delivery, JSON.stringify(deliveries))
    // envia já (a rotina por minuto também enviaria)
    const sent = await root.post(`/settings/webhook-deliveries/${delivery.id}/redeliver`)
    assert.equal(sent.status, 200, JSON.stringify(sent.body))
    assert.equal(sent.body.data.status, 'success')
    const request = receiver.requests.find((r) => r.headers['x-kamban-delivery'] === delivery.id)
    assert.ok(request)
    assert.equal(request.headers['x-kamban-event'], 'task.created')
    assert.equal(request.headers['content-type'], 'application/json')
    const ts = request.headers['x-kamban-timestamp']
    assert.equal(request.headers['x-kamban-signature'], `sha256=${sign(hook.secret, ts, request.body)}`)
    const body = JSON.parse(request.body)
    assert.equal(body.id, delivery.id)
    assert.equal(body.event, 'task.created')
    assert.deepEqual(body.entity, { type: 'task', id: task.id })
    assert.equal(body.data.title, 'Avisar o CRM')
  })

  it('fora do catálogo não dispara; teste mostra a resposta do destino; destino com erro conta falha', async () => {
    const before = (await root.get(`/settings/webhooks/${hook.id}/deliveries`)).body.data.length
    await createClient(pb.api).login('gil@example.com', 'SenhaTeste123')
    assert.equal((await root.get(`/settings/webhooks/${hook.id}/deliveries`)).body.data.length, before)

    const ok = (await root.post(`/settings/webhooks/${hook.id}/test`)).body.data
    assert.equal(ok.event, 'webhook.ping')
    assert.equal(ok.status, 'success')
    receiver.respond(500)
    const failed = (await root.post(`/settings/webhooks/${hook.id}/test`)).body.data
    assert.equal(failed.status, 'failed')
    assert.equal(failed.response_status, 500)
    receiver.respond(200)
    const saved = (await root.get('/settings/webhooks')).body.data.find((w) => w.id === hook.id)
    assert.equal(saved.last_status, 500)
    assert.equal(saved.consecutive_failures, 1)
  })

  it('novo segredo passa a assinar; excluir apaga as entregas', async () => {
    const { secret } = (await root.post(`/settings/webhooks/${hook.id}/rotate-secret`)).body.data
    assert.notEqual(secret, hook.secret)
    const ping = (await root.post(`/settings/webhooks/${hook.id}/test`)).body.data
    const request = receiver.requests.find((r) => r.headers['x-kamban-delivery'] === ping.id)
    assert.equal(request.headers['x-kamban-signature'], `sha256=${sign(secret, request.headers['x-kamban-timestamp'], request.body)}`)
    const history = (await root.get('/audit-logs?entity_type=webhook')).body.data
    assert.equal(JSON.stringify(history).includes(secret), false)

    assert.equal((await root.del(`/settings/webhooks/${hook.id}`)).status, 200)
    assert.equal((await root.get(`/settings/webhooks/${hook.id}/deliveries`)).body.error.code, 'WEBHOOK_NOT_FOUND')
  })
})
