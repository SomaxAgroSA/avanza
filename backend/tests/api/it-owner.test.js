/**
 * Responsável TI (§33/§36), projeto pai (§34) e seções do projeto (§35) — API real e isolada.
 *
 * Varredura: o Responsável TI não lê nada do projeto além do resumo, da ficha (se o perfil tiver a seção)
 * e das tarefas visíveis a ele — por nenhuma rota da API nem por nenhuma ferramenta do MCP.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const PASSWORD = 'SenhaTeste123'

describe('API — Responsável TI, projeto pai e seções', { timeout: 240000 }, () => {
  let pb
  let admin
  let roles
  let gabi
  let tito
  let project
  let sap
  let space
  let element
  const tasks = {}
  let token
  let nextId = 1

  async function userWithRole(code, name, email) {
    const res = await admin.post('/users', { name, email, password: PASSWORD, role_id: roles.find((r) => r.code === code).id })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const client = createClient(pb.api)
    await client.login(email, PASSWORD)
    return { client, user: res.body.data }
  }

  before(async () => {
    pb = await startServer()
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    roles = (await admin.get('/roles')).body.data
    gabi = await userWithRole('MANAGER', 'Gabi', 'gabi@example.com')
    // perfil de membro com token de API (para o MCP)
    const { DEFAULT_ROLE_PERMISSIONS } = require('../../src/domain/permissions')
    const ti = await admin.post('/roles', { code: 'MEMBRO_TOKEN', name: 'Membro com token', permissions: DEFAULT_ROLE_PERMISSIONS.MEMBER.concat('api_tokens.create') })
    assert.equal(ti.status, 201, JSON.stringify(ti.body))
    roles = (await admin.get('/roles')).body.data
    tito = await userWithRole('MEMBRO_TOKEN', 'Tito TI', 'tito@example.com')

    project = (await gabi.client.post('/projects', { name: 'CRM Corporativo', key: 'CRM' })).body.data
    sap = (await gabi.client.post('/projects', { name: 'SAP', key: 'SAP' })).body.data
    assert.equal((await gabi.client.post(`/projects/${project.id}/members`, { user_id: tito.user.id, role: 'it' })).status, 201)
    await gabi.client.post(`/projects/${sap.id}/members`, { user_id: tito.user.id, role: 'member' })

    const type = (await admin.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO')
    const create = async (p, title, extra) => {
      const res = await gabi.client.post('/tasks', Object.assign({ project_id: p.id, task_type_id: type.id, title }, extra))
      assert.equal(res.status, 201, JSON.stringify(res.body))
      return res.body.data
    }
    tasks.mine = await create(project, 'Liberar acesso ao banco', { assignee_id: tito.user.id })
    tasks.shared = await create(project, 'Integração com o ERP')
    tasks.other = await create(project, 'Tela de pedidos')
    tasks.sap = await create(sap, 'Migração do SAP')
    assert.equal((await gabi.client.put(`/tasks/${tasks.shared.id}/it-visible`, { it_visible: true })).body.data.it_visible, true)
    await gabi.client.post(`/tasks/${tasks.other.id}/comments`, { content: 'Detalhe interno' })
    await gabi.client.post(`/tasks/${tasks.mine.id}/relations`, { type: 'relates', target_id: tasks.other.id })

    await gabi.client.put(`/projects/${project.id}/charter`, { objective: 'Portal comercial' })
    await gabi.client.post(`/projects/${project.id}/charter/items`, { kind: 'result', title: 'Disponibilidade do banco', target: 99.5, unit: '%', owner_id: tito.user.id })
    await gabi.client.post(`/projects/${project.id}/charter/items`, { kind: 'feature', title: 'Pedidos', task_ids: [tasks.other.id, tasks.mine.id] })
    await gabi.client.post(`/projects/${project.id}/milestones`, { name: 'Go-live', due_date: '2026-12-01' })
    await gabi.client.post(`/projects/${project.id}/sprints`, { name: 'Sprint 1' })
    const group = (await gabi.client.post(`/projects/${project.id}/groups`, { name: 'Iniciação' })).body.data
    element = (await gabi.client.post(`/projects/${project.id}/plan/items`, { group_id: group.id, name: 'Contrato' })).body.data
    space = (await gabi.client.post('/docs/spaces', { key: 'CRMDOC', name: 'Docs do CRM', visibility: 'project', project_id: project.id })).body.data
    assert.ok(space && space.id, 'espaço do projeto criado')

    token = (await tito.client.post('/auth/tokens', { name: 'Claude', expires_in_days: 30 })).body.data.token
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  async function tool(name, args) {
    const res = await fetch(`${pb.baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args || {} } }),
    })
    const body = await res.json()
    assert.ok(body.result, JSON.stringify(body))
    return { isError: !!body.result.isError, data: JSON.parse(body.result.content[0].text) }
  }

  const codes = (list) => list.map((t) => t.code).sort()

  it('abre o projeto e o resumo (com as tarefas dele e as marcadas); a ficha só lê, sem as tarefas fechadas', async () => {
    const seen = (await tito.client.get(`/projects/${project.id}`)).body.data
    assert.equal(seen.my_role, 'it')
    assert.deepEqual(seen.capabilities.sections, ['charter'])
    assert.equal(seen.capabilities.edit, false)

    const brief = await tito.client.get(`/projects/${project.id}/brief`)
    assert.equal(brief.status, 200, JSON.stringify(brief.body))
    assert.equal(brief.body.data.objective, 'Portal comercial')
    assert.deepEqual(codes(brief.body.data.tasks), codes([tasks.mine, tasks.shared]))
    assert.deepEqual(brief.body.data.items.map((i) => i.title), ['Disponibilidade do banco'])

    const charter = (await tito.client.get(`/projects/${project.id}/charter`)).body.data
    assert.equal(charter.capabilities.edit, false)
    const feature = charter.items.find((i) => i.kind === 'feature')
    assert.deepEqual(feature.tasks.map((t) => t.code), [tasks.mine.code])
    assert.equal((await tito.client.put(`/projects/${project.id}/charter`, { objective: 'x' })).body.error.code, 'PROJECT_NOT_FOUND')
  })

  it('varredura das rotas do projeto: nada além do resumo e da ficha', async () => {
    const id = project.id
    const expect = {
      [`/projects/${id}/members`]: 'PROJECT_NOT_FOUND',
      [`/projects/${id}/member-candidates`]: 'PROJECT_NOT_FOUND',
      [`/projects/${id}/history`]: 'FORBIDDEN',
      [`/projects/${id}/board`]: 'PROJECT_NOT_FOUND',
      [`/projects/${id}/backlog`]: 'PROJECT_NOT_FOUND',
      [`/projects/${id}/timeline`]: 'PROJECT_NOT_FOUND',
      [`/projects/${id}/sprints`]: 'PROJECT_NOT_FOUND',
      [`/projects/${id}/milestones`]: 'PROJECT_NOT_FOUND',
      [`/projects/${id}/plan`]: 'PROJECT_NOT_FOUND',
      [`/projects/${id}/groups`]: 'PROJECT_NOT_FOUND',
      [`/projects/${id}/plan/journal`]: 'PROJECT_NOT_FOUND',
      [`/projects/${id}/plan/issues`]: 'PROJECT_NOT_FOUND',
      [`/projects/${id}/plan/report`]: 'PROJECT_NOT_FOUND',
      [`/projects/${id}/files`]: 'PROJECT_NOT_FOUND',
      [`/plan/items/${element.id}`]: 'PLAN_ITEM_NOT_FOUND',
      [`/plan/items/${element.id}/history`]: 'PLAN_ITEM_NOT_FOUND',
      [`/docs/spaces/${space.id}`]: 'DOC_SPACE_NOT_FOUND',
      [`/tasks/${tasks.other.id}`]: 'TASK_NOT_FOUND',
      [`/tasks/${tasks.other.id}/comments`]: 'TASK_NOT_FOUND',
      [`/tasks/${tasks.other.id}/attachments`]: 'TASK_NOT_FOUND',
      [`/tasks/${tasks.other.id}/history`]: 'TASK_NOT_FOUND',
      [`/tasks/${tasks.other.id}/relations`]: 'TASK_NOT_FOUND',
      [`/tasks/${tasks.other.id}/mention-candidates`]: 'TASK_NOT_FOUND',
    }
    for (const [path, code] of Object.entries(expect)) {
      const res = await tito.client.get(path)
      assert.equal(res.body.error && res.body.error.code, code, `${path}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`)
    }
    assert.ok(!(await tito.client.get('/docs/spaces')).body.data.some((s) => s.id === space.id))
    const search = (await tito.client.get('/docs/search?q=CRM')).body.data || []
    assert.ok(!JSON.stringify(search).includes(space.id))
  })

  it('tarefas: lista geral e do projeto só com as visíveis; nelas colabora; não exclui, não reatribui, não cria, não marca', async () => {
    assert.deepEqual(codes((await tito.client.get('/tasks?perPage=100')).body.data), codes([tasks.mine, tasks.shared, tasks.sap]))
    assert.deepEqual(codes((await tito.client.get(`/tasks?project_id=${project.id}`)).body.data), codes([tasks.mine, tasks.shared]))
    assert.deepEqual(codes((await tito.client.get('/tasks?search=pedidos')).body.data), [])

    const detail = (await tito.client.get(`/tasks/${tasks.mine.id}`)).body.data
    assert.deepEqual(detail.capabilities, { edit: true, delete: false, assign: false, link: false, fork: false, comment: true })
    const statuses = (await admin.get('/statuses')).body.data
    const dev = statuses.find((s) => s.category === 'in_progress')
    assert.equal((await tito.client.patch(`/tasks/${tasks.mine.id}`, { status_id: dev.id })).body.data.status.id, dev.id)
    assert.equal((await tito.client.post(`/tasks/${tasks.mine.id}/comments`, { content: 'Feito' })).status, 201)
    assert.equal((await tito.client.get(`/tasks/${tasks.mine.id}/history`)).status, 200)
    const relations = (await tito.client.get(`/tasks/${tasks.mine.id}/relations`)).body.data
    assert.ok(!JSON.stringify(relations).includes(tasks.other.code), 'relação com tarefa fechada fica oculta')

    assert.equal((await tito.client.del(`/tasks/${tasks.mine.id}`)).body.error.code, 'FORBIDDEN')
    assert.equal((await tito.client.patch(`/tasks/${tasks.mine.id}`, { assignee_id: gabi.user.id })).body.error.code, 'FORBIDDEN')
    assert.equal((await tito.client.put(`/tasks/${tasks.mine.id}/it-visible`, { it_visible: false })).body.error.code, 'FORBIDDEN')
    assert.equal((await tito.client.put(`/tasks/${tasks.mine.id}/report`, { in_report: false })).body.error.code, 'FORBIDDEN')
    assert.equal((await tito.client.post(`/tasks/${tasks.mine.id}/relations`, { type: 'relates', target_id: tasks.shared.id })).body.error.code, 'FORBIDDEN')
    const type = (await admin.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO')
    assert.equal((await tito.client.post('/tasks', { project_id: project.id, task_type_id: type.id, title: 'Nova' })).body.error.code, 'PROJECT_NOT_FOUND')
    assert.equal((await tito.client.patch(`/tasks/${tasks.other.id}`, { title: 'x' })).body.error.code, 'TASK_NOT_FOUND')
  })

  it('visões de todos os projetos: Kanban sem o projeto dele, relatórios só com as visíveis, sem tempo real do projeto', async () => {
    const board = (await tito.client.get('/board')).body.data
    assert.deepEqual(board.projects.map((p) => p.key), ['SAP'])
    const cards = board.columns.reduce((list, column) => list.concat(column.tasks.map((t) => t.code)), [])
    assert.deepEqual(cards, [tasks.sap.code])
    const asked = (await tito.client.get(`/board?project_ids=${project.id}`)).body.data
    assert.equal(asked.columns.reduce((n, column) => n + column.tasks.length, 0), 0)

    const report = (await tito.client.get(`/reports?project_id=${project.id}`)).body.data
    assert.equal(report.indicators.total, 2)
    const drill = (await tito.client.get(`/reports/tasks?metric=open&project_id=${project.id}`)).body.data
    assert.deepEqual(codes(drill), codes([tasks.mine, tasks.shared]))
    assert.equal((await tito.client.get('/executive')).body.error.code, 'FORBIDDEN')
  })

  it('MCP: as mesmas regras pelas ferramentas do Claude', async () => {
    const brief = await tool('get_project_brief', { project_id: project.id })
    assert.equal(brief.isError, false, JSON.stringify(brief.data))
    assert.deepEqual(codes(brief.data.tasks), codes([tasks.mine, tasks.shared]))
    assert.deepEqual(codes((await tool('list_tasks', { project_id: project.id })).data.items), codes([tasks.mine, tasks.shared]))
    assert.equal((await tool('get_task', { task_id: tasks.mine.id })).isError, false)
    const charter = await tool('get_project_charter', { project_id: project.id })
    assert.deepEqual(charter.data.items.find((i) => i.kind === 'feature').tasks.map((t) => t.code), [tasks.mine.code])

    const closed = {
      get_task: [{ task_id: tasks.other.id }, 'TASK_NOT_FOUND'],
      list_task_comments: [{ task_id: tasks.other.id }, 'TASK_NOT_FOUND'],
      get_task_history: [{ task_id: tasks.other.id }, 'TASK_NOT_FOUND'],
      get_task_relations: [{ task_id: tasks.other.id }, 'TASK_NOT_FOUND'],
      list_task_attachments: [{ task_id: tasks.other.id }, 'TASK_NOT_FOUND'],
      list_project_members: [{ project_id: project.id }, 'PROJECT_NOT_FOUND'],
      get_project_history: [{ project_id: project.id }, 'FORBIDDEN'],
      get_board: [{ project_id: project.id }, 'PROJECT_NOT_FOUND'],
      get_backlog: [{ project_id: project.id }, 'PROJECT_NOT_FOUND'],
      get_timeline: [{ project_id: project.id }, 'PROJECT_NOT_FOUND'],
      list_milestones: [{ project_id: project.id }, 'PROJECT_NOT_FOUND'],
      list_sprints: [{ project_id: project.id }, 'PROJECT_NOT_FOUND'],
      get_plan: [{ project_id: project.id }, 'PROJECT_NOT_FOUND'],
      get_plan_item: [{ plan_item_id: element.id }, 'PLAN_ITEM_NOT_FOUND'],
      list_project_files: [{ project_id: project.id }, 'PROJECT_NOT_FOUND'],
      get_doc_space: [{ space_key: 'CRMDOC' }, 'DOC_SPACE_NOT_FOUND'],
      update_task: [{ task_id: tasks.other.id, title: 'x' }, 'TASK_NOT_FOUND'],
      delete_task: [{ task_id: tasks.mine.id }, 'FORBIDDEN'],
      set_task_it_visible: [{ task_id: tasks.mine.id, it_visible: false }, 'FORBIDDEN'],
      set_task_in_report: [{ task_id: tasks.mine.id, in_report: false }, 'FORBIDDEN'],
    }
    for (const [name, [args, code]] of Object.entries(closed)) {
      const out = await tool(name, args)
      assert.equal(out.isError, true, `${name} deveria falhar`)
      assert.equal(out.data.error.code, code, `${name}: ${JSON.stringify(out.data)}`)
    }
    const all = await tool('get_board_all_projects', {})
    assert.ok(!JSON.stringify(all.data).includes(project.key + '-'), 'nenhum cartão do projeto dele')
    const report = await tool('list_report_tasks', { metric: 'open' })
    assert.deepEqual(codes(report.data.items), codes([tasks.mine, tasks.shared, tasks.sap]))
  })

  it('a equipe marca e desmarca "Visível para TI" (com histórico e filtro); desmarcada, a tarefa fecha de novo', async () => {
    assert.deepEqual(codes((await gabi.client.get(`/tasks?project_id=${project.id}&it_visible=true`)).body.data), [tasks.shared.code])
    assert.equal((await gabi.client.put(`/tasks/${tasks.other.id}/it-visible`, { it_visible: 'sim' })).status, 400)
    await gabi.client.put(`/tasks/${tasks.other.id}/it-visible`, { it_visible: true })
    assert.equal((await tito.client.get(`/tasks/${tasks.other.id}`)).status, 200)
    const history = (await gabi.client.get(`/tasks/${tasks.other.id}/history`)).body.data
    assert.ok(history.some((h) => h.new_value && h.new_value.it_visible === true))
    await gabi.client.put(`/tasks/${tasks.other.id}/it-visible`, { it_visible: false })
    assert.equal((await tito.client.get(`/tasks/${tasks.other.id}`)).body.error.code, 'TASK_NOT_FOUND')
  })

  it('projeto pai: cria o subprojeto, filtra pelos filhos e recusa o segundo nível', async () => {
    const parent = (await admin.post('/projects', { name: 'Programa CRM', key: 'PCRM' })).body.data
    const child = await admin.post('/projects', { name: 'Força de Vendas', key: 'PFVB', parent_id: parent.id })
    assert.equal(child.status, 201)
    assert.equal(child.body.data.parent.key, 'PCRM')
    assert.equal((await admin.get(`/projects/${parent.id}`)).body.data.child_count, 1)
    assert.deepEqual((await admin.get(`/projects?parent_id=${parent.id}`)).body.data.map((p) => p.key), ['PFVB'])
    assert.ok(!(await admin.get('/projects?parent_id=none&perPage=100')).body.data.some((p) => p.key === 'PFVB'))
    const nested = await admin.post('/projects', { name: 'Neto', key: 'PNETO', parent_id: child.body.data.id })
    assert.equal(nested.body.error.details.fields.parent_id, 'parent_is_child')
    // pai que a pessoa não edita = opção inválida
    const foreign = await gabi.client.post('/projects', { name: 'Sub', key: 'PSUB', parent_id: parent.id })
    assert.equal(foreign.body.error.details.fields.parent_id, 'invalid_option')
    assert.equal((await admin.patch(`/projects/${child.body.data.id}`, { parent_id: null })).body.data.parent, null)
  })

  it('seções do projeto: sem projects.charter/history o servidor fecha a ficha e o histórico; sem members, não gerencia membros', async () => {
    const role = (await admin.post('/roles', { code: 'SO_FICHA', name: 'Só ficha', permissions: ['projects.view', 'projects.edit', 'projects.charter'] })).body.data
    const res = await admin.post('/users', { name: 'Sonia', email: 'sonia@example.com', password: PASSWORD, role_id: role.id })
    const sonia = createClient(pb.api)
    await sonia.login('sonia@example.com', PASSWORD)
    const own = (await admin.post('/projects', { name: 'Seções', key: 'SEC' })).body.data
    await admin.post(`/projects/${own.id}/members`, { user_id: res.body.data.id, role: 'manager' })

    const seen = (await sonia.get(`/projects/${own.id}`)).body.data
    assert.deepEqual(seen.capabilities.sections, ['charter'])
    assert.equal(seen.capabilities.manage_members, false)
    assert.equal((await sonia.get(`/projects/${own.id}/charter`)).status, 200)
    assert.equal((await sonia.get(`/projects/${own.id}/history`)).body.error.code, 'FORBIDDEN')
    assert.equal((await sonia.post(`/projects/${own.id}/members`, { user_id: tito.user.id, role: 'member' })).body.error.code, 'FORBIDDEN')
    assert.equal((await sonia.get(`/projects/${own.id}/members`)).status, 200)
    assert.deepEqual((await admin.get(`/projects/${own.id}`)).body.data.capabilities.sections, ['charter', 'history', 'members', 'report'])
  })
})
