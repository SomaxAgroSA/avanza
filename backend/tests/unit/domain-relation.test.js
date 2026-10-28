const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const relation = require('../../src/domain/relation')

describe('domain/relation — tipos e perspectiva', () => {
  it('normaliza o tipo pedido (inclusive os inversos) para o que é gravado', () => {
    assert.deepEqual(relation.normalize('blocks', 'a', 'b'), { type: 'blocks', sourceId: 'a', targetId: 'b' })
    assert.deepEqual(relation.normalize('blocked_by', 'a', 'b'), { type: 'blocks', sourceId: 'b', targetId: 'a' })
    assert.deepEqual(relation.normalize('duplicated_by', 'a', 'b'), { type: 'duplicates', sourceId: 'b', targetId: 'a' })
    assert.deepEqual(relation.normalize('dependency_of', 'a', 'b'), { type: 'depends_on', sourceId: 'b', targetId: 'a' })
    assert.equal(relation.normalize('parent', 'a', 'b'), null)
    assert.equal(relation.normalize('relates', 'a', 'a'), null)
  })

  it('cada lado vê o tipo do seu ponto de vista', () => {
    const rel = { type: 'blocks', sourceId: 'a', targetId: 'b' }
    assert.equal(relation.viewType(rel, 'a'), 'blocks')
    assert.equal(relation.viewType(rel, 'b'), 'blocked_by')
    assert.equal(relation.viewType({ type: 'relates', sourceId: 'a', targetId: 'b' }, 'b'), 'relates')
    assert.equal(relation.viewType({ type: 'depends_on', sourceId: 'a', targetId: 'b' }, 'b'), 'dependency_of')
  })

  it('mesma relação já existente (relacionado e duplicado valem nos dois sentidos)', () => {
    const existing = [
      { type: 'relates', sourceId: 'a', targetId: 'b' },
      { type: 'duplicates', sourceId: 'c', targetId: 'd' },
      { type: 'blocks', sourceId: 'e', targetId: 'f' },
    ]
    assert.equal(relation.isDuplicate(existing, { type: 'relates', sourceId: 'b', targetId: 'a' }), true)
    assert.equal(relation.isDuplicate(existing, { type: 'duplicates', sourceId: 'd', targetId: 'c' }), true)
    assert.equal(relation.isDuplicate(existing, { type: 'blocks', sourceId: 'e', targetId: 'f' }), true)
    assert.equal(relation.isDuplicate(existing, { type: 'blocks', sourceId: 'f', targetId: 'e' }), false)
  })
})

describe('domain/relation — ciclos de precedência', () => {
  // a bloqueia b; c depende de b (b antes de c)
  const edges = { a: ['b'], b: ['c'] }
  const next = (ids) => ids.flatMap((id) => edges[id] || [])

  it('bloqueios e dependências formam um só grafo de "vem antes"', () => {
    assert.deepEqual(relation.precedenceOf({ type: 'blocks', sourceId: 'a', targetId: 'b' }), ['a', 'b'])
    assert.deepEqual(relation.precedenceOf({ type: 'depends_on', sourceId: 'c', targetId: 'b' }), ['b', 'c'])
    assert.equal(relation.precedenceOf({ type: 'relates', sourceId: 'a', targetId: 'b' }), null)
  })

  it('detecta ciclo direto e transitivo', () => {
    assert.equal(relation.createsCycle(['c', 'a'], next), true)
    assert.equal(relation.createsCycle(['b', 'a'], next), true)
    assert.equal(relation.createsCycle(['a', 'c'], next), false)
    assert.equal(relation.createsCycle(['x', 'x'], next), true)
  })
})

describe('domain/relation — subtarefas e fork', () => {
  it('pai: mesmo projeto, sem virar ancestral de si mesmo e com profundidade limitada', () => {
    const parents = { t2: 't1', t3: 't2', t4: 't3', t5: 't4' }
    const parentOf = (id) => parents[id] || null
    assert.equal(relation.parentIssue({ taskId: 't9', parent: { id: 't1', projectId: 'p' }, projectId: 'p', parentOf }), null)
    assert.equal(relation.parentIssue({ taskId: 't9', parent: { id: 't1', projectId: 'q' }, projectId: 'p', parentOf }), 'other_project')
    assert.equal(relation.parentIssue({ taskId: 't1', parent: { id: 't3', projectId: 'p' }, projectId: 'p', parentOf }), 'cycle')
    assert.equal(relation.parentIssue({ taskId: 't1', parent: { id: 't1', projectId: 'p' }, projectId: 'p', parentOf }), 'cycle')
    assert.equal(relation.parentIssue({ taskId: 't9', parent: { id: 't5', projectId: 'p' }, projectId: 'p', parentOf }), 'too_deep')
  })

  it('fork: cópia configurável com padrões claros', () => {
    assert.deepEqual(relation.forkCopy(undefined), { description: true, tags: true, custom_values: true, checklist: true, attachments: false, relations: false })
    assert.deepEqual(relation.forkCopy({ attachments: true, tags: false, extra: true }), {
      description: true,
      tags: false,
      custom_values: true,
      checklist: true,
      attachments: true,
      relations: false,
    })
  })
})
