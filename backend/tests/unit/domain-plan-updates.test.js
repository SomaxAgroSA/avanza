/**
 * Quadro do projeto — GP-3: atualizações do elemento (conversa com respostas) e o que cada um pode fazer.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const updates = require('../../src/domain/plan-updates')

const u = (id, extra) => Object.assign({ id, itemId: 'i1', parentId: null, authorId: 'ana', content: id, deletedAt: null, createdAt: new Date(`2026-01-0${id.length}T10:00:00Z`) }, extra)

describe('domain/plan-updates', () => {
  it('capacidades: autor edita; autor ou gestor exclui; responde só na principal; excluída ou projeto arquivado não', () => {
    const open = { comment: true, manager: false }
    assert.deepEqual(updates.capabilities(open, u('a'), 'ana'), { edit: true, delete: true, reply: true })
    assert.deepEqual(updates.capabilities(open, u('a'), 'bia'), { edit: false, delete: false, reply: true })
    assert.deepEqual(updates.capabilities({ comment: true, manager: true }, u('a'), 'bia'), { edit: false, delete: true, reply: true })
    assert.deepEqual(updates.capabilities(open, u('r', { parentId: 'a' }), 'ana'), { edit: true, delete: true, reply: false })
    assert.deepEqual(updates.capabilities(open, u('a', { deletedAt: new Date() }), 'ana'), { edit: false, delete: false, reply: false })
    assert.deepEqual(updates.capabilities({ comment: false, manager: true }, u('a'), 'ana'), { edit: false, delete: false, reply: false })
  })

  it('conversa: principais da mais nova para a mais antiga, respostas em ordem; resposta sem principal fica de fora', () => {
    const list = [u('a'), u('bb'), u('r1', { parentId: 'a', createdAt: new Date('2026-01-05T10:00:00Z') }), u('r2', { parentId: 'a', createdAt: new Date('2026-01-04T10:00:00Z') }), u('x', { parentId: 'nope' })]
    const threads = updates.threads(list)
    assert.deepEqual(threads.map((t) => t.id), ['bb', 'a'])
    assert.deepEqual(threads[1].replies.map((r) => r.id), ['r2', 'r1'])
  })

  it('texto obrigatório (salvo com imagem/arquivo), até 10.000 caracteres; contador ignora as excluídas', () => {
    assert.equal(updates.contentIssue('  '), 'required')
    assert.equal(updates.contentIssue('  ', true), null)
    assert.equal(updates.contentIssue('x'.repeat(10001)), 'too_long')
    assert.equal(updates.contentIssue('ok'), null)
    assert.deepEqual(updates.countByItem([u('a'), u('r', { parentId: 'a' }), u('d', { deletedAt: new Date() }), u('z', { itemId: 'i2' })]), { i1: 2, i2: 1 })
  })

  it('arquivos da atualização: até 10 por vez e 50 MB no total (cada um até 20 MB, conferido à parte)', () => {
    const file = (size) => ({ name: 'a.png', size })
    assert.equal(updates.uploadIssue([]), null)
    assert.equal(updates.uploadIssue([file(1), file(2)]), null)
    assert.equal(updates.uploadIssue(Array.from({ length: 11 }, () => file(1))), 'too_many')
    assert.equal(updates.uploadIssue([file(20 * 1024 * 1024), file(20 * 1024 * 1024), file(11 * 1024 * 1024)]), 'upload_too_large')
  })
})
