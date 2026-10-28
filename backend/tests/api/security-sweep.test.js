/**
 * Varredura de segurança (Fase 9): percorre TODAS as rotas registradas (http/route-table.js).
 * - sem sessão, só health, openapi.json, login e a identidade da plataforma respondem; o resto é 401;
 * - com sessão, toda mutação sem o header CSRF é recusada (403 CSRF_CHECK_FAILED);
 * - nenhuma rota fora da /api/v1 (como a antiga API genérica do PocketBase) entrega dados;
 * - respostas da API saem com os cabeçalhos de segurança.
 * Uma rota nova entra automaticamente na varredura.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')
const { ROUTES } = require('../../src/http/route-table')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 50000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 50000 },
]

const PUBLIC = [
  'GET /api/v1/health',
  'GET /api/v1/openapi.json',
  'POST /api/v1/auth/login',
  // identidade da plataforma (Configurador geral): a tela de login e a aba do navegador precisam dela sem sessão
  'GET /api/v1/platform',
  'GET /api/v1/platform/branding/{slot}',
  // links de senha por e-mail: quem esqueceu a senha não tem sessão
  'POST /api/v1/auth/password-reset/request',
  'GET /api/v1/auth/password-reset/check',
  'POST /api/v1/auth/password-reset/confirm',
]
const MUTATIONS = ['POST', 'PUT', 'PATCH', 'DELETE']

/** Rotas registradas no servidor (http/route-table.js), com os parâmetros no formato {nome}. */
function registeredRoutes() {
  return ROUTES.map(([method, url]) => ({ method, path: url.replace(/:([a-zA-Z]+)/g, (_, name) => `{${name}}`) })).filter((r) => r.path.startsWith('/api/v1/'))
}

// ids com formato válido, mas inexistentes
const concrete = (p) => p.replace(/\{[^}]+\}/g, 'abcdefghijk1234')

describe('API — varredura de segurança', { timeout: 300000 }, () => {
  let pb
  let admin
  let member
  const routes = registeredRoutes()

  before(async () => {
    pb = await startServer()
    await pb.updateSettings({ rateLimits: { enabled: true, rules: RULES } })
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    await admin.post('/users', { name: 'Mário', email: 'mario@example.com', password: 'SenhaTeste123', role_id: roles.find((r) => r.code === 'MEMBER').id })
    member = createClient(pb.api)
    await member.login('mario@example.com', 'SenhaTeste123')
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('encontrou as rotas registradas', () => {
    assert.ok(routes.length > 80, `só ${routes.length} rotas encontradas`)
  })

  it('sem sessão, toda rota que não é pública responde 401', async () => {
    const anon = createClient(pb.api)
    const failures = []
    for (const route of routes) {
      const key = `${route.method} ${route.path}`
      if (PUBLIC.includes(key)) continue
      const url = concrete(route.path).replace('/api/v1', '')
      const res = await anon[route.method === 'DELETE' ? 'del' : route.method.toLowerCase()](url, MUTATIONS.includes(route.method) && route.method !== 'DELETE' ? {} : undefined)
      if (res.status !== 401) failures.push(`${key} -> ${res.status}`)
    }
    assert.deepEqual(failures, [])
  })

  it('com sessão, mutação sem o header CSRF é recusada', async () => {
    const failures = []
    for (const route of routes.filter((r) => MUTATIONS.includes(r.method))) {
      const key = `${route.method} ${route.path}`
      if (key === 'POST /api/v1/auth/logout') continue // sairia da sessão usada no restante da varredura
      const url = concrete(route.path).replace('/api/v1', '')
      const res = await member[route.method === 'DELETE' ? 'del' : route.method.toLowerCase()](url, ...(route.method === 'DELETE' ? [{ csrf: false }] : [{}, { csrf: false }]))
      if (res.status !== 403 || !res.body || res.body.error.code !== 'CSRF_CHECK_FAILED') failures.push(`${key} -> ${res.status}`)
    }
    assert.deepEqual(failures, [])
  })

  it('API genérica do PocketBase não entrega registros a usuário comum', async () => {
    const collections = [
      'users', 'roles', 'permissions', 'role_permissions', 'sessions', 'audit_logs', 'projects', 'project_members',
      'custom_fields', 'custom_field_options', 'task_types', 'task_type_fields', 'task_statuses', 'task_priorities',
      'tasks', 'task_custom_values', 'tags', 'task_tag_relations', 'comments', 'attachments', 'notifications',
      'sprints', 'task_relations', 'login_attempts',
    ]
    const cookie = member.cookie ? member.cookie() : ''
    const leaks = []
    for (const name of collections) {
      const res = await fetch(`${pb.baseUrl}/api/collections/${name}/records`, { headers: cookie ? { Cookie: cookie } : {} })
      const body = await res.json().catch(() => ({}))
      if (res.status === 200 && Array.isArray(body.items) && body.items.length > 0) leaks.push(name)
    }
    assert.deepEqual(leaks, [])
    // login nativo do PocketBase desativado
    const native = await fetch(`${pb.baseUrl}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: 'mario@example.com', password: 'SenhaTeste123' }),
    })
    assert.notEqual(native.status, 200)
  })

  it('respostas da API saem com cabeçalhos de segurança e sem cache', async () => {
    const res = await member.get('/auth/me')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.match(res.headers.get('cache-control') || '', /no-store/)
  })
})
