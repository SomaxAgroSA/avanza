/**
 * Relacionamentos, subtarefas e fork — testes de API contra um PocketBase real.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

/** PNG 1x1 válido. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

describe('API Relacionamentos', { timeout: 180000 }, () => {
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
  const create = (title, extra) => mario.client.post('/tasks', Object.assign({ project_id: project.id, task_type_id: doc.id, title }, extra)).then((r) => r.body.data)

  it('relação vista dos dois lados, sem duplicar e sem ciclo; leitor só consulta', async () => {
    const a = await create('A')
    const b = await create('B')
    const created = await mario.client.post(`/tasks/${a.id}/relations`, { type: 'blocks', target_id: b.id })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const fromB = (await lia.client.get(`/tasks/${b.id}/relations`)).body.data
    assert.deepEqual(fromB.relations.map((r) => [r.type, r.task.code]), [['blocked_by', a.code]])
    assert.equal((await mario.client.get(`/tasks/${b.id}`)).body.data.blocked, true)

    assert.equal((await mario.client.post(`/tasks/${a.id}/relations`, { type: 'blocks', target_id: b.id })).body.error.code, 'RELATION_EXISTS')
    assert.equal((await mario.client.post(`/tasks/${b.id}/relations`, { type: 'blocks', target_id: a.id })).body.error.code, 'RELATION_CYCLE')
    assert.equal((await lia.client.post(`/tasks/${a.id}/relations`, { type: 'relates', target_id: b.id })).status, 403)

    const history = (await mario.client.get(`/tasks/${b.id}/history`)).body.data
    assert.ok(history.some((h) => h.new_value && h.new_value['rel:blocked_by'] === `${a.code} · A`))

    assert.equal((await mario.client.del(`/relations/${created.body.data.id}`)).status, 200)
    assert.equal((await mario.client.get(`/tasks/${b.id}`)).body.data.blocked, false)
  })

  it('subtarefas: progresso no pai; excluir o pai solta as filhas', async () => {
    const parent = await create('Pai')
    const child = await create('Filha', { parent_task_id: parent.id })
    await create('Filha 2', { parent_task_id: parent.id, status_id: st('CONCLUIDO') })
    const view = (await mario.client.get(`/tasks/${parent.id}/relations`)).body.data
    assert.deepEqual(view.subtask_progress, { done: 1, total: 2 })
    assert.equal((await mario.client.get(`/tasks/${child.id}`)).body.data.parent.code, parent.code)
    assert.equal((await mario.client.patch(`/tasks/${parent.id}`, { parent_task_id: child.id })).body.error.details.fields.parent_task_id, 'cycle')

    assert.equal((await admin.del(`/tasks/${parent.id}`)).status, 200)
    assert.equal((await mario.client.get(`/tasks/${child.id}`)).body.data.parent, null)
  })

  it('fork copia anexos (arquivo de verdade) quando pedido e guarda a origem', async () => {
    const source = await create('Manual', { description: 'Texto', checklist: [{ text: 'Revisar', done: true }] })
    const data = new FormData()
    data.append('files', new Blob([PNG], { type: 'image/png' }), 'tela.png')
    assert.equal((await mario.client.post(`/tasks/${source.id}/attachments`, data)).status, 201)

    const fork = await mario.client.post(`/tasks/${source.id}/fork`, { title: 'Manual v2', copy: { attachments: true } })
    assert.equal(fork.status, 201, JSON.stringify(fork.body))
    assert.equal(fork.body.data.forked_from.code, source.code)
    assert.equal(fork.body.data.description, 'Texto')
    assert.deepEqual(fork.body.data.checklist.map((i) => i.done), [false])
    const copies = (await mario.client.get(`/tasks/${fork.body.data.id}/attachments`)).body.data
    assert.deepEqual(copies.map((c) => c.name), ['tela.png'])
    const file = await mario.client.get(`/attachments/${copies[0].id}/file`, { raw: true })
    assert.ok(file.bytes.equals(PNG))
    const forks = (await mario.client.get(`/tasks/${source.id}/relations`)).body.data.forks
    assert.deepEqual(forks.map((t) => t.title), ['Manual v2'])
    assert.equal((await lia.client.post(`/tasks/${source.id}/fork`, {})).status, 403)
  })
})
