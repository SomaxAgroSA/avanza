/**
 * Quadro do projeto (Gerenciamento de Projetos — módulo à parte das tarefas) — API contra um PocketBase real.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

describe('API Quadro do projeto', { timeout: 180000 }, () => {
  let pb
  let admin
  let mario
  let lia
  let users
  let project

  before(async () => {
    pb = await startServer()
    await pb.updateSettings({ rateLimits: { enabled: true, rules: RULES } })
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
    const l = await make('Lia', 'lia@example.com', 'VIEWER')
    mario = m.client
    lia = l.client
    users = { mario: m.user, lia: l.user }
    project = (await admin.post('/projects', { name: 'Clover 6', key: 'CLV' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: m.user.id, role: 'member' })
    await admin.post(`/projects/${project.id}/members`, { user_id: l.user.id, role: 'viewer' })
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('quadro: etiquetas iniciais, grupos numerados, elementos e subelementos com os cálculos; leitor só vê', async () => {
    const board = (await lia.get(`/projects/${project.id}/plan`)).body.data
    assert.deepEqual(board.statuses.map((s) => s.name), ['Planejado', 'Em progresso', 'Confirmar', 'Parado', 'Feito'])
    assert.deepEqual(board.capabilities, { edit: false, manage: false })
    const feito = board.statuses.find((s) => s.category === 'done')

    const ini = await admin.post(`/projects/${project.id}/groups`, { name: 'Iniciação', color: 'blue' })
    assert.equal(ini.status, 201, JSON.stringify(ini.body))
    assert.equal((await mario.post(`/projects/${project.id}/groups`, { name: 'Não' })).status, 403)

    const gp = (await mario.post(`/projects/${project.id}/plan/resources`, { name: 'Gerente de Projetos' })).body.data
    assert.equal((await mario.post(`/projects/${project.id}/plan/resources`, { name: 'gerente de projetos' })).body.error.code, 'PLAN_RESOURCE_NAME_IN_USE')
    const item = await mario.post(`/projects/${project.id}/plan/items`, {
      group_id: ini.body.data.id,
      name: 'Elaborar pré-cronograma',
      status_id: feito.id,
      start_date: '2026-01-26',
      end_date: '2026-01-27',
      resource_ids: [gp.id],
      estimated_hours: 1,
    })
    assert.equal(item.status, 201, JSON.stringify(item.body))
    assert.equal(item.body.data.duration_days, 2)
    const pai = (await mario.post(`/projects/${project.id}/plan/items`, { group_id: ini.body.data.id, name: 'Apresentar pré-cronograma', duration_days: 1, estimated_hours: 0 })).body.data
    assert.equal(pai.estimated_hours, 0)
    const sub = await mario.post(`/projects/${project.id}/plan/items`, { parent_id: pai.id, name: 'Montar apresentação', owner_id: users.mario.id, due_date: '2026-02-10', estimated_hours: 2, actual_hours: 1.5, progress: 50 })
    assert.equal(sub.status, 201, JSON.stringify(sub.body))
    assert.equal((await lia.post(`/projects/${project.id}/plan/items`, { group_id: ini.body.data.id, name: 'X' })).status, 403)

    const edited = await mario.patch(`/plan/items/${item.body.data.id}`, { end_date: '2026-01-30' })
    assert.equal(edited.body.data.duration_days, 5)
    assert.equal((await mario.patch(`/plan/items/${item.body.data.id}`, { end_date: '2026-01-01' })).body.error.details.fields.end_date, 'end_before_start')

    const after = (await lia.get(`/projects/${project.id}/plan`)).body.data
    const summary = after.groups[0].summary
    assert.equal(summary.items, 2)
    assert.equal(summary.estimated_hours, 1)
    assert.equal(summary.duration_days, 6)
    assert.equal(after.items.find((i) => i.id === pai.id).progress.source, 'subitems')
  })

  it('grupos: subgrupo, duplicar, mover, excluir; etiqueta de status pelo gestor; tarefas intactas', async () => {
    const pl = (await admin.post(`/projects/${project.id}/groups`, { name: 'Planejamento' })).body.data
    const pp = (await admin.post(`/projects/${project.id}/groups`, { name: 'Plano do Projeto', parent_id: pl.id })).body.data
    assert.equal(pp.number, '2.1')
    await mario.post(`/projects/${project.id}/plan/items`, { group_id: pp.id, name: 'Elaborar plano v6' })
    const copy = await admin.post(`/groups/${pl.id}/duplicate`, {})
    assert.equal(copy.status, 201, JSON.stringify(copy.body))
    const moved = await admin.put(`/groups/${copy.body.data.id}/move`, { next_id: pl.id })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    const removed = (await admin.del(`/groups/${copy.body.data.id}`)).body.data
    assert.deepEqual(removed, { deleted: 2, items: 1 })
    assert.equal((await admin.patch(`/groups/${copy.body.data.id}`, { name: 'Z' })).body.error.code, 'GROUP_NOT_FOUND')

    const status = await admin.post(`/projects/${project.id}/plan/statuses`, { name: 'Aguardando cliente', color: 'violet', category: 'blocked' })
    assert.equal(status.status, 201, JSON.stringify(status.body))
    assert.equal((await mario.post(`/projects/${project.id}/plan/statuses`, { name: 'Não' })).status, 403)
    // as tarefas não ganharam campos do quadro
    const types = (await admin.get('/task-types')).body.data
    const type = types.find((t) => t.key === 'DOCUMENTACAO') || types[0]
    const task = (await admin.post('/tasks', { project_id: project.id, task_type_id: type.id, title: 'Tarefa comum' })).body.data
    assert.equal(task.group_id, undefined)
    assert.equal(task.resources, undefined)
  })

  it('GP-2: mover, duplicar, massa, dependências com a regra do quadro e importar', async () => {
    const g = (await admin.post(`/projects/${project.id}/groups`, { name: 'Execução' })).body.data
    const other = (await admin.post(`/projects/${project.id}/groups`, { name: 'Encerramento' })).body.data
    const mk = async (name) => (await mario.post(`/projects/${project.id}/plan/items`, { group_id: g.id, name })).body.data
    const a = await mk('Levantar requisitos')
    const b = await mk('Configurar ambiente')
    const c = await mk('Treinar usuários')

    const moved = await mario.put(`/plan/items/${c.id}/move`, { next_id: a.id })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    let board = (await lia.get(`/projects/${project.id}/plan`)).body.data
    const order = (groupId) => board.items.filter((i) => i.group_id === groupId && !i.parent_id).sort((x, y) => x.position - y.position).map((i) => i.name)
    assert.deepEqual(order(g.id), ['Treinar usuários', 'Levantar requisitos', 'Configurar ambiente'])

    const copy = await mario.post(`/plan/items/${a.id}/duplicate`, {})
    assert.equal(copy.status, 201, JSON.stringify(copy.body))
    const bulk = await mario.post(`/projects/${project.id}/plan/items/bulk`, { ids: [copy.body.data.id, c.id], action: 'move', group_id: other.id })
    assert.deepEqual(bulk.body.data, { moved: 2 })
    assert.equal((await lia.post(`/projects/${project.id}/plan/items/bulk`, { ids: [a.id], action: 'delete' })).status, 403)

    // dependência: "Configurar ambiente" depende de "Levantar requisitos"
    const link = await mario.post(`/plan/items/${b.id}/links`, { type: 'depends_on', item_id: a.id })
    assert.equal(link.status, 201, JSON.stringify(link.body))
    assert.equal((await mario.post(`/plan/items/${a.id}/links`, { type: 'depends_on', item_id: b.id })).body.error.details.fields.item_id, 'cycle')
    board = (await lia.get(`/projects/${project.id}/plan`)).body.data
    assert.equal(board.settings.dependency_rule, 'warn')
    assert.equal(board.items.find((i) => i.id === b.id).blocked, true)
    assert.equal((await mario.patch(`/projects/${project.id}/plan/settings`, { dependency_rule: 'block' })).status, 403)
    assert.equal((await admin.patch(`/projects/${project.id}/plan/settings`, { dependency_rule: 'block' })).status, 200)
    const progress = board.statuses.find((s) => s.category === 'in_progress')
    const pending = await mario.patch(`/plan/items/${b.id}`, { status_id: progress.id })
    assert.equal(pending.status, 409)
    assert.equal(pending.body.error.code, 'PLAN_DEPENDENCY_PENDING')
    assert.equal((await mario.del(`/plan/links/${link.body.data.id}`)).status, 200)
    assert.equal((await mario.patch(`/plan/items/${b.id}`, { status_id: progress.id })).status, 200)

    // importar: linha com problema cancela tudo; depois importa
    const bad = await mario.post(`/projects/${project.id}/plan/import`, { rows: [{ group: 'Execução', name: 'Ok' }, { group: 'Execução', name: 'X', progress: 300 }] })
    assert.equal(bad.status, 400, JSON.stringify(bad.body))
    assert.deepEqual(bad.body.error.details.rows, { 1: { progress: 'too_large' } })
    const imported = await mario.post(`/projects/${project.id}/plan/import`, {
      rows: [
        { group: 'Execução', name: 'Homologar', resources: ['Consultor'], estimated_hours: 4 },
        { group: 'Execução', parent: 'Homologar', name: 'Roteiro de testes' },
      ],
    })
    assert.equal(imported.status, 201, JSON.stringify(imported.body))
    assert.deepEqual(imported.body.data.created, { groups: 0, statuses: 0, resources: 1, items: 1, subitems: 1 })
  })

  it('GP-3: painel do elemento — atualização com @menção e resposta (notificam), arquivo protegido, histórico e contadores', async () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    const g = (await admin.post(`/projects/${project.id}/groups`, { name: 'Monitoramento' })).body.data
    const item = (await mario.post(`/projects/${project.id}/plan/items`, { group_id: g.id, name: 'Reunião de status' })).body.data

    const people = (await lia.get(`/plan/items/${item.id}/mention-candidates`)).body.data
    assert.ok(people.some((p) => p.id === users.mario.id))
    const created = await mario.post(`/plan/items/${item.id}/updates`, { content: `Ata enviada, @[Lia](${users.lia.id}) confira` })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const reply = await lia.post(`/plan/items/${item.id}/updates`, { content: 'Conferido.', parent_id: created.body.data.id })
    assert.equal(reply.status, 201, JSON.stringify(reply.body))
    const thread = (await lia.get(`/plan/items/${item.id}/updates`)).body.data
    assert.equal(thread.updates[0].replies[0].content, 'Conferido.')
    assert.deepEqual(thread.capabilities, { post: true })
    const liaInbox = (await lia.get('/notifications')).body.data
    assert.equal(liaInbox[0].type, 'plan_mention')
    assert.equal(liaInbox[0].plan_item.id, item.id)
    assert.equal((await mario.get('/notifications')).body.data[0].type, 'plan_reply')
    assert.equal((await lia.patch(`/plan/updates/${created.body.data.id}`, { content: 'Não' })).status, 403)

    // imagem colada segue com o texto (multipart); só a imagem também vale
    const form = new FormData()
    form.append('content', 'Print do quadro')
    form.append('files', new Blob([PNG], { type: 'image/png' }), 'ata.png')
    const withImage = await mario.post(`/plan/items/${item.id}/updates`, form)
    assert.equal(withImage.status, 201, JSON.stringify(withImage.body))
    assert.equal(withImage.body.data.content, 'Print do quadro')
    const file = withImage.body.data.files[0]
    assert.equal(file.kind, 'image')
    const onlyImage = new FormData()
    onlyImage.append('parent_id', created.body.data.id)
    onlyImage.append('files', new Blob([PNG], { type: 'image/png' }), 'resposta.png')
    const imageReply = await lia.post(`/plan/items/${item.id}/updates`, onlyImage)
    assert.equal(imageReply.status, 201, JSON.stringify(imageReply.body))
    assert.equal(imageReply.body.data.parent_id, created.body.data.id)
    const more = new FormData()
    more.append('files', new Blob([PNG], { type: 'image/png' }), 'x.png')
    assert.equal((await lia.post(`/plan/updates/${withImage.body.data.id}/files`, more)).status, 403)
    const download = await lia.get(`/plan/files/${file.id}/file`, { raw: true })
    assert.equal(download.status, 200)
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(download.bytes, PNG)
    const listed = (await lia.get(`/plan/items/${item.id}/updates`)).body.data
    assert.equal(listed.updates[0].files[0].name, 'ata.png')
    assert.equal(listed.updates[1].replies[1].files[0].name, 'resposta.png')

    const board = (await lia.get(`/projects/${project.id}/plan`)).body.data
    const row = board.items.find((i) => i.id === item.id)
    assert.equal(row.updates, 4)
    assert.equal(row.files, 2)
    const history = (await lia.get(`/plan/items/${item.id}/history`)).body.data
    assert.ok(history.some((h) => h.action === 'plan_item.update_added' && h.new_value && h.new_value.files === 'ata.png'))
    assert.equal((await mario.del(`/plan/files/${file.id}`)).status, 200)
    assert.ok((await lia.get(`/plan/items/${item.id}/history`)).body.data.some((h) => h.action === 'plan_item.file_deleted'))
  })

  it('GP-4: diário e problemas (Gestão), linha de base, resumo do quadro e relatório com a saúde', async () => {
    const other = (await admin.post('/projects', { name: 'Visões GP4', key: 'VGP' })).body.data
    await admin.post(`/projects/${other.id}/members`, { user_id: users.mario.id, role: 'member' })
    await admin.post(`/projects/${other.id}/members`, { user_id: users.lia.id, role: 'viewer' })
    const p = other.id
    const g = (await admin.post(`/projects/${p}/groups`, { name: 'Iniciação' })).body.data
    const board = (await lia.get(`/projects/${p}/plan`)).body.data
    const feito = board.statuses.find((s) => s.category === 'done').id
    await mario.post(`/projects/${p}/plan/items`, { group_id: g.id, name: 'Kickoff', status_id: feito, start_date: '2024-01-26', end_date: '2024-01-27', estimated_hours: 4 })
    const plano = (await mario.post(`/projects/${p}/plan/items`, { group_id: g.id, name: 'Plano', start_date: '2024-02-01', end_date: '2024-02-05', estimated_hours: 10 })).body.data

    // diário
    const entry = await mario.post(`/projects/${p}/plan/journal`, { entry_date: '2024-02-01', content: 'Reunião de abertura do projeto.' })
    assert.equal(entry.status, 201, JSON.stringify(entry.body))
    assert.equal((await lia.post(`/projects/${p}/plan/journal`, { entry_date: '2024-02-01', content: 'x' })).status, 403)
    const journal = (await lia.get(`/projects/${p}/plan/journal`)).body.data
    assert.deepEqual([journal.entries[0].entry_date, journal.entries[0].content, journal.capabilities.create], ['2024-02-01', 'Reunião de abertura do projeto.', false])
    assert.equal((await mario.patch(`/plan/journal/${entry.body.data.id}`, { content: 'Abertura (ata enviada).' })).body.data.content, 'Abertura (ata enviada).')

    // problemas
    const issue = await mario.post(`/projects/${p}/plan/issues`, { opened_on: '2024-02-05', description: 'Cliente sem VPN', owner_id: users.mario.id })
    assert.equal(issue.status, 201, JSON.stringify(issue.body))
    assert.deepEqual([issue.body.data.number, issue.body.data.state, issue.body.data.owner.name], [1, 'pending', 'Mário'])
    const resolved = (await mario.patch(`/plan/issues/${issue.body.data.id}`, { state: 'resolved' })).body.data
    assert.equal(resolved.state, 'resolved')
    assert.match(resolved.resolved_on, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal((await mario.post(`/projects/${p}/plan/issues`, { opened_on: '2024-02-06', description: 'Segundo' })).body.data.number, 2)
    assert.equal((await lia.get(`/projects/${p}/plan/issues`)).body.data.issues.length, 2)
    assert.equal((await lia.del(`/plan/issues/${issue.body.data.id}`)).status, 403)

    // linha de base (gestor) e resumo do quadro
    assert.equal((await mario.put(`/projects/${p}/plan/baseline`)).status, 403)
    const saved = await admin.put(`/projects/${p}/plan/baseline`)
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    assert.equal(saved.body.data.items, 2)
    await mario.patch(`/plan/items/${plano.id}`, { end_date: '2024-02-09' })
    const after = (await lia.get(`/projects/${p}/plan`)).body.data
    const row = after.items.find((i) => i.id === plano.id)
    assert.deepEqual([row.baseline_start, row.baseline_end, row.end_date], ['2024-02-01', '2024-02-05', '2024-02-09'])
    assert.ok(after.settings.baseline_at)
    assert.equal(after.summary.items, 2)
    assert.equal(after.summary.estimated_hours, 14)

    // relatório
    const report = (await lia.get(`/projects/${p}/plan/report?tz_offset=180`)).body.data
    assert.deepEqual([report.summary.total, report.summary.done, report.effort.estimated], [2, 1, 14])
    assert.deepEqual(report.health.factors.map((f) => f.key), ['schedule', 'progress', 'stuck', 'effort', 'issues'])
    assert.equal((await lia.get(`/projects/${p}/plan/report?tz_offset=abc`)).status, 400)

    assert.equal((await admin.del(`/projects/${p}/plan/baseline`)).status, 200)
    assert.equal((await lia.get(`/projects/${p}/plan`)).body.data.settings.baseline_at, null)
    const audit = (await admin.get(`/projects/${p}/history`)).body.data.map((h) => h.action)
    ;['plan_journal.created', 'plan_journal.updated', 'plan_issue.created', 'plan_issue.updated', 'plan_settings.baseline_saved', 'plan_settings.baseline_cleared'].forEach((action) => assert.ok(audit.includes(action), action))
  })

  it('GP-5: colunas personalizadas — o gestor define, quem edita preenche (validado), soma no rodapé, troca de tipo com prévia, duplicar e excluir', async () => {
    const other = (await admin.post('/projects', { name: 'Colunas GP5', key: 'COL' })).body.data
    await admin.post(`/projects/${other.id}/members`, { user_id: users.mario.id, role: 'member' })
    await admin.post(`/projects/${other.id}/members`, { user_id: users.lia.id, role: 'viewer' })
    const p = other.id
    const g = (await admin.post(`/projects/${p}/groups`, { name: 'Execução' })).body.data
    const a = (await mario.post(`/projects/${p}/plan/items`, { group_id: g.id, name: 'Compra de servidores' })).body.data
    const b = (await mario.post(`/projects/${p}/plan/items`, { group_id: g.id, name: 'Licenças' })).body.data

    assert.equal((await mario.post(`/projects/${p}/plan/columns`, { name: 'Custo', type: 'number' })).status, 403)
    const custo = await admin.post(`/projects/${p}/plan/columns`, { name: 'Custo', type: 'number', settings: { unit: 'R$' } })
    assert.equal(custo.status, 201, JSON.stringify(custo.body))
    const fase = (await admin.post(`/projects/${p}/plan/columns`, { name: 'Fase', type: 'dropdown', settings: { options: [{ name: 'Piloto', color: 'blue' }] } })).body.data
    const nota = (await admin.post(`/projects/${p}/plan/columns`, { name: 'Nota', type: 'text' })).body.data
    const c = custo.body.data.id
    const piloto = fase.settings.options[0].id

    const set = await mario.patch(`/plan/items/${a.id}`, { custom: { [c]: 1200.5, [fase.id]: piloto, [nota.id]: '12,5' } })
    assert.equal(set.status, 200, JSON.stringify(set.body))
    assert.equal(set.body.data.custom[c], 1200.5)
    await mario.patch(`/plan/items/${b.id}`, { custom: { [c]: 300, [nota.id]: 'sem valor' } })
    assert.equal((await mario.patch(`/plan/items/${a.id}`, { custom: { [c]: 'mil' } })).body.error.code, 'VALIDATION_ERROR')
    assert.equal((await lia.patch(`/plan/items/${a.id}`, { custom: { [c]: 1 } })).status, 403)

    const board = (await lia.get(`/projects/${p}/plan`)).body.data
    assert.deepEqual(board.columns.map((x) => x.name), ['Custo', 'Fase', 'Nota'])
    assert.equal(board.groups[0].summary.custom_sums[c], 1500.5)
    assert.deepEqual(board.items.find((i) => i.id === a.id).custom, { [c]: 1200.5, [fase.id]: piloto, [nota.id]: '12,5' })

    const preview = (await admin.post(`/plan/columns/${nota.id}/type`, { type: 'number', dry_run: true })).body.data
    assert.deepEqual(preview, { converted: 1, lost: 1 })
    const changed = await admin.post(`/plan/columns/${nota.id}/type`, { type: 'number' })
    assert.equal(changed.status, 200, JSON.stringify(changed.body))
    const afterType = (await lia.get(`/projects/${p}/plan`)).body.data
    assert.equal(afterType.items.find((i) => i.id === a.id).custom[nota.id], 12.5)
    assert.equal(afterType.items.find((i) => i.id === b.id).custom[nota.id], undefined)

    const copy = await admin.post(`/plan/columns/${fase.id}/duplicate`)
    assert.equal(copy.status, 201, JSON.stringify(copy.body))
    assert.equal(copy.body.data.name, 'Fase (cópia)')
    assert.equal((await admin.patch(`/plan/columns/${fase.id}`, { name: 'Etapa' })).body.data.name, 'Etapa')
    const removed = await admin.del(`/plan/columns/${c}`)
    assert.deepEqual(removed.body.data, { deleted: true, values: 2 })
    const final = (await lia.get(`/projects/${p}/plan`)).body.data
    assert.deepEqual(final.columns.map((x) => x.name), ['Etapa', 'Fase (cópia)', 'Nota'])
    assert.equal(final.items.find((i) => i.id === a.id).custom[c], undefined)
    const history = (await admin.get(`/projects/${p}/history`)).body.data.map((h) => h.action)
    ;['plan_column.created', 'plan_column.type_changed', 'plan_column.duplicated', 'plan_column.updated', 'plan_column.deleted'].forEach((action) => assert.ok(history.includes(action), action))
  })
})
