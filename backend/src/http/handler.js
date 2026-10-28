/**
 * Adaptador HTTP: converte requisições em chamadas de casos de uso e as respostas no envelope padrão
 * { data, meta, error }.
 *
 * Responsabilidades transversais aplicadas a toda rota /api/v1:
 * - Correlation ID (header X-Correlation-Id, devolvido na resposta e em `meta`);
 * - proteção CSRF (header X-Requested-With obrigatório em métodos que alteram estado);
 * - resolução da sessão (cookie HttpOnly) e exigência de autenticação;
 * - mapeamento de erros e log estruturado sem dados sensíveis.
 *
 * `e` é o evento da requisição montado pelo servidor (http/server.js): cabeçalhos, cookies, IP, corpo,
 * multipart e a resposta.
 */

const crypto = require('node:crypto')
const { appError, isAppError, toErrorPayload } = require('../core/errors')
const { success, failure } = require('../core/response')
const { createContainer } = require('../infrastructure/container')
const { resolveLocale } = require('../domain/content-locale')

const CORRELATION_PATTERN = /^[A-Za-z0-9-]{8,64}$/
const CSRF_HEADER = 'X-Requested-With'
const CSRF_VALUE = 'kamban'
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']
const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function randomString(length) {
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHANUMERIC[bytes[i] % ALPHANUMERIC.length]
  return out
}

function resolveCorrelationId(e) {
  const incoming = e.header('X-Correlation-Id')
  return CORRELATION_PATTERN.test(incoming) ? incoming : randomString(20)
}

function sessionCookie(config, value, maxAgeSeconds) {
  const parts = [`${config.cookie.name}=${value}`, 'Path=/api/', 'HttpOnly', 'SameSite=Strict']
  if (config.cookie.secure) parts.push('Secure')
  // Max-Age > 0: cookie persistente; < 0: apaga; 0: cookie de sessão do navegador (sem Max-Age)
  if (maxAgeSeconds > 0) parts.push(`Max-Age=${maxAgeSeconds}`)
  if (maxAgeSeconds < 0) parts.push('Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  return parts.join('; ')
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
  const attrs = { correlationId, method: e.method, path: e.path, status }
  if (status >= 500) {
    e.log.error(Object.assign(attrs, { error: String((err && err.stack) || (err && err.message) || err) }), 'api.v1 unexpected error')
  } else if (!isAppError(err) || status === 403) {
    e.log.warn(Object.assign(attrs, { code: isAppError(err) ? err.code : 'UNKNOWN' }), 'api.v1 request rejected')
  }
}

/** Contêiner da requisição: repositórios e casos de uso no idioma da tela. */
function containerFor(e) {
  // idioma da tela (o app envia Accept-Language): cadastros traduzidos saem nele
  return createContainer(e.runtime, { locale: resolveLocale(e.header('Accept-Language')) })
}

/**
 * Executa `action({ e, ctx, services, body, query, param, cookies })`.
 * `action` retorna (ou resolve) { data, meta?, status? } — ou { noContent: true } / { handled: true }.
 *
 * @param {object} options
 * @param {boolean} [options.auth=true] exige sessão válida
 */
async function handle(e, action, options) {
  const opts = options || {}
  const correlationId = resolveCorrelationId(e)
  e.setHeader('X-Correlation-Id', correlationId)
  e.setHeader('Cache-Control', 'no-store')

  try {
    const container = containerFor(e)
    const method = String(e.method).toUpperCase()
    const bearer = /^Bearer\s+(\S+)$/i.exec(e.header('Authorization') || '')
    let auth
    if (bearer) {
      // token de API: o cookie é ignorado e o CSRF não se aplica (não há credencial automática do navegador)
      auth = await container.apiTokens.authenticate(bearer[1], e.realIP())
      if (opts.auth !== false && !auth.principal) throw appError('API_TOKEN_INVALID')
    } else {
      if (SAFE_METHODS.indexOf(method) < 0 && e.header(CSRF_HEADER) !== CSRF_VALUE) {
        throw appError('CSRF_CHECK_FAILED')
      }
      const token = e.cookie(container.config.cookie.name)
      auth = await container.auth.authenticate(token)
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
      userAgent: e.header('User-Agent'),
      correlationId,
    }

    const result =
      (await action({
        e,
        ctx,
        services: container,
        body: () => e.body(),
        query: () => e.query(),
        param: (name) => e.param(name),
        cookies: {
          setSession: (value, expiresAtIso, persistent) => setSessionCookie(e, container.config, value, expiresAtIso, persistent),
          clearSession: () => clearSessionCookie(e, container.config),
        },
      })) || {}

    if (result.noContent) return e.noContent()
    // a ação já escreveu a resposta (ex.: download de arquivo)
    if (result.handled) return e.reply
    return e.json(result.status || 200, success(result.data, Object.assign({ correlationId }, result.meta || {})))
  } catch (err) {
    const payload = toErrorPayload(err)
    logError(e, correlationId, err, payload.status)
    return e.json(payload.status, failure(payload.error, { correlationId }))
  }
}

/**
 * Erros da própria plataforma HTTP (limite por IP, corpo grande demais, JSON inválido, rota
 * inexistente) no envelope padrão, para que a API /api/v1 tenha um formato de erro único.
 */
function renderPlatformError(e, status, err) {
  const correlationId = resolveCorrelationId(e)
  const codes = { 400: 'BAD_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'ROUTE_NOT_FOUND', 413: 'BAD_REQUEST', 429: 'RATE_LIMITED' }
  const code = codes[status] || 'INTERNAL_ERROR'
  const payload = toErrorPayload(appError(code))
  if (payload.status >= 500) logError(e, correlationId, err, payload.status)
  e.setHeader('X-Correlation-Id', correlationId)
  e.setHeader('Cache-Control', 'no-store')
  return e.json(status === 413 ? 413 : payload.status, failure(payload.error, { correlationId }))
}

module.exports = { handle, renderPlatformError, containerFor, resolveCorrelationId, randomString, CSRF_HEADER, CSRF_VALUE }
