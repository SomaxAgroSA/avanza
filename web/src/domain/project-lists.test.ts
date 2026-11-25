import { describe, expect, it } from 'vitest'
import { PROJECT_LISTS, hiddenListRedirect, projectListOf, projectListsOf, projectsEntryPath } from './project-lists'

describe('Projetos por perfil — listas do menu (25/11)', () => {
  it('do "O que aparece" (§48): sem escolha, as quatro; senão, as visíveis com a de entrada ("Abre em") primeiro', () => {
    expect(projectListsOf({ hidden: [], starts: {} })).toEqual([...PROJECT_LISTS])
    expect(projectListsOf({ hidden: ['projects.lists.all', 'projects.lists.finished'], starts: {} })).toEqual(['ongoing', 'archived'])
    expect(projectListsOf({ hidden: [], starts: { 'projects.lists': 'archived' } })).toEqual(['archived', 'all', 'ongoing', 'finished'])
    expect(projectsEntryPath(projectListsOf({ hidden: [], starts: { 'projects.lists': 'ongoing' } }))).toBe('/projects/ongoing')
  })

  it('o menu leva à primeira lista visível', () => {
    expect(projectsEntryPath([...PROJECT_LISTS])).toBe('/projects')
    expect(projectsEntryPath(['ongoing'])).toBe('/projects/ongoing')
    expect(projectsEntryPath(['finished', 'archived'])).toBe('/projects/finished')
  })

  it('lista de um endereço: só as quatro, caminho exato', () => {
    expect(projectListOf('/projects')).toBe('all')
    expect(projectListOf('/projects/finished/')).toBe('finished')
    expect(projectListOf('/projects/mine')).toBeNull()
    expect(projectListOf('/projects/abc123')).toBeNull()
  })

  it('endereço de lista escondida → a primeira visível; projeto por link direto e Meus projetos seguem abrindo', () => {
    expect(hiddenListRedirect('/projects/finished', ['ongoing'])).toBe('/projects/ongoing')
    expect(hiddenListRedirect('/projects', ['ongoing', 'archived'])).toBe('/projects/ongoing')
    expect(hiddenListRedirect('/projects/ongoing', ['ongoing'])).toBeNull()
    expect(hiddenListRedirect('/projects/abc123', ['ongoing'])).toBeNull()
    expect(hiddenListRedirect('/projects/mine', ['ongoing'])).toBeNull()
  })
})
