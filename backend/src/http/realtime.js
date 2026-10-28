/**
 * Rotas do tempo real (mesmo protocolo SSE do PocketBase, que o web já usa):
 * - GET /api/realtime abre a conexão e manda PB_CONNECT com o clientId;
 * - POST /api/realtime { clientId, subscriptions } troca as assinaturas. Passa pela sessão do cookie e
 *   pela verificação de CSRF; ficam só os tópicos que a pessoa pode ver. A conexão fica presa à pessoa
 *   (outra sessão não reaproveita o mesmo clientId). Lista vazia cancela tudo e não exige sessão.
 */

const { appError, toErrorPayload } = require('../core/errors')
const { failure } = require('../core/response')
const { containerFor, CSRF_HEADER, CSRF_VALUE } = require('./handler')

function connect(e) {
  const hub = e.runtime.realtime
  const raw = e.reply.raw
  e.reply.hijack()
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    // proxies (nginx) não seguram os eventos em buffer
    'X-Accel-Buffering': 'no',
  })
  const client = hub.add((text) => raw.write(text))
  const close = () => hub.remove(client.id)
  raw.on('close', close)
  raw.on('error', close)
}

function reject(e, code) {
  const payload = toErrorPayload(appError(code))
  return e.json(payload.status, failure(payload.error, {}))
}

async function subscribe(e) {
  const hub = e.runtime.realtime
  const body = e.body()
  const client = hub.get(String(body.clientId || ''))
  if (!client) return reject(e, 'NOT_FOUND')
  const topics = Array.isArray(body.subscriptions) ? body.subscriptions.map(String) : []
  // cancelar todas as assinaturas não precisa de sessão
  if (topics.length === 0) {
    client.subscriptions = new Set()
    return e.noContent()
  }
  if (e.header(CSRF_HEADER) !== CSRF_VALUE) return reject(e, 'CSRF_CHECK_FAILED')
  try {
    const container = containerFor(e)
    const auth = await container.auth.authenticate(e.cookie(container.config.cookie.name))
    if (!auth.principal) return reject(e, 'UNAUTHENTICATED')
    if (client.userId && client.userId !== auth.principal.userId) return reject(e, 'FORBIDDEN')
    const result = await container.realtime.authorize({ principal: auth.principal }, topics)
    client.userId = auth.principal.userId
    client.subscriptions = new Set(result.allowed)
    return e.noContent()
  } catch (err) {
    const payload = toErrorPayload(err)
    if (payload.status >= 500) e.log.error({ err }, 'tempo real: assinatura falhou')
    return e.json(payload.status, failure(payload.error, {}))
  }
}

module.exports = { connect, subscribe }
