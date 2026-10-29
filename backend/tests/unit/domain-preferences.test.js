const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { normalizePreference, isKnownKey } = require('../../src/domain/preferences')

describe('domain/preferences', () => {
  it('só chaves conhecidas: o filtro de projetos de cada tela', () => {
    ;['kanban', 'planning', 'plan', 'timeline', 'tasks', 'reports', 'executive'].forEach((screen) => assert.equal(isKnownKey(`project_filter.${screen}`), true, screen))
    assert.equal(isKnownKey('project_filter.outra'), false)
    assert.equal(isKnownKey('tema'), false)
    assert.deepEqual(normalizePreference('qualquer', {}), { fields: { key: 'invalid_option' } })
  })

  it('filtro de projetos: status na ordem do fluxo, sem repetir; padrões; nulo volta ao padrão', () => {
    assert.deepEqual(normalizePreference('project_filter.kanban', { statuses: ['paused', 'active', 'active'], members_only: true }), { value: { statuses: ['active', 'paused'], members_only: true } })
    assert.deepEqual(normalizePreference('project_filter.kanban', {}), { value: { statuses: [], members_only: false } })
    assert.deepEqual(normalizePreference('project_filter.kanban', null), { value: null })
  })

  it('formato errado volta com o campo e o código da API', () => {
    assert.deepEqual(normalizePreference('project_filter.tasks', { statuses: ['outro'] }).fields, { 'value.statuses': 'invalid_option' })
    assert.deepEqual(normalizePreference('project_filter.tasks', { statuses: 'active' }).fields, { 'value.statuses': 'invalid_type' })
    assert.deepEqual(normalizePreference('project_filter.tasks', { members_only: 'sim' }).fields, { 'value.members_only': 'invalid_type' })
    assert.deepEqual(normalizePreference('project_filter.tasks', { cor: 'azul' }).fields, { 'value.cor': 'unknown_field' })
    assert.deepEqual(normalizePreference('project_filter.tasks', []).fields, { value: 'invalid_type' })
  })
})
