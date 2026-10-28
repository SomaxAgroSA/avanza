/**
 * Servidor HTTP (Fastify): a API /api/v1 (tabela em route-table.js, ações em routes.js), o tempo
 * real (/api/realtime, SSE) e o frontend (build do web) com os cabeçalhos de segurança.
 *
 * `runtime` = { config, db, storage, realtime, log } — montado em src/server.js.
 */

const fs = require('node:fs')
const path = require('node:path')
const Fastify = require('fastify')
const { appError } = require('../core/errors')
const { ROUTES, MULTIPART } = require('./route-table')
const { renderPlatformError } = require('./handler')
const { createRateLimiter } = require('./rate-limit')

const FRONTEND_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"

const DEFAULT_BODY_LIMIT = 1024 * 1024
const MULTIPART_MAX_FILES = 20

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function readCookie(header, name) {
  const parts = String(header || '').split(';')
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim()
    if (part.indexOf(name + '=') === 0) {
      try {
        return decodeURIComponent(part.slice(name.length + 1))
      } catch (_) {
        return ''
      }
    }
  }
  return ''
}

/** Corpo multipart em memória: campos de texto e arquivos (até `limit` bytes no total). */
async function readMultipart(request, limit) {
  const fields = {}
  const files = []
  let total = 0
  if (!request.isMultipart()) return { fields, files }
  const parts = request.parts({ limits: { fileSize: limit, files: MULTIPART_MAX_FILES, fields: 50, fieldSize: DEFAULT_BODY_LIMIT } })
  for await (const part of parts) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer()
      total += buffer.length
      if (total > limit) throw Object.assign(new Error('multipart grande demais'), { statusCode: 413 })
      files.push({ field: part.fieldname, name: part.filename || 'arquivo', mime: part.mimetype || '', size: buffer.length, buffer })
    } else if (fields[part.fieldname] === undefined) {
      fields[part.fieldname] = String(part.value)
    }
  }
  return { fields, files }
}

/** Evento da requisição entregue às rotas (o que o handler e as ações usam). */
function createEvent(request, reply, runtime, routeLimit) {
  let multipart = null
  return {
    runtime,
    log: request.log,
    method: request.method,
    path: request.url.split('?')[0],
    header: (name) => String(firstValue(request.headers[String(name).toLowerCase()]) || ''),
    cookie: (name) => readCookie(request.headers.cookie, name),
    realIP: () => request.ip,
    body() {
      // multipart: os campos de texto valem como corpo (como o PocketBase fazia); lidos antes da ação
      if (multipart) return Object.assign({}, multipart.fields)
      const body = request.body
      if (body === undefined || body === null || body === '') return {}
      if (typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) throw appError('BAD_REQUEST', 'Invalid request body')
      return body
    },
    query() {
      const out = {}
      Object.keys(request.query || {}).forEach((key) => {
        out[key] = String(firstValue(request.query[key]) === undefined ? '' : firstValue(request.query[key]))
      })
      return out
    },
    param: (name) => String((request.params || {})[name] || ''),
    /** `{ fields, files }` do corpo multipart (lido uma vez). */
    async multipart() {
      if (!multipart) multipart = await readMultipart(request, routeLimit || DEFAULT_BODY_LIMIT)
      return multipart
    },
    setHeader: (name, value) => reply.header(name, value),
    setCookie(value) {
      const previous = reply.getHeader('set-cookie')
      reply.header('set-cookie', previous ? [].concat(previous, value) : value)
    },
    json: (status, payload) => reply.code(status).type('application/json; charset=utf-8').send(JSON.stringify(payload)),
    noContent: () => reply.code(204).send(),
    /** Resposta crua (arquivos): `body` pode ser Buffer ou stream. */
    send: (status, body) => reply.code(status).send(body),
    reply,
  }
}

function setFrontendHeaders(reply) {
  reply.header('Content-Security-Policy', FRONTEND_CSP)
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'DENY')
}

function trustProxyOption(value) {
  if (!value) return false
  if (value === 'true') return true
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

/**
 * @param {object} runtime
 * @param {object} [options] `logger` (padrão: pino do Fastify em JSON, nível info)
 */
function buildServer(runtime, options) {
  const opts = options || {}
  const { config } = runtime
  const app = Fastify({
    logger: opts.logger === undefined ? { level: config.isTest ? 'warn' : 'info' } : opts.logger,
    trustProxy: trustProxyOption(config.trustProxy),
    bodyLimit: DEFAULT_BODY_LIMIT,
    logController: new Fastify.LogController({ disableRequestLogging: true }),
    // erros de rota e de corpo saem no envelope (setErrorHandler / setNotFoundHandler abaixo)
    return503OnClosing: true,
  })
  const routes = require('./routes')
  const limiter = createRateLimiter(config.rateLimits)
  runtime.rateLimiter = limiter
  const sweep = setInterval(() => limiter.sweep(), 60000)
  sweep.unref()
  app.addHook('onClose', async () => clearInterval(sweep))

  app.register(require('@fastify/multipart'), { limits: { files: MULTIPART_MAX_FILES } })

  // cabeçalhos de segurança em toda resposta (os mesmos que o PocketBase punha); o frontend ganha a CSP
  app.addHook('onSend', (request, reply, payload, done) => {
    if (request.url.indexOf('/api/') !== 0 && !reply.hasHeader('content-security-policy')) setFrontendHeaders(reply)
    if (!reply.hasHeader('x-content-type-options')) reply.header('X-Content-Type-Options', 'nosniff')
    if (!reply.hasHeader('x-frame-options')) reply.header('X-Frame-Options', 'SAMEORIGIN')
    done(null, payload)
  })

  // JSON vazio vale {} (o PocketBase aceitava); outros tipos não viram corpo (CSRF e validação respondem)
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (!body || !body.trim()) return done(null, {})
    try {
      done(null, JSON.parse(body))
    } catch (_) {
      done(Object.assign(new Error('JSON inválido'), { statusCode: 400 }))
    }
  })
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (request, body, done) => done(null, undefined))

  // limite por IP antes de qualquer trabalho (inclusive do corpo)
  app.addHook('onRequest', (request, reply, done) => {
    const pathname = request.url.split('?')[0]
    const result = limiter.hit(request.method, pathname, request.ip)
    if (result.allowed) return done()
    reply.header('Retry-After', String(result.retryAfter))
    renderPlatformError(createEvent(request, reply, runtime), 429)
    return reply
  })

  ROUTES.forEach(([method, url, name, limit]) => {
    const action = routes[name]
    if (typeof action !== 'function') throw new Error(`Rota sem ação: ${method} ${url} → ${name}`)
    const multipart = MULTIPART.has(name)
    app.route({
      method,
      url,
      bodyLimit: multipart ? undefined : limit || DEFAULT_BODY_LIMIT,
      handler: async (request, reply) => {
        const event = createEvent(request, reply, runtime, limit)
        if (multipart && request.isMultipart()) {
          try {
            await event.multipart()
          } catch (err) {
            const status = err.statusCode === 413 || err.code === 'FST_REQ_FILE_TOO_LARGE' || err.code === 'FST_FILES_LIMIT' ? 413 : 400
            return renderPlatformError(event, status, err)
          }
        }
        return action(event)
      },
    })
  })

  // tempo real (mesmo protocolo do PocketBase que o web já usa)
  app.get('/api/realtime', (request, reply) => require('./realtime').connect(createEvent(request, reply, runtime)))
  app.post('/api/realtime', (request, reply) => require('./realtime').subscribe(createEvent(request, reply, runtime)))

  if (config.isTest) {
    // só nos testes: ajusta os limites por IP como a API de configurações do PocketBase fazia
    app.put('/api/_test/rate-limits', (request, reply) => {
      const body = request.body || {}
      limiter.configure(body.rules || config.rateLimits, body.enabled)
      reply.code(204).send()
    })
  }

  const hasFrontend = fs.existsSync(path.join(config.publicDir, 'index.html'))
  if (hasFrontend) {
    app.register(require('@fastify/static'), {
      root: config.publicDir,
      wildcard: true,
      index: ['index.html'],
    })
  }

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0]
    if (pathname.indexOf('/api/') === 0 || pathname === '/api') return renderPlatformError(createEvent(request, reply, runtime), 404)
    // arquivo que não existe (ex.: um módulo de uma versão anterior que a aba aberta ainda pede) é 404, nunca o
    // index.html — servido no lugar de um .js, ele quebra o carregamento e o web não percebe que deve recarregar
    if (pathname.indexOf('/assets/') === 0 || /\.[a-z0-9]{1,8}$/i.test(pathname)) {
      return reply.code(404).type('text/plain; charset=utf-8').send('Not found')
    }
    // SPA: qualquer outra rota GET abre o app (o roteador do web decide a tela)
    if (hasFrontend && (request.method === 'GET' || request.method === 'HEAD')) {
      setFrontendHeaders(reply)
      reply.header('Cache-Control', 'no-cache')
      return reply.sendFile('index.html')
    }
    return reply.code(404).type('text/plain; charset=utf-8').send('Not found')
  })

  app.setErrorHandler((err, request, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500
    if (status >= 500) request.log.error({ err }, 'erro inesperado')
    const pathname = request.url.split('?')[0]
    if (pathname.indexOf('/api/') !== 0) return reply.code(status).type('text/plain; charset=utf-8').send(status >= 500 ? 'Internal error' : 'Bad request')
    return renderPlatformError(createEvent(request, reply, runtime), status === 415 ? 400 : status, err)
  })

  return app
}

module.exports = { buildServer, createEvent, readCookie, FRONTEND_CSP }
