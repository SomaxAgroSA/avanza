/**
 * Quadro do projeto — GP-4: Gestão (Diário do projeto e Gestão dos problemas) e linha de base.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const mgmt = require('../../src/domain/plan-management')

describe('domain/plan-management — diário', () => {
  it('registro datado: data (AAAA-MM-DD) e texto obrigatórios, até 5.000 caracteres', () => {
    assert.deepEqual(mgmt.journalInput({ entry_date: '2024-02-01', content: '  Reunião de abertura do projeto. ' }, false), { issues: {}, data: { entry_date: '2024-02-01', content: 'Reunião de abertura do projeto.' } })
    assert.deepEqual(mgmt.journalInput({}, false).issues, { entry_date: 'required', content: 'required' })
    assert.deepEqual(mgmt.journalInput({ entry_date: '01/02/2024', content: 'x'.repeat(5001) }, false).issues, { entry_date: 'invalid_date', content: 'too_long' })
    assert.deepEqual(mgmt.journalInput({ content: 'Só o texto' }, true), { issues: {}, data: { content: 'Só o texto' } })
  })

  it('quem edita o quadro registra; editar e excluir: o autor ou o gestor', () => {
    const entry = { authorId: 'ana' }
    assert.deepEqual(mgmt.journalCapabilities({ edit: true, manage: false }, entry, 'ana'), { edit: true, delete: true })
    assert.deepEqual(mgmt.journalCapabilities({ edit: true, manage: false }, entry, 'bia'), { edit: false, delete: false })
    assert.deepEqual(mgmt.journalCapabilities({ edit: true, manage: true }, entry, 'bia'), { edit: true, delete: true })
    assert.deepEqual(mgmt.journalCapabilities({ edit: false, manage: false }, entry, 'ana'), { edit: false, delete: false })
  })

  it('ordem: do dia mais recente para o mais antigo; no mesmo dia, o último registrado primeiro', () => {
    const list = [
      { id: 'a', entryDate: '2024-02-01', createdAt: new Date('2024-02-01T10:00:00Z') },
      { id: 'b', entryDate: '2024-02-03', createdAt: new Date('2024-02-03T10:00:00Z') },
      { id: 'c', entryDate: '2024-02-01', createdAt: new Date('2024-02-02T10:00:00Z') },
    ]
    assert.deepEqual(mgmt.sortJournal(list).map((e) => e.id), ['b', 'c', 'a'])
  })
})

describe('domain/plan-management — problemas', () => {
  it('problema: data e descrição obrigatórias; situação Em andamento, Pendente (padrão) ou Resolvido; responsável opcional', () => {
    assert.deepEqual(mgmt.issueInput({ opened_on: '2024-02-05', description: ' Cliente sem acesso à VPN ' }, false), { issues: {}, data: { opened_on: '2024-02-05', description: 'Cliente sem acesso à VPN', state: 'pending' } })
    assert.deepEqual(mgmt.issueInput({}, false).issues, { opened_on: 'required', description: 'required' })
    assert.deepEqual(mgmt.issueInput({ state: 'done', owner_id: 'x y' }, true).issues, { state: 'invalid_option', owner_id: 'invalid_type' })
    assert.deepEqual(mgmt.issueInput({ state: 'resolved', owner_id: null }, true), { issues: {}, data: { state: 'resolved', owner_id: null } })
    assert.deepEqual(mgmt.ISSUE_STATES, ['in_progress', 'pending', 'resolved'])
  })

  it('resolvido guarda o dia; voltar para aberto limpa', () => {
    assert.equal(mgmt.resolvedOn({ state: 'pending', resolvedOn: null }, 'resolved', '2024-02-10'), '2024-02-10')
    assert.equal(mgmt.resolvedOn({ state: 'resolved', resolvedOn: '2024-02-10' }, 'resolved', '2024-03-01'), '2024-02-10')
    assert.equal(mgmt.resolvedOn({ state: 'resolved', resolvedOn: '2024-02-10' }, 'in_progress', '2024-03-01'), null)
  })

  it('quem edita o quadro abre e atualiza; excluir: quem abriu ou o gestor', () => {
    const issue = { createdBy: 'ana' }
    assert.deepEqual(mgmt.issueCapabilities({ edit: true, manage: false }, issue, 'ana'), { edit: true, delete: true })
    assert.deepEqual(mgmt.issueCapabilities({ edit: true, manage: false }, issue, 'bia'), { edit: true, delete: false })
    assert.deepEqual(mgmt.issueCapabilities({ edit: true, manage: true }, issue, 'bia'), { edit: true, delete: true })
    assert.deepEqual(mgmt.issueCapabilities({ edit: false, manage: false }, issue, 'ana'), { edit: false, delete: false })
  })
})

describe('domain/plan-management — linha de base', () => {
  it('guarda o cronograma atual dos elementos (uma data só vale para as duas pontas); sem datas fica de fora', () => {
    const items = [
      { id: 'a', startDate: '2024-01-26', endDate: '2024-01-27' },
      { id: 'b', startDate: null, endDate: '2024-01-30' },
      { id: 'c', startDate: null, endDate: null },
      { id: 's', parentId: 'a', startDate: '2024-01-26', endDate: '2024-01-26' },
    ]
    assert.deepEqual(mgmt.baselineSnapshot(items), { a: { start: '2024-01-26', end: '2024-01-27' }, b: { start: '2024-01-30', end: '2024-01-30' } })
  })
})
