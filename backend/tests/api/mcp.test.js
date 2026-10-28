/**
 * MCP (ferramentas para o Claude) — `POST /api/mcp` contra a API real e isolada: só com token de API,
 * origem e versão do protocolo, ciclo do JSON-RPC (initialize, notificação, tools/list) e as
 * ferramentas agindo como a pessoa do token (permissões, validação, histórico).
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const PASSWORD = 'SenhaTeste123'

describe('API MCP', { timeout: 180000 }, () => {
  let pb
  let root
  let gestor
  let token
  let nextId = 1

  before(async () => {
    pb = await startServer()
    root = createClient(pb.api)
    await root.login(pb.admin.email, pb.admin.password)
    const roles = (await root.get('/roles')).body.data
    await root.post('/users', { name: 'Gil', email: 'gil@example.com', password: PASSWORD, role_id: roles.find((r) => r.code === 'MANAGER').id })
    gestor = createClient(pb.api)
    await gestor.login('gil@example.com', PASSWORD)
    token = (await gestor.post('/auth/tokens', { name: 'Claude', expires_in_days: 30 })).body.data.token
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  /** POST cru no endpoint do MCP. */
  async function post(body, headers) {
    const res = await fetch(`${pb.baseUrl}/api/mcp`, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` }, headers || {}),
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
  }

  const rpc = (method, params, headers) => post({ jsonrpc: '2.0', id: nextId++, method, params }, headers)

  /** Chama uma ferramenta e devolve { isError, data } (o texto JSON já lido). */
  async function tool(name, args) {
    const res = await rpc('tools/call', { name, arguments: args || {} })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.ok(res.body.result, JSON.stringify(res.body))
    return { isError: !!res.body.result.isError, data: JSON.parse(res.body.result.content[0].text) }
  }

  it('acesso: sem token ou com token inválido → 401 com WWW-Authenticate; cookie do navegador não vale', async () => {
    const none = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: '' })
    assert.equal(none.status, 401)
    assert.match(none.headers.get('www-authenticate'), /^Bearer/)
    assert.equal(none.body.error.message, 'Authentication required')
    const invalid = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer kb_pat_${'x'.repeat(40)}` })
    assert.equal(invalid.status, 401)
    const cookie = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: '', Cookie: gestor.cookie(), 'X-Requested-With': 'kamban' })
    assert.equal(cookie.status, 401)
  })

  it('transporte: outra origem → 403; versão do protocolo desconhecida → 400; GET → 405; JSON inválido → -32700', async () => {
    const cross = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://evil.example.com' })
    assert.equal(cross.status, 403)
    const same = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: pb.baseUrl })
    assert.equal(same.status, 200)
    const version = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'MCP-Protocol-Version': '1999-01-01' })
    assert.equal(version.status, 400)
    assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'MCP-Protocol-Version': '2025-06-18' })).status, 200)
    const get = await fetch(`${pb.baseUrl}/api/mcp`, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' } })
    assert.equal(get.status, 405)
    assert.equal(get.headers.get('allow'), 'POST')
    const broken = await post('{"jsonrpc": ')
    assert.equal(broken.status, 400)
    assert.equal(broken.body.error.code, -32700)
    // a API /api/v1 continua com o envelope dela para JSON inválido
    const api = await fetch(`${pb.api}/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{' })
    assert.equal((await api.json()).error.code, 'BAD_REQUEST')
  })

  it('ciclo: initialize negocia a versão; a notificação recebe 202 sem corpo; tools/list traz o catálogo', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.0.0' } })
    assert.equal(init.status, 200)
    assert.match(init.headers.get('content-type'), /application\/json/)
    assert.ok(init.headers.get('x-correlation-id'))
    assert.equal(init.body.result.protocolVersion, '2025-06-18')
    assert.equal(init.body.result.serverInfo.name, 'avanza')
    assert.deepEqual(init.body.result.capabilities, { tools: { listChanged: false } })
    assert.match(init.body.result.instructions, /Avanza/)

    const notification = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    assert.equal(notification.status, 202)
    assert.equal(notification.body, null)

    const { tools } = (await rpc('tools/list', {})).body.result
    const names = tools.map((t) => t.name)
    ;['whoami', 'create_project', 'list_tasks', 'create_task', 'move_task', 'add_task_comment', 'get_board'].forEach((name) => assert.ok(names.includes(name), name))
    assert.equal(tools.find((t) => t.name === 'list_tasks').annotations.readOnlyHint, true)
  })

  it('fluxo: cria projeto, tarefa, move no quadro e comenta — como a pessoa do token, com histórico', async () => {
    const me = await tool('whoami')
    assert.equal(me.data.user.email, 'gil@example.com')
    assert.ok(me.data.permissions.includes('projects.create'))

    const project = await tool('create_project', { name: 'Integração Claude', key: 'MCP', description: 'Criado pelo **Claude**', priority: 'high' })
    assert.equal(project.isError, false, JSON.stringify(project.data))
    assert.equal(project.data.key, 'MCP')
    assert.equal(project.data.owner.id, me.data.user.id)

    // tipo sem campos obrigatórios (os tipos de exemplo exigem campos)
    const type = (await root.post('/task-types', { key: 'TAREFA_MCP', name: 'Tarefa MCP' })).body.data
    const settings = await tool('get_task_settings')
    const status = (key) => settings.data.statuses.find((s) => s.key === key)
    assert.ok(settings.data.task_types.some((t) => t.id === type.id))
    assert.ok(status('DESENVOLVIMENTO'))

    const created = await tool('create_task', { project_id: project.data.id, task_type_id: type.id, title: 'Primeira tarefa', due_date: '2026-12-01', checklist: [{ text: 'Revisar' }] })
    assert.equal(created.isError, false, JSON.stringify(created.data))
    assert.equal(created.data.code, 'MCP-1')
    assert.equal(created.data.status.key, 'BACKLOG')

    const listed = await tool('list_tasks', { search: 'MCP-1' })
    assert.deepEqual(listed.data.items.map((t) => t.code), ['MCP-1'])
    assert.equal(listed.data.meta.total, 1)
    assert.equal(listed.data.items[0].project, 'MCP')

    const moved = await tool('move_task', { task_id: created.data.id, status_id: status('DESENVOLVIMENTO').id })
    assert.equal(moved.isError, false, JSON.stringify(moved.data))
    assert.equal(moved.data.status.key, 'DESENVOLVIMENTO')
    const open = await tool('list_tasks', { project_id: project.data.id, categories: ['in_progress'] })
    assert.deepEqual(open.data.items.map((t) => t.code), ['MCP-1'])

    const board = await tool('get_board', { project_id: project.data.id })
    const column = board.data.columns.find((c) => c.status.id === status('DESENVOLVIMENTO').id)
    assert.deepEqual(column.tasks.map((t) => t.code), ['MCP-1'])

    const comment = await tool('add_task_comment', { task_id: created.data.id, content: 'Comentário pelo Claude' })
    assert.equal(comment.isError, false, JSON.stringify(comment.data))
    assert.equal((await tool('list_task_comments', { task_id: created.data.id })).data.length, 1)

    const updated = await tool('update_task', { task_id: created.data.id, due_date: null, title: 'Primeira tarefa (revisada)' })
    assert.equal(updated.data.title, 'Primeira tarefa (revisada)')
    assert.equal(updated.data.due_date, null)

    // histórico em nome da pessoa do token, com o User-Agent do cliente
    const history = await pb.query(`SELECT action, user_id FROM audit_logs WHERE entity_id = $1 ORDER BY created`, [created.data.id])
    assert.ok(history.length >= 3)
    assert.ok(history.every((h) => h.user_id === me.data.user.id))
    const taskHistory = await tool('get_task_history', { task_id: created.data.id })
    assert.ok(taskHistory.data.items.length >= 3)
  })

  it('erros voltam como resultado da ferramenta: validação (formato e regra), campos exigidos e projeto de outra pessoa', async () => {
    const missing = await tool('create_task', { project_id: 'x' })
    assert.equal(missing.isError, true)
    assert.equal(missing.data.error.code, 'VALIDATION_ERROR')
    assert.deepEqual(missing.data.error.details.fields, { task_type_id: 'required', title: 'required' })

    const project = (await tool('list_projects', { search: 'Integração' })).data.items[0]
    const badDate = await tool('update_project', { project_id: project.id, due_date: 'amanhã' })
    assert.equal(badDate.isError, true)
    assert.equal(badDate.data.error.details.fields.due_date, 'invalid_date')

    // tipo de exemplo com campos obrigatórios: a mensagem diz quais faltam
    const bug = (await tool('get_task_settings')).data.task_types.find((t) => t.key === 'BUG')
    const required = await tool('create_task', { project_id: project.id, task_type_id: bug.id, title: 'Bug sem dados' })
    assert.equal(required.isError, true)
    assert.ok(Object.keys(required.data.error.details.fields).some((key) => key.indexOf('custom_values.') === 0), JSON.stringify(required.data))

    // projeto do root, em que o Gil não é membro: inexistente para ele
    const hidden = (await root.post('/projects', { name: 'Só do root', key: 'ROOT' })).body.data
    const denied = await tool('get_project', { project_id: hidden.id })
    assert.equal(denied.isError, true)
    assert.equal(denied.data.error.code, 'PROJECT_NOT_FOUND')
  })

  it('token revogado deixa de valer na hora', async () => {
    const { id, token: other } = (await gestor.post('/auth/tokens', { name: 'Temporário', expires_in_days: 30 })).body.data
    assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${other}` })).status, 200)
    await gestor.del(`/auth/tokens/${id}`)
    assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${other}` })).status, 401)
  })
})
