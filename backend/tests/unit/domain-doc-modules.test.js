const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const modules = require('../../src/domain/doc-modules')

describe('domain/doc-modules', () => {
  it('nameKey: sem acento, sem diferença de maiúsculas e de espaços repetidos', () => {
    assert.equal(modules.nameKey('  Marketing  '), 'marketing')
    assert.equal(modules.nameKey('Operações'), modules.nameKey('operacoes'))
    assert.equal(modules.nameKey('TI  e   sistemas'), 'ti e sistemas')
    assert.equal(modules.nameKey(null), '')
  })

  it('sortModules: pela posição e, no empate, pelo nome', () => {
    const list = [
      { id: 'b', name: 'Finanças', position: 1 },
      { id: 'c', name: 'Comercial', position: 1 },
      { id: 'a', name: 'Marketing', position: 0 },
    ]
    assert.deepEqual(modules.sortModules(list).map((m) => m.id), ['a', 'c', 'b'])
    assert.deepEqual(list.map((m) => m.id), ['b', 'c', 'a'], 'não altera a lista recebida')
  })

  it('reorder: leva o módulo para o índice pedido (limitado ao fim da lista)', () => {
    const list = [
      { id: 'a', name: 'A', position: 0 },
      { id: 'b', name: 'B', position: 1 },
      { id: 'c', name: 'C', position: 2 },
    ]
    assert.deepEqual(modules.reorder(list, 'c', 0), ['c', 'a', 'b'])
    assert.deepEqual(modules.reorder(list, 'a', 1), ['b', 'a', 'c'])
    assert.deepEqual(modules.reorder(list, 'a', 99), ['b', 'c', 'a'])
    assert.deepEqual(modules.reorder(list, 'x', 0), ['a', 'b', 'c'])
  })

  it('positionIssue: inteiro de 0 a 999', () => {
    assert.equal(modules.positionIssue(0), null)
    assert.equal(modules.positionIssue(3), null)
    assert.equal(modules.positionIssue(-1), 'invalid_type')
    assert.equal(modules.positionIssue(1.5), 'invalid_type')
    assert.equal(modules.positionIssue('2'), 'invalid_type')
    assert.equal(modules.positionIssue(1000), 'invalid_type')
  })
})
