/**
 * Transporte HTTP do servidor MCP (Model Context Protocol), para conectar o Claude ao Avanza:
 * "Streamable HTTP" sem estado — `POST /api/mcp` recebe uma mensagem JSON-RPC (ou um lote) e responde
 * em JSON; só notificações → 202 sem corpo. Não há fluxo SSE do servidor nem sessão (`GET`/`DELETE`
 * → 405). O protocolo e as ferramentas ficam em src/mcp/.
 *
 * Acesso só com **token de API pessoal** (`Authorization: Bearer kb_pat_…`, o mesmo da API /api/v1):
 * o cookie do navegador não vale aqui, então não há CSRF. Requisição de navegador vinda de outro
 * endereço (header `Origin` diferente do host pedido — ex.: DNS rebinding) é recusada, como pede a
 * especificação.
 */

const { createMcpServer, rpcError, PROTOCOL_VERSIONS, RPC } = require('../mcp/protocol')
const { TOOLS, INSTRUCTIONS } = require('../mcp/tools')
const { ERROR_DEFINITIONS } = require('../core/errors')
const { containerFor, resolveCorrelationId } = require('./handler')

const MCP_PATH = '/api/mcp'
const BODY_LIMIT = 1024 * 1024
const JSON_TYPE = 'application/json; charset=utf-8'

function header(request, name) {
  const value = request.headers[String(name).toLowerCase()]
  return String((Array.isArray(value) ? value[0] : value) || '')
}

function send(reply, status, payload) {
  return reply.code(status).type(JSON_TYPE).send(JSON.stringify(payload))
}

/** Sem `Origin` (clientes MCP, scripts) ou do próprio endereço; `request.host` segue o proxy confiável. */
function allowedOrigin(request) {
  const origin = header(request, 'Origin')
  if (!origin) return true
  try {
    return new URL(origin).host === request.host
  } catch (_) {
    return false
  }
}

function methodNotAllowed(request, reply) {
  reply.header('Allow', 'POST')
  return send(reply, 405, rpcError(null, RPC.INVALID_REQUEST, 'Method not allowed: use POST'))
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {object} runtime { config, db, storage, … } — o mesmo das rotas /api/v1
 */
function register(app, runtime) {
  const server = createMcpServer({
    tools: TOOLS,
    instructions: INSTRUCTIONS,
    serverInfo: { name: 'avanza', title: 'Avanza', version: runtime.config.appVersion },
  })

  async function handlePost(request, reply) {
    const e = { runtime, header: (name) => header(request, name) }
    const correlationId = resolveCorrelationId(e)
    reply.header('X-Correlation-Id', correlationId)
    reply.header('Cache-Control', 'no-store')

    if (!allowedOrigin(request)) return send(reply, 403, rpcError(null, RPC.INVALID_REQUEST, 'Origin not allowed'))
    const version = header(request, 'MCP-Protocol-Version')
    if (version && PROTOCOL_VERSIONS.indexOf(version) < 0) return send(reply, 400, rpcError(null, RPC.INVALID_REQUEST, `Unsupported protocol version: ${version}`))

    const container = containerFor(e)
    const bearer = /^Bearer\s+(\S+)$/i.exec(header(request, 'Authorization'))
    const auth = bearer ? await container.apiTokens.authenticate(bearer[1], request.ip) : { principal: null }
    if (!auth.principal) {
      reply.header('WWW-Authenticate', 'Bearer realm="Avanza"')
      const code = bearer ? 'API_TOKEN_INVALID' : 'UNAUTHENTICATED'
      return send(reply, 401, rpcError(null, RPC.INVALID_REQUEST, ERROR_DEFINITIONS[code].message))
    }

    let payload
    try {
      payload = JSON.parse(typeof request.body === 'string' ? request.body : '')
    } catch (_) {
      return send(reply, 400, rpcError(null, RPC.PARSE_ERROR, 'Parse error'))
    }

    const ctx = {
      principal: auth.principal,
      session: null,
      authMethod: 'token',
      ip: request.ip,
      userAgent: header(request, 'User-Agent'),
      correlationId,
    }
    const response = await server.handlePayload(payload, { services: container, ctx, log: request.log.child({ correlationId }) })
    if (!response) return reply.code(202).send()
    return send(reply, 200, response)
  }

  app.register(async (scope) => {
    // o corpo chega como texto: JSON inválido vira o erro do JSON-RPC (-32700), não o envelope da API
    scope.removeContentTypeParser('application/json')
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => done(null, body))
    scope.setErrorHandler((err, request, reply) => {
      const status = err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500
      if (status >= 500) request.log.error({ err }, 'mcp unexpected error')
      const message = status === 413 ? 'Request too large' : status >= 500 ? 'Internal error' : 'Bad request'
      return send(reply, status, rpcError(null, status >= 500 ? RPC.INTERNAL_ERROR : RPC.INVALID_REQUEST, message))
    })
    scope.post(MCP_PATH, { bodyLimit: BODY_LIMIT }, handlePost)
    scope.get(MCP_PATH, methodNotAllowed)
    scope.delete(MCP_PATH, methodNotAllowed)
  })
}

module.exports = { register, MCP_PATH }
