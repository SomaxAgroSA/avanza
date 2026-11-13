const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { validateArguments } = require('../../src/mcp/schema')
const { TOOLS } = require('../../src/mcp/catalog/plan')

const ctx = { principal: { userId: 'u1' } }

/** Serviços falsos: guardam as chamadas e devolvem o que o teste pedir. */
function spyServices(returns) {
  const calls = []
  const handler = (service) =>
    new Proxy(
      {},
      {
        get: (_, method) => async (...args) => {
          calls.push({ service, method, args: args.slice(1) })
          const value = (returns || {})[`${service}.${method}`]
          return typeof value === 'function' ? value(...args.slice(1)) : value
        },
      },
    )
  return { calls, services: new Proxy({}, { get: (_, service) => handler(service) }) }
}
const byName = (name) => TOOLS.find((t) => t.name === name)
const run = async (name, args, returns) => {
  const spy = spyServices(returns)
  const out = await byName(name).run(args, { services: spy.services, ctx })
  return { out, calls: spy.calls }
}

/** Descrição em cada propriedade, inclusive nas aninhadas (objetos e itens de lista). */
function assertDescribed(prop, path) {
  assert.ok(prop.description, `${path} sem descrição`)
  const nested = prop.items && prop.items.properties ? prop.items.properties : prop.properties
  if (nested) Object.keys(nested).forEach((key) => assertDescribed(nested[key], `${path}.${key}`))
}

describe('mcp/catalog/plan — catálogo', () => {
  it('nomes únicos, esquemas fechados e descritos, anotações coerentes', () => {
    const names = TOOLS.map((t) => t.name)
    assert.equal(new Set(names).size, names.length)
    TOOLS.forEach((tool) => {
      assert.match(tool.name, /^[a-z][a-z_]{2,40}$/, tool.name)
      assert.ok(tool.title && tool.description.length > 20, tool.name)
      assert.equal(tool.inputSchema.type, 'object', tool.name)
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name)
      ;(tool.inputSchema.required || []).forEach((key) => assert.ok(tool.inputSchema.properties[key], `${tool.name}.${key}`))
      Object.keys(tool.inputSchema.properties).forEach((key) => assertDescribed(tool.inputSchema.properties[key], `${tool.name}.${key}`))
      const readOnly = /^(get|list|find|search|whoami)/.test(tool.name)
      assert.equal(tool.annotations.readOnlyHint, readOnly, tool.name)
      assert.equal(tool.annotations.openWorldHint, false, tool.name)
      if (readOnly) assert.equal(tool.annotations.destructiveHint, false, tool.name)
      const deleting = /^(delete_|bulk_delete_|clear_)/.test(tool.name)
      if (deleting) {
        assert.equal(tool.annotations.destructiveHint, true, tool.name)
        assert.match(tool.description, /Confirm with the user first\.$/, tool.name)
      }
      assert.equal(typeof tool.run, 'function')
    })
  })

  it('entra no catálogo principal uma vez só (sem repetir nomes de outros módulos)', () => {
    const { TOOLS: main } = require('../../src/mcp/tools')
    const names = main.map((t) => t.name)
    TOOLS.forEach((tool) => assert.equal(names.filter((name) => name === tool.name).length, 1, tool.name))
  })

  it('cobre as rotas do módulo', () => {
    ;[
      'get_plan', 'get_plan_item', 'get_plan_item_history', 'get_plan_report',
      'create_plan_group', 'update_plan_group', 'move_plan_group', 'duplicate_plan_group', 'delete_plan_group',
      'create_plan_item', 'update_plan_item', 'set_plan_item_value', 'move_plan_item', 'duplicate_plan_item', 'delete_plan_item',
      'bulk_update_plan_items', 'bulk_move_plan_items', 'bulk_duplicate_plan_items', 'bulk_delete_plan_items', 'import_plan_items',
      'link_plan_items', 'delete_plan_link', 'update_plan_settings',
      'create_plan_status', 'update_plan_status', 'delete_plan_status', 'create_plan_resource', 'update_plan_resource', 'delete_plan_resource',
      'list_plan_updates', 'list_plan_mention_candidates', 'add_plan_update', 'edit_plan_update', 'delete_plan_update', 'delete_plan_file',
      'list_plan_journal', 'add_plan_journal_entry', 'update_plan_journal_entry', 'delete_plan_journal_entry',
      'list_plan_issues', 'create_plan_issue', 'update_plan_issue', 'delete_plan_issue',
      'save_plan_baseline', 'clear_plan_baseline',
      'create_plan_column', 'update_plan_column', 'change_plan_column_type', 'duplicate_plan_column', 'delete_plan_column',
    ].forEach((name) => assert.ok(byName(name), name))
  })

  it('esquemas aceitam os formatos do caso de uso e recusam o resto', () => {
    const item = byName('update_plan_item').inputSchema
    assert.deepEqual(validateArguments({ plan_item_id: 'i1', estimated_hours: 0, progress: null, resource_ids: null, custom: { c1: 3 } }, item), {})
    assert.deepEqual(validateArguments({ plan_item_id: 'i1', progress: 101 }, item), { progress: 'too_large' })
    assert.deepEqual(validateArguments({ plan_item_id: 'i1', progress: 1.5 }, item), { progress: 'invalid_type' })
    const column = byName('create_plan_column').inputSchema
    assert.deepEqual(validateArguments({ project_id: 'p', name: 'Fase', type: 'dropdown', settings: { options: [{ name: 'A', color: 'red' }] } }, column), {})
    assert.deepEqual(validateArguments({ project_id: 'p', name: 'Fase', type: 'dropdown', settings: { options: [{ name: 'A' }] } }, column), { settings: 'invalid_type' })
    assert.deepEqual(validateArguments({ project_id: 'p', name: 'X', type: 'formula' }, column), { type: 'invalid_option' })
    const value = byName('set_plan_item_value').inputSchema
    ;[true, 3.5, 'texto', null].forEach((v) => assert.deepEqual(validateArguments({ plan_item_id: 'i', column_id: 'c', value: v }, value), {}))
    assert.deepEqual(validateArguments({ plan_item_id: 'i', column_id: 'c', value: ['x'] }, value), { value: 'invalid_type' })
    const rows = byName('import_plan_items').inputSchema
    assert.deepEqual(validateArguments({ project_id: 'p', rows: [{ group: 'G', name: 'E', resources: ['Ana'], progress: 10 }] }, rows), {})
    assert.deepEqual(validateArguments({ project_id: 'p', rows: [{ name: 'E' }] }, rows), { rows: 'invalid_type' })
  })
})

describe('mcp/catalog/plan — argumentos para os casos de uso', () => {
  it('get_plan: quadro enxuto, subelementos dentro do elemento, campos vazios fora', async () => {
    const plan = {
      project: { id: 'p1', key: 'CRM', name: 'CRM', archived: false },
      capabilities: { edit: true, manage: false },
      statuses: [{ id: 's1', name: 'Feito', color: 'green', category: 'done', position: 1 }],
      resources: [{ id: 'r1', name: 'Ana', color: 'indigo' }],
      groups: [
        { id: 'g1', parent_id: null, name: 'Iniciação', color: 'blue', position: 1, number: '1.0', summary: { items: 1, status_counts: [], start_date: '2026-11-01T00:00:00.000Z', end_date: null, estimated_hours: 8, duration_days: 1, progress: 50, custom_sums: {} } },
        { id: 'g2', parent_id: null, name: 'Execução', color: 'red', position: 2, number: '2.0', summary: null },
      ],
      summary: { items: 2, status_counts: [], start_date: null, end_date: null, estimated_hours: null, duration_days: null, progress: 0, custom_sums: {} },
      columns: [{ id: 'c1', name: 'Custo', type: 'number', settings: { unit: 'R$' }, position: 1 }],
      settings: { dependency_rule: 'warn', baseline_at: null },
      links: [{ id: 'l1', from_id: 'i1', to_id: 'i3', type: 'blocks' }],
      items: [
        {
          id: 'i1', group_id: 'g1', parent_id: null, name: 'Reunião', status_id: 's1', start_date: '2026-11-01', end_date: null, due_date: null,
          owner: { id: 'u2', name: 'Bia', email: 'bia@x', avatar_url: null }, resource_ids: ['r1'], estimated_hours: 8, actual_hours: null,
          duration_days: 1, duration_manual: null, progress: { value: 100, source: 'done' }, progress_manual: null, subitems: 1, custom: { c1: 10 },
          position: 1024, created_at: 'x', updated_at: 'y', blocked: false, updates: 2, files: 0, baseline_start: null, baseline_end: null,
        },
        { id: 'i2', group_id: 'g1', parent_id: 'i1', name: 'Ata', status_id: null, resource_ids: [], progress: { value: 0, source: 'none' }, custom: {}, blocked: false, updates: 0 },
        { id: 'i3', group_id: 'g2', parent_id: null, name: 'Entrega', status_id: null, resource_ids: [], estimated_hours: 6, actual_hours: null, estimated_from_tasks: true, actual_from_tasks: false, progress: { value: 0, source: 'none' }, custom: {}, blocked: true, updates: 0 },
      ],
      truncated: false,
    }
    const { out, calls } = await run('get_plan', { project_id: 'p1' }, { 'plan.getPlan': plan })
    assert.deepEqual(calls, [{ service: 'plan', method: 'getPlan', args: ['p1'] }])
    assert.deepEqual(out.statuses, [{ id: 's1', name: 'Feito', category: 'done' }])
    assert.deepEqual(out.resources, [{ id: 'r1', name: 'Ana' }])
    assert.deepEqual(out.columns, [{ id: 'c1', name: 'Custo', type: 'number', settings: { unit: 'R$' } }])
    assert.deepEqual(out.groups[0], { id: 'g1', number: '1.0', name: 'Iniciação', totals: { items: 1, progress: 50, start_date: '2026-11-01', estimated_hours: 8 } })
    assert.deepEqual(out.groups[1], { id: 'g2', number: '2.0', name: 'Execução' })
    assert.deepEqual(out.links, plan.links)
    assert.deepEqual(out.items[0], {
      id: 'i1', name: 'Reunião', group_id: 'g1', status: { id: 's1', name: 'Feito', category: 'done' }, owner: { id: 'u2', name: 'Bia' },
      start_date: '2026-11-01', progress: 100, estimated_hours: 8, resources: ['Ana'], custom: { c1: 10 }, updates: 2,
      subitems: [{ id: 'i2', name: 'Ata', progress: 0 }],
    })
    // sem horas próprias, o esforço vem das tarefas ligadas (regras §28)
    assert.deepEqual(out.items[1], { id: 'i3', name: 'Entrega', group_id: 'g2', progress: 0, estimated_hours: 6, hours_from_tasks: { estimated: true, actual: false }, blocked: true })
    assert.equal(out.items.length, 2)

    const only = (await run('get_plan', { project_id: 'p1', group_id: 'g1', include_subitems: false }, { 'plan.getPlan': plan })).out
    assert.deepEqual(only.groups.map((g) => g.id), ['g1'])
    assert.deepEqual(only.items.map((i) => [i.id, i.subitem_count, i.subitems]), [['i1', 1, undefined]])
  })

  it('criar e editar: o id do caminho sai do corpo; null passa para limpar', async () => {
    const { calls } = await run('update_plan_item', { plan_item_id: 'i1', status_id: null, end_date: null, custom: { c1: null } })
    assert.deepEqual(calls, [{ service: 'plan', method: 'updateItem', args: ['i1', { status_id: null, end_date: null, custom: { c1: null } }] }])
    const created = await run('create_plan_item', { project_id: 'p1', group_id: 'g1', name: 'Kickoff' })
    assert.deepEqual(created.calls, [{ service: 'plan', method: 'createItem', args: ['p1', { group_id: 'g1', name: 'Kickoff' }] }])
    const group = await run('move_plan_group', { group_id: 'g2', parent_id: null, prev_id: 'g1' })
    assert.deepEqual(group.calls, [{ service: 'plan', method: 'moveGroup', args: ['g2', { parent_id: null, prev_id: 'g1' }] }])
  })

  it('set_plan_item_value: vira `custom` com a coluna do elemento', async () => {
    const { calls } = await run('set_plan_item_value', { plan_item_id: 'i1', column_id: 'c1', value: 42 })
    assert.deepEqual(calls, [{ service: 'plan', method: 'updateItem', args: ['i1', { custom: { c1: 42 } }] }])
  })

  it('ações em massa: cada ferramenta fixa a ação', async () => {
    const update = await run('bulk_update_plan_items', { project_id: 'p1', ids: ['i1', 'i2'], status_id: 's1', add_resource_ids: ['r1'] })
    assert.deepEqual(update.calls, [{ service: 'planInteraction', method: 'bulkItems', args: ['p1', { action: 'update', ids: ['i1', 'i2'], status_id: 's1', add_resource_ids: ['r1'] }] }])
    const move = await run('bulk_move_plan_items', { project_id: 'p1', ids: ['i1'], group_id: 'g2' })
    assert.deepEqual(move.calls[0].args, ['p1', { action: 'move', ids: ['i1'], group_id: 'g2' }])
    assert.deepEqual((await run('bulk_duplicate_plan_items', { project_id: 'p1', ids: ['i1'] })).calls[0].args, ['p1', { action: 'duplicate', ids: ['i1'] }])
    assert.deepEqual((await run('bulk_delete_plan_items', { project_id: 'p1', ids: ['i1'] })).calls[0].args, ['p1', { action: 'delete', ids: ['i1'] }])
  })

  it('change_plan_column_type: dry_run vai para o caso de uso', async () => {
    const { out, calls } = await run('change_plan_column_type', { column_id: 'c1', type: 'number', dry_run: true }, { 'planColumns.changeType': { converted: 3, lost: 1 } })
    assert.deepEqual(calls, [{ service: 'planColumns', method: 'changeType', args: ['c1', { type: 'number', dry_run: true }] }])
    assert.deepEqual(out, { converted: 3, lost: 1 })
  })

  it('dependência, atualização, histórico e relatório no formato da API', async () => {
    const link = await run('link_plan_items', { plan_item_id: 'i1', type: 'depends_on', target_item_id: 'i2' })
    assert.deepEqual(link.calls, [{ service: 'planInteraction', method: 'createLink', args: ['i1', { type: 'depends_on', item_id: 'i2' }] }])
    const update = await run('add_plan_update', { plan_item_id: 'i1', content: 'Feito', parent_id: 'up1' })
    assert.deepEqual(update.calls, [{ service: 'planCollaboration', method: 'createUpdate', args: ['i1', { content: 'Feito', parent_id: 'up1' }, []] }])
    const history = await run('get_plan_item_history', { plan_item_id: 'i1', per_page: 5 }, { 'audit.listEntityHistory': { items: [{ id: 'a' }], meta: { page: 1 }, extra: true } })
    assert.deepEqual(history.calls, [{ service: 'audit', method: 'listEntityHistory', args: ['plan_item', 'i1', { perPage: 5 }] }])
    assert.deepEqual(history.out, { items: [{ id: 'a' }], meta: { page: 1 } })
    const report = await run('get_plan_report', { project_id: 'p1', tz_offset: 180 })
    assert.deepEqual(report.calls, [{ service: 'planManagement', method: 'getReport', args: ['p1', { tz_offset: '180' }] }])
    assert.deepEqual((await run('get_plan_report', { project_id: 'p1' })).calls[0].args, ['p1', {}])
    const issue = await run('update_plan_issue', { issue_id: 'x1', state: 'resolved', owner_id: null })
    assert.deepEqual(issue.calls, [{ service: 'planManagement', method: 'updateIssue', args: ['x1', { state: 'resolved', owner_id: null }] }])
  })
})
