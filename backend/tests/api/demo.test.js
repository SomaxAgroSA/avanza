/**
 * Dados de demonstração (`npm run demo`) contra um PocketBase real e isolado: tudo é criado pela API,
 * o quadro fica completo e rodar de novo não duplica nada.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')
const { seedDemo } = require('../../scripts/demo-data')

describe('API Dados de demonstração', { timeout: 180000 }, () => {
  let pb
  let admin

  before(async () => {
    pb = await startServer()
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('cria projeto, tarefas, quadro da Gestão de projetos e documentação; na segunda vez não muda nada', async () => {
    const result = await seedDemo(admin)
    assert.equal(result.created, true)
    const p = result.project.id
    const tasks = (await admin.get(`/tasks?project_id=${p}&perPage=50`)).body.data
    assert.ok(tasks.length >= 5)
    const board = (await admin.get(`/projects/${p}/plan`)).body.data
    assert.deepEqual(board.groups.map((g) => `${g.number} ${g.name}`), ['1.0 Iniciação', '2.0 Planejamento', '2.1 Plano do Projeto', '3.0 Execução'])
    assert.ok(board.items.length >= 7)
    assert.deepEqual(board.columns.map((c) => c.name), ['Custo', 'Contrato'])
    assert.ok(board.settings.baseline_at)
    assert.equal((await admin.get(`/projects/${p}/plan/issues`)).body.data.issues.length, 2)
    assert.equal((await admin.get(`/projects/${p}/plan/report`)).status, 200)
    const spaces = (await admin.get('/docs/spaces')).body.data
    assert.ok(spaces.some((s) => s.key === 'DEMO'))

    const again = await seedDemo(admin)
    assert.equal(again.created, false)
  })
})
