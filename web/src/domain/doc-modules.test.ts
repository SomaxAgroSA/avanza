import { describe, expect, it } from 'vitest'
import { countSpacesByModule, groupSpacesByModule, resolveModuleFilter, type DocModule, type DocSpace } from './docs'

const mod = (id: string, name: string, position: number): DocModule => ({ id, name, color: 'blue', position, spaceCount: 0 })
const space = (key: string, moduleId: string | null): DocSpace => ({
  id: key.toLowerCase(),
  key,
  name: key,
  description: '',
  icon: 'book',
  color: 'blue',
  visibility: 'company',
  project: null,
  module: moduleId ? { id: moduleId, name: moduleId, color: 'blue' } : null,
  homePageId: null,
  pageCount: 0,
  createdAt: null,
  updatedAt: null,
  capabilities: { edit: false, manage: false },
})

const MODULES = [mod('fin', 'Finanças', 1), mod('mkt', 'Marketing', 0), mod('ti', 'TI', 2)]
const SPACES = [space('DRE', 'fin'), space('PWGS', 'mkt'), space('RENT', 'fin'), space('RCJ', null), space('VELHO', 'apagado')]

describe('domain/docs — módulos da documentação', () => {
  it('resolveModuleFilter: Todos, Sem módulo ou um módulo que existe (o resto volta para Todos)', () => {
    expect(resolveModuleFilter(null, MODULES)).toBe('all')
    expect(resolveModuleFilter('none', MODULES)).toBe('none')
    expect(resolveModuleFilter('fin', MODULES)).toBe('fin')
    expect(resolveModuleFilter('apagado', MODULES)).toBe('all')
  })

  it('Todos: grupos na ordem dos módulos, sem os vazios, e "Sem módulo" no fim (inclui módulo que não existe mais)', () => {
    const groups = groupSpacesByModule(SPACES, MODULES, 'all')
    expect(groups.map((g) => [g.module?.id ?? null, g.spaces.map((s) => s.key)])).toEqual([
      ['mkt', ['PWGS']],
      ['fin', ['DRE', 'RENT']],
      [null, ['RCJ', 'VELHO']],
    ])
  })

  it('um módulo escolhido mostra só o grupo dele, mesmo vazio; "Sem módulo" só os sem módulo', () => {
    expect(groupSpacesByModule(SPACES, MODULES, 'ti')).toEqual([{ module: MODULES[2], spaces: [] }])
    expect(groupSpacesByModule(SPACES, MODULES, 'none').map((g) => g.spaces.map((s) => s.key))).toEqual([['RCJ', 'VELHO']])
  })

  it('contagem por módulo e sem módulo', () => {
    expect(countSpacesByModule(SPACES, MODULES)).toEqual({ all: 5, none: 2, byModule: { fin: 2, mkt: 1, ti: 0 } })
  })
})
