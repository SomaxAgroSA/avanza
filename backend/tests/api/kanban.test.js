/**
 * Kanban — testes de API contra um PocketBase real (quadro, mover, transições, WIP).
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

describe('API Kanban', { timeout: 180000 }, () => {
  let pb
  let admin
  let mario
  let lia
  let project
  let doc
  let statuses

  before(async () => {
    pb = await startServer()
    await pb.updateSettings({ rateLimits: { enabled: true, rules: RULES } })
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    const make = async (name, email, role) => {
      const created = await admin.post('/users', { name, email, password: 'SenhaTeste123', role_id: roles.find((r) => r.code === role).id })
      const client = createClient(pb.api)
      await client.login(email, 'SenhaTeste123')
      return { client, user: created.body.data }
    }
    mario = await make('Mário', 'mario@example.com', 'MEMBER')
    lia = await make('Lia', 'lia@example.com', 'VIEWER')
    project = (await admin.post('/projects', { name: 'CRM', key: 'CRM' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: mario.user.id, role: 'member' })
    await admin.post(`/projects/${project.id}/members`, { user_id: lia.user.id, role: 'viewer' })
    doc = (await admin.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO')
    statuses = (await admin.get('/statuses')).body.data
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  const st = (key) => statuses.find((s) => s.key === key).id
  const create = (title) => mario.client.post('/tasks', { project_id: project.id, task_type_id: doc.id, title }).then((r) => r.body.data)
  const titles = (board, key) => board.columns.find((c) => c.status.key === key).tasks.map((t) => t.title)

  it('quadro: colunas dos status, cards na ordem de criação e capacidades', async () => {
    await create('A')
    await create('B')
    await create('C')
    const board = await lia.client.get(`/projects/${project.id}/board`)
    assert.equal(board.status, 200, JSON.stringify(board.body))
    assert.deepEqual(board.body.data.columns.map((c) => c.status.key).slice(0, 3), ['BACKLOG', 'TRIAGEM', 'ANALISE'])
    assert.deepEqual(titles(board.body.data, 'BACKLOG'), ['A', 'B', 'C'])
    assert.deepEqual(board.body.data.capabilities, { move: false, create: false })
  })

  it('mover entre colunas e reordenar; leitor não move', async () => {
    const board = (await mario.client.get(`/projects/${project.id}/board`)).body.data
    const [a, b, c] = board.columns[0].tasks
    const moved = await mario.client.post(`/tasks/${c.id}/move`, { status_id: st('TRIAGEM') })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.equal(moved.body.data.status.key, 'TRIAGEM')
    await mario.client.post(`/tasks/${b.id}/move`, { status_id: st('BACKLOG'), next_id: a.id })
    const after = (await mario.client.get(`/projects/${project.id}/board`)).body.data
    assert.deepEqual(titles(after, 'BACKLOG'), ['B', 'A'])
    assert.deepEqual(titles(after, 'TRIAGEM'), ['C'])
    assert.equal((await lia.client.post(`/tasks/${a.id}/move`, { status_id: st('TRIAGEM') })).status, 403)
  })

  it('transições permitidas e limite WIP configurados no status', async () => {
    const updated = await admin.patch(`/statuses/${st('BACKLOG')}`, { allowed_next: [st('TRIAGEM')], wip_limit: 5 })
    assert.equal(updated.status, 200, JSON.stringify(updated.body))
    assert.deepEqual(updated.body.data.allowed_next, [st('TRIAGEM')])
    const board = (await mario.client.get(`/projects/${project.id}/board`)).body.data
    const backlog = board.columns.find((c) => c.status.key === 'BACKLOG')
    assert.equal(backlog.wip_limit, 5)
    const denied = await mario.client.post(`/tasks/${backlog.tasks[0].id}/move`, { status_id: st('CONCLUIDO') })
    assert.equal(denied.status, 409)
    assert.equal(denied.body.error.code, 'TRANSITION_NOT_ALLOWED')
    // o PATCH comum também respeita a regra
    assert.equal((await mario.client.patch(`/tasks/${backlog.tasks[0].id}`, { status_id: st('CONCLUIDO') })).body.error.code, 'TRANSITION_NOT_ALLOWED')
  })

  it('quadro de todos os projetos: só os que a pessoa vê (sem arquivados), project_ids restringe e leitor não move', async () => {
    const erp = (await admin.post('/projects', { name: 'ERP', key: 'ERP' })).body.data
    const rh = (await admin.post('/projects', { name: 'RH', key: 'RH' })).body.data
    const old = (await admin.post('/projects', { name: 'Antigo', key: 'OLD' })).body.data
    await admin.post(`/projects/${erp.id}/members`, { user_id: mario.user.id, role: 'viewer' })
    await admin.post(`/projects/${old.id}/members`, { user_id: mario.user.id, role: 'member' })
    for (const [p, title] of [[erp, 'Tarefa ERP'], [rh, 'Tarefa RH'], [old, 'Tarefa antiga']]) {
      assert.equal((await admin.post('/tasks', { project_id: p.id, task_type_id: doc.id, title })).status, 201)
    }
    assert.equal((await admin.post(`/projects/${old.id}/archive`)).status, 200)
    const cards = (board) => board.columns.flatMap((c) => c.tasks)
    const keys = (board) => [...new Set(cards(board).map((t) => t.project.key))].sort()

    const res = await mario.client.get('/board')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const board = res.body.data
    assert.equal(board.project, null)
    assert.deepEqual(board.projects.map((p) => p.key), ['CRM', 'ERP'])
    assert.deepEqual(keys(board), ['CRM', 'ERP'])
    // mover vale pelo projeto do card: membro no CRM, leitor no ERP
    assert.ok(cards(board).every((t) => t.capabilities.move === (t.project.key === 'CRM')))
    assert.deepEqual(board.capabilities, { move: true, create: true })
    // mesmas colunas do quadro do projeto; total somando os projetos
    const single = (await mario.client.get(`/projects/${project.id}/board`)).body.data
    assert.deepEqual(board.columns.map((c) => c.status.key), single.columns.map((c) => c.status.key))
    assert.deepEqual(board.columns.map((c) => c.total), single.columns.map((c) => c.total + (c.status.key === 'BACKLOG' ? 1 : 0)))

    // quem vê todos os projetos recebe todos os abertos
    assert.deepEqual((await admin.get('/board')).body.data.projects.map((p) => p.key), ['CRM', 'ERP', 'RH'])

    // project_ids restringe; o que a pessoa não vê fica de fora sem erro
    const narrowed = (await mario.client.get(`/board?project_ids=${erp.id},${rh.id}`)).body.data
    assert.deepEqual(narrowed.projects.map((p) => p.key), ['ERP'])
    assert.deepEqual(keys(narrowed), ['ERP'])
    assert.deepEqual(narrowed.capabilities, { move: false, create: false })
    const erpCard = cards(narrowed)[0]
    assert.equal(erpCard.capabilities.move, false)
    assert.equal((await mario.client.post(`/tasks/${erpCard.id}/move`, { status_id: st('TRIAGEM') })).status, 403)

    const viewer = (await lia.client.get('/board')).body.data
    assert.deepEqual(viewer.projects.map((p) => p.key), ['CRM'])
    assert.deepEqual(viewer.capabilities, { move: false, create: false })

    const invalid = await mario.client.get('/board?project_ids=a%20b')
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.error.code, 'VALIDATION_ERROR')
  })
})
