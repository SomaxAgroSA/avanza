const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const company = require('../../src/domain/company')

describe('domain/company (§46)', () => {
  it('nome: obrigatório, até 120, espaços repetidos viram um só; a chave ignora maiúsculas', () => {
    assert.equal(company.nameIssue(''), 'required')
    assert.equal(company.nameIssue('   '), 'required')
    assert.equal(company.nameIssue(12), 'invalid_type')
    assert.equal(company.nameIssue('x'.repeat(121)), 'too_long')
    assert.equal(company.nameIssue('Somax Paraguay'), null)
    assert.equal(company.normalizeName('  Somax   Paraguay '), 'Somax Paraguay')
    assert.equal(company.nameKey(' SOMAX  paraguay'), company.nameKey('Somax Paraguay'))
  })

  it('sigla: opcional, maiúsculas, até 10 caracteres, letras, dígitos e . & -', () => {
    assert.equal(company.shortCodeIssue(undefined), null)
    assert.equal(company.shortCodeIssue(null), null)
    assert.equal(company.shortCodeIssue(''), null)
    assert.equal(company.shortCodeIssue('smx'), null)
    assert.equal(company.normalizeShortCode(' smx-py '), 'SMX-PY')
    assert.equal(company.shortCodeIssue('A&B.1'), null)
    assert.equal(company.shortCodeIssue('ABCDEFGHIJK'), 'too_long')
    assert.equal(company.shortCodeIssue('S M'), 'invalid_format')
    assert.equal(company.shortCodeIssue('-SM'), 'invalid_format')
    assert.equal(company.shortCodeIssue(5), 'invalid_type')
  })

  it('obrigatória só quando existe alguma empresa ativa', () => {
    assert.equal(company.companyRequired([]), false)
    assert.equal(company.companyRequired([{ active: false }]), false)
    assert.equal(company.companyRequired([{ active: false }, { active: true }]), true)
  })

  it('a tarefa de projeto herda a empresa do projeto; a demanda interna usa a sua', () => {
    const project = { id: 'p1', kind: '', companyId: 'c1' }
    const inbox = { id: 'dem', kind: 'demands', companyId: null }
    assert.equal(company.effectiveCompanyId({ companyId: 'c9' }, project), 'c1')
    assert.equal(company.effectiveCompanyId({ companyId: null }, { id: 'p2', kind: '' }), null)
    assert.equal(company.effectiveCompanyId({ companyId: 'c2' }, inbox), 'c2')
    assert.equal(company.effectiveCompanyId({}, inbox), null)
    assert.equal(company.effectiveCompanyId(null, project), null)
  })
})
