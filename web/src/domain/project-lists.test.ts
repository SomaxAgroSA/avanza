import { describe, expect, it } from 'vitest'
import { PROJECT_LISTS, hiddenListRedirect, projectListOf, projectsEntryPath, toProjectLists, toggleProjectList } from './project-lists'

describe('Projetos por perfil — listas do menu (25/11)', () => {
  it('sem escolha (ou só valores desconhecidos) ficam as quatro; senão, as conhecidas na ordem do menu', () => {
    expect(toProjectLists(undefined)).toEqual([...PROJECT_LISTS])
    expect(toProjectLists([])).toEqual([...PROJECT_LISTS])
    expect(toProjectLists(['mine'])).toEqual([...PROJECT_LISTS])
    expect(toProjectLists(['archived', 'mine', 'ongoing'])).toEqual(['ongoing', 'archived'])
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

  it('marcar e desmarcar: na ordem do menu e sempre ao menos uma', () => {
    expect(toggleProjectList(['ongoing'], 'all', true)).toEqual(['all', 'ongoing'])
    expect(toggleProjectList(['all', 'ongoing'], 'all', false)).toEqual(['ongoing'])
    expect(toggleProjectList(['ongoing'], 'ongoing', false)).toEqual(['ongoing'])
    expect(toggleProjectList(['ongoing'], 'ongoing', true)).toEqual(['ongoing'])
  })
})
