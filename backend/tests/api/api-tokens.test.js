/**
 * Tokens de API pessoais — API contra um PocketBase real e isolado: criar (valor uma vez), usar com
 * `Authorization: Bearer` (sem cookie e sem CSRF), permissões do perfil, o que o token não pode fazer,
 * revogar, pessoa desativada e a lista do Admin.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const PASSWORD = 'SenhaTeste123'

describe('API Tokens de API', { timeout: 180000 }, () => {
  let pb
  let root
  let gestor
  let membro
  const users = {}

  before(async () => {
    pb = await startServer()
    root = createClient(pb.api)
    await root.login(pb.admin.email, pb.admin.password)
    const roles = (await root.get('/roles')).body.data
    const make = async (name, email, role) => {
      const created = (await root.post('/users', { name, email, password: PASSWORD, role_id: roles.find((r) => r.code === role).id })).body.data
      const client = createClient(pb.api)
      await client.login(email, PASSWORD)
      users[email] = created
      return client
    }
    gestor = await make('Gil', 'gil@example.com', 'MANAGER')
    membro = await make('Mia', 'mia@example.com', 'MEMBER')
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  /** Cliente sem cookie, só com o token (e sem o header de CSRF). */
  const bearer = (token) => {
    const client = createClient(pb.api)
    const auth = { csrf: false, headers: { Authorization: `Bearer ${token}` } }
    return {
      get: (p) => client.get(p, auth),
      post: (p, b) => client.post(p, b, auth),
      patch: (p, b) => client.patch(p, b, auth),
      del: (p) => client.del(p, auth),
    }
  }

  it('criar: Gestor sim, Membro não; o valor só vem na criação; a lista não traz o valor', async () => {
    assert.equal((await membro.post('/auth/tokens', { name: 'BI', expires_in_days: 30 })).status, 403)
    const created = await gestor.post('/auth/tokens', { name: 'Integração BI', expires_in_days: 90 })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.match(created.body.data.token, /^kb_pat_[A-Za-z0-9]{40}$/)
    assert.equal(created.body.data.prefix, created.body.data.token.slice(0, 11))
    const list = (await gestor.get('/auth/tokens')).body.data
    assert.equal(list.length, 1)
    assert.equal(JSON.stringify(list).includes(created.body.data.token), false)
    const history = (await root.get('/audit-logs?action=api_token.created')).body.data
    assert.equal(JSON.stringify(history).includes(created.body.data.token), false)
  })

  it('usar: Bearer sem cookie nem CSRF age como a pessoa; o token prevalece sobre o cookie; inválido = 401', async () => {
    const { token } = (await gestor.post('/auth/tokens', { name: 'Script', expires_in_days: 30 })).body.data
    const api = bearer(token)
    const me = await api.get('/auth/me')
    assert.equal(me.status, 200, JSON.stringify(me.body))
    assert.equal(me.body.data.user.email, 'gil@example.com')
    assert.equal(me.body.data.session, null)
    const project = await api.post('/projects', { name: 'Via token', key: 'TOK' })
    assert.equal(project.status, 201, JSON.stringify(project.body))
    // permissões do perfil: Gestor não configura integrações nem cria usuários
    assert.equal((await api.get('/settings/email')).status, 403)
    assert.equal((await api.post('/users', { name: 'X', email: 'x@example.com', password: PASSWORD, role_id: 'x' })).status, 403)
    // com o cookie do root junto, quem vale é o token
    const both = await root.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(both.body.data.user.email, 'gil@example.com')
    const invalid = await bearer(`kb_pat_${'x'.repeat(40)}`).get('/auth/me')
    assert.equal(invalid.status, 401)
    assert.equal(invalid.body.error.code, 'API_TOKEN_INVALID')
    const used = (await gestor.get('/auth/tokens')).body.data.find((t) => t.name === 'Script')
    assert.ok(used.last_used_at)
  })

  it('com token não dá para criar tokens, trocar a senha ou mexer nas sessões', async () => {
    const { token } = (await gestor.post('/auth/tokens', { name: 'Restrito', expires_in_days: 30 })).body.data
    const api = bearer(token)
    assert.equal((await api.post('/auth/tokens', { name: 'Outro', expires_in_days: 30 })).body.error.code, 'TOKEN_NOT_ALLOWED')
    assert.equal((await api.post('/auth/password', { current_password: PASSWORD, new_password: 'OutraSenha1234' })).body.error.code, 'TOKEN_NOT_ALLOWED')
    assert.equal((await api.post('/auth/sessions/revoke-others')).body.error.code, 'TOKEN_NOT_ALLOWED')
  })

  it('revogar (a própria pessoa ou o Admin) e desativar a pessoa cortam o acesso; Admin vê todos', async () => {
    const mine = (await gestor.post('/auth/tokens', { name: 'Para revogar', expires_in_days: 0 })).body.data
    assert.equal((await bearer(mine.token).get('/auth/me')).status, 200)
    assert.equal((await membro.del(`/auth/tokens/${mine.id}`)).status, 404)
    assert.equal((await gestor.del(`/auth/tokens/${mine.id}`)).body.data.state, 'revoked')
    assert.equal((await bearer(mine.token).get('/auth/me')).status, 401)

    const other = (await gestor.post('/auth/tokens', { name: 'Do Admin revogar', expires_in_days: 30 })).body.data
    assert.equal((await gestor.get('/settings/api-tokens')).status, 403)
    const all = (await root.get('/settings/api-tokens')).body.data
    assert.ok(all.some((t) => t.id === other.id && t.user.name === 'Gil'))
    assert.equal((await root.del(`/settings/api-tokens/${other.id}`)).body.data.state, 'revoked')

    const last = (await gestor.post('/auth/tokens', { name: 'Até desativar', expires_in_days: 30 })).body.data
    assert.equal((await root.patch(`/users/${users['gil@example.com'].id}/status`, { status: 'disabled' })).status, 200)
    assert.equal((await bearer(last.token).get('/auth/me')).status, 401)
  })

  it('ver de novo: o dono vê e copia pelo navegador (histórico); com o próprio token, de outra pessoa ou revogado, não', async () => {
    const roles = (await root.get('/roles')).body.data
    await root.post('/users', { name: 'Vera', email: 'vera@example.com', password: PASSWORD, role_id: roles.find((r) => r.code === 'MANAGER').id })
    const gestor = createClient(pb.api)
    await gestor.login('vera@example.com', PASSWORD)
    const created = (await gestor.post('/auth/tokens', { name: 'Claude VS Code', expires_in_days: 30 })).body.data
    const listed = (await gestor.get('/auth/tokens')).body.data.find((t) => t.id === created.id)
    assert.equal(listed.revealable, true)
    assert.equal('token' in listed, false)

    const shown = await gestor.post(`/auth/tokens/${created.id}/reveal`)
    assert.equal(shown.status, 200, JSON.stringify(shown.body))
    assert.equal(shown.body.data.token, created.token)
    const history = (await root.get('/audit-logs?action=api_token.revealed')).body.data
    assert.equal(history.length, 1)
    assert.equal(JSON.stringify(history).includes(created.token), false)

    // sem o header de CSRF (o navegador sempre manda), com o próprio token e para outra pessoa: não
    assert.equal((await gestor.post(`/auth/tokens/${created.id}/reveal`, {}, { csrf: false })).status, 403)
    assert.equal((await bearer(created.token).post(`/auth/tokens/${created.id}/reveal`)).body.error.code, 'TOKEN_NOT_ALLOWED')
    assert.equal((await root.post(`/auth/tokens/${created.id}/reveal`)).body.error.code, 'API_TOKEN_NOT_FOUND')

    await gestor.del(`/auth/tokens/${created.id}`)
    assert.equal((await gestor.post(`/auth/tokens/${created.id}/reveal`)).body.error.code, 'API_TOKEN_NOT_REVEALABLE')
  })
})
