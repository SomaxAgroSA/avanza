/**
 * Tipos de tarefa e campos personalizados — testes de API contra um PocketBase real.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

describe('API /api/v1/task-types e /custom-fields', { timeout: 120000 }, () => {
  let pb
  let admin
  let roles

  before(async () => {
    pb = await startServer()
    await pb.updateSettings({ rateLimits: { enabled: true, rules: RULES } })
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    roles = (await admin.get('/roles')).body.data
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  async function userWithRole(code, email) {
    await admin.post('/users', { name: code, email, password: 'SenhaTeste123', role_id: roles.find((r) => r.code === code).id })
    const client = createClient(pb.api)
    await client.login(email, 'SenhaTeste123')
    return client
  }

  it('carga inicial: 8 tipos da diretriz e campos do BUG configurados', async () => {
    const list = await admin.get('/task-types')
    assert.equal(list.status, 200, JSON.stringify(list.body))
    assert.deepEqual(list.body.data.map((t) => t.key), [
      'BUG', 'DESENVOLVIMENTO', 'MELHORIA', 'ADEQUACAO', 'NOVA_FUNCIONALIDADE', 'INTEGRACAO', 'SUPORTE', 'DOCUMENTACAO',
    ])
    const bug = (await admin.get(`/task-types/${list.body.data[0].id}`)).body.data
    assert.deepEqual(bug.fields.map((f) => f.field.name), [
      'ambiente', 'versao', 'severidade', 'passos_para_reproducao', 'resultado_esperado', 'resultado_atual', 'evidencias', 'cliente_afetado', 'modulo',
    ])
    const severidade = bug.fields.find((f) => f.field.name === 'severidade')
    assert.equal(severidade.required, true)
    assert.equal(severidade.show_on_card, true)
    assert.deepEqual(severidade.field.options.map((o) => o.label), ['Crítica', 'Alta', 'Média', 'Baixa'])
    assert.equal(severidade.field.default_value, severidade.field.options[2].id)

    const criterios = (await admin.get('/custom-fields?search=criterios')).body.data[0]
    assert.deepEqual(criterios.used_by.map((t) => t.key).sort(), ['DESENVOLVIMENTO', 'MELHORIA'])
  })

  it('cria campo com opções, edita preservando IDs e configura no tipo', async () => {
    const created = await admin.post('/custom-fields', {
      label: 'Canal de atendimento',
      type: 'select',
      filterable: true,
      options: [{ label: 'E-mail', color: 'blue', is_default: true }, { label: 'Telefone', color: 'green' }],
    })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const field = created.body.data
    assert.equal(field.name, 'canal_de_atendimento')
    assert.equal(field.default_value, field.options[0].id)

    const updated = await admin.patch(`/custom-fields/${field.id}`, {
      options: [
        { id: field.options[1].id, label: 'Telefone', color: 'green' },
        { id: field.options[0].id, label: 'E-mail', color: 'blue' },
        { label: 'Chat', color: 'violet', is_default: true },
      ],
    })
    assert.equal(updated.status, 200, JSON.stringify(updated.body))
    assert.deepEqual(updated.body.data.options.map((o) => o.label), ['Telefone', 'E-mail', 'Chat'])
    assert.equal(updated.body.data.options[0].id, field.options[1].id)
    assert.equal(updated.body.data.default_value, updated.body.data.options[2].id)

    const suporte = (await admin.get('/task-types')).body.data.find((t) => t.key === 'SUPORTE')
    const configured = await admin.put(`/task-types/${suporte.id}/fields`, { fields: [{ field_id: field.id, required: true, show_on_card: true }] })
    assert.equal(configured.status, 200, JSON.stringify(configured.body))
    assert.equal(configured.body.data.fields[0].field.name, 'canal_de_atendimento')

    const blocked = await admin.del(`/custom-fields/${field.id}`)
    assert.equal(blocked.body.error.code, 'FIELD_IN_USE')
    assert.deepEqual(blocked.body.error.details.types, ['SUPORTE'])

    const history = (await admin.get(`/task-types/${suporte.id}/history`)).body.data
    assert.equal(history[0].action, 'task_type.fields_updated')
    assert.deepEqual(history[0].new_value.fields, ['Canal de atendimento *'])
  })

  it('valida entrada e unicidade', async () => {
    const bad = await admin.post('/custom-fields', { label: 'Obs', type: 'textarea', sortable: true })
    assert.equal(bad.body.error.details.fields.sortable, 'not_supported')
    const dup = await admin.post('/custom-fields', { label: 'Versão', type: 'text' })
    assert.equal(dup.body.error.code, 'FIELD_NAME_IN_USE')
    const key = await admin.post('/task-types', { key: 'bug', name: 'Outro' })
    assert.equal(key.body.error.code, 'TASK_TYPE_KEY_IN_USE')
  })

  it('cria, desativa, reordena e exclui tipo', async () => {
    const created = await admin.post('/task-types', { key: 'pesquisa', name: 'Pesquisa', icon: 'search', color: 'indigo' })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.equal(created.body.data.key, 'PESQUISA')
    assert.equal(created.body.data.order, 8)

    const all = (await admin.get('/task-types?include_inactive=1')).body.data.map((t) => t.id)
    const reordered = await admin.put('/task-types/order', { ids: [all[8]].concat(all.slice(0, 8)) })
    assert.equal(reordered.status, 200, JSON.stringify(reordered.body))
    assert.equal(reordered.body.data[0].key, 'PESQUISA')

    await admin.patch(`/task-types/${created.body.data.id}`, { is_active: false })
    assert.equal((await admin.get('/task-types')).body.data.some((t) => t.key === 'PESQUISA'), false)
    assert.equal((await admin.del(`/task-types/${created.body.data.id}`)).status, 200)
  })

  it('obrigatório por status: salvo no tipo e exigido ao criar, editar e mover no Kanban', async () => {
    const statuses = (await admin.get('/statuses')).body.data
    const st = (key) => statuses.find((x) => x.key === key).id
    const parecer = (await admin.post('/custom-fields', { label: 'Parecer do analista', type: 'textarea' })).body.data
    const type = (await admin.post('/task-types', { key: 'ANALISADO', name: 'Analisado' })).body.data
    const fieldsPath = `/task-types/${type.id}/fields`
    const saved = await admin.put(fieldsPath, { fields: [{ field_id: parecer.id, required_status_ids: [st('ANALISE'), st('DESENVOLVIMENTO')] }] })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    assert.deepEqual(saved.body.data.fields[0].required_status_ids, [st('ANALISE'), st('DESENVOLVIMENTO')])
    assert.equal((await admin.put(fieldsPath, { fields: [{ field_id: parecer.id, required_status_ids: ['naoexiste'] }] })).body.error.details.fields.fields, 'invalid_status')

    const project = (await admin.post('/projects', { name: 'Por status', key: 'PST' })).body.data
    const base = { project_id: project.id, task_type_id: type.id, title: 'Avaliar integração' }
    const denied = await admin.post('/tasks', Object.assign({ status_id: st('ANALISE') }, base))
    assert.equal(denied.status, 400)
    assert.deepEqual(denied.body.error.details.fields, { 'custom_values.parecer_do_analista': 'required' })
    assert.equal(denied.body.error.details.status.name, 'Análise')

    const task = (await admin.post('/tasks', base)).body.data
    const taskPath = `/tasks/${task.id}`
    const move = await admin.post(`${taskPath}/move`, { status_id: st('ANALISE') })
    assert.equal(move.status, 400)
    assert.equal(move.body.error.details.status.id, st('ANALISE'))
    const filled = await admin.patch(taskPath, { custom_values: { parecer_do_analista: 'Viável' } })
    assert.equal(filled.status, 200, JSON.stringify(filled.body))
    assert.equal((await admin.post(`${taskPath}/move`, { status_id: st('ANALISE') })).status, 200)
  })

  it('tipos traduzidos: padrão já traduzido, idioma pelo Accept-Language e tradução editável', async () => {
    const lang = (value) => ({ headers: { 'Accept-Language': value } })
    const byKey = (list, key) => list.find((t) => t.key === key)
    const es = (await admin.get('/task-types', lang('es-ES,es;q=0.9'))).body.data
    assert.equal(byKey(es, 'DOCUMENTACAO').name, 'Documentación')
    assert.equal(byKey(es, 'BUG').name, 'Error')
    assert.equal(byKey(es, 'SUPORTE').description, 'Atención y dudas')
    const en = (await admin.get('/task-types', lang('en-US'))).body.data
    assert.equal(byKey(en, 'NOVA_FUNCIONALIDADE').name, 'New feature')
    const pt = (await admin.get('/task-types')).body.data
    assert.equal(byKey(pt, 'DOCUMENTACAO').name, 'Documentação')
    assert.deepEqual(byKey(pt, 'DOCUMENTACAO').translations['pt-BR'], { name: 'Documentação', description: 'Manuais, guias e registros' })

    // editar a tradução; o original continua o mesmo
    const suporte = byKey(pt, 'SUPORTE')
    const typePath = `/task-types/${suporte.id}`
    const saved = await admin.patch(typePath, { translations: { es: { name: 'Soporte técnico', description: 'Atención y dudas' }, en: { name: 'Support' } } })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    assert.equal(saved.body.data.name, 'Suporte')
    assert.equal((await admin.get(typePath, lang('es'))).body.data.name, 'Soporte técnico')
    assert.equal((await admin.patch(typePath, { translations: { fr: { name: 'Assistance' } } })).body.error.details.fields.translations, 'invalid_locale')

    // o tipo da tarefa também sai no idioma pedido
    const project = (await admin.post('/projects', { name: 'Traduções', key: 'TRD' })).body.data
    const task = (await admin.post('/tasks', { project_id: project.id, task_type_id: suporte.id, title: 'Dúvida sobre nota fiscal' })).body.data
    assert.equal((await admin.get(`/tasks/${task.id}`, lang('es'))).body.data.type.name, 'Soporte técnico')
    assert.equal((await admin.get(`/tasks/${task.id}`)).body.data.type.name, 'Suporte')
  })

  it('leitura para quem vê tarefas; escrita só com settings.manage', async () => {
    const member = await userWithRole('MEMBER', 'membro-config@kamban.test')
    assert.equal((await member.get('/task-types')).status, 200)
    assert.equal((await member.get('/custom-fields')).status, 200)
    assert.equal((await member.post('/task-types', { key: 'X1', name: 'X' })).status, 403)
    assert.equal((await member.post('/custom-fields', { label: 'X', type: 'text' })).status, 403)
  })
})
