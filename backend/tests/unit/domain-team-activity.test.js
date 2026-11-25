const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { actionOf, stateOf, excerptOf, EXCERPT } = require('../../src/domain/team-activity')

describe('domain/team-activity — ação de uma linha do histórico', () => {
  it('mudança de status, com de/para', () => {
    assert.deepEqual(actionOf({ action: 'task.updated', statusChanged: true, fromStatus: 'Desarrollo', toStatus: 'Prueba' }), {
      type: 'status_changed',
      from: 'Desarrollo',
      to: 'Prueba',
    })
  })

  it('outra edição da tarefa, relações e exclusões viram "edited"', () => {
    for (const action of ['task.updated', 'task.linked', 'task.unlinked', 'task.doc_linked', 'comment.deleted', 'attachment.deleted', 'task.forked']) {
      assert.deepEqual(actionOf({ action, statusChanged: false }), { type: 'edited' }, action)
    }
  })

  it('comentário com o começo do texto, sem quebras', () => {
    assert.deepEqual(actionOf({ action: 'comment.added', comment: 'Vistas  publicadas\nen el espacio de pruebas' }), { type: 'commented', excerpt: 'Vistas publicadas en el espacio de pruebas' })
    assert.equal(actionOf({ action: 'comment.edited', comment: 'x' }).type, 'commented')
    const long = excerptOf('a'.repeat(200))
    assert.equal(long.length, EXCERPT)
    assert.ok(long.endsWith('…'))
  })

  it('anexos contam os arquivos; criação e passos do fluxo do responsável', () => {
    assert.deepEqual(actionOf({ action: 'attachment.added', attachments: 'a.pdf, b.png' }), { type: 'attached', count: 2 })
    assert.deepEqual(actionOf({ action: 'attachment.added', attachments: '' }), { type: 'attached', count: 1 })
    assert.deepEqual(actionOf({ action: 'task.created' }), { type: 'created' })
    assert.deepEqual(actionOf({ action: 'task.demand_concluded' }), { type: 'step', step: 'concluded' })
    assert.deepEqual(actionOf({ action: 'task.demand_other' }), { type: 'edited' })
  })
})

describe('domain/team-activity — estado pela ação da própria pessoa', () => {
  it('working = em andamento e agiu; active = agiu; idle = não agiu', () => {
    assert.equal(stateOf({ inProgress: 2, acted: 1 }), 'working')
    assert.equal(stateOf({ inProgress: 0, acted: 3 }), 'active')
    assert.equal(stateOf({ inProgress: 2, acted: 0 }), 'idle')
    assert.equal(stateOf({ inProgress: 0, acted: 0 }), 'idle')
  })
})
