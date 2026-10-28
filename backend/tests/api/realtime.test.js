/**
 * Tempo real — API contra um PocketBase real e isolado: a conexão SSE assina tópicos com a sessão do
 * cookie (e o header de CSRF); só os projetos que a pessoa vê; os avisos chegam depois de gravar e
 * levam só identificadores; a notificação chega no tópico da pessoa.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')
const { connectRealtime } = require('../support/sse-client')

describe('API Tempo real', { timeout: 180000 }, () => {
  let pb
  let root
  let mia
  let miaUser
  let crm
  let erp
  let doc
  const connections = []

  before(async () => {
    pb = await startServer()
    root = createClient(pb.api)
    await root.login(pb.admin.email, pb.admin.password)
    const roles = (await root.get('/roles')).body.data
    miaUser = (await root.post('/users', { name: 'Mia', email: 'mia@example.com', password: 'SenhaTeste123', role_id: roles.find((r) => r.code === 'MEMBER').id })).body.data
    mia = createClient(pb.api)
    await mia.login('mia@example.com', 'SenhaTeste123')
    crm = (await root.post('/projects', { name: 'CRM', key: 'CRM' })).body.data
    erp = (await root.post('/projects', { name: 'ERP', key: 'ERP' })).body.data
    await root.post(`/projects/${crm.id}/members`, { user_id: miaUser.id, role: 'member' })
    doc = (await root.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO')
  })

  after(async () => {
    connections.forEach((c) => c.close())
    if (pb) await pb.stop()
  })

  async function connect(cookie) {
    const connection = await connectRealtime(pb.baseUrl, cookie)
    connections.push(connection)
    return connection
  }

  it('assinar exige sessão e o header de CSRF', async () => {
    const live = await connect(mia.cookie())
    assert.equal((await live.subscribe([`project:${crm.id}`], { cookie: '' })).status, 401)
    assert.equal((await live.subscribe([`project:${crm.id}`], { csrf: false })).status, 403)
    assert.equal((await live.subscribe([`project:${crm.id}`])).status, 204)
    // outra sessão não reaproveita a conexão de outra pessoa
    assert.equal((await live.subscribe([`project:${erp.id}`], { cookie: root.cookie() })).status, 403)
  })

  it('tarefa nova no projeto chega como aviso com identificadores; projeto que a pessoa não vê não chega', async () => {
    const live = await connect(mia.cookie())
    assert.equal((await live.subscribe([`project:${crm.id}`, `project:${erp.id}`, `user:${miaUser.id}`])).status, 204)
    const hidden = (await root.post('/tasks', { project_id: erp.id, task_type_id: doc.id, title: 'Segredo do ERP' })).body.data
    const task = (await root.post('/tasks', { project_id: crm.id, task_type_id: doc.id, title: 'Tela nova', assignee_id: miaUser.id })).body.data
    const event = await live.waitFor((e) => e.name === `project:${crm.id}` && e.data.collection === 'tasks' && e.data.id === task.id)
    assert.deepEqual(event.data, { collection: 'tasks', action: 'create', id: task.id, project_id: crm.id, task_id: task.id, item_id: null })
    // atribuída a ela: a notificação chega no tópico dela
    await live.waitFor((e) => e.name === `user:${miaUser.id}` && e.data.collection === 'notifications')
    assert.equal(live.events.some((e) => e.name === `project:${erp.id}` || (e.data && e.data.id === hidden.id)), false)
    assert.equal(JSON.stringify(live.events).includes('Tela nova'), false)

    // comentário: o projeto vem da tarefa
    await root.post(`/tasks/${task.id}/comments`, { content: 'Pode revisar?' })
    const comment = await live.waitFor((e) => e.data && e.data.collection === 'comments')
    assert.equal(comment.name, `project:${crm.id}`)
    assert.equal(comment.data.task_id, task.id)
  })

  it('mudança no quadro da Gestão de projetos chega no tópico do projeto', async () => {
    const live = await connect(mia.cookie())
    await live.subscribe([`project:${crm.id}`])
    const group = (await root.post(`/projects/${crm.id}/groups`, { name: 'Execução', color: 'blue' })).body.data
    const item = (await root.post(`/projects/${crm.id}/plan/items`, { group_id: group.id, name: 'Kickoff' })).body.data
    const event = await live.waitFor((e) => e.data && e.data.collection === 'plan_items' && e.data.id === item.id)
    assert.equal(event.data.item_id, item.id)
  })
})
