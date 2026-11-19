/**
 * Módulos da documentação (§43) — testes de API: CRUD pelas rotas e o `module_id` do espaço gravado
 * de verdade (criação e configuração passam pela rota inteira, sem perder o campo no caminho).
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

describe('API Módulos da documentação', { timeout: 180000 }, () => {
  let pb
  let admin
  let mario
  let otto
  let project

  before(async () => {
    pb = await startServer()
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    const make = async (name, email, role) => {
      const created = (await admin.post('/users', { name, email, password: 'SenhaTeste123', role_id: roles.find((r) => r.code === role).id })).body.data
      const client = createClient(pb.api)
      await client.login(email, 'SenhaTeste123')
      return { client, user: created }
    }
    const m = await make('Mário', 'mario@example.com', 'MEMBER')
    const o = await make('Otto', 'otto@example.com', 'MEMBER')
    mario = m.client
    otto = o.client
    project = (await admin.post('/projects', { name: 'CRM', key: 'CRM' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: m.user.id, role: 'member' })
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('CRUD: só docs.manage altera; nome único sem maiúsculas/acentos; reordena; exclusão deixa os espaços sem módulo', async () => {
    const created = await admin.post('/docs/modules', { name: 'Marketing', color: 'pink' })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const mkt = created.body.data
    assert.deepEqual([mkt.name, mkt.color, mkt.position, mkt.space_count], ['Marketing', 'pink', 0, 0])
    const fin = (await admin.post('/docs/modules', { name: 'Finanças', color: 'green' })).body.data
    assert.equal(fin.position, 1)

    const dup = await admin.post('/docs/modules', { name: 'MARKETING' })
    assert.equal(dup.status, 409)
    assert.equal(dup.body.error.code, 'DOC_MODULE_NAME_IN_USE')
    assert.equal((await admin.post('/docs/modules', { name: 'financas' })).body.error.code, 'DOC_MODULE_NAME_IN_USE')
    assert.equal((await admin.post('/docs/modules', { name: 'TI', color: '#123456' })).status, 400)
    assert.equal((await mario.post('/docs/modules', { name: 'TI' })).status, 403)
    assert.equal((await mario.patch(`/docs/modules/${mkt.id}`, { name: 'X' })).status, 403)
    assert.equal((await mario.del(`/docs/modules/${mkt.id}`)).status, 403)
    assert.equal((await admin.patch('/docs/modules/naoexiste12345', { name: 'X' })).status, 404)

    const renamed = await admin.patch(`/docs/modules/${fin.id}`, { name: 'Financeiro', position: 0 })
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body))
    assert.deepEqual([renamed.body.data.name, renamed.body.data.position], ['Financeiro', 0])
    // qualquer pessoa com docs.view lista, na ordem
    assert.deepEqual((await otto.get('/docs/modules')).body.data.map((m) => m.name), ['Financeiro', 'Marketing'])

    const space = (await admin.post('/docs/spaces', { key: 'MKT', name: 'Campanhas', visibility: 'company', module_id: mkt.id })).body.data
    assert.deepEqual(space.module, { id: mkt.id, name: 'Marketing', color: 'pink' })
    assert.equal((await otto.get('/docs/modules')).body.data.find((m) => m.id === mkt.id).space_count, 1)

    const removed = await admin.del(`/docs/modules/${mkt.id}`)
    assert.equal(removed.status, 200, JSON.stringify(removed.body))
    assert.deepEqual(removed.body.data, { deleted: true, spaces: 1 })
    assert.equal((await otto.get('/docs/spaces/MKT')).body.data.space.module, null)
    assert.deepEqual((await otto.get('/docs/modules')).body.data.map((m) => m.name), ['Financeiro'])

    const history = (await admin.get('/audit-logs?entity_type=doc_module&perPage=50')).body.data.map((e) => e.action)
    assert.ok(history.includes('doc_module.created') && history.includes('doc_module.updated') && history.includes('doc_module.deleted'), JSON.stringify(history))
  })

  it('module_id do espaço persiste pela rota (criar, mover, tirar) e vem na lista e no detalhe', async () => {
    const ops = (await admin.post('/docs/modules', { name: 'Operações', color: 'amber' })).body.data
    const ti = (await admin.post('/docs/modules', { name: 'TI e sistemas', color: 'violet' })).body.data

    const created = await admin.post('/docs/spaces', { key: 'CRMDOC', name: 'Docs do CRM', visibility: 'project', project_id: project.id, module_id: ops.id })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.equal(created.body.data.module.id, ops.id)
    // relido do banco, não só o eco da resposta
    assert.equal((await mario.get('/docs/spaces/CRMDOC')).body.data.space.module.id, ops.id)

    const moved = await admin.patch(`/docs/spaces/${created.body.data.id}`, { module_id: ti.id })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.deepEqual((await mario.get('/docs/spaces')).body.data.find((s) => s.key === 'CRMDOC').module, { id: ti.id, name: 'TI e sistemas', color: 'violet' })

    // quem só edita páginas não troca o módulo
    assert.equal((await mario.patch(`/docs/spaces/${created.body.data.id}`, { module_id: ops.id })).status, 403)
    assert.equal((await admin.patch(`/docs/spaces/${created.body.data.id}`, { module_id: 'naoexiste12345' })).body.error.code, 'DOC_MODULE_NOT_FOUND')

    assert.equal((await admin.patch(`/docs/spaces/${created.body.data.id}`, { module_id: '' })).status, 200)
    assert.equal((await mario.get('/docs/spaces/CRMDOC')).body.data.space.module, null)
    // Otto não vê o espaço do projeto: a contagem dele não inclui
    await admin.patch(`/docs/spaces/${created.body.data.id}`, { module_id: ti.id })
    assert.equal((await otto.get('/docs/modules')).body.data.find((m) => m.id === ti.id).space_count, 0)
    assert.equal((await mario.get('/docs/modules')).body.data.find((m) => m.id === ti.id).space_count, 1)
  })
})
