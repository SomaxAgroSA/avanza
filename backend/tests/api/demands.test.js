/**
 * Demandas internas (§45) pela API real e isolada: todos os campos passam pelas rotas e ficam gravados,
 * o fluxo completo (atribuir → começar → passar → concluir → devolver → validar), quem vê o quê, as
 * notificações e o histórico — e a caixa de sistema fora de todas as listas e painéis de projetos.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const PASSWORD = 'SenhaTeste123'
const DUE = '2026-12-01T20:30:00.000Z'

describe('API — demandas internas (§45)', { timeout: 240000 }, () => {
  let pb
  let admin
  let roles
  const people = {}
  let type
  let area
  let high
  let demand
  let crm

  async function person(key, code, name) {
    const email = `${key}@example.com`
    const res = await admin.post('/users', { name, email, password: PASSWORD, role_id: roles.find((r) => r.code === code).id })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const client = createClient(pb.api)
    await client.login(email, PASSWORD)
    people[key] = { client, user: res.body.data }
  }

  before(async () => {
    pb = await startServer()
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    roles = (await admin.get('/roles')).body.data
    await person('ana', 'MEMBER', 'Ana Estratégia')
    await person('cesar', 'MANAGER', 'César TI')
    await person('jorge', 'MEMBER', 'Jorge TI')
    await person('carlos', 'MEMBER', 'Carlos TI')
    await person('fabi', 'MEMBER', 'Fabi Finanças')
    const areas = await admin.put('/settings/dependency-areas', {
      areas: [
        { key: 'ti', name: 'TI', user_ids: [people.cesar.user.id, people.jorge.user.id, people.carlos.user.id] },
        { name: 'Finanças', user_ids: [people.fabi.user.id] },
      ],
    })
    assert.equal(areas.status, 200, JSON.stringify(areas.body))
    type = (await admin.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO')
    area = (await admin.post('/areas', { key: 'ESTRAT', name: 'Estratégia', color: 'blue' })).body.data
    high = (await admin.get('/priorities')).body.data.find((p) => !p.is_default)
    crm = (await people.cesar.client.post('/projects', { name: 'CRM', key: 'CRM' })).body.data
    const projectTask = await people.cesar.client.post('/tasks', { project_id: crm.id, task_type_id: type.id, title: 'Tarefa do CRM', assignee_id: people.cesar.user.id })
    assert.equal(projectTask.status, 201, JSON.stringify(projectTask.body))
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('a migration cria a caixa de sistema DEM, sem dono, fora das listas de projetos', async () => {
    const rows = await pb.query(`SELECT "key", "kind", "owner_id" FROM projects WHERE "kind" = 'demands'`)
    assert.deepEqual(rows, [{ key: 'DEM', kind: 'demands', owner_id: null }])
    const keys = (await admin.get('/projects?perPage=100')).body.data.map((p) => p.key)
    assert.deepEqual(keys, ['CRM'])
    for (const view of ['mine', 'ongoing', 'finished', 'archived']) {
      assert.equal((await admin.get(`/projects?view=${view}`)).body.data.some((p) => p.key === 'DEM'), false, view)
    }
  })

  it('POST /demands: todos os campos chegam e ficam gravados; quem pede não define executor nem prazo', async () => {
    const res = await people.ana.client.post('/demands', {
      task_type_id: type.id,
      title: 'Vista DMR_Cuadro_Reporte_SAC: agregar Fecha cuenta',
      description: 'Coluna **Fecha cuenta (SAP)** para o DRE.',
      demand_owner_id: people.cesar.user.id,
      area_id: area.id,
      priority_id: high.id,
      // ignorados: são do responsável
      assignee_id: people.jorge.user.id,
      due_date: '2026-12-24',
    })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    demand = res.body.data
    const saved = (await people.ana.client.get(`/tasks/${demand.id}`)).body.data
    assert.equal(saved.code, 'DEM-1')
    assert.equal(saved.project, null)
    assert.equal(saved.title, 'Vista DMR_Cuadro_Reporte_SAC: agregar Fecha cuenta')
    assert.equal(saved.description, 'Coluna **Fecha cuenta (SAP)** para o DRE.')
    assert.equal(saved.type.id, type.id)
    assert.equal(saved.priority.id, high.id)
    assert.equal(saved.area.id, area.id)
    assert.equal(saved.reporter.id, people.ana.user.id)
    assert.equal(saved.assignee, null)
    assert.equal(saved.due_date, null)
    assert.equal(saved.demand.status, 'unassigned')
    assert.equal(saved.demand.owner.id, people.cesar.user.id)
    assert.ok(saved.demand.opened_at)
    assert.deepEqual(saved.demand.actions, { assign: false, start: false, pass: false, conclude: false, validate: false, return: false })
    const invalid = await people.ana.client.post('/demands', { title: 'x' })
    assert.equal(invalid.status, 400)
    assert.deepEqual(Object.keys(invalid.body.error.details.fields).sort(), ['area_id', 'demand_owner_id', 'task_type_id'])
  })

  it('quem vê: quem pediu, o responsável, a equipe dele e o admin; os demais recebem 404', async () => {
    for (const key of ['ana', 'cesar', 'jorge', 'carlos']) assert.equal((await people[key].client.get(`/tasks/${demand.id}`)).status, 200, key)
    assert.equal((await admin.get(`/tasks/${demand.id}`)).status, 200)
    assert.equal((await people.fabi.client.get(`/tasks/${demand.id}`)).status, 404)
    assert.equal((await people.fabi.client.get(`/tasks/${demand.id}/comments`)).status, 404)
    assert.equal((await people.fabi.client.get(`/tasks/${demand.id}/history`)).status, 404)
    assert.equal((await people.fabi.client.get('/tasks')).body.data.some((t) => t.id === demand.id), false)
  })

  it('GET /tasks: Com projeto · Sem projeto e "Minhas" (pedidas, recebidas ou atribuídas)', async () => {
    const codes = async (client, query) => (await client.get(`/tasks?${query}`)).body.data.map((t) => t.code).sort()
    assert.deepEqual(await codes(people.cesar.client, ''), ['CRM-1', 'DEM-1'])
    assert.deepEqual(await codes(people.cesar.client, 'kind=project'), ['CRM-1'])
    assert.deepEqual(await codes(people.cesar.client, 'kind=demand'), ['DEM-1'])
    assert.deepEqual(await codes(people.ana.client, 'mine=true'), ['DEM-1'])
    assert.deepEqual(await codes(people.jorge.client, 'mine=true'), [])
    assert.equal((await people.cesar.client.get('/tasks?kind=outra')).status, 400)
  })

  it('selo, responsáveis possíveis e equipe para atribuir', async () => {
    const overview = (await people.cesar.client.get('/demands/overview')).body.data
    assert.equal(overview.counts.received.unassigned, 1)
    assert.deepEqual(overview.team.map((m) => m.user.id).sort(), [people.jorge.user.id, people.carlos.user.id].sort())
    assert.deepEqual((await people.ana.client.get('/demands/owners?search=Jorge')).body.data.map((u) => u.name), ['Jorge TI'])
    const team = (await people.cesar.client.get(`/demands/${demand.id}/team`)).body.data.map((u) => u.name)
    assert.deepEqual(team, ['Carlos TI', 'César TI', 'Jorge TI'])
    assert.equal((await people.ana.client.get(`/demands/${demand.id}/team`)).status, 403)
    assert.deepEqual((await people.cesar.client.get('/demands?box=received')).body.data.map((t) => t.code), ['DEM-1'])
    assert.deepEqual((await people.ana.client.get('/demands?box=requested&status=unassigned')).body.data.map((t) => t.code), ['DEM-1'])
  })

  it('GET /demands?box=all (caixa Todas): só com projects.view_all, com filtros; overview traz all e all_team', async () => {
    const res = await admin.get('/demands?box=all')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(res.body.data.map((t) => t.code), ['DEM-1'])
    assert.deepEqual((await admin.get(`/demands?box=all&owner_id=${people.cesar.user.id}`)).body.data.map((t) => t.code), ['DEM-1'])
    assert.deepEqual((await admin.get(`/demands?box=all&owner_id=${people.fabi.user.id}`)).body.data, [])
    assert.deepEqual((await admin.get(`/demands?box=all&assignee_id=${people.jorge.user.id}`)).body.data, [])
    assert.equal((await admin.get('/demands?box=all&owner_id=x%20y')).status, 400)
    // sem projects.view_all: nem o responsável nem quem pediu abrem a caixa Todas
    for (const key of ['cesar', 'ana']) {
      const forbidden = await people[key].client.get('/demands?box=all')
      assert.equal(forbidden.status, 403, key)
      assert.equal(forbidden.body.error.code, 'FORBIDDEN')
    }
    const overview = (await admin.get('/demands/overview')).body.data
    assert.deepEqual(overview.counts.all, { unassigned: 1, assigned: 0, in_progress: 0, to_validate: 0, done: 0 })
    assert.deepEqual(overview.all_team, [])
    const mine = (await people.cesar.client.get('/demands/overview')).body.data
    assert.equal(mine.counts.all, undefined)
    assert.equal(mine.all_team, undefined)
  })

  it('fluxo completo pelas rotas, com prazo (data e hora), estimativa e comentários gravados', async () => {
    const id = demand.id
    assert.equal((await people.jorge.client.post(`/demands/${id}/assign`, { assignee_id: people.jorge.user.id, due_at: DUE })).status, 403)
    const noDue = await people.cesar.client.post(`/demands/${id}/assign`, { assignee_id: people.jorge.user.id })
    assert.equal(noDue.body.error.details.fields.due_at, 'required')
    const outside = await people.cesar.client.post(`/demands/${id}/assign`, { assignee_id: people.fabi.user.id, due_at: DUE })
    assert.equal(outside.body.error.details.fields.assignee_id, 'not_in_team')

    const assigned = await people.cesar.client.post(`/demands/${id}/assign`, { assignee_id: people.jorge.user.id, due_at: DUE, estimated_hours: 4.5 })
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body))
    let saved = (await people.cesar.client.get(`/tasks/${id}`)).body.data
    assert.equal(saved.demand.status, 'assigned')
    assert.equal(saved.demand.due_at, DUE)
    assert.equal(saved.due_date, DUE)
    assert.equal(saved.estimated_hours, 4.5)
    assert.equal(saved.assignee.id, people.jorge.user.id)

    assert.equal((await people.jorge.client.post(`/demands/${id}/start`)).status, 200)
    assert.equal((await people.jorge.client.post(`/demands/${id}/start`)).body.error.code, 'DEMAND_STATE_CONFLICT')
    assert.equal((await people.jorge.client.post(`/demands/${id}/pass`, { assignee_id: people.carlos.user.id })).body.error.details.fields.comment, 'required')
    const passed = await people.jorge.client.post(`/demands/${id}/pass`, { assignee_id: people.carlos.user.id, comment: 'Carlos já configurou esse servidor.' })
    assert.equal(passed.status, 200, JSON.stringify(passed.body))
    saved = (await people.carlos.client.get(`/tasks/${id}`)).body.data
    assert.equal(saved.assignee.id, people.carlos.user.id)
    assert.equal(saved.demand.status, 'assigned')
    // Jorge passou e continua vendo
    assert.equal((await people.jorge.client.get(`/tasks/${id}`)).status, 200)

    assert.equal((await people.carlos.client.post(`/demands/${id}/conclude`, { comment: '' })).status, 400)
    assert.equal((await people.carlos.client.post(`/demands/${id}/conclude`, { comment: 'Coluna publicada na vista.' })).status, 200)
    assert.equal((await people.cesar.client.post(`/demands/${id}/validate`)).status, 403)
    assert.equal((await people.ana.client.post(`/demands/${id}/return`, { comment: 'Falta o filtro por safra.' })).status, 200)
    assert.equal((await people.carlos.client.post(`/demands/${id}/conclude`, { comment: 'Filtro incluído.' })).status, 200)
    const done = await people.ana.client.post(`/demands/${id}/validate`)
    assert.equal(done.status, 200, JSON.stringify(done.body))
    saved = (await people.ana.client.get(`/tasks/${id}`)).body.data
    assert.equal(saved.demand.status, 'done')
    assert.equal(saved.status.category, 'done')
    assert.ok(saved.completed_at)

    const history = (await people.ana.client.get(`/tasks/${id}/history?perPage=100`)).body.data
    const actions = history.map((h) => h.action)
    for (const action of ['task.created', 'task.demand_assigned', 'task.demand_started', 'task.demand_passed', 'task.demand_concluded', 'task.demand_returned', 'task.demand_validated']) {
      assert.ok(actions.includes(action), action)
    }
    const pass = history.find((h) => h.action === 'task.demand_passed')
    assert.equal(pass.new_value.note, 'Carlos já configurou esse servidor.')
    assert.equal(pass.new_value.assignee, 'Carlos TI')
    assert.equal(history.find((h) => h.action === 'task.demand_assigned').new_value.due_at, DUE)

    const types = async (key) => (await people[key].client.get('/notifications?perPage=50')).body.data.map((n) => n.type).sort()
    assert.deepEqual(await types('cesar'), ['demand_concluded', 'demand_concluded', 'demand_passed', 'demand_received', 'demand_returned', 'demand_validated'])
    assert.ok((await types('ana')).includes('demand_concluded'))
    assert.ok((await types('carlos')).includes('assigned'))
  })

  it('PATCH /tasks/{id}: título e descrição sim; status, executor e prazo pelo fluxo', async () => {
    const created = (await people.ana.client.post('/demands', { task_type_id: type.id, title: 'Usuário técnico do Datasphere', demand_owner_id: people.cesar.user.id, area_id: area.id })).body.data
    const edited = await people.ana.client.patch(`/tasks/${created.id}`, { title: 'Usuário técnico do Datasphere com acesso completo', description: 'Ticket #4821' })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    const saved = (await people.ana.client.get(`/tasks/${created.id}`)).body.data
    assert.equal(saved.title, 'Usuário técnico do Datasphere com acesso completo')
    assert.equal(saved.description, 'Ticket #4821')
    const flow = await people.ana.client.patch(`/tasks/${created.id}`, { status_id: saved.status.id, due_date: '2026-12-01' })
    assert.deepEqual(flow.body.error.details.fields, { status_id: 'demand_flow', due_date: 'demand_flow' })
    assert.equal((await people.cesar.client.post(`/tasks/${created.id}/move`, { status_id: saved.status.id })).status, 400)
    // comentários do módulo de sempre
    assert.equal((await people.jorge.client.post(`/tasks/${created.id}/comments`, { content: 'Vejo isso amanhã.' })).status, 201)
  })

  it('tarefa de projeto com responsável (POST e PATCH /tasks): o fluxo vale, quem é de fora vê só a tarefa', async () => {
    const fin = (await admin.post('/projects', { name: 'Finanças', key: 'FIN', status: 'active' })).body.data
    assert.equal((await admin.post(`/projects/${fin.id}/members`, { user_id: people.ana.user.id, role: 'member' })).status, 201)
    const created = await people.ana.client.post('/tasks', { project_id: fin.id, task_type_id: type.id, title: 'Publicar o dashboard', demand_owner_id: people.cesar.user.id })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    let saved = (await people.ana.client.get(`/tasks/${created.body.data.id}`)).body.data
    assert.equal(saved.project.key, 'FIN')
    assert.equal(saved.demand.status, 'unassigned')
    assert.equal(saved.demand.owner.id, people.cesar.user.id)
    // César não é do projeto: vê a tarefa, não o projeto
    assert.equal((await people.cesar.client.get(`/tasks/${saved.id}`)).status, 200)
    assert.equal((await people.cesar.client.get(`/projects/${fin.id}`)).status, 404)
    const assigned = await people.cesar.client.post(`/demands/${saved.id}/assign`, { assignee_id: people.carlos.user.id, due_at: DUE, estimated_hours: 2 })
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body))
    assert.equal((await people.carlos.client.post(`/demands/${saved.id}/start`)).status, 200)
    assert.equal((await people.carlos.client.post(`/tasks/${saved.id}/comments`, { content: 'Em andamento.' })).status, 201)
    const received = (await people.cesar.client.get('/demands?box=received')).body.data.find((t) => t.id === saved.id)
    assert.equal(received.project.name, 'Finanças')

    // PATCH numa tarefa que já existe: liga o fluxo (executor e status ficam) e null desliga
    const plain = (await people.ana.client.post('/tasks', { project_id: fin.id, task_type_id: type.id, title: 'Conciliação', assignee_id: people.ana.user.id })).body.data
    assert.equal(plain.demand, null)
    const linked = await people.ana.client.patch(`/tasks/${plain.id}`, { demand_owner_id: people.cesar.user.id })
    assert.equal(linked.status, 200, JSON.stringify(linked.body))
    saved = (await people.cesar.client.get(`/tasks/${plain.id}`)).body.data
    assert.equal(saved.demand.owner.id, people.cesar.user.id)
    assert.equal(saved.demand.status, 'assigned')
    assert.equal(saved.assignee.id, people.ana.user.id)
    const doneStatus = (await admin.get('/statuses')).body.data.find((st) => st.category === 'done')
    assert.equal((await people.ana.client.patch(`/tasks/${plain.id}`, { status_id: doneStatus.id })).body.error.details.fields.status_id, 'demand_flow')
    assert.equal((await people.cesar.client.patch(`/tasks/${plain.id}`, { demand_owner_id: people.jorge.user.id })).status, 403)
    assert.equal((await people.ana.client.patch(`/tasks/${plain.id}`, { demand_owner_id: null })).body.data.demand, null)
    assert.equal((await people.cesar.client.get(`/tasks/${plain.id}`)).status, 404)
  })

  it('quem vê todas (admin) atribui e reatribui qualquer demanda pela rota; o histórico guarda o admin', async () => {
    const created = (await people.ana.client.post('/demands', { task_type_id: type.id, title: 'Acesso ao SAP para a equipe nova', demand_owner_id: people.cesar.user.id, area_id: area.id })).body.data
    let detail = (await admin.get(`/tasks/${created.id}`)).body.data
    assert.equal(detail.demand.actions.assign, true)
    assert.equal(detail.demand.actions.start, false)
    const team = await admin.get(`/demands/${created.id}/team`)
    assert.equal(team.status, 200, JSON.stringify(team.body))
    assert.deepEqual(team.body.data.map((u) => u.name), ['Carlos TI', 'César TI', 'Jorge TI'])
    const outside = await admin.post(`/demands/${created.id}/assign`, { assignee_id: people.fabi.user.id, due_at: DUE })
    assert.equal(outside.body.error.details.fields.assignee_id, 'not_in_team')
    const assigned = await admin.post(`/demands/${created.id}/assign`, { assignee_id: people.jorge.user.id, due_at: DUE, estimated_hours: 2 })
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body))
    const moved = await admin.post(`/demands/${created.id}/assign`, { assignee_id: people.carlos.user.id, due_at: DUE })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    detail = (await people.carlos.client.get(`/tasks/${created.id}`)).body.data
    assert.equal(detail.assignee.id, people.carlos.user.id)
    const history = (await admin.get(`/tasks/${created.id}/history?perPage=50`)).body.data
    const reassigned = history.find((h) => h.action === 'task.demand_reassigned')
    assert.ok(reassigned)
    assert.equal(reassigned.user.id, (await admin.get('/auth/me')).body.data.user.id)
    // o resto do fluxo continua de quem executa
    assert.equal((await admin.post(`/demands/${created.id}/start`)).status, 403)
  })

  it('a caixa de sistema e as demandas ficam fora de Kanban, relatórios, painéis e dependências', async () => {
    const inbox = (await pb.query(`SELECT id FROM projects WHERE "kind" = 'demands'`))[0].id
    assert.equal((await admin.get(`/projects/${inbox}`)).status, 404)
    assert.equal((await admin.patch(`/projects/${inbox}`, { name: 'X' })).status, 404)
    assert.equal((await admin.post(`/projects/${inbox}/archive`)).status, 404)
    assert.equal((await admin.del(`/projects/${inbox}`)).status, 404)
    assert.equal((await admin.get(`/projects/${inbox}/board`)).status, 404)
    assert.equal((await admin.post('/tasks', { project_id: inbox, task_type_id: type.id, title: 'x' })).status, 404)
    const hides = async (path) => {
      const res = await admin.get(path)
      assert.equal(res.status, 200, `${path}: ${JSON.stringify(res.body)}`)
      const text = JSON.stringify(res.body.data)
      assert.equal(text.includes(inbox), false, `${path} mostra a caixa`)
      assert.equal(text.includes('DEM-'), false, `${path} mostra demandas`)
    }
    await hides('/board')
    await hides('/reports')
    await hides('/executive')
    await hides('/dependencies')
    await hides('/team-activity')
    await hides('/project-task-counts')
    await hides('/project-covers')
  })
})
