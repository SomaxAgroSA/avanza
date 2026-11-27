/**
 * Tarefas — testes de API contra um PocketBase real (migrations + seed da Fase 3/4).
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

/** Valor válido de exemplo para cada tipo de campo obrigatório. */
function sampleValue(field) {
  if (field.type === 'select') return field.options[0].id
  if (field.type === 'multiselect') return [field.options[0].id]
  if (field.type === 'number' || field.type === 'decimal') return 1
  if (field.type === 'boolean') return true
  if (field.type === 'date') return '2026-10-01'
  if (field.type === 'url') return 'https://example.com'
  return 'valor'
}

describe('API /api/v1/tasks', { timeout: 180000 }, () => {
  let pb
  let admin
  let member
  let viewer
  let outsider
  let project
  let bug
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
    const m = await make('Mário', 'mario@example.com', 'MEMBER')
    const v = await make('Lia', 'lia@example.com', 'MEMBER')
    const o = await make('Otto', 'otto@example.com', 'MEMBER')
    member = m
    viewer = v
    outsider = o

    project = (await admin.post('/projects', { name: 'CRM Corporativo', key: 'CRM' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: m.user.id, role: 'member' })
    await admin.post(`/projects/${project.id}/members`, { user_id: v.user.id, role: 'viewer' })

    const types = (await admin.get('/task-types')).body.data
    bug = (await admin.get(`/task-types/${types.find((t) => t.key === 'BUG').id}`)).body.data
    doc = types.find((t) => t.key === 'DOCUMENTACAO')
    statuses = (await admin.get('/statuses')).body.data
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  function bugValues(overrides) {
    const values = {}
    bug.fields.filter((f) => f.required).forEach((f) => {
      values[f.field.name] = sampleValue(f.field)
    })
    return Object.assign(values, overrides)
  }

  it('cria tarefas numeradas por projeto, com padrões e campos do tipo', async () => {
    const missing = await member.client.post('/tasks', { project_id: project.id, task_type_id: bug.id, title: 'Erro ao salvar' })
    assert.equal(missing.status, 400)
    assert.ok(Object.keys(missing.body.error.details.fields).every((k) => k.startsWith('custom_values.')))

    const first = await member.client.post('/tasks', {
      project_id: project.id,
      task_type_id: bug.id,
      title: 'Erro ao salvar pedido',
      assignee_id: member.user.id,
      due_date: '2026-10-15',
      estimated_hours: 3.5,
      custom_values: bugValues({ versao: '2.1.0' }),
    })
    assert.equal(first.status, 201, JSON.stringify(first.body))
    const task = first.body.data
    assert.equal(task.code, 'CRM-1')
    assert.equal(task.status.key, 'BACKLOG')
    assert.equal(task.priority.key, 'MEDIA')
    assert.equal(task.assignee.name, 'Mário')
    assert.equal(task.due_date.slice(0, 10), '2026-10-15')
    assert.equal(task.estimated_hours, 3.5)
    assert.equal(task.custom_values.versao, '2.1.0')
    assert.deepEqual(task.capabilities, { edit: true, delete: false, assign: true, link: true, fork: true, comment: true })

    const second = await member.client.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: 'Manual do usuário' })
    assert.equal(second.body.data.code, 'CRM-2')
  })

  it('lista com escopo, busca (inclusive em campos pesquisáveis), filtros e ordenação', async () => {
    const all = await member.client.get('/tasks?sort=-code')
    assert.equal(all.status, 200, JSON.stringify(all.body))
    assert.deepEqual(all.body.data.map((t) => t.code), ['CRM-2', 'CRM-1'])
    assert.equal(all.body.meta.total, 2)
    assert.deepEqual((await member.client.get('/tasks?search=2.1.0')).body.data.map((t) => t.code), ['CRM-1'])
    assert.deepEqual((await member.client.get('/tasks?search=crm-2')).body.data.map((t) => t.code), ['CRM-2'])
    assert.deepEqual((await member.client.get('/tasks?assignee_id=me')).body.data.map((t) => t.code), ['CRM-1'])
    assert.deepEqual((await member.client.get('/tasks?search=100%25')).body.data, [])
    assert.equal((await outsider.client.get('/tasks')).body.meta.total, 0)
    assert.deepEqual((await admin.get('/tasks?sort=due_date')).body.data.map((t) => t.code), ['CRM-1', 'CRM-2'])
    // pessoas (ajuste 24/11): várias, `me` e `none`; e o Prazo em grupos pelo "hoje" de quem consulta
    const codes = async (query) => {
      const res = await member.client.get(`/tasks?sort=code&${query}`)
      assert.equal(res.status, 200, JSON.stringify(res.body))
      return res.body.data.map((t) => t.code)
    }
    assert.deepEqual(await codes('assignee_id=none'), ['CRM-2'])
    assert.deepEqual(await codes('assignee_id=me,none'), ['CRM-1', 'CRM-2'])
    assert.deepEqual(await codes(`responsible_id=${member.user.id}`), ['CRM-1'])
    assert.deepEqual(await codes('responsible_id=none'), ['CRM-2'])
    assert.deepEqual(await codes('due=overdue&due_today=2026-10-16'), ['CRM-1'])
    assert.deepEqual(await codes('due=today&due_today=2026-10-15'), ['CRM-1'])
    assert.deepEqual(await codes('due=next7&due_today=2026-10-10'), ['CRM-1'])
    assert.deepEqual(await codes('due=later&due_today=2026-10-01'), ['CRM-1'])
    assert.deepEqual(await codes('due=today&due_today=2026-10-16'), [])
    assert.deepEqual(await codes('due=none'), ['CRM-2'])
    assert.deepEqual(await codes('due=overdue,none&due_today=2026-10-16'), ['CRM-1', 'CRM-2'])
    assert.equal((await member.client.get('/tasks?due=ontem')).status, 400)
  })

  it('edita status, registra conclusão e histórico legível', async () => {
    const task = (await member.client.get('/tasks?search=CRM-1')).body.data[0]
    const done = statuses.find((s) => s.key === 'CONCLUIDO')
    const updated = await member.client.patch(`/tasks/${task.id}`, { status_id: done.id, estimated_hours: null })
    assert.equal(updated.status, 200, JSON.stringify(updated.body))
    assert.ok(updated.body.data.completed_at)
    assert.equal(updated.body.data.estimated_hours, null)

    const history = (await viewer.client.get(`/tasks/${task.id}/history`)).body.data
    assert.equal(history[0].action, 'task.updated')
    assert.deepEqual(history[0].old_value, { task_status: 'Backlog', estimated_hours: 3.5 })
    assert.deepEqual(history[0].new_value, { task_status: 'Concluído', estimated_hours: null })
    assert.equal(history[1].action, 'task.created')
    assert.deepEqual((await member.client.get('/tasks?category=done')).body.data.map((t) => t.code), ['CRM-1'])
  })

  it('informe do projeto: entra por padrão, liga/desliga com histórico e filtra a listagem', async () => {
    const task = (await member.client.get('/tasks?search=CRM-2')).body.data[0]
    assert.equal(task.in_report, true)
    const off = await member.client.put(`/tasks/${task.id}/report`, { in_report: false })
    assert.equal(off.status, 200, JSON.stringify(off.body))
    assert.equal(off.body.data.in_report, false)
    assert.deepEqual((await member.client.get(`/tasks?project_id=${project.id}&in_report=false`)).body.data.map((t) => t.code), ['CRM-2'])
    assert.deepEqual((await member.client.get(`/tasks?project_id=${project.id}&in_report=true`)).body.data.map((t) => t.code), ['CRM-1'])
    const history = (await member.client.get(`/tasks/${task.id}/history`)).body.data
    assert.deepEqual([history[0].old_value, history[0].new_value], [{ in_report: true }, { in_report: false }])
    assert.equal((await viewer.client.put(`/tasks/${task.id}/report`, { in_report: true })).status, 403)
    assert.equal((await member.client.put(`/tasks/${task.id}/report`, { in_report: true }, { csrf: false })).status, 403)
    assert.equal((await member.client.put(`/tasks/${task.id}/report`, { in_report: true })).body.data.in_report, true)
  })

  it('urgência: semáforo alta/média/baixa, com histórico e filtro (também no quadro)', async () => {
    const task = (await member.client.get('/tasks?search=CRM-2')).body.data[0]
    assert.equal(task.urgency, null)
    const high = await member.client.put(`/tasks/${task.id}/urgency`, { urgency: 'high' })
    assert.equal(high.status, 200, JSON.stringify(high.body))
    assert.equal(high.body.data.urgency, 'high')
    assert.deepEqual((await member.client.get(`/tasks?project_id=${project.id}&urgency=high`)).body.data.map((t) => t.code), ['CRM-2'])
    assert.deepEqual((await member.client.get(`/tasks?project_id=${project.id}&urgency=none`)).body.data.map((t) => t.code), ['CRM-1'])
    // vários valores separados por vírgula (botões da Lista de tarefas, §44)
    assert.deepEqual((await member.client.get(`/tasks?project_id=${project.id}&urgency=high,none&sort=code`)).body.data.map((t) => t.code), ['CRM-1', 'CRM-2'])
    assert.equal((await member.client.get('/tasks?urgency=high,roja')).body.error.details.fields.urgency, 'invalid_option')
    const card = (await member.client.get(`/projects/${project.id}/board`)).body.data.columns.flatMap((c) => c.tasks).find((t) => t.id === task.id)
    assert.equal(card.urgency, 'high')
    const history = (await member.client.get(`/tasks/${task.id}/history`)).body.data
    assert.deepEqual([history[0].old_value, history[0].new_value], [{ urgency: null }, { urgency: 'high' }])
    assert.equal((await member.client.put(`/tasks/${task.id}/urgency`, { urgency: 'roja' })).body.error.details.fields.urgency, 'invalid_option')
    assert.equal((await viewer.client.put(`/tasks/${task.id}/urgency`, { urgency: 'low' })).status, 403)
    assert.equal((await member.client.put(`/tasks/${task.id}/urgency`, { urgency: 'low' }, { csrf: false })).status, 403)
    assert.equal((await member.client.put(`/tasks/${task.id}/urgency`, { urgency: null })).body.data.urgency, null)
    // também pelo PATCH (null limpa)
    assert.equal((await member.client.patch(`/tasks/${task.id}`, { urgency: 'medium' })).body.data.urgency, 'medium')
    assert.equal((await member.client.patch(`/tasks/${task.id}`, { urgency: null })).body.data.urgency, null)
  })

  it('fixar no topo (§50): POST/DELETE /tasks/{id}/pin, igual para todos, com histórico; pinned_first ordena', async () => {
    const all = (await member.client.get(`/tasks?project_id=${project.id}&sort=code`)).body.data
    const task = all[all.length - 1]
    assert.equal(task.pinned, null)
    const pinned = await member.client.post(`/tasks/${task.id}/pin`)
    assert.equal(pinned.status, 200, JSON.stringify(pinned.body))
    assert.equal(pinned.body.data.pinned.by.name, 'Mário')
    assert.ok(pinned.body.data.pinned.at)
    // quem só olha também vê a fixação, e a lista pedida com pinned_first traz a fixada primeiro
    const seen = (await viewer.client.get(`/tasks?project_id=${project.id}&sort=code&pinned_first=true`)).body.data
    assert.equal(seen[0].id, task.id)
    assert.equal(seen[0].pinned.by.name, 'Mário')
    assert.equal((await member.client.get(`/tasks?project_id=${project.id}&sort=code`)).body.data[0].id, all[0].id)
    assert.equal((await member.client.get('/tasks?pinned_first=sim')).body.error.details.fields.pinned_first, 'invalid_option')
    const history = (await member.client.get(`/tasks/${task.id}/history`)).body.data
    assert.equal(history[0].action, 'task.pinned')
    // a regra da edição: leitor não fixa; sem o cabeçalho anti-CSRF, não
    assert.equal((await viewer.client.post(`/tasks/${task.id}/pin`)).status, 403)
    assert.equal((await viewer.client.del(`/tasks/${task.id}/pin`)).status, 403)
    assert.equal((await member.client.del(`/tasks/${task.id}/pin`, { csrf: false })).status, 403)
    assert.equal((await outsider.client.post(`/tasks/${task.id}/pin`)).status, 404)
    const unpinned = await member.client.del(`/tasks/${task.id}/pin`)
    assert.equal(unpinned.status, 200, JSON.stringify(unpinned.body))
    assert.equal(unpinned.body.data.pinned, null)
    assert.equal((await member.client.get(`/tasks/${task.id}/history`)).body.data[0].action, 'task.unpinned')
  })

  it('fixar para mim (§55): POST/DELETE /tasks/{id}/pin/me, pessoal e privado, sem histórico; pinned_first põe as minhas primeiro', async () => {
    const all = (await viewer.client.get(`/tasks?project_id=${project.id}&sort=code`)).body.data
    const task = all[all.length - 1]
    assert.equal(task.pinned_mine, null)
    // quem só lê também fixa para si
    const pinned = await viewer.client.post(`/tasks/${task.id}/pin/me`)
    assert.equal(pinned.status, 200, JSON.stringify(pinned.body))
    assert.ok(pinned.body.data.pinned_mine.at)
    assert.equal(pinned.body.data.pinned, null)
    const seen = await viewer.client.get(`/tasks?project_id=${project.id}&sort=code&pinned_first=true`)
    assert.equal(seen.body.data[0].id, task.id)
    assert.deepEqual(seen.body.meta.pins, { all: 0, max_all: 10, mine: 1, max_mine: 10 })
    // privada: as outras pessoas não veem nem a fixação nem a ordem
    const other = (await member.client.get(`/tasks?project_id=${project.id}&sort=code&pinned_first=true`)).body
    assert.equal(other.data[0].id, all[0].id)
    assert.equal(other.data.find((t) => t.id === task.id).pinned_mine, null)
    assert.equal(other.meta.pins.mine, 0)
    assert.equal((await member.client.get(`/tasks/${task.id}`)).body.data.pinned_mine, null)
    // sem histórico
    assert.ok(!(await member.client.get(`/tasks/${task.id}/history`)).body.data.some((entry) => entry.action === 'task.pinned'))
    // quem não vê a tarefa não fixa; sem o cabeçalho anti-CSRF, não
    assert.equal((await outsider.client.post(`/tasks/${task.id}/pin/me`)).status, 404)
    assert.equal((await viewer.client.del(`/tasks/${task.id}/pin/me`, { csrf: false })).status, 403)
    const unpinned = await viewer.client.del(`/tasks/${task.id}/pin/me`)
    assert.equal(unpinned.status, 200, JSON.stringify(unpinned.body))
    assert.equal(unpinned.body.data.pinned_mine, null)
  })

  it('área responsável: lista inicial, muda pela lista, histórico, filtro e quadro', async () => {
    const areas = (await member.client.get('/areas')).body.data
    assert.equal(areas.length, 11)
    assert.ok(areas.every((a) => a.is_default === false))
    const ti = areas.find((a) => a.key === 'TI')
    const task = (await member.client.get('/tasks?search=CRM-2')).body.data[0]
    assert.equal(task.area, null)
    const set = await member.client.put(`/tasks/${task.id}/area`, { area_id: ti.id })
    assert.equal(set.status, 200, JSON.stringify(set.body))
    assert.deepEqual(set.body.data.area, { id: ti.id, key: 'TI', name: 'Dpto. TI', color: 'blue' })
    assert.deepEqual((await member.client.get(`/tasks?project_id=${project.id}&area_id=${ti.id}`)).body.data.map((t) => t.code), ['CRM-2'])
    assert.deepEqual((await member.client.get(`/tasks?project_id=${project.id}&area_id=none`)).body.data.map((t) => t.code), ['CRM-1'])
    const card = (await member.client.get(`/projects/${project.id}/board`)).body.data.columns.flatMap((c) => c.tasks).find((t) => t.id === task.id)
    assert.equal(card.area.name, 'Dpto. TI')
    const history = (await member.client.get(`/tasks/${task.id}/history`)).body.data
    assert.deepEqual([history[0].old_value, history[0].new_value], [{ area: null }, { area: 'Dpto. TI' }])
    assert.equal((await member.client.put(`/tasks/${task.id}/area`, { area_id: 'naoexiste12345' })).body.error.details.fields.area_id, 'invalid_option')
    assert.equal((await viewer.client.put(`/tasks/${task.id}/area`, { area_id: null })).status, 403)
    assert.equal((await member.client.put(`/tasks/${task.id}/area`, { area_id: null }, { csrf: false })).status, 403)
    // área em uso não sai (só desativa)
    const inUse = await admin.del(`/areas/${ti.id}`)
    assert.equal(inUse.body.error.code, 'AREA_IN_USE')
    assert.deepEqual(inUse.body.error.details, { tasks: 1, projects: 0 })
    assert.equal((await member.client.put(`/tasks/${task.id}/area`, { area_id: null })).body.data.area, null)
    // também pelo PATCH e na criação
    const mkt = areas.find((a) => a.key === 'MARKETING')
    assert.equal((await member.client.patch(`/tasks/${task.id}`, { area_id: mkt.id })).body.data.area.name, 'Marketing')
    assert.equal((await member.client.patch(`/tasks/${task.id}`, { area_id: null })).body.data.area, null)
  })

    it('protege acesso: leitor não edita, estranho não vê, CSRF exigido, exclusão por gestor', async () => {
    const task = (await member.client.get('/tasks?search=CRM-2')).body.data[0]
    assert.equal((await viewer.client.patch(`/tasks/${task.id}`, { title: 'x' })).status, 403)
    assert.equal((await viewer.client.post('/tasks', { project_id: project.id, task_type_id: doc.id, title: 'x' })).status, 403)
    assert.equal((await outsider.client.get(`/tasks/${task.id}`)).body.error.code, 'TASK_NOT_FOUND')
    assert.equal((await outsider.client.get(`/tasks/${task.id}/history`)).body.error.code, 'TASK_NOT_FOUND')
    assert.equal((await member.client.patch(`/tasks/${task.id}`, { title: 'x' }, { csrf: false })).status, 403)
    assert.equal((await member.client.del(`/tasks/${task.id}`)).status, 403)

    const removed = await admin.del(`/tasks/${task.id}`)
    assert.equal(removed.status, 200, JSON.stringify(removed.body))
    assert.equal((await admin.get(`/tasks/${task.id}`)).status, 404)
    // o status em uso não pode ser excluído
    const done = statuses.find((s) => s.key === 'CONCLUIDO')
    assert.equal((await admin.del(`/statuses/${done.id}`)).body.error.code, 'STATUS_IN_USE')
  })

  it('§41: GET /project-task-counts conta executadas e faltantes por projeto (só quem vê o projeto por inteiro)', async () => {
    const counted = (await admin.post('/projects', { name: 'Contagem', key: 'CNT' })).body.data
    await admin.post(`/projects/${counted.id}/members`, { user_id: member.user.id, role: 'member' })
    const made = await Promise.all(['Primeira', 'Segunda'].map((title) => member.client.post('/tasks', { project_id: counted.id, task_type_id: doc.id, title })))
    made.forEach((res) => assert.equal(res.status, 201, JSON.stringify(res.body)))
    const done = statuses.find((x) => x.key === 'CONCLUIDO')
    assert.equal((await member.client.patch(`/tasks/${made[0].body.data.id}`, { status_id: done.id })).status, 200)

    const mine = (await member.client.get('/project-task-counts')).body.data.projects
    assert.deepEqual(mine.find((p) => p.project_id === counted.id), { project_id: counted.id, done: 1, open: 1 })
    assert.equal((await outsider.client.get('/project-task-counts')).body.data.projects.some((p) => p.project_id === counted.id), false)
    assert.equal((await createClient(pb.api).get('/project-task-counts')).status, 401)
  })

  it('§42: GET /dependencies (e /ti-dependencies), Dependências por área (PUT /settings/dependency-areas) e Pessoas de TI antigas (settings.manage)', async () => {
    const roles = (await admin.get('/roles')).body.data
    const ti = (await admin.post('/users', { name: 'Equipo de Informática', email: 'ti@example.com', password: 'SenhaTeste123', role_id: roles.find((r) => r.code === 'MEMBER').id })).body.data
    const fin = (await admin.post('/users', { name: 'Lúcia Finanças', email: 'fin@example.com', password: 'SenhaTeste123', role_id: roles.find((r) => r.code === 'MEMBER').id })).body.data
    const fvb = (await admin.post('/projects', { name: 'Fuerza de Ventas', key: 'FVB', status: 'active' })).body.data
    const dre = (await admin.post('/projects', { name: 'DRE', key: 'DRE', status: 'active' })).body.data
    for (const p of [fvb, dre]) await admin.post(`/projects/${p.id}/members`, { user_id: member.user.id, role: 'member' })
    await admin.post(`/projects/${fvb.id}/members`, { user_id: ti.id, role: 'manager' })
    await admin.post(`/projects/${dre.id}/members`, { user_id: fin.id, role: 'member' })
    const make = async (project, title, assignee) => {
      const res = await admin.post('/tasks', { project_id: project.id, task_type_id: doc.id, title, assignee_id: assignee })
      assert.equal(res.status, 201, JSON.stringify(res.body))
      return res.body.data
    }
    const sso = await make(fvb, 'Autenticação SSO', ti.id)
    const blocked = await make(dre, 'Dashboard', member.user.id)
    const related = await make(fvb, 'Segurança', member.user.id)
    const budget = await make(dre, 'Orçamento', fin.id)
    assert.equal((await member.client.post(`/tasks/${blocked.id}/relations`, { type: 'depends_on', target_id: sso.id })).status, 201)
    const rel = (await member.client.post(`/tasks/${related.id}/relations`, { type: 'relates', target_id: sso.id })).body.data

    // sem pessoas de TI (Victor é gestor, não Responsável TI): nada
    assert.equal((await member.client.get('/ti-dependencies')).body.data.projects.some((p) => p.project.id === fvb.id), false)
    assert.equal((await member.client.put('/settings/it-people', { user_ids: [ti.id] })).status, 403)
    const saved = await admin.put('/settings/it-people', { user_ids: [ti.id] })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    assert.deepEqual(saved.body.data.users.map((u) => u.name), ['Equipo de Informática'])
    assert.deepEqual((await admin.get('/settings/it-people')).body.data.user_ids, [ti.id])
    assert.equal((await admin.put('/settings/it-people', { user_ids: ['naoexiste'] })).body.error.code, 'VALIDATION_ERROR')

    // a lista antiga vira a área TI
    assert.deepEqual((await admin.get('/settings/dependency-areas')).body.data.areas.map((a) => [a.key, a.name, a.user_ids]), [['ti', 'TI', [ti.id]]])
    assert.equal((await member.client.put('/settings/dependency-areas', { areas: [] })).status, 403)
    const areas = await admin.put('/settings/dependency-areas', { areas: [{ key: 'ti', name: 'TI', user_ids: [ti.id] }, { name: 'Finanças', user_ids: [fin.id] }] })
    assert.equal(areas.status, 200, JSON.stringify(areas.body))
    assert.deepEqual(areas.body.data.areas.map((a) => a.key), ['ti', 'financas'])
    assert.equal((await admin.put('/settings/dependency-areas', { areas: [{ name: 'Sem TI', user_ids: [] }] })).body.error.details.fields.areas, 'ti_required')

    const data = (await member.client.get('/dependencies')).body.data
    const byId = Object.fromEntries(data.projects.map((p) => [p.project.id, p]))
    assert.deepEqual(byId[fvb.id].deliveries.map((d) => [d.code, d.risk, d.blocks, d.area.key]), [[sso.code, 'none_due', 1, 'ti']])
    assert.deepEqual(byId[dre.id].deliveries.map((d) => [d.code, d.area.name]), [[budget.code, 'Finanças']])
    assert.deepEqual(data.areas, [{ key: 'ti', name: 'TI', deliveries: 1 }, { key: 'financas', name: 'Finanças', deliveries: 1 }])
    // a rota antiga continua, só com a TI
    const legacy = (await member.client.get('/ti-dependencies')).body.data
    assert.equal(JSON.stringify(legacy).includes(budget.code), false)
    assert.deepEqual(legacy.areas.map((a) => a.key), ['ti'])
    assert.deepEqual(byId[fvb.id].pending.map((p) => [p.code, p.relation_id, p.can_confirm]), [[related.code, rel.id, true]])
    assert.deepEqual(byId[dre.id].blocked.map((b) => [b.code, b.waiting_on[0].code]), [[blocked.code, sso.code]])
    assert.deepEqual(data.people.map((u) => u.name), ['Equipo de Informática', 'Lúcia Finanças'])
    // project_ids recorta; quem não vê os projetos não recebe nada deles; sem login, 401
    assert.deepEqual((await member.client.get(`/dependencies?project_ids=${dre.id}`)).body.data.projects.map((p) => p.project.id), [dre.id])
    assert.equal((await outsider.client.get('/dependencies')).body.data.projects.some((p) => [fvb.id, dre.id].includes(p.project.id)), false)
    assert.equal((await createClient(pb.api).get('/dependencies')).status, 401)
    assert.equal((await createClient(pb.api).get('/ti-dependencies')).status, 401)
    // confirmar o bloqueio: a relacionada vira "depende de" e passa a bloquear
    assert.equal((await member.client.post(`/tasks/${related.id}/relations`, { type: 'depends_on', target_id: sso.id })).status, 201)
    assert.equal((await member.client.del(`/relations/${rel.id}`)).status, 200)
    const after = (await member.client.get(`/dependencies?project_ids=${fvb.id}`)).body.data.projects[0]
    assert.deepEqual([after.counts.blocked, after.counts.pending, after.deliveries[0].blocks], [1, 0, 2])
    await admin.put('/settings/dependency-areas', { areas: [{ key: 'ti', name: 'TI', user_ids: [] }] })
  })

  it('§44: sem a Lista de tarefas (tasks.list) a pessoa continua vendo as tarefas pela API e dentro do projeto', async () => {
    const { DEFAULT_ROLE_PERMISSIONS } = require('../../src/domain/permissions')
    const permissions = DEFAULT_ROLE_PERMISSIONS.MEMBER.filter((code) => code !== 'tasks.list')
    const role = (await admin.post('/roles', { code: 'SEM_LISTA', name: 'Sem lista', permissions })).body.data
    const created = await admin.post('/users', { name: 'Nina', email: 'nina@example.com', password: 'SenhaTeste123', role_id: role.id })
    await admin.post(`/projects/${project.id}/members`, { user_id: created.body.data.id, role: 'member' })
    const nina = createClient(pb.api)
    await nina.login('nina@example.com', 'SenhaTeste123')
    const me = (await nina.get('/auth/me')).body.data
    assert.equal(me.permissions.includes('tasks.list'), false)
    assert.equal(me.permissions.includes('tasks.view'), true)
    const seen = await nina.get(`/tasks?project_id=${project.id}`)
    assert.equal(seen.status, 200, JSON.stringify(seen.body))
    // o projeto ficou com uma tarefa (a outra foi excluída no teste de acesso): a mesma que o administrador vê
    assert.ok(seen.body.meta.total >= 1)
    assert.equal(seen.body.meta.total, (await admin.get(`/tasks?project_id=${project.id}`)).body.meta.total)
    assert.equal((await nina.get('/tasks')).body.meta.total, seen.body.meta.total)
    // o catálogo traz o módulo próprio
    const catalog = (await admin.get('/permissions')).body.data
    assert.deepEqual(catalog.filter((p) => p.code === 'tasks.list').map((p) => p.module), ['task_list'])
  })
})
