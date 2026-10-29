const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { appError } = require('../../src/core/errors')
const { validateArguments } = require('../../src/mcp/schema')
const { createMcpServer, PROTOCOL_VERSIONS, RPC } = require('../../src/mcp/protocol')
const { TOOLS } = require('../../src/mcp/tools')

const ECHO = {
  name: 'echo',
  title: 'Echo',
  description: 'Devolve os argumentos.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', maxLength: 5 },
      count: { type: 'integer', minimum: 1, maximum: 3 },
      mode: { type: 'string', enum: ['a', 'b'] },
      due: { type: ['string', 'null'] },
      ids: { type: 'array', items: { type: 'string' }, maxItems: 2 },
      extra: { type: 'object' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  run: async (args, context) => ({ args, user: context.ctx.principal.userId }),
}

const FAIL = {
  name: 'fail',
  title: 'Fail',
  description: 'Falha.',
  inputSchema: { type: 'object', properties: { kind: { type: 'string' } }, additionalProperties: false },
  run: async (args) => {
    if (args.kind === 'app') throw appError('PROJECT_NOT_FOUND')
    throw new Error('segredo interno: senha=123')
  },
}

function setup() {
  const logged = []
  const server = createMcpServer({ tools: [ECHO, FAIL], serverInfo: { name: 'avanza', title: 'Avanza', version: '1.2.3' }, instructions: 'Use as ferramentas.' })
  const context = { ctx: { principal: { userId: 'u1' } }, log: { error: (attrs, msg) => logged.push({ attrs, msg }) } }
  const call = (method, params, id) => server.handlePayload({ jsonrpc: '2.0', id: id === undefined ? 1 : id, method, params }, context)
  const tool = async (name, args) => (await call('tools/call', { name, arguments: args })).result
  const parsed = (result) => JSON.parse(result.content[0].text)
  return { server, context, call, tool, parsed, logged }
}

describe('mcp/schema', () => {
  it('aceita argumentos válidos e devolve os erros com os códigos da API', () => {
    assert.deepEqual(validateArguments({ text: 'oi', count: 2, mode: 'a', due: null, ids: ['x'], extra: { a: 1 } }, ECHO.inputSchema), {})
    assert.deepEqual(validateArguments({}, ECHO.inputSchema), { text: 'required' })
    assert.deepEqual(validateArguments({ text: 'longo demais' }, ECHO.inputSchema), { text: 'too_long' })
    assert.deepEqual(validateArguments({ text: 1 }, ECHO.inputSchema), { text: 'invalid_type' })
    assert.deepEqual(validateArguments({ text: 'a', count: 1.5 }, ECHO.inputSchema), { count: 'invalid_type' })
    assert.deepEqual(validateArguments({ text: 'a', count: 0 }, ECHO.inputSchema), { count: 'too_small' })
    assert.deepEqual(validateArguments({ text: 'a', count: 4 }, ECHO.inputSchema), { count: 'too_large' })
    assert.deepEqual(validateArguments({ text: 'a', mode: 'c' }, ECHO.inputSchema), { mode: 'invalid_option' })
    assert.deepEqual(validateArguments({ text: 'a', ids: ['x', 'y', 'z'] }, ECHO.inputSchema), { ids: 'too_many' })
    assert.deepEqual(validateArguments({ text: 'a', ids: [1] }, ECHO.inputSchema), { ids: 'invalid_type' })
    assert.deepEqual(validateArguments({ text: 'a', extra: [] }, ECHO.inputSchema), { extra: 'invalid_type' })
    assert.deepEqual(validateArguments({ text: 'a', outro: 1 }, ECHO.inputSchema), { outro: 'unknown_field' })
    assert.deepEqual(validateArguments(null, ECHO.inputSchema), { arguments: 'invalid_type' })
  })

  it('valida os itens de lista de objetos (ex.: checklist)', () => {
    const schema = {
      type: 'object',
      properties: { list: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } } },
      additionalProperties: false,
    }
    assert.deepEqual(validateArguments({ list: [{ text: 'a' }] }, schema), {})
    assert.deepEqual(validateArguments({ list: [{}] }, schema), { list: 'invalid_type' })
    assert.deepEqual(validateArguments({ list: [{ text: 'a', x: 1 }] }, schema), { list: 'invalid_type' })
  })
})

describe('mcp/protocol', () => {
  it('initialize: devolve a versão pedida quando suportada, senão a mais recente; só a capacidade de ferramentas', async () => {
    const { call } = setup()
    const result = (await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2' } })).result
    assert.equal(result.protocolVersion, '2025-06-18')
    assert.deepEqual(result.capabilities, { tools: { listChanged: false } })
    assert.deepEqual(result.serverInfo, { name: 'avanza', title: 'Avanza', version: '1.2.3' })
    assert.equal(result.instructions, 'Use as ferramentas.')
    assert.equal((await call('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, PROTOCOL_VERSIONS[0])
    assert.equal((await call('initialize', {})).result.protocolVersion, PROTOCOL_VERSIONS[0])
  })

  it('notificações e respostas do cliente não têm resposta; ping responde vazio', async () => {
    const { server, context, call } = setup()
    assert.equal(await server.handlePayload({ jsonrpc: '2.0', method: 'notifications/initialized' }, context), null)
    assert.equal(await server.handlePayload({ jsonrpc: '2.0', id: 9, result: {} }, context), null)
    assert.equal(await server.handlePayload([{ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }], context), null)
    assert.deepEqual(await call('ping', undefined, 'abc'), { jsonrpc: '2.0', id: 'abc', result: {} })
  })

  it('mensagem inválida, id nulo e método desconhecido viram erros do JSON-RPC', async () => {
    const { server, context, call } = setup()
    assert.equal((await server.handlePayload({ id: 1, method: 'ping' }, context)).error.code, RPC.INVALID_REQUEST)
    assert.equal((await server.handlePayload({ jsonrpc: '2.0', id: null, method: 'ping' }, context)).error.code, RPC.INVALID_REQUEST)
    assert.equal((await server.handlePayload('texto', context)).error.code, RPC.INVALID_REQUEST)
    assert.equal((await server.handlePayload([], context)).error.code, RPC.INVALID_REQUEST)
    const unknown = await call('resources/list', {}, 7)
    assert.equal(unknown.id, 7)
    assert.equal(unknown.error.code, RPC.METHOD_NOT_FOUND)
  })

  it('lote: responde só as requisições, na ordem', async () => {
    const { server, context } = setup()
    const out = await server.handlePayload(
      [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ],
      context,
    )
    assert.deepEqual(out.map((r) => r.id), [1, 2])
  })

  it('tools/list: nome, título, descrição, esquema e anotações (sem a função)', async () => {
    const { call } = setup()
    const { tools } = (await call('tools/list', {})).result
    assert.deepEqual(tools.map((t) => t.name), ['echo', 'fail'])
    assert.equal(tools[0].title, 'Echo')
    assert.deepEqual(tools[0].inputSchema, ECHO.inputSchema)
    assert.deepEqual(tools[0].annotations, { title: 'Echo', readOnlyHint: true })
    assert.equal(tools[0].run, undefined)
  })

  it('tools/call: resultado em texto JSON, com o contexto de quem chama', async () => {
    const { tool, parsed } = setup()
    const result = await tool('echo', { text: 'oi' })
    assert.equal(result.isError, undefined)
    assert.equal(result.content[0].type, 'text')
    assert.deepEqual(parsed(result), { args: { text: 'oi' }, user: 'u1' })
  })

  it('tools/call: ferramenta desconhecida é erro do protocolo; argumentos inválidos voltam como erro da ferramenta', async () => {
    const { call, tool, parsed } = setup()
    assert.equal((await call('tools/call', { name: 'nada' })).error.code, RPC.INVALID_PARAMS)
    assert.equal((await call('tools/call', {})).error.code, RPC.INVALID_PARAMS)
    const invalid = await tool('echo', { count: 9 })
    assert.equal(invalid.isError, true)
    assert.deepEqual(parsed(invalid).error, { code: 'VALIDATION_ERROR', message: 'Invalid data', details: { fields: { text: 'required', count: 'too_large' } } })
  })

  it('tools/call: erro de aplicação vai com código e mensagem; erro inesperado não vaza detalhes e fica no log', async () => {
    const { tool, parsed, logged } = setup()
    const notFound = await tool('fail', { kind: 'app' })
    assert.equal(notFound.isError, true)
    assert.equal(parsed(notFound).error.code, 'PROJECT_NOT_FOUND')
    assert.equal(logged.length, 0)
    const crash = await tool('fail', {})
    assert.equal(crash.isError, true)
    assert.deepEqual(parsed(crash).error, { code: 'INTERNAL_ERROR', message: 'Unexpected error', details: {} })
    assert.equal(JSON.stringify(crash).includes('senha'), false)
    assert.equal(logged.length, 1)
    assert.equal(logged[0].attrs.tool, 'fail')
  })
})

describe('mcp/tools', () => {
  const ctx = { principal: { userId: 'u1' } }

  /** Serviços falsos: guardam as chamadas e devolvem o que o teste pedir. */
  function spyServices(returns) {
    const calls = []
    const handler = (service) =>
      new Proxy(
        {},
        {
          get: (_, method) => async (...args) => {
            calls.push({ service, method, args: args.slice(1) })
            const value = (returns || {})[`${service}.${method}`]
            return typeof value === 'function' ? value(...args.slice(1)) : value
          },
        },
      )
    return { calls, services: new Proxy({}, { get: (_, service) => handler(service) }) }
  }
  const byName = (name) => TOOLS.find((t) => t.name === name)

  it('catálogo: nomes únicos em snake_case, descrições, esquemas fechados e anotações coerentes', () => {
    const names = TOOLS.map((t) => t.name)
    assert.equal(new Set(names).size, names.length)
    TOOLS.forEach((tool) => {
      assert.match(tool.name, /^[a-z][a-z_]{2,40}$/, tool.name)
      assert.ok(tool.title && tool.description.length > 20, tool.name)
      assert.equal(tool.inputSchema.type, 'object', tool.name)
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name)
      ;(tool.inputSchema.required || []).forEach((key) => assert.ok(tool.inputSchema.properties[key], `${tool.name}.${key}`))
      Object.keys(tool.inputSchema.properties).forEach((key) => assert.ok(tool.inputSchema.properties[key].description, `${tool.name}.${key} sem descrição`))
      const readOnly = /^(get|list|find|search|whoami)/.test(tool.name)
      assert.equal(tool.annotations.readOnlyHint, readOnly, tool.name)
      assert.equal(tool.annotations.openWorldHint, false, tool.name)
      assert.equal(typeof tool.run, 'function')
      if (/^(delete|remove)_/.test(tool.name)) assert.match(tool.description, /confirm with the user first\.$/i, tool.name)
    })
    ;['create_project', 'list_projects', 'create_task', 'update_task', 'move_task', 'list_tasks', 'add_task_comment', 'get_board'].forEach((name) => assert.ok(byName(name), name))
  })

  it('list_tasks: filtros no formato da API (perPage, categorias separadas por vírgula) e cards enxutos', async () => {
    const summary = {
      id: 't1', code: 'CRM-1', title: 'Tarefa', project: { id: 'p1', key: 'CRM', name: 'CRM' },
      type: { id: 'ty', name: 'Bug' }, status: { id: 's1', key: 'todo', name: 'A fazer', color: 'gray', category: 'todo' },
      priority: { id: 'pr', name: 'Alta' }, sprint: null, assignee: { id: 'u2', name: 'Ana', email: 'ana@x', avatar_url: null },
      tags: [{ id: 'g', name: 'api', color: 'red' }], due_date: '2026-11-01T00:00:00.000Z', blocked: false,
      checklist_progress: { done: 0, total: 0 }, comment_count: 3,
    }
    const { calls, services } = spyServices({ 'tasks.listTasks': { items: [summary], meta: { page: 1, perPage: 5, total: 1, totalPages: 1 } } })
    const out = await byName('list_tasks').run({ project_id: 'p1', categories: ['todo', 'in_progress'], assignee_id: 'me', per_page: 5 }, { services, ctx })
    assert.deepEqual(calls[0], { service: 'tasks', method: 'listTasks', args: [{ project_id: 'p1', category: 'todo,in_progress', assignee_id: 'me', perPage: 5 }] })
    assert.deepEqual(out.meta, { page: 1, perPage: 5, total: 1, totalPages: 1 })
    assert.deepEqual(out.items[0], {
      id: 't1', code: 'CRM-1', title: 'Tarefa', project: 'CRM', type: 'Bug', status: { id: 's1', name: 'A fazer', category: 'todo' },
      priority: 'Alta', assignee: { id: 'u2', name: 'Ana' }, sprint: null, start_date: null, due_date: '2026-11-01T00:00:00.000Z',
      tags: ['api'], blocked: false, parent_task_id: null, updated_at: null,
    })
  })

  it('update_task e move_task: o id vai no caminho, o resto vira o corpo', async () => {
    const { calls, services } = spyServices()
    await byName('update_task').run({ task_id: 't1', title: 'Novo', due_date: null }, { services, ctx })
    await byName('move_task').run({ task_id: 't1', status_id: 's2' }, { services, ctx })
    assert.deepEqual(calls, [
      { service: 'tasks', method: 'updateTask', args: ['t1', { title: 'Novo', due_date: null }] },
      { service: 'tasks', method: 'moveTask', args: ['t1', { status_id: 's2' }] },
    ])
  })

  it('get_board: cards enxutos e no máximo `limit_per_column` por coluna', async () => {
    const card = (n) => ({ id: `t${n}`, code: `C-${n}`, title: `T${n}`, tags: [], card_fields: [{ field: {}, value: 1 }] })
    const board = {
      project: { id: 'p1', key: 'C', name: 'C', archived: false },
      capabilities: { move: true, create: true },
      columns: [{ status: { id: 's1', key: 'todo', name: 'A fazer', color: 'gray', category: 'todo', is_default: true }, wip_limit: 2, allowed_next: [], total: 3, truncated: false, tasks: [card(1), card(2), card(3)] }],
    }
    const { services } = spyServices({ 'board.getBoard': board })
    const out = await byName('get_board').run({ project_id: 'p1', limit_per_column: 2 }, { services, ctx })
    assert.deepEqual(out.columns[0].status, { id: 's1', name: 'A fazer', category: 'todo' })
    assert.equal(out.columns[0].total, 3)
    assert.equal(out.columns[0].wip_limit, 2)
    assert.deepEqual(out.columns[0].tasks.map((t) => t.code), ['C-1', 'C-2'])
    assert.equal(out.columns[0].truncated, true)
    assert.equal(out.columns[0].tasks[0].card_fields, undefined)
  })
  it('get_board_all_projects: ids separados por vírgula e cards enxutos com o projeto', async () => {
    const board = {
      project: null,
      projects: [{ id: 'p1', key: 'A', name: 'A' }, { id: 'p2', key: 'B', name: 'B' }],
      capabilities: { move: true, create: true },
      columns: [{ status: { id: 's1', name: 'A fazer', category: 'todo' }, wip_limit: 0, allowed_next: [], total: 1, tasks: [{ id: 't1', code: 'B-1', title: 'T', project: { id: 'p2', key: 'B' }, tags: [] }] }],
    }
    const { calls, services } = spyServices({ 'board.getAllBoard': board })
    const out = await byName('get_board_all_projects').run({ project_ids: ['p1', 'p2'] }, { services, ctx })
    assert.deepEqual(calls[0].args, [{ project_ids: 'p1,p2' }])
    assert.deepEqual(out.projects, board.projects)
    assert.equal(out.columns[0].tasks[0].project, 'B')
    await byName('get_board_all_projects').run({}, { services, ctx })
    assert.deepEqual(calls[1].args, [{}])
  })

  it('ids no caminho: membros, comentários, relações, sprints, marcos e notificações', async () => {
    const { calls, services } = spyServices({ 'notifications.listNotifications': { items: [], meta: {} } })
    await byName('update_project_member').run({ project_id: 'p1', user_id: 'u2', role: 'viewer' }, { services, ctx })
    await byName('remove_project_member').run({ project_id: 'p1', user_id: 'u2' }, { services, ctx })
    await byName('transfer_project_ownership').run({ project_id: 'p1', user_id: 'u3' }, { services, ctx })
    await byName('update_task_comment').run({ comment_id: 'c1', content: 'oi' }, { services, ctx })
    await byName('unlink_tasks').run({ relation_id: 'r1' }, { services, ctx })
    await byName('fork_task').run({ task_id: 't1', title: 'Cópia', copy: { attachments: true } }, { services, ctx })
    await byName('rank_backlog_task').run({ task_id: 't1', prev_id: 't0', sprint_id: null }, { services, ctx })
    await byName('reorder_sprints').run({ project_id: 'p1', sprint_ids: ['s2', 's1'] }, { services, ctx })
    await byName('update_milestone').run({ milestone_id: 'm1', state: 'done' }, { services, ctx })
    await byName('create_milestone').run({ project_id: 'p1', name: 'Go-live', due_date: '2026-12-01' }, { services, ctx })
    await byName('list_notifications').run({ unread_only: true, per_page: 10 }, { services, ctx })
    assert.deepEqual(
      calls.map((c) => [c.service, c.method, c.args]),
      [
        ['projects', 'updateMemberRole', ['p1', 'u2', { role: 'viewer' }]],
        ['projects', 'removeMember', ['p1', 'u2']],
        ['projects', 'transferOwnership', ['p1', { user_id: 'u3' }]],
        ['comments', 'updateComment', ['c1', { content: 'oi' }]],
        ['relations', 'deleteRelation', ['r1']],
        ['relations', 'forkTask', ['t1', { title: 'Cópia', copy: { attachments: true } }]],
        ['backlog', 'rankTask', ['t1', { prev_id: 't0', sprint_id: null }]],
        ['sprints', 'reorderSprints', ['p1', ['s2', 's1']]],
        ['milestones', 'updateMilestone', ['m1', { state: 'done' }]],
        ['milestones', 'createMilestone', ['p1', { name: 'Go-live', due_date: '2026-12-01' }]],
        ['notifications', 'listNotifications', [{ unread: '1', perPage: 10 }]],
      ],
    )
  })

  it('list_report_tasks: indicador e filtros do relatório, cards enxutos com metric_hours', async () => {
    const { calls, services } = spyServices({
      'reports.listIndicatorTasks': { items: [{ id: 't1', code: 'C-1', title: 'T', tags: [], metric_hours: 12.5 }], meta: { page: 2, perPage: 5, total: 6, totalPages: 2 } },
    })
    const out = await byName('list_report_tasks').run({ metric: 'lead_time', project_id: 'p1', tz_offset: 180, page: 2, per_page: 5 }, { services, ctx })
    assert.deepEqual(calls[0].args, [{ metric: 'lead_time', project_id: 'p1', tz_offset: '180', page: 2, perPage: 5 }])
    assert.equal(out.items[0].metric_hours, 12.5)
    assert.equal(out.items[0].code, 'C-1')
  })

  it('get_timeline: tarefas enxutas, o resto como veio', async () => {
    const timeline = { project: { id: 'p1' }, capabilities: { edit: true }, tasks: [{ id: 't1', code: 'C-1', title: 'T', tags: [], card_fields: [] }], dependencies: [], milestones: [], sprints: [], truncated: false }
    const { services } = spyServices({ 'timeline.getTimeline': timeline })
    const out = await byName('get_timeline').run({ project_id: 'p1' }, { services, ctx })
    assert.equal(out.tasks[0].card_fields, undefined)
    assert.deepEqual(out.milestones, [])
    assert.equal(out.truncated, false)
  })
})
