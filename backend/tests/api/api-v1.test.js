/**
 * Testes de API ponta a ponta contra um PocketBase real (migrations + hooks).
 * Executar com: npm run test:api
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const LOGIN_RULE = { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 }
const OTHER_RULES = [
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

describe('API /api/v1', { timeout: 120000 }, () => {
  let pb
  let admin
  let roles

  before(async () => {
    pb = await startServer()
    await pb.updateSettings({ rateLimits: { enabled: true, rules: [LOGIN_RULE].concat(OTHER_RULES) } })
    admin = createClient(pb.api)
    const res = await admin.login(pb.admin.email, pb.admin.password)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    roles = (await admin.get('/roles')).body.data
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  const roleId = (code) => roles.find((r) => r.code === code).id

  async function createUserAndLogin(code, email) {
    const password = 'SenhaTeste123'
    const res = await admin.post('/users', { name: code, email, password, role_id: roleId(code) })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const client = createClient(pb.api)
    assert.equal((await client.login(email, password)).status, 200)
    return { client, user: res.body.data }
  }

  describe('contrato geral', () => {
    it('health é público e segue o envelope', async () => {
      const res = await createClient(pb.api).get('/health')
      assert.equal(res.status, 200)
      assert.equal(res.body.data.status, 'ok')
      assert.equal(res.body.error, null)
      assert.ok(res.body.meta.correlationId)
      assert.equal(res.headers.get('x-correlation-id'), res.body.meta.correlationId)
      assert.equal(res.headers.get('cache-control'), 'no-store')
    })

    it('reaproveita correlation id válido enviado pelo cliente', async () => {
      const res = await createClient(pb.api).get('/health', { headers: { 'X-Correlation-Id': 'abc-12345678' } })
      assert.equal(res.body.meta.correlationId, 'abc-12345678')
    })

    it('rota inexistente retorna ROUTE_NOT_FOUND no envelope', async () => {
      const res = await admin.get('/nao-existe')
      assert.equal(res.status, 404)
      assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND')
      assert.equal(res.body.data, null)
    })

    it('OpenAPI é servido', async () => {
      const res = await createClient(pb.api).get('/openapi.json')
      assert.equal(res.status, 200)
      assert.equal(res.body.openapi, '3.1.0')
      assert.ok(res.body.paths['/auth/login'])
    })

    it('body JSON inválido retorna BAD_REQUEST', async () => {
      const res = await admin.post('/users', '{invalido')
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, 'BAD_REQUEST')
    })
  })

  describe('segurança', () => {
    it('mutação sem header CSRF é bloqueada', async () => {
      const res = await createClient(pb.api).post('/auth/login', { email: pb.admin.email, password: pb.admin.password }, { csrf: false })
      assert.equal(res.status, 403)
      assert.equal(res.body.error.code, 'CSRF_CHECK_FAILED')
    })

    it('cookie de sessão é HttpOnly, SameSite=Strict e restrito a /api/', async () => {
      const client = createClient(pb.api)
      const res = await client.login(pb.admin.email, pb.admin.password)
      assert.match(res.setCookie, /HttpOnly/i)
      assert.match(res.setCookie, /SameSite=Strict/i)
      assert.match(res.setCookie, /Path=\/api\//i)
      assert.equal(JSON.stringify(res.body).includes(res.setCookie.split(';')[0].split('=')[1]), false, 'token não pode ir no body')
    })

    it('nenhuma rota genérica expõe as tabelas (as antigas do PocketBase respondem 404)', async () => {
      for (const name of ['users', 'sessions', 'audit_logs', 'roles']) {
        const res = await fetch(`${pb.baseUrl}/api/collections/${name}/records`)
        assert.equal(res.status, 404, name)
        assert.equal((await res.json()).error.code, 'ROUTE_NOT_FOUND')
      }
      const auth = await fetch(`${pb.baseUrl}/api/collections/users/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: pb.admin.email, password: pb.admin.password }),
      })
      assert.notEqual(auth.status, 200)
    })

    it('rota protegida sem sessão retorna UNAUTHENTICATED', async () => {
      const res = await createClient(pb.api).get('/auth/me')
      assert.equal(res.status, 401)
      assert.equal(res.body.error.code, 'UNAUTHENTICATED')
    })
  })

  describe('autenticação e sessão', () => {
    it('credenciais inválidas retornam erro genérico', async () => {
      const res = await createClient(pb.api).login(pb.admin.email, 'SenhaErrada123')
      assert.equal(res.status, 401)
      assert.equal(res.body.error.code, 'INVALID_CREDENTIALS')
      const unknown = await createClient(pb.api).login('ninguem@kamban.test', 'SenhaErrada123')
      assert.equal(unknown.body.error.code, 'INVALID_CREDENTIALS')
    })

    it('me retorna usuário, perfil e permissões', async () => {
      const res = await admin.get('/auth/me')
      assert.equal(res.status, 200)
      assert.equal(res.body.data.user.email, pb.admin.email)
      assert.equal(res.body.data.role.code, 'SUPER_ADMIN')
      assert.ok(res.body.data.permissions.includes('permissions.manage'))
      assert.equal(res.body.data.session.current, true)
    })

    it('logout invalida a sessão e limpa o cookie', async () => {
      const client = createClient(pb.api)
      await client.login(pb.admin.email, pb.admin.password)
      const cookieBefore = client.hasSession()
      const res = await client.post('/auth/logout')
      assert.equal(res.status, 200)
      assert.equal(cookieBefore, true)
      assert.equal(client.hasSession(), false)
      assert.equal((await client.get('/auth/me')).status, 401)
    })

    it('encerra as outras sessões e mantém a atual', async () => {
      const { client: current } = await createUserAndLogin('MEMBER', 'varias-sessoes@kamban.test')
      const other = createClient(pb.api)
      await other.login('varias-sessoes@kamban.test', 'SenhaTeste123')
      const res = await current.post('/auth/sessions/revoke-others')
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.equal(res.body.data.revoked, 1)
      assert.equal((await current.get('/auth/me')).status, 200)
      assert.equal((await other.get('/auth/me')).status, 401)
      assert.equal((await admin.get('/auth/me')).status, 200, 'sessões de outros usuários não são afetadas')
    })

    it('lista e revoga sessões próprias; não revoga sessão alheia', async () => {
      const a = createClient(pb.api)
      const b = createClient(pb.api)
      await a.login(pb.admin.email, pb.admin.password)
      await b.login(pb.admin.email, pb.admin.password)
      const sessions = (await a.get('/auth/sessions')).body.data
      const bSessionId = (await b.get('/auth/me')).body.data.session.id
      const other = sessions.find((s) => s.id === bSessionId)
      assert.ok(other && !other.current)
      assert.equal((await a.del(`/auth/sessions/${other.id}`)).status, 200)

      const member = await createUserAndLogin('MEMBER', 'idor@kamban.test')
      const mine = (await a.get('/auth/sessions')).body.data.find((s) => s.current)
      const res = await member.client.del(`/auth/sessions/${mine.id}`)
      assert.equal(res.status, 404)
      assert.equal(res.body.error.code, 'SESSION_NOT_FOUND')
    })
  })

  describe('RBAC', () => {
    it('perfis padrão existem com permissões', async () => {
      const codes = roles.map((r) => r.code).sort()
      assert.deepEqual(codes, ['ADMIN', 'MANAGER', 'MEMBER', 'SUPER_ADMIN', 'VIEWER'])
      assert.ok(roles.find((r) => r.code === 'VIEWER').permissions.includes('tasks.view'))
    })

    it('VIEWER não lista usuários nem perfis', async () => {
      const { client } = await createUserAndLogin('VIEWER', 'viewer@kamban.test')
      assert.equal((await client.get('/users')).body.error.code, 'FORBIDDEN')
      assert.equal((await client.get('/roles')).status, 403)
    })

    it('admin altera permissões de perfil e a mudança vale na próxima requisição', async () => {
      const { client } = await createUserAndLogin('VIEWER', 'viewer2@kamban.test')
      const res = await admin.put(`/roles/${roleId('VIEWER')}/permissions`, {
        permissions: ['projects.view', 'tasks.view', 'kanban.view', 'reports.view', 'users.view'],
      })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.ok(res.body.data.permissions.includes('users.view'))
      assert.equal((await client.get('/users')).status, 200)

      await admin.put(`/roles/${roleId('VIEWER')}/permissions`, {
        permissions: ['projects.view', 'tasks.view', 'kanban.view', 'reports.view'],
      })
      assert.equal((await client.get('/users')).status, 403)
    })

    it('SUPER_ADMIN é imutável e permissões desconhecidas são rejeitadas', async () => {
      const immutable = await admin.put(`/roles/${roleId('SUPER_ADMIN')}/permissions`, { permissions: [] })
      assert.equal(immutable.body.error.code, 'ROLE_IMMUTABLE')
      const unknown = await admin.put(`/roles/${roleId('MEMBER')}/permissions`, { permissions: ['hack.all'] })
      assert.equal(unknown.body.error.code, 'VALIDATION_ERROR')
    })

    it('cria e exclui perfil customizado', async () => {
      const created = await admin.post('/roles', { code: 'qa', name: 'QA', permissions: ['tasks.view'] })
      assert.equal(created.status, 201, JSON.stringify(created.body))
      assert.equal(created.body.data.code, 'QA')
      assert.deepEqual(created.body.data.permissions, ['tasks.view'])
      const removed = await admin.del(`/roles/${created.body.data.id}`)
      assert.equal(removed.status, 200)
      assert.equal((await admin.get(`/roles/${created.body.data.id}`)).body.error.code, 'ROLE_NOT_FOUND')
    })
  })

  describe('usuários', () => {
    it('cria, valida, lista com paginação, busca e ordenação', async () => {
      const invalid = await admin.post('/users', { name: '', email: 'x', password: 'abc' })
      assert.equal(invalid.status, 400)
      assert.deepEqual(Object.keys(invalid.body.error.details.fields).sort(), ['email', 'name', 'password', 'role_id'])

      for (const n of [1, 2, 3]) {
        const res = await admin.post('/users', {
          name: `Lista ${n}`,
          email: `lista${n}@kamban.test`,
          password: 'SenhaTeste123',
          role_id: roleId('MEMBER'),
        })
        assert.equal(res.status, 201)
      }
      const dup = await admin.post('/users', { name: 'Dup', email: 'LISTA1@kamban.test', password: 'SenhaTeste123', role_id: roleId('MEMBER') })
      assert.equal(dup.body.error.code, 'EMAIL_ALREADY_IN_USE')

      const page = await admin.get('/users?search=lista&perPage=2&page=1&sort=-name')
      assert.equal(page.status, 200)
      assert.equal(page.body.meta.total, 3)
      assert.equal(page.body.meta.totalPages, 2)
      assert.deepEqual(page.body.data.map((u) => u.name), ['Lista 3', 'Lista 2'])
      assert.equal(JSON.stringify(page.body).includes('password'), false)
    })

    it('ADMIN não cria SUPER_ADMIN (escalonamento)', async () => {
      const { client } = await createUserAndLogin('ADMIN', 'admin2@kamban.test')
      const res = await client.post('/users', {
        name: 'Hacker',
        email: 'hacker@kamban.test',
        password: 'SenhaTeste123',
        role_id: roleId('SUPER_ADMIN'),
      })
      assert.equal(res.body.error.code, 'PRIVILEGE_ESCALATION')
    })

    it('desativar usuário derruba as sessões dele', async () => {
      const { client, user } = await createUserAndLogin('MEMBER', 'desativar@kamban.test')
      assert.equal((await client.get('/auth/me')).status, 200)
      const res = await admin.patch(`/users/${user.id}/status`, { status: 'disabled' })
      assert.equal(res.body.data.status, 'disabled')
      const after = await client.get('/auth/me')
      assert.equal(after.status, 401)
      assert.equal(after.body.error.code, 'SESSION_EXPIRED')
      const relogin = await createClient(pb.api).login('desativar@kamban.test', 'SenhaTeste123')
      assert.equal(relogin.body.error.code, 'ACCOUNT_DISABLED')
    })

    it('admin não pode desativar a si mesmo', async () => {
      const me = (await admin.get('/auth/me')).body.data.user
      const res = await admin.patch(`/users/${me.id}/status`, { status: 'disabled' })
      assert.equal(res.body.error.code, 'CANNOT_DISABLE_SELF')
    })
  })

  describe('auditoria', () => {
    it('registra ações com autor, IP, correlation id e sem dados sensíveis', async () => {
      const created = await admin.post('/users', {
        name: 'Auditado',
        email: 'auditado@kamban.test',
        password: 'SenhaSecreta123',
        role_id: roleId('MEMBER'),
      }, { headers: { 'X-Correlation-Id': 'audit-corr-0001' } })
      assert.equal(created.status, 201)

      const logs = await pb.query('SELECT * FROM audit_logs WHERE entity_id = $1', [created.body.data.id])
      assert.equal(logs.length, 1)
      assert.equal(logs[0].action, 'user.created')
      assert.equal(logs[0].correlation_id, 'audit-corr-0001')
      assert.ok(logs[0].user_id)
      assert.ok(logs[0].ip)
      assert.equal(JSON.stringify(logs).includes('SenhaSecreta123'), false)
    })

    it('login e logout geram histórico', async () => {
      const logs = await pb.query("SELECT * FROM audit_logs WHERE action IN ('auth.login', 'auth.logout')")
      assert.ok(logs.some((l) => l.action === 'auth.login'))
      assert.ok(logs.some((l) => l.action === 'auth.logout'))
    })
  })

  describe('senhas', () => {
    it('usuário troca a própria senha; outras sessões caem e a atual continua', async () => {
      const { client } = await createUserAndLogin('MEMBER', 'troca@kamban.test')
      const other = createClient(pb.api)
      await other.login('troca@kamban.test', 'SenhaTeste123')

      const wrong = await client.post('/auth/password', { current_password: 'Errada12345', new_password: 'NovaSenha12345' })
      assert.equal(wrong.body.error.details.fields.current_password, 'incorrect')

      const ok = await client.post('/auth/password', { current_password: 'SenhaTeste123', new_password: 'NovaSenha12345' })
      assert.equal(ok.status, 200, JSON.stringify(ok.body))
      assert.equal(ok.body.data.other_sessions_revoked, 1)
      assert.equal((await client.get('/auth/me')).status, 200)
      assert.equal((await other.get('/auth/me')).body.error.code, 'SESSION_EXPIRED')
      assert.equal((await createClient(pb.api).login('troca@kamban.test', 'NovaSenha12345')).status, 200)
    })

    it('admin redefine a senha de outro usuário e derruba as sessões dele', async () => {
      const { client, user } = await createUserAndLogin('MEMBER', 'reset@kamban.test')
      const res = await admin.post(`/users/${user.id}/password`, { password: 'Redefinida12345' })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.equal((await client.get('/auth/me')).status, 401)
      assert.equal((await createClient(pb.api).login('reset@kamban.test', 'Redefinida12345')).status, 200)

      const me = (await admin.get('/auth/me')).body.data.user
      assert.equal((await admin.post(`/users/${me.id}/password`, { password: 'Qualquer12345' })).body.error.code, 'USE_CHANGE_PASSWORD')
    })
  })

  describe('consulta de auditoria', () => {
    it('lista com filtros e autor; histórico de usuário exige users.view', async () => {
      const { user } = await createUserAndLogin('MEMBER', 'historico@kamban.test')
      await admin.patch(`/users/${user.id}`, { name: 'Histórico Renomeado' })

      const page = await admin.get(`/audit-logs?entity_type=user&entity_id=${user.id}&perPage=10`)
      assert.equal(page.status, 200, JSON.stringify(page.body))
      assert.ok(page.body.meta.total >= 2)
      const updated = page.body.data.find((e) => e.action === 'user.updated')
      assert.deepEqual(updated.new_value, { name: 'Histórico Renomeado' })
      assert.equal(updated.user.email, pb.admin.email)

      const history = await admin.get(`/users/${user.id}/history`)
      assert.equal(history.status, 200)
      assert.equal(history.body.data[0].action, 'user.updated')

      const viewer = await createUserAndLogin('VIEWER', 'viewer-audit@kamban.test')
      assert.equal((await viewer.client.get('/audit-logs')).status, 403)
      assert.equal((await viewer.client.get(`/users/${user.id}/history`)).status, 403)

      assert.equal((await admin.get('/audit-logs?from=ontem')).body.error.details.fields.from, 'invalid_date')
    })

    it('ADMIN possui audit.view após a migration', async () => {
      assert.ok(roles.find((r) => r.code === 'ADMIN').permissions.includes('audit.view'))
    })
  })

  describe('rate limiting', () => {
    it('login excessivo retorna RATE_LIMITED no envelope padrão', async () => {
      await pb.updateSettings({
        rateLimits: { enabled: true, rules: [Object.assign({}, LOGIN_RULE, { maxRequests: 3 })].concat(OTHER_RULES) },
      })
      const client = createClient(pb.api)
      const statuses = []
      for (let i = 0; i < 5; i++) statuses.push((await client.login('x@kamban.test', 'SenhaErrada123')).status)
      assert.ok(statuses.includes(429), statuses.join(','))
      const res = await client.login('x@kamban.test', 'SenhaErrada123')
      assert.equal(res.body.error.code, 'RATE_LIMITED')
      await pb.updateSettings({ rateLimits: { enabled: true, rules: [LOGIN_RULE].concat(OTHER_RULES) } })
    })
  })
})
