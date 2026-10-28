/**
 * Tags, checklist, comentários e menções — testes de API contra um PocketBase real.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

describe('API tags, checklist e comentários', { timeout: 180000 }, () => {
  let pb
  let admin
  let member
  let viewer
  let outsider
  let task

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
    member = await make('Mário', 'mario@example.com', 'MEMBER')
    viewer = await make('Lia', 'lia@example.com', 'VIEWER')
    outsider = await make('Otto', 'otto@example.com', 'MEMBER')
    const project = (await admin.post('/projects', { name: 'CRM', key: 'CRM' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: member.user.id, role: 'member' })
    await admin.post(`/projects/${project.id}/members`, { user_id: viewer.user.id, role: 'viewer' })
    const doc = (await admin.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO')
    task = (await member.client.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: 'Manual' })).body.data
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('tags: admin cadastra; tarefa recebe e filtra; nome é único', async () => {
    const created = await admin.post('/tags', { name: 'Cliente', color: 'violet' })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.equal((await admin.post('/tags', { name: 'cliente' })).body.error.code, 'TAG_NAME_IN_USE')
    assert.equal((await member.client.post('/tags', { name: 'Outra' })).status, 403)

    const updated = await member.client.patch(`/tasks/${task.id}`, { tag_ids: [created.body.data.id] })
    assert.equal(updated.status, 200, JSON.stringify(updated.body))
    assert.deepEqual(updated.body.data.tags.map((t) => t.name), ['Cliente'])
    assert.deepEqual((await member.client.get(`/tasks?tag_id=${created.body.data.id}`)).body.data.map((t) => t.code), ['CRM-1'])
    assert.equal((await admin.get('/tags')).body.data[0].task_count, 1)
  })

  it('checklist: salva itens com ids, mostra progresso', async () => {
    const res = await member.client.patch(`/tasks/${task.id}`, { checklist: [{ text: 'Escrever' }, { text: 'Revisar', done: true }] })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.data.checklist.length, 2)
    assert.ok(res.body.data.checklist[0].id)
    assert.deepEqual(res.body.data.checklist_progress, { done: 1, total: 2 })
    const list = (await member.client.get('/tasks')).body.data[0]
    assert.deepEqual(list.checklist_progress, { done: 1, total: 2 })
  })

  it('leitora comenta e menciona; histórico mostra comentário e menções', async () => {
    const candidates = (await viewer.client.get(`/tasks/${task.id}/mention-candidates`)).body.data.map((u) => u.name)
    assert.ok(candidates.includes('Mário') && candidates.includes('Lia'))
    assert.ok(!candidates.includes('Otto'))

    const posted = await viewer.client.post(`/tasks/${task.id}/comments`, { content: `@[Mário](${member.user.id}) pode revisar o **manual**?` })
    assert.equal(posted.status, 201, JSON.stringify(posted.body))
    assert.deepEqual(posted.body.data.mentions.map((m) => m.name), ['Mário'])

    const bad = await viewer.client.post(`/tasks/${task.id}/comments`, { content: `oi @[Otto](${outsider.user.id})` })
    assert.equal(bad.body.error.details.fields.content, 'invalid_mention')
    assert.equal((await outsider.client.post(`/tasks/${task.id}/comments`, { content: 'x' })).body.error.code, 'TASK_NOT_FOUND')

    const history = (await member.client.get(`/tasks/${task.id}/history`)).body.data
    assert.equal(history[0].action, 'comment.added')
    // no histórico, menções viram "@Nome" e a marcação Markdown some
    assert.deepEqual(history[0].new_value, { comment: '@Mário pode revisar o manual?', mentions: 'Mário' })
    assert.equal(history[0].user.name, 'Lia')
    assert.equal((await member.client.get('/tasks')).body.data[0].comment_count, 1)
  })

  it('só o autor edita; autor ou gestor exclui', async () => {
    const [comment] = (await member.client.get(`/tasks/${task.id}/comments`)).body.data
    assert.equal((await member.client.patch(`/comments/${comment.id}`, { content: 'x' })).status, 403)
    const edited = await viewer.client.patch(`/comments/${comment.id}`, { content: 'Revisado, obrigado!' })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    assert.ok(edited.body.data.edited_at)
    assert.equal((await member.client.del(`/comments/${comment.id}`)).status, 403)
    assert.equal((await admin.del(`/comments/${comment.id}`)).status, 200)
    const [shown] = (await viewer.client.get(`/tasks/${task.id}/comments`)).body.data
    assert.deepEqual([shown.deleted, shown.content], [true, ''])
    const actions = (await member.client.get(`/tasks/${task.id}/history`)).body.data.map((h) => h.action)
    assert.deepEqual(actions.slice(0, 3), ['comment.deleted', 'comment.edited', 'comment.added'])
  })
})
