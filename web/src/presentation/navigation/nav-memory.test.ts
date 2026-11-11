import { beforeEach, describe, expect, it } from 'vitest'
import { NAV_ITEMS } from './nav-items'
import { lastNavChild, rememberNavChild, stickyNavChild } from './nav-memory'

const projects = NAV_ITEMS.find((item) => item.id === 'projects')!

describe('memória da última lista do menu', () => {
  beforeEach(() => sessionStorage.clear())

  it('guarda a lista aberta com os filtros e devolve para o "Voltar"', () => {
    rememberNavChild('/projects/ongoing', '?status=active')
    expect(lastNavChild('projects')).toBe('/projects/ongoing?status=active')
    rememberNavChild('/projects/finished')
    expect(lastNavChild('projects')).toBe('/projects/finished')
  })

  it('não guarda o que não é uma lista do menu (o próprio projeto)', () => {
    rememberNavChild('/projects/ongoing')
    rememberNavChild('/projects/p1')
    rememberNavChild('/projects/p1/management')
    expect(lastNavChild('projects')).toBe('/projects/ongoing')
  })

  it('dentro de um projeto, o menu segue marcando a lista de onde veio', () => {
    rememberNavChild('/projects/ongoing')
    expect(stickyNavChild('/projects/p1/management', projects)).toBe('/projects/ongoing')
    // na própria lista quem marca é o link; fora do grupo, nada
    expect(stickyNavChild('/projects/ongoing', projects)).toBeNull()
    expect(stickyNavChild('/tracking', projects)).toBeNull()
  })

  it('sem lista lembrada, nada fica marcado', () => {
    expect(stickyNavChild('/projects/p1', projects)).toBeNull()
    expect(lastNavChild('projects')).toBeNull()
  })
})
