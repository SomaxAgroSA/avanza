/**
 * Notificações — testes de API contra um PocketBase real.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

function day(offset) {
  const d = new Date()
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset)
  return new Date(utc).toISOString().slice(0, 10)
}

describe('API /api/v1/notifications', { timeout: 180000 }, () => {
  let pb
  let admin
  let mario
  let lia
  let project
  let doc

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
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('atribuição e menção chegam na caixa; contador de não lidas', async () => {
    const task = (await admin.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: 'Manual', assignee_id: mario.user.id })).body.data
    await mario.client.post(`/tasks/${task.id}/comments`, { content: `@[Lia](${lia.user.id}) pode revisar?` })

    const liaInbox = await lia.client.get('/notifications')
    assert.equal(liaInbox.status, 200, JSON.stringify(liaInbox.body))
    assert.deepEqual(liaInbox.body.data.map((n) => [n.type, n.task.code, n.actor.name]), [['mention', 'CRM-1', 'Mário']])
    assert.equal(liaInbox.body.data[0].data.comment, '@Lia pode revisar?')

    const marioInbox = (await mario.client.get('/notifications')).body.data
    assert.deepEqual(marioInbox.map((n) => n.type), ['assigned'])
    assert.equal((await mario.client.get('/notifications/unread-count')).body.data.count, 1)
  })

  it('marcar como lida (só as próprias) e todas', async () => {
    const [n] = (await mario.client.get('/notifications')).body.data
    assert.equal((await lia.client.post(`/notifications/${n.id}/read`)).body.error.code, 'NOTIFICATION_NOT_FOUND')
    assert.equal((await mario.client.post(`/notifications/${n.id}/read`)).status, 200)
    assert.equal((await mario.client.get('/notifications/unread-count')).body.data.count, 0)
    assert.equal((await mario.client.get('/notifications?unread=1')).body.data.length, 0)
    assert.deepEqual((await lia.client.post('/notifications/read-all')).body.data, { updated: 1 })
    assert.equal((await mario.client.post(`/notifications/${n.id}/read`, {}, { csrf: false })).status, 403)
  })

  it('lembretes de prazo: amanhã e vencido, sem repetir; só settings.manage dispara manualmente', async () => {
    await admin.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: 'Vence amanhã', assignee_id: mario.user.id, due_date: day(1) })
    await admin.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: 'Atrasada', assignee_id: mario.user.id, due_date: day(-2) })
    await admin.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: 'Semana que vem', assignee_id: mario.user.id, due_date: day(7) })
    assert.equal((await mario.client.post('/notifications/due-reminders')).status, 403)
    const run = await admin.post('/notifications/due-reminders')
    assert.equal(run.status, 200, JSON.stringify(run.body))
    assert.equal(run.body.data.created, 2)
    assert.equal((await admin.post('/notifications/due-reminders')).body.data.created, 0)
    const reminders = (await mario.client.get('/notifications?unread=1')).body.data
      .filter((n) => n.type === 'due_soon' || n.type === 'overdue')
      .map((n) => [n.type, n.task.title])
      .sort()
    assert.deepEqual(reminders, [['due_soon', 'Vence amanhã'], ['overdue', 'Atrasada']])
  })
})
