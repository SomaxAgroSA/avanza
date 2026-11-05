/**
 * Projetos — testes de API ponta a ponta contra um PocketBase real.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startPocketBase, createClient } = require('../support/pb-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

describe('API /api/v1/projects', { timeout: 120000 }, () => {
  let pb
  let admin
  let roles

  before(async () => {
    pb = await startPocketBase()
    await pb.updateSettings({ rateLimits: { enabled: true, rules: RULES } })
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    roles = (await admin.get('/roles')).body.data
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  async function userWithRole(code, email) {
    const res = await admin.post('/users', { name: email.split('@')[0], email, password: 'SenhaTeste123', role_id: roles.find((r) => r.code === code).id })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const client = createClient(pb.api)
    await client.login(email, 'SenhaTeste123')
    return { client, user: res.body.data }
  }

  it('fluxo completo: criar, listar, membros, arquivar e excluir', async () => {
    const manager = await userWithRole('MANAGER', 'gestor@kamban.test')
    const member = await userWithRole('MEMBER', 'membro@kamban.test')

    const created = await manager.client.post('/projects', {
      name: 'CRM Corporativo',
      key: 'crm',
      description: 'Novo CRM',
      priority: 'high',
      start_date: '2026-01-01',
      due_date: '2026-06-30',
    })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const project = created.body.data
    assert.equal(project.key, 'CRM')
    assert.equal(project.owner.email, 'gestor@kamban.test')
    assert.equal(project.member_count, 1)
    assert.equal(project.capabilities.edit, true)
    assert.equal(project.due_date, '2026-06-30T00:00:00.000Z')

    // chave duplicada
    assert.equal((await manager.client.post('/projects', { name: 'Outro', key: 'CRM' })).body.error.code, 'PROJECT_KEY_IN_USE')

    // membro sem vínculo não enxerga (IDOR -> 404)
    assert.equal((await member.client.get(`/projects/${project.id}`)).status, 404)
    assert.equal((await member.client.get('/projects')).body.meta.total, 0)

    // adiciona membro via candidatos
    const candidates = (await manager.client.get(`/projects/${project.id}/member-candidates?search=membro`)).body.data
    assert.deepEqual(candidates.map((c) => c.email), ['membro@kamban.test'])
    const added = await manager.client.post(`/projects/${project.id}/members`, { user_id: member.user.id, role: 'member' })
    assert.equal(added.status, 201, JSON.stringify(added.body))
    assert.equal(added.body.data.length, 2)

    const seen = (await member.client.get(`/projects/${project.id}`)).body.data
    assert.equal(seen.my_role, 'member')
    assert.equal(seen.capabilities.edit, false)
    assert.equal((await member.client.patch(`/projects/${project.id}`, { name: 'Hack' })).status, 403)

    // listagem com filtros, busca e ordenação
    await manager.client.post('/projects', { name: 'Integrações', key: 'INT', status: 'active' })
    const page = await manager.client.get('/projects?sort=-name&perPage=10')
    assert.deepEqual(page.body.data.map((p) => p.key), ['INT', 'CRM'])
    assert.equal((await manager.client.get('/projects?status=active')).body.meta.total, 1)
    assert.equal((await manager.client.get('/projects?search=crm')).body.data[0].key, 'CRM')

    // admin (projects.view_all) enxerga tudo; "mine" só os dele
    assert.equal((await admin.get('/projects')).body.meta.total, 2)
    assert.equal((await admin.get('/projects?view=mine')).body.meta.total, 0)

    // edição e histórico
    const updated = await manager.client.patch(`/projects/${project.id}`, { status: 'active', due_date: null })
    assert.equal(updated.body.data.status, 'active')
    assert.equal(updated.body.data.due_date, null)
    const history = (await member.client.get(`/projects/${project.id}/history`)).body.data
    assert.deepEqual(history.map((h) => h.action).slice(0, 3), ['project.updated', 'project.member_added', 'project.created'])

    // arquivar -> somente leitura, some da lista padrão
    assert.equal((await manager.client.post(`/projects/${project.id}/archive`)).status, 200)
    assert.equal((await manager.client.patch(`/projects/${project.id}`, { name: 'X' })).body.error.code, 'PROJECT_ARCHIVED')
    assert.deepEqual((await manager.client.get('/projects')).body.data.map((p) => p.key), ['INT'])
    assert.equal((await manager.client.get('/projects?view=archived')).body.meta.total, 1)

    // MANAGER não tem projects.delete
    assert.equal((await manager.client.del(`/projects/${project.id}`)).status, 403)
    // admin exclui projeto arquivado
    assert.equal((await admin.del(`/projects/${project.id}`)).status, 200)
    assert.equal((await admin.get(`/projects/${project.id}`)).status, 404)
  })

  it('regras de membros e posse', async () => {
    const manager = await userWithRole('MANAGER', 'gestor2@kamban.test')
    const other = await userWithRole('MEMBER', 'outro@kamban.test')
    const project = (await manager.client.post('/projects', { name: 'SAP', key: 'SAP' })).body.data
    const ownerId = project.owner.id

    assert.equal((await manager.client.del(`/projects/${project.id}/members/${ownerId}`)).body.error.code, 'CANNOT_REMOVE_OWNER')
    assert.equal(
      (await manager.client.patch(`/projects/${project.id}/members/${ownerId}`, { role: 'viewer' })).body.error.code,
      'OWNER_ROLE_LOCKED',
    )

    await manager.client.post(`/projects/${project.id}/members`, { user_id: other.user.id, role: 'viewer' })
    assert.equal(
      (await manager.client.post(`/projects/${project.id}/members`, { user_id: other.user.id, role: 'viewer' })).body.error.code,
      'MEMBER_ALREADY_EXISTS',
    )

    const transferred = await manager.client.put(`/projects/${project.id}/owner`, { user_id: other.user.id })
    assert.equal(transferred.status, 200, JSON.stringify(transferred.body))
    assert.equal(transferred.body.data.owner.id, other.user.id)
    const members = (await other.client.get(`/projects/${project.id}/members`)).body.data
    assert.deepEqual(members.map((m) => [m.user.email, m.role, m.is_owner]), [
      ['outro@kamban.test', 'manager', true],
      ['gestor2@kamban.test', 'manager', false],
    ])

    // ex-dono pode sair do projeto
    assert.equal((await manager.client.del(`/projects/${project.id}/members/${ownerId}`)).status, 200)
    assert.equal((await manager.client.get(`/projects/${project.id}`)).status, 404)
  })

  it('valida entrada e exige permissão para criar', async () => {
    const viewer = await userWithRole('VIEWER', 'leitor@kamban.test')
    assert.equal((await viewer.client.post('/projects', { name: 'X', key: 'XX' })).body.error.code, 'FORBIDDEN')

    const res = await admin.post('/projects', { name: '', key: '1', status: 'x', start_date: '2026-05-01', due_date: 'amanhã' })
    assert.equal(res.status, 400)
    assert.deepEqual(Object.keys(res.body.error.details.fields).sort(), ['due_date', 'key', 'name', 'status'])

    const dates = await admin.post('/projects', { name: 'Datas', key: 'DT', start_date: '2026-05-01', due_date: '2026-04-01' })
    assert.equal(dates.body.error.details.fields.due_date, 'due_before_start')
  })

  it('projeto pai: cria o subprojeto, filtra pelos filhos e recusa o segundo nível', async () => {
    const parent = (await admin.post('/projects', { name: 'Programa CRM', key: 'PCRM' })).body.data
    const child = await admin.post('/projects', { name: 'Força de Vendas', key: 'PFVB', parent_id: parent.id })
    assert.equal(child.status, 201)
    assert.equal(child.body.data.parent.key, 'PCRM')
    assert.equal((await admin.get(`/projects/${parent.id}`)).body.data.child_count, 1)
    assert.deepEqual((await admin.get(`/projects?parent_id=${parent.id}`)).body.data.map((p) => p.key), ['PFVB'])
    const nested = await admin.post('/projects', { name: 'Neto', key: 'PNETO', parent_id: child.body.data.id })
    assert.equal(nested.body.error.details.fields.parent_id, 'parent_is_child')
    assert.equal((await admin.patch(`/projects/${child.body.data.id}`, { parent_id: null })).body.data.parent, null)
  })

  it('seções do projeto: sem projects.charter/history o servidor fecha a ficha e o histórico', async () => {
    const role = (await admin.post('/roles', { code: 'SO_FICHA', name: 'Só ficha', permissions: ['projects.view', 'projects.charter'] })).body.data
    const res = await admin.post('/users', { name: 'ti', email: 'ti@kamban.test', password: 'SenhaTeste123', role_id: role.id })
    const ti = createClient(pb.api)
    await ti.login('ti@kamban.test', 'SenhaTeste123')
    const project = (await admin.post('/projects', { name: 'Seções', key: 'SEC' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: res.body.data.id, role: 'viewer' })

    assert.deepEqual((await ti.get(`/projects/${project.id}`)).body.data.capabilities.sections, ['charter'])
    assert.equal((await ti.get(`/projects/${project.id}/charter`)).status, 200)
    assert.equal((await ti.get(`/projects/${project.id}/history`)).body.error.code, 'FORBIDDEN')
    assert.deepEqual((await admin.get(`/projects/${project.id}`)).body.data.capabilities.sections, ['charter', 'history', 'members', 'report'])
  })
})
