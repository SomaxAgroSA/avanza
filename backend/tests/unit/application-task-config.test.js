const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createCustomFieldService } = require('../../src/application/custom-fields')
const { createTaskTypeService } = require('../../src/application/task-types')
const { createLookupService } = require('../../src/application/lookups')
const { createPrincipal } = require('../../src/domain/rbac')

async function ctxFor(deps, roleCode) {
  const user = await seedUser(deps, { roleCode })
  const role = await deps.roleRepository.findById(user.roleId)
  return {
    principal: createPrincipal({ userId: user.id, roleId: role.id, roleCode, permissions: await deps.roleRepository.getPermissionCodes(role.id) }),
    ip: '1.1.1.1',
    userAgent: 'ua',
    correlationId: 'c',
  }
}

async function setup() {
  const deps = createFakeDeps()
  return {
    deps,
    fields: createCustomFieldService(deps),
    types: createTaskTypeService(deps),
    admin: await ctxFor(deps, 'ADMIN'),
    member: await ctxFor(deps, 'MEMBER'),
    viewer: await ctxFor(deps, 'VIEWER'),
  }
}

const severity = {
  label: 'Severidade',
  type: 'select',
  filterable: true,
  options: [
    { label: 'Crítica', color: 'red' },
    { label: 'Média', color: 'amber', is_default: true },
    { label: 'Baixa', color: 'green' },
  ],
}

describe('application/custom-fields', () => {
  it('cria campo com nome técnico derivado do rótulo, opções e padrão marcado na opção', async () => {
    const { deps, fields, admin } = await setup()
    const field = await fields.createField(admin, severity)
    assert.equal(field.name, 'severidade')
    assert.equal(field.type, 'select')
    assert.deepEqual(field.options.map((o) => [o.label, o.color, o.order, o.is_active]), [
      ['Crítica', 'red', 0, true],
      ['Média', 'amber', 1, true],
      ['Baixa', 'green', 2, true],
    ])
    const media = field.options.find((o) => o.label === 'Média')
    assert.deepEqual(field.default_value, media.id)
    assert.equal(field.filterable, true)
    assert.equal(deps.store.audit.at(-1).action, 'custom_field.created')
  })

  it('exige settings.manage para alterar a biblioteca', async () => {
    const { fields, member } = await setup()
    await assert.rejects(() => fields.createField(member, severity), { code: 'FORBIDDEN' })
  })

  it('valida tipo, config, flags não suportadas, opções e padrão', async () => {
    const { fields, admin } = await setup()
    await assert.rejects(
      () => fields.createField(admin, { label: 'X', type: 'nope' }),
      (err) => err.details.fields.type === 'invalid_option',
    )
    await assert.rejects(
      () => fields.createField(admin, { label: 'Descrição longa', type: 'textarea', sortable: true }),
      (err) => err.details.fields.sortable === 'not_supported',
    )
    await assert.rejects(
      () => fields.createField(admin, { label: 'Horas', type: 'decimal', config: { decimals: 12 } }),
      (err) => err.details.fields.config === 'decimals',
    )
    await assert.rejects(
      () => fields.createField(admin, { label: 'Ambiente', type: 'select', options: [] }),
      (err) => err.details.fields.options === 'required',
    )
    await assert.rejects(
      () => fields.createField(admin, { label: 'Ambiente', type: 'select', options: [{ label: 'Prod' }, { label: 'prod' }] }),
      (err) => err.details.fields.options === 'duplicate_option',
    )
    await assert.rejects(
      () => fields.createField(admin, { label: 'Estimativa', type: 'number', config: { max: 10 }, default_value: 20 }),
      (err) => err.details.fields.default_value === 'too_large',
    )
  })

  it('nome técnico é único e imutável; tipo é imutável', async () => {
    const { fields, admin } = await setup()
    const field = await fields.createField(admin, severity)
    await assert.rejects(() => fields.createField(admin, Object.assign({}, severity, { label: 'Outra' , name: 'severidade' })), {
      code: 'FIELD_NAME_IN_USE',
    })
    await assert.rejects(() => fields.updateField(admin, field.id, { type: 'text' }), (err) => err.details.fields.type === 'immutable')
    await assert.rejects(() => fields.updateField(admin, field.id, { name: 'outro' }), (err) => err.details.fields.name === 'immutable')
  })

  it('atualiza opções preservando IDs existentes, adicionando e removendo', async () => {
    const { fields, admin } = await setup()
    const field = await fields.createField(admin, severity)
    const [critica, media] = field.options
    const updated = await fields.updateField(admin, field.id, {
      label: 'Severidade do bug',
      options: [
        { id: media.id, label: 'Média', color: 'amber' },
        { id: critica.id, label: 'Crítica!', color: 'red', is_default: true },
        { label: 'Bloqueante', color: 'violet', is_active: false },
      ],
    })
    assert.equal(updated.label, 'Severidade do bug')
    assert.deepEqual(updated.options.map((o) => [o.label, o.order, o.is_active]), [
      ['Média', 0, true],
      ['Crítica!', 1, true],
      ['Bloqueante', 2, false],
    ])
    assert.equal(updated.options[1].id, critica.id, 'ID preservado')
    assert.equal(updated.default_value, critica.id)
  })

  it('não exclui campo usado por tipo de tarefa', async () => {
    const { fields, types, admin } = await setup()
    const field = await fields.createField(admin, severity)
    const bug = await types.createType(admin, { key: 'bug', name: 'Bug' })
    await types.setTypeFields(admin, bug.id, [{ field_id: field.id, required: true }])
    await assert.rejects(() => fields.deleteField(admin, field.id), (err) => err.code === 'FIELD_IN_USE' && err.details.types[0] === 'BUG')
    await types.setTypeFields(admin, bug.id, [])
    await fields.deleteField(admin, field.id)
    await assert.rejects(() => fields.getField(admin, field.id), { code: 'FIELD_NOT_FOUND' })
  })

  it('lista com busca, filtro por tipo e "usado em"', async () => {
    const { fields, types, admin, member, viewer } = await setup()
    const sev = await fields.createField(admin, severity)
    await fields.createField(admin, { label: 'Versão', type: 'text' })
    const bug = await types.createType(admin, { key: 'BUG', name: 'Bug' })
    await types.setTypeFields(admin, bug.id, [{ field_id: sev.id }])

    const list = await fields.listFields(member, { search: 'sev' })
    assert.equal(list.length, 1)
    assert.deepEqual(list[0].used_by.map((t) => t.key), ['BUG'])
    assert.equal((await fields.listFields(member, { type: 'text' }))[0].name, 'versao')
    assert.equal((await fields.listFields(viewer, {})).length, 2, 'quem vê tarefas lê a biblioteca')
  })
})

describe('application/task-types', () => {
  it('traduções do tipo: original editável em pt-BR, en/es opcionais e exibição no idioma da requisição', async () => {
    const { deps, types, admin } = await setup()
    const created = await types.createType(admin, {
      key: 'SUPORTE',
      name: 'Suporte',
      description: 'Atendimento e dúvidas',
      translations: { es: { name: ' Soporte ', description: '' }, en: { name: 'Support', description: 'Help desk and questions' } },
    })
    assert.deepEqual(created.translations, {
      'pt-BR': { name: 'Suporte', description: 'Atendimento e dúvidas' },
      en: { name: 'Support', description: 'Help desk and questions' },
      es: { name: 'Soporte', description: '' },
    })
    assert.equal(created.name, 'Suporte')

    // em espanhol: nome traduzido; descrição sem tradução usa o original
    deps.locale = 'es'
    const es = await types.getType(admin, created.id)
    assert.deepEqual([es.name, es.description], ['Soporte', 'Atendimento e dúvidas'])
    assert.equal((await types.listTypes(admin, {})).find((t) => t.id === created.id).name, 'Soporte')
    deps.locale = 'en'
    assert.equal((await types.getType(admin, created.id)).description, 'Help desk and questions')

    // editar só a tradução (o original fica como está) e registrar no histórico
    deps.locale = 'pt-BR'
    const updated = await types.updateType(admin, created.id, { translations: { es: { name: 'Soporte técnico' } } })
    assert.deepEqual([updated.name, updated.translations.es.name, updated.translations.en.name], ['Suporte', 'Soporte técnico', ''])
    const audit = deps.store.audit.filter((e) => e.action === 'task_type.updated').at(-1)
    assert.ok(JSON.stringify(audit.newValue.translations).includes('Soporte técnico'))
    // sem mudanças, nada é gravado
    const count = deps.store.audit.length
    await types.updateType(admin, created.id, { translations: { es: { name: 'Soporte técnico' } } })
    assert.equal(deps.store.audit.length, count)

    const code = async (input) => {
      try {
        await types.updateType(admin, created.id, input)
      } catch (err) {
        return err.code + ':' + JSON.stringify(err.details.fields)
      }
      return 'OK'
    }
    assert.equal(await code({ translations: { fr: { name: 'Support' } } }), 'VALIDATION_ERROR:{"translations":"invalid_locale"}')
    assert.equal(await code({ translations: { es: { name: 'x'.repeat(61) } } }), 'VALIDATION_ERROR:{"translations":"too_long"}')
  })

  it('"Usado em" dos campos mostra o tipo no idioma da requisição', async () => {
    const { deps, fields, types, admin } = await setup()
    const field = await fields.createField(admin, { label: 'Versão', type: 'text' })
    const doc = await types.createType(admin, { key: 'DOC', name: 'Documentação', translations: { es: { name: 'Documentación' } } })
    await types.setTypeFields(admin, doc.id, [{ field_id: field.id }])
    deps.locale = 'es'
    const listed = (await fields.listFields(admin, {})).find((f) => f.id === field.id)
    assert.deepEqual(listed.used_by.map((t) => t.name), ['Documentación'])
  })

  it('campos obrigatórios por status: grava os status, valida e normaliza', async () => {
    const { deps, fields, types, admin } = await setup()
    const statuses = createLookupService(deps, 'status')
    const backlog = await statuses.create(admin, { key: 'BACKLOG', name: 'Backlog', category: 'backlog', is_default: true })
    const analise = await statuses.create(admin, { key: 'ANALISE', name: 'Análise', category: 'todo' })
    const dev = await statuses.create(admin, { key: 'DEV', name: 'Desenvolvimento', category: 'in_progress' })
    const parecer = await fields.createField(admin, { label: 'Parecer do analista', type: 'textarea' })
    const versao = await fields.createField(admin, { label: 'Versão', type: 'text' })
    const interno = await fields.createField(admin, { label: 'Interno', type: 'text' })
    const bug = await types.createType(admin, { key: 'BUG', name: 'Bug' })

    const detail = await types.setTypeFields(admin, bug.id, [
      { field_id: parecer.id, required_status_ids: [analise.id, dev.id, analise.id] },
      // obrigatório sempre: a lista por status é redundante e some
      { field_id: versao.id, required: true, required_status_ids: [backlog.id] },
      // oculto nunca é exigido
      { field_id: interno.id, visible: false, required_status_ids: [dev.id] },
    ])
    assert.deepEqual(
      detail.fields.map((f) => [f.field.name, f.required, f.required_status_ids]),
      [
        ['parecer_do_analista', false, [analise.id, dev.id]],
        ['versao', true, []],
        ['interno', false, []],
      ],
    )
    assert.deepEqual((await types.getType(admin, bug.id)).fields[0].required_status_ids, [analise.id, dev.id])

    const code = async (items) => {
      try {
        await types.setTypeFields(admin, bug.id, items)
      } catch (err) {
        return err.code + ':' + JSON.stringify(err.details.fields)
      }
      return 'OK'
    }
    assert.equal(await code([{ field_id: parecer.id, required_status_ids: 'x' }]), 'VALIDATION_ERROR:{"fields":"invalid_type"}')
    assert.equal(await code([{ field_id: parecer.id, required_status_ids: ['nao-existe'] }]), 'VALIDATION_ERROR:{"fields":"invalid_status"}')

    // histórico do tipo mostra onde o campo é exigido
    const history = deps.store.audit.filter((e) => e.action === 'task_type.fields_updated')[0]
    assert.ok(history.newValue.fields.includes('Parecer do analista (Análise, Desenvolvimento)'), JSON.stringify(history.newValue))
  })

  it('cria tipo com chave normalizada, ordem ao final e auditoria', async () => {
    const { deps, types, admin } = await setup()
    const a = await types.createType(admin, { key: 'bug', name: 'Bug', icon: 'bug', color: 'red' })
    const b = await types.createType(admin, { key: 'nova funcionalidade', name: 'Nova funcionalidade' })
    assert.equal(a.key, 'BUG')
    assert.equal(b.key, 'NOVA_FUNCIONALIDADE')
    assert.equal(b.order, 1)
    assert.equal(b.is_active, true)
    assert.equal(deps.store.audit.at(-1).action, 'task_type.created')
    await assert.rejects(() => types.createType(admin, { key: 'BUG', name: 'Outro' }), { code: 'TASK_TYPE_KEY_IN_USE' })
  })

  it('configura campos do tipo: ordem, obrigatório, visível e card', async () => {
    const { fields, types, admin, member } = await setup()
    const sev = await fields.createField(admin, severity)
    const ver = await fields.createField(admin, { label: 'Versão', type: 'text' })
    const bug = await types.createType(admin, { key: 'BUG', name: 'Bug' })

    const configured = await types.setTypeFields(admin, bug.id, [
      { field_id: ver.id, required: false, show_on_card: true },
      { field_id: sev.id, required: true },
    ])
    assert.deepEqual(configured.fields.map((f) => [f.field.name, f.order, f.required, f.visible, f.show_on_card]), [
      ['versao', 0, false, true, true],
      ['severidade', 1, true, true, false],
    ])
    assert.equal(configured.fields[1].field.options.length, 3, 'inclui opções para o formulário dinâmico')
    assert.equal((await types.getType(member, bug.id)).fields.length, 2)
    assert.equal((await types.listTypes(member, {}))[0].field_count, 2)
  })

  it('rejeita campos duplicados ou inexistentes', async () => {
    const { fields, types, admin } = await setup()
    const sev = await fields.createField(admin, severity)
    const bug = await types.createType(admin, { key: 'BUG', name: 'Bug' })
    await assert.rejects(() => types.setTypeFields(admin, bug.id, [{ field_id: sev.id }, { field_id: sev.id }]), (err) => err.details.fields.fields === 'duplicate_field')
    await assert.rejects(() => types.setTypeFields(admin, bug.id, [{ field_id: 'nope' }]), { code: 'FIELD_NOT_FOUND' })
  })

  it('reordena tipos exigindo a lista completa', async () => {
    const { types, admin } = await setup()
    const a = await types.createType(admin, { key: 'A1', name: 'A' })
    const b = await types.createType(admin, { key: 'B1', name: 'B' })
    const c = await types.createType(admin, { key: 'C1', name: 'C' })
    assert.deepEqual((await types.reorderTypes(admin, [c.id, a.id, b.id])).map((t) => t.key), ['C1', 'A1', 'B1'])
    await assert.rejects(() => types.reorderTypes(admin, [c.id, a.id]), (err) => err.details.fields.ids === 'invalid_order')
  })

  it('desativa (some da lista padrão) e só exclui tipo sem tarefas', async () => {
    const { deps, types, admin, member } = await setup()
    const bug = await types.createType(admin, { key: 'BUG', name: 'Bug' })
    await types.updateType(admin, bug.id, { is_active: false })
    assert.equal((await types.listTypes(member, {})).length, 0)
    assert.equal((await types.listTypes(admin, { include_inactive: '1' })).length, 1)

    deps.store.taskCounts = { [bug.id]: 3 }
    await assert.rejects(() => types.deleteType(admin, bug.id), { code: 'TASK_TYPE_IN_USE' })
    deps.store.taskCounts = {}
    await types.deleteType(admin, bug.id)
    await assert.rejects(() => types.getType(admin, bug.id), { code: 'TASK_TYPE_NOT_FOUND' })
  })

  it('chave é imutável e leitura exige tasks.view ou settings.manage', async () => {
    const { types, admin } = await setup()
    const bug = await types.createType(admin, { key: 'BUG', name: 'Bug' })
    await assert.rejects(() => types.updateType(admin, bug.id, { key: 'BUGS' }), (err) => err.details.fields.key === 'immutable')
    const deps = createFakeDeps()
    const noAccess = await ctxFor(deps, 'VIEWER')
    await deps.roleRepository.setPermissionCodes(noAccess.principal.roleId, [])
    const stripped = Object.assign({}, noAccess, {
      principal: createPrincipal({ userId: 'x', roleId: 'r', roleCode: 'CUSTOM', permissions: [] }),
    })
    await assert.rejects(() => createTaskTypeService(deps).listTypes(stripped, {}), { code: 'FORBIDDEN' })
  })
})
