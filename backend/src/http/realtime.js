/**
 * Ganchos do tempo real (registrados em main.pb.js):
 * - `authorizeSubscriptions`: cada POST /api/realtime (assinaturas da conexão SSE) passa pela sessão
 *   do cookie e pela verificação de CSRF; ficam só os tópicos que a pessoa pode ver. A conexão fica
 *   presa à pessoa (outra sessão não reaproveita o mesmo clientId).
 * - `recordChanged`: depois de gravado (e da transação confirmada), avisa o tópico do projeto/pessoa.
 */

const { CSRF_HEADER, CSRF_VALUE } = require('./handler')

const CLIENT_USER_KEY = 'kamban_user'

/** Valor de um cookie no cabeçalho Cookie cru (neste evento a requisição chega só por requestInfo). */
function cookieValue(raw, name) {
  const parts = String(raw || '').split(';')
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim()
    if (part.indexOf(name + '=') === 0) return decodeURIComponent(part.slice(name.length + 1))
  }
  return ''
}

function authorizeSubscriptions(e) {
  // painel do PocketBase (superusuário com o token dele): segue as regras nativas
  if (e.auth && typeof e.auth.isSuperuser === 'function' && e.auth.isSuperuser()) return e.next()
  // cancelar todas as assinaturas não precisa de sessão
  if (!e.subscriptions || e.subscriptions.length === 0) return e.next()

  const { createContainer } = require(`${__hooks}/src/infrastructure/container.js`)
  const container = createContainer($app)
  const headers = e.requestInfo().headers
  // cabeçalhos normalizados pelo PocketBase: minúsculos e com _ no lugar de -
  if (headers[CSRF_HEADER.toLowerCase().replace(/-/g, '_')] !== CSRF_VALUE) throw new ForbiddenError('CSRF_CHECK_FAILED')
  const token = cookieValue(headers.cookie, container.config.cookie.name)
  const auth = container.auth.authenticate(token)
  if (!auth.principal) throw new UnauthorizedError('UNAUTHENTICATED')
  const bound = e.client.get(CLIENT_USER_KEY)
  if (bound && bound !== auth.principal.userId) throw new ForbiddenError('FORBIDDEN')

  const result = container.realtime.authorize({ principal: auth.principal }, Array.from(e.subscriptions))
  e.client.set(CLIENT_USER_KEY, auth.principal.userId)
  e.subscriptions = result.allowed
  return e.next()
}

function recordChanged(e, action) {
  e.next()
  try {
    const { changeFromRecord, broadcast } = require(`${__hooks}/src/infrastructure/realtime.js`)
    const change = changeFromRecord(e.record, action)
    if (!change) return
    const { createContainer } = require(`${__hooks}/src/infrastructure/container.js`)
    const event = createContainer($app).realtime.eventFor(change)
    if (event) broadcast($app, event)
  } catch (err) {
    // aviso em tempo real nunca derruba a operação que já foi gravada
    $app.logger().warn('kamban: tempo real', 'error', String((err && err.message) || err))
  }
}

/** Rotina (main.pb.js): mantém as conexões vivas abaixo do limite de 5 min sem mensagens. */
function keepAlive() {
  require(`${__hooks}/src/infrastructure/realtime.js`).keepAlive($app)
}

module.exports = { authorizeSubscriptions, recordChanged, keepAlive }
