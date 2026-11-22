import { describe, expect, it } from 'vitest'
import type { PermissionCode } from '@/domain/permissions'
import { automaticHomePath, homePageOptions, panoramaOffPath, resolveHomePath } from './home-page'

const director: PermissionCode[] = ['projects.view', 'tasks.view', 'kanban.view', 'docs.view']
const manager: PermissionCode[] = [...director, 'executive.view']

describe('página inicial (§38)', () => {
  it('oferece só as telas do menu que a pessoa abre, na ordem do menu, com a seção no rótulo', () => {
    expect(homePageOptions(director).map((o) => o.path)).toEqual(['/projects', '/projects/ongoing', '/projects/finished', '/projects/archived', '/kanban', '/docs'])
    expect(homePageOptions(director).find((o) => o.path === '/projects/ongoing')?.labelKeys).toEqual(['nav.projects', 'nav.projectsOngoing'])
    expect(homePageOptions(director).find((o) => o.path === '/kanban')?.labelKeys).toEqual(['nav.kanban'])
    expect(homePageOptions(manager)[0]).toEqual({ path: '/tracking', labelKeys: ['nav.tracking'] })
    expect(homePageOptions([])).toEqual([])
  })

  it('Tarefas (§44) entra nas opções para quem tem a Lista de tarefas, depois das listas de projetos', () => {
    expect(homePageOptions([...director, 'tasks.list']).map((o) => o.path)).toEqual(['/projects', '/projects/ongoing', '/projects/finished', '/projects/archived', '/tasks', '/kanban', '/docs'])
    expect(homePageOptions([...director, 'tasks.list']).find((o) => o.path === '/tasks')?.labelKeys).toEqual(['nav.tasks'])
    expect(resolveHomePath('/tasks', director)).toBe('/projects')
  })

  it('automática: Panorama para quem vê o painel executivo; senão, a lista de projetos', () => {
    expect(automaticHomePath(manager)).toBe('/tracking')
    expect(automaticHomePath(director)).toBe('/projects')
  })

  it('leva à página escolhida; se a pessoa perdeu o acesso ou a página não existe, à automática', () => {
    expect(resolveHomePath('/projects/ongoing', director)).toBe('/projects/ongoing')
    expect(resolveHomePath('', manager)).toBe('/tracking')
    // sem kanban.view: a escolha antiga não leva a uma tela sem acesso
    expect(resolveHomePath('/kanban', ['projects.view'])).toBe('/projects')
    expect(resolveHomePath('/settings/access', manager)).toBe('/tracking')
  })
})

describe('página inicial com o Panorama desligado (§26.2)', () => {
  const off = { panoramaEnabled: false }
  const withTasks: PermissionCode[] = [...manager, 'tasks.list']

  it('o Panorama sai das opções; ligado, continua', () => {
    expect(homePageOptions(manager, off).map((o) => o.path)).not.toContain('/tracking')
    expect(homePageOptions(manager, { panoramaEnabled: true })[0]?.path).toBe('/tracking')
  })

  it('quem o tinha (escolhido ou pela automática) entra em Tarefas; sem a Lista de tarefas, nos projetos', () => {
    expect(resolveHomePath('/tracking', withTasks, off)).toBe('/tasks')
    expect(resolveHomePath('', withTasks, off)).toBe('/tasks')
    expect(automaticHomePath(withTasks, off)).toBe('/tasks')
    expect(resolveHomePath('/tracking', manager, off)).toBe('/projects')
    expect(panoramaOffPath(withTasks)).toBe('/tasks')
    expect(panoramaOffPath(manager)).toBe('/projects')
    // as outras escolhas e a automática de quem não via o Panorama não mudam
    expect(resolveHomePath('/kanban', withTasks, off)).toBe('/kanban')
    expect(automaticHomePath(director, off)).toBe('/projects')
  })
})
