const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { PROJECT_LISTS, projectListsIssue, projectListsFromText, projectListsToText } = require('../../src/domain/permissions')

describe('Projetos por perfil — listas do menu (25/11)', () => {
  it('as quatro listas, na ordem do menu', () => {
    assert.deepEqual(PROJECT_LISTS, ['all', 'ongoing', 'finished', 'archived'])
  })

  it('escolha válida: lista só com as conhecidas e ao menos uma', () => {
    assert.equal(projectListsIssue(['ongoing', 'archived']), null)
    assert.equal(projectListsIssue([]), 'required')
    assert.equal(projectListsIssue(['ongoing', 'mine']), 'invalid_option')
    assert.equal(projectListsIssue('ongoing'), 'invalid_type')
  })

  it('texto gravado → listas visíveis: vazio ou sem nenhuma conhecida = as quatro; ordem do menu', () => {
    assert.deepEqual(projectListsFromText(''), PROJECT_LISTS)
    assert.deepEqual(projectListsFromText(undefined), PROJECT_LISTS)
    assert.deepEqual(projectListsFromText('mine,outra'), PROJECT_LISTS)
    assert.deepEqual(projectListsFromText('archived,ongoing'), ['ongoing', 'archived'])
  })

  it('listas → texto: na ordem do menu, sem repetidas; as quatro = vazio (o padrão)', () => {
    assert.equal(projectListsToText(['archived', 'ongoing', 'ongoing']), 'ongoing,archived')
    assert.equal(projectListsToText(['archived', 'finished', 'ongoing', 'all']), '')
    assert.equal(projectListsToText(['ongoing']), 'ongoing')
  })
})
