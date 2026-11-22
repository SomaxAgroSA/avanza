const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const docExport = require('../../src/domain/doc-export')

const page = (id, parentId, position, status) => ({ id, parentId, position, status: status || 'published' })

describe('domain/doc-export — ordem de leitura', () => {
  it('irmãos pela posição e cada página seguida das subpáginas, com a profundidade', () => {
    const order = docExport.readingOrder([
      page('b', null, 2048),
      page('a', null, 1024),
      page('a2', 'a', 2048),
      page('a1', 'a', 1024),
      page('a1x', 'a1', 1024),
    ])
    assert.deepEqual(
      order.map((p) => [p.id, p.parentId, p.depth]),
      [
        ['a', null, 1],
        ['a1', 'a', 2],
        ['a1x', 'a1', 3],
        ['a2', 'a', 2],
        ['b', null, 1],
      ],
    )
  })

  it('só as publicadas; a publicada debaixo de um rascunho sobe para o ancestral publicado', () => {
    const order = docExport.readingOrder([page('home', null, 1024), page('draft', 'home', 1024, 'draft'), page('child', 'draft', 1024), page('loose', 'gone', 1024)])
    assert.deepEqual(
      order.map((p) => [p.id, p.parentId, p.depth]),
      [
        ['home', null, 1],
        ['child', 'home', 2],
        ['loose', null, 1],
      ],
    )
    assert.deepEqual(docExport.readingOrder([]), [])
    assert.deepEqual(docExport.readingOrder(null), [])
  })

  it('conta as palavras do texto publicado', () => {
    assert.equal(docExport.wordCount('  Relevamento das webs   atuais\ndo grupo '), 6)
    assert.equal(docExport.wordCount(''), 0)
    assert.equal(docExport.wordCount(null), 0)
  })
})
