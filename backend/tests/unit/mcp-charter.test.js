const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { validateArguments } = require('../../src/mcp/schema')
const { TOOLS } = require('../../src/mcp/catalog/charter')

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

const FEATURE = {
  id: 'f1',
  kind: 'feature',
  title: 'Reclamos',
  progress: { done: 1, total: 1 },
  tasks: [{ id: 't1', code: 'CRM-1', title: 'Tela', project: { id: 'p1', key: 'CRM' }, tags: [], card_fields: [], comment_count: 2 }],
}

describe('mcp/catalog/charter — catálogo', () => {
  it('nomes únicos, esquemas fechados e descritos, anotações coerentes', () => {
    const names = TOOLS.map((t) => t.name)
    assert.equal(new Set(names).size, names.length)
    TOOLS.forEach((tool) => {
      assert.match(tool.name, /^[a-z][a-z_]{2,40}$/, tool.name)
      assert.ok(tool.title && tool.description.length > 20, tool.name)
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name)
      ;(tool.inputSchema.required || []).forEach((key) => assert.ok(tool.inputSchema.properties[key], `${tool.name}.${key}`))
      Object.keys(tool.inputSchema.properties).forEach((key) => assert.ok(tool.inputSchema.properties[key].description, `${tool.name}.${key} sem descrição`))
      assert.equal(tool.annotations.readOnlyHint, /^(get|list)_/.test(tool.name), tool.name)
      if (/^delete_/.test(tool.name)) {
        assert.equal(tool.annotations.destructiveHint, true, tool.name)
        assert.match(tool.description, /Confirm with the user first\.$/, tool.name)
      }
    })
  })

  it('entra no catálogo principal uma vez só e cobre as rotas da ficha', () => {
    const { TOOLS: main } = require('../../src/mcp/tools')
    const names = main.map((t) => t.name)
    TOOLS.forEach((tool) => assert.equal(names.filter((name) => name === tool.name).length, 1, tool.name))
    ;[
      'get_project_charter', 'update_project_charter', 'create_charter_item', 'update_charter_item', 'reorder_charter_items', 'delete_charter_item',
      'list_charter_measurements', 'add_charter_measurement',
    ].forEach((name) => assert.ok(byName(name), name))
  })

  it('valida tipo do item, estado e números antes do caso de uso', () => {
    const create = byName('create_charter_item').inputSchema
    assert.deepEqual(validateArguments({ project_id: 'p1', kind: 'result', title: 'Usuários', target: 120, frequency: 'monthly' }, create), {})
    assert.deepEqual(validateArguments({ project_id: 'p1', kind: 'risk', title: 'X' }, create), { kind: 'invalid_option' })
    assert.deepEqual(validateArguments({ project_id: 'p1', kind: 'result', title: 'X', target: '10' }, create), { target: 'invalid_type' })
    assert.deepEqual(validateArguments({ project_id: 'p1', kind: 'feature', title: 'X', state: 'whatever' }, create), { state: 'invalid_option' })
    assert.deepEqual(validateArguments({ item_id: 'i1', owner_id: null, due_date: null }, byName('update_charter_item').inputSchema), {})
    assert.deepEqual(validateArguments({ item_id: 'i1' }, byName('add_charter_measurement').inputSchema), { value: 'required' })
  })
})

describe('mcp/catalog/charter — delegação', () => {
  it('ficha e item: o id vai no caminho, o resto vira o corpo; tarefas das funcionalidades enxutas', async () => {
    const charter = { project_id: 'p1', objective: 'Centralizar', items: [FEATURE, { id: 's1', kind: 'scope_in', title: 'Portal' }] }
    const got = await run('get_project_charter', { project_id: 'p1' }, { 'charter.getCharter': charter })
    assert.deepEqual(got.calls[0], { service: 'charter', method: 'getCharter', args: ['p1'] })
    assert.equal(got.out.items[0].tasks[0].project, 'CRM')
    assert.equal(got.out.items[0].tasks[0].card_fields, undefined)
    assert.deepEqual(got.out.items[1], { id: 's1', kind: 'scope_in', title: 'Portal' })

    const objective = await run('update_project_charter', { project_id: 'p1', objective: 'Novo' }, { 'charter.updateCharter': charter })
    assert.deepEqual(objective.calls[0].args, ['p1', { objective: 'Novo' }])

    const created = await run('create_charter_item', { project_id: 'p1', kind: 'feature', title: 'Reclamos', task_ids: ['t1'] }, { 'charter.createItem': FEATURE })
    assert.deepEqual(created.calls[0].args, ['p1', { kind: 'feature', title: 'Reclamos', task_ids: ['t1'] }])
    assert.equal(created.out.tasks[0].code, 'CRM-1')

    const updated = await run('update_charter_item', { item_id: 'r1', target: 90, owner_id: null }, { 'charter.updateItem': { id: 'r1', kind: 'result' } })
    assert.deepEqual(updated.calls[0].args, ['r1', { target: 90, owner_id: null }])
  })

  it('ordem, exclusão e medições', async () => {
    const { calls: order } = await run('reorder_charter_items', { project_id: 'p1', kind: 'objective', item_ids: ['o2', 'o1'] }, { 'charter.reorderItems': { items: [] } })
    assert.deepEqual(order[0], { service: 'charter', method: 'reorderItems', args: ['p1', { kind: 'objective', ids: ['o2', 'o1'] }] })
    const { calls: removed } = await run('delete_charter_item', { item_id: 'i1' })
    assert.deepEqual(removed[0], { service: 'charter', method: 'deleteItem', args: ['i1'] })
    const { calls: list } = await run('list_charter_measurements', { item_id: 'r1' })
    assert.deepEqual(list[0], { service: 'charter', method: 'listMeasurements', args: ['r1'] })
    const { calls: measured } = await run('add_charter_measurement', { item_id: 'r1', value: 46, note: 'CRM', measured_at: '2026-10-15' }, { 'charter.addMeasurement': { id: 'r1' } })
    assert.deepEqual(measured[0], { service: 'charter', method: 'addMeasurement', args: ['r1', { value: 46, note: 'CRM', measured_at: '2026-10-15' }] })
  })
})
