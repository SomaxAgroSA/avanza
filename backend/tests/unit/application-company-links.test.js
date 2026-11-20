/**
 * Empresa no projeto, na tarefa e na demanda interna (§46): obrigatória quando existe empresa ativa, só
 * empresa ativa, a tarefa de projeto herda a do projeto, a demanda interna guarda a sua, e o filtro
 * `company_id` nas listas de tarefas e de demandas.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createCompanyService } = require('../../src/application/companies')
const { createProjectService } = require('../../src/application/projects')
const { createTaskService } = require('../../src/application/tasks')
const { createDemandService } = require('../../src/application/demands')
const { createLookupService } = require('../../src/application/lookups')
const { createTaskTypeService } = require('../../src/application/task-types')
const { createPrincipal } = require('../../src/domain/rbac')

async function ctxOf(deps, user) {
  const role = await deps.roleRepository.findById(user.roleId)
  return {
    principal: createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: await deps.roleRepository.getPermissionCodes(role.id) }),
    ip: '1.1.1.1',
    userAgent: 'ua',
    correlationId: 'c',
  }
}

async function codeOf(fn) {
  try {
    await fn()
  } catch (err) {
    return err.code === 'VALIDATION_ERROR' ? `${err.code}:${JSON.stringify(err.details.fields)}` : err.code
  }
  return 'OK'
}

async function setup() {
  const deps = createFakeDeps()
  const adminUser = await seedUser(deps, { roleCode: 'ADMIN', name: 'Admin' })
  const cesarUser = await seedUser(deps, { roleCode: 'MANAGER', name: 'César' })
  const admin = await ctxOf(deps, adminUser)
  const cesar = await ctxOf(deps, cesarUser)
  const statuses = createLookupService(deps, 'status')
  await statuses.create(admin, { key: 'BACKLOG', name: 'Backlog', category: 'backlog', color: 'gray' })
  await statuses.create(admin, { key: 'DONE', name: 'Concluído', category: 'done', color: 'green' })
  await createLookupService(deps, 'priority').create(admin, { key: 'MEDIA', name: 'Média', color: 'amber' })
  const area = await createLookupService(deps, 'area').create(admin, { key: 'EST', name: 'Estratégia', color: 'blue' })
  const type = await createTaskTypeService(deps).createType(admin, { key: 'DEV', name: 'Desenvolvimento', icon: 'code', color: 'blue' })
  return {
    deps,
    admin,
    cesar,
    cesarUser,
    area,
    type,
    companies: createCompanyService(deps),
    projects: createProjectService(deps),
    tasks: createTaskService(deps),
    demands: createDemandService(deps),
  }
}

const demandInput = (s, extra) => Object.assign({ task_type_id: s.type.id, title: 'Pedido', demand_owner_id: s.cesarUser.id, area_id: s.area.id }, extra)

describe('empresa no projeto (§46)', () => {
  it('sem empresa ativa, o projeto nasce sem empresa (instalações antigas e testes continuam iguais)', async () => {
    const s = await setup()
    const crm = await s.projects.createProject(s.cesar, { name: 'CRM', key: 'CRM' })
    assert.equal(crm.company, null)
    const old = await s.companies.create(s.admin, { name: 'Antiga', active: false })
    assert.equal(old.active, false)
    assert.equal((await s.projects.createProject(s.cesar, { name: 'ERP', key: 'ERP' })).company, null)
  })

  it('com empresa ativa, é obrigatória ao criar e só aceita empresa ativa', async () => {
    const s = await setup()
    const somax = await s.companies.create(s.admin, { name: 'Somax', short_code: 'SMX' })
    const old = await s.companies.create(s.admin, { name: 'Antiga', active: false })
    assert.equal(await codeOf(() => s.projects.createProject(s.cesar, { name: 'CRM', key: 'CRM' })), 'VALIDATION_ERROR:{"company_id":"required"}')
    assert.equal(await codeOf(() => s.projects.createProject(s.cesar, { name: 'CRM', key: 'CRM', company_id: old.id })), 'VALIDATION_ERROR:{"company_id":"invalid_option"}')
    assert.equal(await codeOf(() => s.projects.createProject(s.cesar, { name: 'CRM', key: 'CRM', company_id: 'x y' })), 'VALIDATION_ERROR:{"company_id":"invalid_type"}')
    const crm = await s.projects.createProject(s.cesar, { name: 'CRM', key: 'CRM', company_id: somax.id })
    assert.deepEqual(crm.company, { id: somax.id, name: 'Somax', short_code: 'SMX' })
    assert.equal(s.deps.store.audit.find((e) => e.action === 'project.created').newValue.company, 'Somax')
    assert.deepEqual((await s.projects.getProject(s.cesar, crm.id)).company, { id: somax.id, name: 'Somax', short_code: 'SMX' })
    assert.equal((await s.projects.listProjects(s.cesar, {})).items[0].company.name, 'Somax')
  })

  it('o projeto antigo (sem empresa) ganha uma na edição; a inativa continua nele mas não é oferecida', async () => {
    const s = await setup()
    const crm = await s.projects.createProject(s.cesar, { name: 'CRM', key: 'CRM' })
    const somax = await s.companies.create(s.admin, { name: 'Somax' })
    const agro = await s.companies.create(s.admin, { name: 'Agro' })
    // editar outro campo não exige a empresa do projeto antigo
    assert.equal((await s.projects.updateProject(s.cesar, crm.id, { name: 'CRM 2' })).company, null)
    const edited = await s.projects.updateProject(s.cesar, crm.id, { company_id: somax.id })
    assert.equal(edited.company.name, 'Somax')
    const entry = s.deps.store.audit.at(-1)
    assert.deepEqual([entry.oldValue.company, entry.newValue.company], [null, 'Somax'])
    // com empresa ativa, não volta a ficar sem
    assert.equal(await codeOf(() => s.projects.updateProject(s.cesar, crm.id, { company_id: null })), 'VALIDATION_ERROR:{"company_id":"required"}')
    await s.companies.update(s.admin, somax.id, { active: false })
    assert.equal((await s.projects.updateProject(s.cesar, crm.id, { name: 'CRM 3' })).company.name, 'Somax')
    assert.equal(await codeOf(() => s.projects.updateProject(s.cesar, crm.id, { company_id: somax.id })), 'OK')
    await s.companies.update(s.admin, agro.id, { active: false })
    // sem nenhuma ativa, pode limpar
    assert.equal((await s.projects.updateProject(s.cesar, crm.id, { company_id: null })).company, null)
    assert.equal(await codeOf(() => s.projects.updateProject(s.cesar, crm.id, { company_id: agro.id })), 'VALIDATION_ERROR:{"company_id":"invalid_option"}')
  })
})

describe('empresa na tarefa e na demanda interna (§46)', () => {
  it('a tarefa de projeto herda a do projeto; a demanda interna guarda a sua; o filtro vale para as duas', async () => {
    const s = await setup()
    const somax = await s.companies.create(s.admin, { name: 'Somax', short_code: 'SMX' })
    const agro = await s.companies.create(s.admin, { name: 'Agro' })
    const crm = await s.projects.createProject(s.cesar, { name: 'CRM', key: 'CRM', company_id: somax.id })
    // a empresa enviada para a tarefa de projeto não é guardada nela
    const task = await s.tasks.createTask(s.cesar, { project_id: crm.id, task_type_id: s.type.id, title: 'Tarefa', company_id: agro.id })
    assert.deepEqual(task.company, { id: somax.id, name: 'Somax', short_code: 'SMX' })
    assert.equal(s.deps.store.tasks.find((t) => t.id === task.id).companyId || null, null)

    assert.equal(await codeOf(() => s.demands.createDemand(s.cesar, demandInput(s))), 'VALIDATION_ERROR:{"company_id":"required"}')
    assert.equal(await codeOf(() => s.demands.createDemand(s.cesar, demandInput(s, { company_id: 'nope' }))), 'VALIDATION_ERROR:{"company_id":"invalid_option"}')
    const demand = await s.demands.createDemand(s.cesar, demandInput(s, { company_id: agro.id }))
    assert.deepEqual(demand.company, { id: agro.id, name: 'Agro', short_code: '' })
    assert.equal(s.deps.store.audit.find((e) => e.entityId === demand.id && e.action === 'task.created').newValue.company, 'Agro')

    const codes = async (query) => (await s.tasks.listTasks(s.admin, query)).items.map((t) => [t.code, t.company ? t.company.name : null])
    assert.deepEqual(await codes({}), [['CRM-1', 'Somax'], ['DEM-1', 'Agro']])
    assert.deepEqual(await codes({ company_id: somax.id }), [['CRM-1', 'Somax']])
    assert.deepEqual(await codes({ company_id: agro.id }), [['DEM-1', 'Agro']])
    assert.equal(await codeOf(() => s.tasks.listTasks(s.admin, { company_id: 'a b' })), 'VALIDATION_ERROR:{"company_id":"invalid_type"}')

    const demandTitles = async (query) => (await s.demands.listDemands(s.admin, Object.assign({ box: 'all' }, query))).items.map((t) => t.company && t.company.name)
    assert.deepEqual(await demandTitles({}), ['Agro'])
    assert.deepEqual(await demandTitles({ company_id: agro.id }), ['Agro'])
    assert.deepEqual(await demandTitles({ company_id: somax.id }), [])
  })

  it('tarefa de projeto sem empresa e filtro "none"', async () => {
    const s = await setup()
    const crm = await s.projects.createProject(s.cesar, { name: 'CRM', key: 'CRM' })
    const task = await s.tasks.createTask(s.cesar, { project_id: crm.id, task_type_id: s.type.id, title: 'Tarefa' })
    assert.equal(task.company, null)
    const somax = await s.companies.create(s.admin, { name: 'Somax' })
    assert.deepEqual((await s.tasks.listTasks(s.admin, { company_id: 'none' })).items.map((t) => t.code), ['CRM-1'])
    assert.deepEqual((await s.tasks.listTasks(s.admin, { company_id: somax.id })).items.map((t) => t.code), [])
  })

  it('a edição da demanda interna troca a empresa (só ativa) e não a deixa sem empresa quando há ativa', async () => {
    const s = await setup()
    const somax = await s.companies.create(s.admin, { name: 'Somax' })
    const agro = await s.companies.create(s.admin, { name: 'Agro' })
    const demand = await s.demands.createDemand(s.cesar, demandInput(s, { company_id: somax.id }))
    const edited = await s.tasks.updateTask(s.cesar, demand.id, { company_id: agro.id })
    assert.equal(edited.company.name, 'Agro')
    const entry = s.deps.store.audit.at(-1)
    assert.deepEqual([entry.oldValue.company, entry.newValue.company], ['Somax', 'Agro'])
    assert.equal(await codeOf(() => s.tasks.updateTask(s.cesar, demand.id, { company_id: null })), 'VALIDATION_ERROR:{"company_id":"required"}')
    await s.companies.update(s.admin, somax.id, { active: false })
    assert.equal(await codeOf(() => s.tasks.updateTask(s.cesar, demand.id, { company_id: somax.id })), 'VALIDATION_ERROR:{"company_id":"invalid_option"}')
  })
})
