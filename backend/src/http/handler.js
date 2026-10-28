/**
 * Adaptador HTTP: converte requisições do PocketBase em chamadas de casos de uso
 * e as respostas no envelope padrão { data, meta, error }.
 *
 * Responsabilidades transversais aplicadas a toda rota /api/v1:
 * - Correlation ID (header X-Correlation-Id, devolvido na resposta e em `meta`);
 * - proteção CSRF (header X-Requested-With obrigatório em métodos que alteram estado);
 * - resolução da sessão (cookie HttpOnly) e exigência de autenticação;
 * - mapeamento de erros e log estruturado sem dados sensíveis.
 */

const { appError, isAppError, toErrorPayload } = require('../core/errors')
const { success, failure } = require('../core/response')
const { toPlain } = require('../infrastructure/pb-helpers')
const { createContainer } = require('../infrastructure/container')
const { resolveLocale } = require('../domain/content-locale')

const CORRELATION_PATTERN = /^[A-Za-z0-9-]{8,64}$/
const CSRF_HEADER = 'X-Requested-With'
const CSRF_VALUE = 'kamban'
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

function header(e, name) {
  return e.request.header.get(name) || ''
}

function resolveCorrelationId(e) {
  const incoming = header(e, 'X-Correlation-Id')
  return CORRELATION_PATTERN.test(incoming) ? incoming : $security.randomString(20)
}

function readCookie(e, name) {
  try {
    const cookie = e.request.cookie(name)
    return cookie ? cookie.value : ''
  } catch (_) {
    return '' // http.ErrNoCookie
  }
}

function readBody(e) {
  try {
    return toPlain(e.requestInfo().body) || {}
  } catch (_) {
    throw appError('BAD_REQUEST', 'Invalid request body')
  }
}

function readQuery(e) {
  return toPlain(e.requestInfo().query) || {}
}

function sessionCookie(config, value, maxAgeSeconds) {
  return new Cookie({
    name: config.cookie.name,
    value: value,
    path: '/api/',
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: 3, // http.SameSiteStrictMode
    maxAge: maxAgeSeconds,
  })
}

function setSessionCookie(e, config, token, expiresAtIso, persistent) {
  // Sessão não persistente => cookie de sessão do navegador (sem Max-Age).
  const maxAge = persistent ? Math.max(1, Math.floor((new Date(expiresAtIso).getTime() - Date.now()) / 1000)) : 0
  e.setCookie(sessionCookie(config, token, maxAge))
}

function clearSessionCookie(e, config) {
  e.setCookie(sessionCookie(config, '', -1))
}

function logError(e, correlationId, err, status) {
  const message = String((err && err.message) || err)
  const attrs = ['correlationId', correlationId, 'method', e.request.method, 'path', e.request.url.path, 'status', status]
  if (status >= 500) {
    $app.logger().error('api.v1 unexpected error', ...attrs.concat(['error', message]))
  } else if (!isAppError(err) || status === 403) {
    $app.logger().warn('api.v1 request rejected', ...attrs.concat(['code', isAppError(err) ? err.code : 'UNKNOWN']))
  }
}

/**
 * Executa `action({ e, ctx, services, body, query, param, cookies })`.
 * `action` retorna { data, meta?, status? } — ou { noContent: true }.
 *
 * @param {object} options
 * @param {boolean} [options.auth=true] exige sessão válida
 */
function handle(e, action, options) {
  const opts = options || {}
  const correlationId = resolveCorrelationId(e)
  e.response.header().set('X-Correlation-Id', correlationId)
  e.response.header().set('Cache-Control', 'no-store')

  let container = null
  try {
    // idioma da tela (o app envia Accept-Language): cadastros traduzidos saem nele
    container = createContainer($app, { locale: resolveLocale(header(e, 'Accept-Language')) })
    const method = String(e.request.method).toUpperCase()
    const bearer = /^Bearer\s+(\S+)$/i.exec(header(e, 'Authorization') || '')
    let auth
    if (bearer) {
      // token de API: o cookie é ignorado e o CSRF não se aplica (não há credencial automática do navegador)
      auth = container.apiTokens.authenticate(bearer[1], e.realIP())
      if (opts.auth !== false && !auth.principal) throw appError('API_TOKEN_INVALID')
    } else {
      if (SAFE_METHODS.indexOf(method) < 0 && header(e, CSRF_HEADER) !== CSRF_VALUE) {
        throw appError('CSRF_CHECK_FAILED')
      }
      const token = readCookie(e, container.config.cookie.name)
      auth = container.auth.authenticate(token)
      // rotas públicas não mexem na sessão: a identidade da plataforma carrega junto com o /auth/me, e
      // limpar o cookie aqui faria o /auth/me perder o motivo "sessão expirada" (vira "sem sessão")
      if (token && !auth.principal && opts.auth !== false) clearSessionCookie(e, container.config)
      if (opts.auth !== false && !auth.principal) throw appError(token ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED')
    }

    const ctx = {
      principal: auth.principal,
      session: bearer ? null : auth.session,
      authMethod: bearer ? 'token' : 'session',
      ip: e.realIP(),
      userAgent: header(e, 'User-Agent'),
      correlationId,
    }

    const result =
      action({
        e,
        ctx,
        services: container,
        body: () => readBody(e),
        query: () => readQuery(e),
        param: (name) => e.request.pathValue(name),
        cookies: {
          setSession: (value, expiresAtIso, persistent) =>
            setSessionCookie(e, container.config, value, expiresAtIso, persistent),
          clearSession: () => clearSessionCookie(e, container.config),
        },
      }) || {}

    if (result.noContent) return e.noContent(204)
    // a ação já escreveu a resposta (ex.: download de arquivo)
    if (result.handled) return null
    return e.json(result.status || 200, success(result.data, Object.assign({ correlationId }, result.meta || {})))
  } catch (err) {
    const payload = toErrorPayload(err)
    logError(e, correlationId, err, payload.status)
    return e.json(payload.status, failure(payload.error, { correlationId }))
  }
}

/**
 * Converte erros gerados pelo próprio PocketBase (rate limit, body limit, 404 de rota)
 * no envelope padrão, para que a API /api/v1 tenha um formato de erro único.
 */
function renderPlatformError(e, err) {
  const correlationId = resolveCorrelationId(e)
  const raw = err && err.value ? err.value : err
  const status = raw && typeof raw.status === 'number' ? raw.status : 500
  const codes = { 400: 'BAD_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'ROUTE_NOT_FOUND', 413: 'BAD_REQUEST', 429: 'RATE_LIMITED' }
  const code = codes[status] || 'INTERNAL_ERROR'
  const payload = toErrorPayload(appError(code))
  if (payload.status >= 500) logError(e, correlationId, err, payload.status)
  e.response.header().set('X-Correlation-Id', correlationId)
  return e.json(status === 413 ? 413 : payload.status, failure(payload.error, { correlationId }))
}

module.exports = { handle, renderPlatformError, CSRF_HEADER, CSRF_VALUE }
