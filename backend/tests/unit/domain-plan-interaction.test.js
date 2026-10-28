/**
 * Quadro do projeto — GP-2 (interação): dependências, regra de bloqueio, seleção em massa, mover e
 * importação de elementos.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const links = require('../../src/domain/plan-links')
const importDomain = require('../../src/domain/plan-import')
const plan = require('../../src/domain/plan')

describe('domain/plan-links — dependências', () => {
  it('"A depende de B" é gravado como "B bloqueia A"; relacionado mantém o sentido', () => {
    assert.deepEqual(links.normalizeLink('a', 'b', 'depends_on'), { fromId: 'b', toId: 'a', type: 'blocks' })
    assert.deepEqual(links.normalizeLink('a', 'b', 'blocks'), { fromId: 'a', toId: 'b', type: 'blocks' })
    assert.deepEqual(links.normalizeLink('a', 'b', 'relates'), { fromId: 'a', toId: 'b', type: 'relates' })
    assert.equal(links.linkTypeIssue('outro'), 'invalid_option')
    assert.equal(links.linkTypeIssue('depends_on'), null)
  })

  it('recusa o próprio elemento, repetida (relacionado nos dois sentidos) e ciclo de bloqueio', () => {
    const existing = [
      { fromId: 'a', toId: 'b', type: 'blocks' },
      { fromId: 'b', toId: 'c', type: 'blocks' },
      { fromId: 'x', toId: 'y', type: 'relates' },
    ]
    assert.equal(links.linkIssue(existing, { fromId: 'a', toId: 'a', type: 'blocks' }), 'self')
    assert.equal(links.linkIssue(existing, { fromId: 'a', toId: 'b', type: 'blocks' }), 'duplicate')
    assert.equal(links.linkIssue(existing, { fromId: 'y', toId: 'x', type: 'relates' }), 'duplicate')
    // c → a fecharia a → b → c → a
    assert.equal(links.linkIssue(existing, { fromId: 'c', toId: 'a', type: 'blocks' }), 'cycle')
    assert.equal(links.linkIssue(existing, { fromId: 'a', toId: 'c', type: 'blocks' }), null)
    // relacionado não forma ciclo
    assert.equal(links.linkIssue(existing, { fromId: 'c', toId: 'a', type: 'relates' }), null)
  })

  it('bloqueios pendentes: quem bloqueia e ainda não está encerrado', () => {
    const list = [
      { fromId: 'a', toId: 'c', type: 'blocks' },
      { fromId: 'b', toId: 'c', type: 'blocks' },
      { fromId: 'd', toId: 'c', type: 'relates' },
    ]
    const closed = new Set(['b'])
    assert.deepEqual(links.pendingBlockers('c', list, (id) => closed.has(id)), ['a'])
    assert.deepEqual(links.pendingBlockers('a', list, () => false), [])
  })

  it('a regra "impedir" vale ao iniciar ou concluir', () => {
    assert.equal(links.gatesDependency('todo', 'in_progress'), true)
    assert.equal(links.gatesDependency(null, 'review'), true)
    assert.equal(links.gatesDependency('blocked', 'done'), true)
    assert.equal(links.gatesDependency('in_progress', 'done'), true)
    assert.equal(links.gatesDependency('in_progress', 'review'), false)
    assert.equal(links.gatesDependency('todo', 'blocked'), false)
    assert.equal(links.gatesDependency('done', 'done'), false)
    assert.equal(links.gatesDependency('todo', 'canceled'), false)
    assert.equal(links.ruleIssue('block'), null)
    assert.equal(links.ruleIssue('nunca'), 'invalid_option')
    assert.equal(links.DEFAULT_DEPENDENCY_RULE, 'warn')
  })
})

describe('domain/plan — seleção em massa e mover', () => {
  it('valida ids, ação e os dados de cada ação', () => {
    assert.deepEqual(plan.bulkInput({}).issues, { ids: 'required', action: 'required' })
    assert.deepEqual(plan.bulkInput({ ids: ['a', 'a', 'b'], action: 'delete' }), { issues: {}, data: { ids: ['a', 'b'], action: 'delete' } })
    assert.equal(plan.bulkInput({ ids: ['a b'], action: 'delete' }).issues.ids, 'invalid_type')
    assert.equal(plan.bulkInput({ ids: Array.from({ length: 201 }, (_, i) => `i${i}`), action: 'delete' }).issues.ids, 'too_many')
    assert.equal(plan.bulkInput({ ids: ['a'], action: 'explodir' }).issues.action, 'invalid_option')
    assert.equal(plan.bulkInput({ ids: ['a'], action: 'move' }).issues.group_id, 'required')
    assert.equal(plan.bulkInput({ ids: ['a'], action: 'update' }).issues.data, 'required')
    assert.deepEqual(plan.bulkInput({ ids: ['a'], action: 'update', status_id: null, add_resource_ids: ['r1'] }).data, {
      ids: ['a'],
      action: 'update',
      status_id: null,
      add_resource_ids: ['r1'],
    })
  })

  it('mover: grupo e vizinho opcionais, ids válidos', () => {
    assert.deepEqual(plan.moveInput({ group_id: 'g1', prev_id: 'a' }), { issues: {}, data: { group_id: 'g1', prev_id: 'a' } })
    assert.deepEqual(plan.moveInput({}), { issues: {}, data: {} })
    assert.equal(plan.moveInput({ next_id: 'x y' }).issues.next_id, 'invalid_type')
  })
})

describe('domain/plan-import — linhas da importação', () => {
  it('normaliza e valida cada linha com as regras do elemento', () => {
    const { issues, rows } = importDomain.importRows([
      { group: ' Iniciação ', name: 'Kickoff', status: 'Feito', start_date: '2026-01-26', end_date: '2026-01-27', resources: ['Cliente', 'cliente', 'GP'], estimated_hours: 1.555 },
      { group: 'Iniciação', parent: 'Kickoff', name: 'Pauta', estimated_hours: 2, progress: 50 },
      { group: '', name: '', start_date: '2026-02-10', end_date: '2026-02-01', progress: 120 },
    ])
    assert.deepEqual(rows[0], {
      index: 0,
      group: 'Iniciação',
      parent: null,
      name: 'Kickoff',
      status: 'Feito',
      resources: ['Cliente', 'GP'],
      data: { start_date: '2026-01-26', end_date: '2026-01-27', estimated_hours: 1.56 },
    })
    assert.equal(rows[1].parent, 'Kickoff')
    assert.deepEqual(issues, { 2: { group: 'required', name: 'required', end_date: 'end_before_start', progress: 'too_large' } })
  })

  it('limites: nenhuma linha, linhas demais, recursos demais', () => {
    assert.deepEqual(importDomain.importRows([]).issues, { rows: 'required' })
    assert.deepEqual(importDomain.importRows(Array.from({ length: 501 }, () => ({ group: 'G', name: 'X' }))).issues, { rows: 'too_many' })
    const many = Array.from({ length: 21 }, (_, i) => `R${i}`)
    assert.deepEqual(importDomain.importRows([{ group: 'G', name: 'X', resources: many }]).issues, { 0: { resources: 'too_many' } })
  })
})
