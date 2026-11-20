/**
 * Empresas (§46) pela API real e isolada: cadastro (permissão, unicidade, desativar em vez de excluir,
 * histórico), empresa do projeto (obrigatória com empresa ativa), da demanda interna e herdada pela tarefa
 * de projeto, e o filtro `company_id` em GET /tasks e GET /demands — todos os campos passando pelas rotas.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const PASSWORD = 'SenhaTeste123'

describe('API — empresas (§46)', { timeout: 240000 }, () => {
  let pb
  let admin
  let gestor
  let type
  let area
  let somax
  let agro
  let legacy
  let crm
  let projectTask
  let demand

  before(async () => {
    pb = await startServer()
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    const created = await admin.post('/users', { name: 'Gestor', email: 'gestor@example.com', password: PASSWORD, role_id: roles.find((r) => r.code === 'MANAGER').id })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    gestor = createClient(pb.api)
    await gestor.login('gestor@example.com', PASSWORD)
    type = (await admin.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO')
    area = (await admin.post('/areas', { key: 'ESTRAT', name: 'Estratégia', color: 'blue' })).body.data
    // projeto antigo, de antes das empresas: nasce sem empresa (nenhuma ativa ainda)
    legacy = (await gestor.post('/projects', { name: 'Legado', key: 'LEG' })).body.data
    assert.equal(legacy.company, null)
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('cadastro: só platform.manage cria e altera; nome único sem diferença de maiúsculas; sigla em maiúsculas', async () => {
    assert.equal((await gestor.post('/companies', { name: 'Somax' })).status, 403)
    const res = await admin.post('/companies', { name: '  Somax   Paraguay ', short_code: 'smx' })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    somax = res.body.data
    assert.equal(somax.name, 'Somax Paraguay')
    assert.equal(somax.short_code, 'SMX')
    assert.equal(somax.active, true)
    const duplicate = await admin.post('/companies', { name: 'SOMAX paraguay' })
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.body.error.code, 'COMPANY_NAME_IN_USE')
    const invalid = await admin.post('/companies', { name: '', short_code: 'A B' })
    assert.equal(invalid.status, 400)
    assert.deepEqual(invalid.body.error.details.fields, { name: 'required', short_code: 'invalid_format' })
    agro = (await admin.post('/companies', { name: 'Agro' })).body.data
    const patched = await admin.patch(`/companies/${agro.id}`, { name: 'Agro SA', short_code: 'agr', active: true })
    assert.equal(patched.status, 200, JSON.stringify(patched.body))
    assert.deepEqual([patched.body.data.name, patched.body.data.short_code], ['Agro SA', 'AGR'])
    assert.equal((await gestor.patch(`/companies/${agro.id}`, { active: false })).status, 403)
    assert.equal((await admin.patch('/companies/naoexiste', { active: false })).status, 404)
    // não há exclusão
    assert.ok([404, 405].includes((await admin.del(`/companies/${agro.id}`)).status))
    const history = (await admin.get('/audit-logs?entity_type=company')).body.data.map((e) => e.action)
    assert.ok(history.includes('company.created'))
    assert.ok(history.includes('company.updated'))
  })

  it('projeto: com empresa ativa, obrigatória ao criar; aparece no projeto e na lista; o antigo ganha na edição', async () => {
    const missing = await gestor.post('/projects', { name: 'CRM', key: 'CRM' })
    assert.equal(missing.status, 400)
    assert.deepEqual(missing.body.error.details.fields, { company_id: 'required' })
    const res = await gestor.post('/projects', { name: 'CRM', key: 'CRM', company_id: somax.id })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    crm = res.body.data
    assert.deepEqual(crm.company, { id: somax.id, name: 'Somax Paraguay', short_code: 'SMX' })
    assert.equal((await gestor.get(`/projects/${crm.id}`)).body.data.company.id, somax.id)
    const listed = (await gestor.get('/projects')).body.data
    assert.equal(listed.find((p) => p.id === crm.id).company.name, 'Somax Paraguay')
    assert.equal(listed.find((p) => p.id === legacy.id).company, null)
    const edited = await gestor.patch(`/projects/${legacy.id}`, { company_id: agro.id })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    assert.equal(edited.body.data.company.name, 'Agro SA')
    const cleared = await gestor.patch(`/projects/${legacy.id}`, { company_id: null })
    assert.deepEqual(cleared.body.error.details.fields, { company_id: 'required' })
  })

  it('tarefa de projeto herda a empresa do projeto; demanda interna guarda a sua; filtros em /tasks e /demands', async () => {
    const task = await gestor.post('/tasks', { project_id: crm.id, task_type_id: type.id, title: 'Tarefa do CRM', company_id: agro.id })
    assert.equal(task.status, 201, JSON.stringify(task.body))
    projectTask = task.body.data
    assert.equal(projectTask.company.id, somax.id)

    const me = (await admin.get('/auth/me')).body.data.user.id
    const required = await gestor.post('/demands', { task_type_id: type.id, title: 'Pedido', demand_owner_id: me, area_id: area.id })
    assert.equal(required.status, 400)
    assert.deepEqual(required.body.error.details.fields, { company_id: 'required' })
    const res = await gestor.post('/demands', { task_type_id: type.id, title: 'Pedido', demand_owner_id: me, area_id: area.id, company_id: agro.id })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    demand = res.body.data
    assert.deepEqual(demand.company, { id: agro.id, name: 'Agro SA', short_code: 'AGR' })
    assert.equal((await gestor.get(`/tasks/${demand.id}`)).body.data.company.id, agro.id)

    const codes = async (query) => (await admin.get(`/tasks?${query}`)).body.data.map((t) => `${t.code}:${t.company ? t.company.name : '-'}`).sort()
    assert.deepEqual(await codes(''), ['CRM-1:Somax Paraguay', 'DEM-1:Agro SA'])
    assert.deepEqual(await codes(`company_id=${somax.id}`), ['CRM-1:Somax Paraguay'])
    assert.deepEqual(await codes(`company_id=${agro.id}`), ['DEM-1:Agro SA'])
    assert.equal((await admin.get('/tasks?company_id=a%20b')).status, 400)

    const demands = async (query) => (await admin.get(`/demands?box=all${query}`)).body.data.map((t) => t.code)
    assert.deepEqual(await demands(''), ['DEM-1'])
    assert.deepEqual(await demands(`&company_id=${agro.id}`), ['DEM-1'])
    assert.deepEqual(await demands(`&company_id=${somax.id}`), [])
  })

  it('a edição da demanda troca a empresa; inativa: some das opções, fica nos registros e conta no uso', async () => {
    const edited = await gestor.patch(`/tasks/${demand.id}`, { company_id: somax.id })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    assert.equal(edited.body.data.company.id, somax.id)
    const off = await admin.patch(`/companies/${agro.id}`, { active: false })
    assert.equal(off.body.data.active, false)
    assert.deepEqual((await gestor.get('/companies')).body.data.map((c) => c.name), ['Somax Paraguay'])
    // sem platform.manage, include_inactive é ignorado e as contagens não vêm
    const plain = (await gestor.get('/companies?include_inactive=true')).body.data
    assert.deepEqual(plain.map((c) => c.name), ['Somax Paraguay'])
    assert.equal(plain[0].usage_count, undefined)
    const all = (await admin.get('/companies?include_inactive=true')).body.data
    assert.deepEqual(
      all.map((c) => [c.name, c.active, c.project_count, c.demand_count, c.usage_count]),
      [
        ['Agro SA', false, 1, 0, 1],
        ['Somax Paraguay', true, 1, 1, 2],
      ],
    )
    // o projeto com a empresa inativa continua com ela; não se escolhe a inativa para um projeto novo
    assert.equal((await gestor.get(`/projects/${legacy.id}`)).body.data.company.name, 'Agro SA')
    const blocked = await gestor.post('/projects', { name: 'ERP', key: 'ERP', company_id: agro.id })
    assert.deepEqual(blocked.body.error.details.fields, { company_id: 'invalid_option' })
  })
})
