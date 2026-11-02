import { describe, expect, it } from 'vitest'
import { canOpenSection, legacyProjectTab, projectPath, sectionFromPath, tabOfSection, visibleProjectTabs, visibleTaskViews } from './project-routes'

describe('domain/project-routes — endereços da página do projeto', () => {
  it('monta o endereço de cada seção, com os parâmetros da tela', () => {
    expect(projectPath('p1')).toBe('/projects/p1')
    expect(projectPath('p1', 'management', { item: 'e1', panel: 'files' })).toBe('/projects/p1/management?item=e1&panel=files')
    expect(projectPath('p1', 'list')).toBe('/projects/p1/tasks')
    expect(projectPath('p1', 'kanban')).toBe('/projects/p1/kanban')
    expect(projectPath('p1', 'planning')).toBe('/projects/p1/planning')
    expect(projectPath('p1', 'timeline', '?zoom=week')).toBe('/projects/p1/timeline?zoom=week')
    expect(projectPath('p1', 'members', new URLSearchParams())).toBe('/projects/p1/members')
    expect(projectPath('a/b', 'files')).toBe('/projects/a%2Fb/files')
    expect(projectPath('p1', 'charter')).toBe('/projects/p1/charter')
    expect(projectPath('p1', 'report')).toBe('/projects/p1/report')
  })

  it('lê a seção do endereço (as visões de tarefas ficam na aba Tarefas)', () => {
    expect(sectionFromPath('/projects/p1', 'p1')).toBe('overview')
    expect(sectionFromPath('/projects/p1/', 'p1')).toBe('overview')
    expect(sectionFromPath('/projects/p1/management', 'p1')).toBe('management')
    expect(sectionFromPath('/projects/p1/tasks', 'p1')).toBe('list')
    expect(sectionFromPath('/projects/p1/kanban', 'p1')).toBe('kanban')
    expect(sectionFromPath('/projects/p1/charter', 'p1')).toBe('charter')
    expect(sectionFromPath('/projects/p1/report', 'p1')).toBe('report')
    expect(sectionFromPath('/projects/p1/xyz', 'p1')).toBeNull()
    expect(tabOfSection('kanban')).toBe('tasks')
    expect(tabOfSection('planning')).toBe('tasks')
    expect(tabOfSection('timeline')).toBe('tasks')
    expect(tabOfSection('list')).toBe('tasks')
    expect(tabOfSection('management')).toBe('management')
    expect(tabOfSection('charter')).toBe('charter')
    expect(tabOfSection('report')).toBe('report')
  })

  it('endereços antigos com ?tab= levam à seção nova', () => {
    expect(legacyProjectTab('plan')).toEqual({ section: 'management', params: {} })
    expect(legacyProjectTab('timeline')).toEqual({ section: 'management', params: { view: 'timeline' } })
    expect(legacyProjectTab('tasks')).toEqual({ section: 'list', params: {} })
    expect(legacyProjectTab('members')).toEqual({ section: 'members', params: {} })
    expect(legacyProjectTab('overview')).toEqual({ section: 'overview', params: {} })
    // abas Ficha e Informe da versão com abas na query (?tab=charter, ?tab=report)
    expect(legacyProjectTab('charter')).toEqual({ section: 'charter', params: {} })
    expect(legacyProjectTab('report')).toEqual({ section: 'report', params: {} })
    expect(legacyProjectTab('qualquer')).toBeNull()
    expect(legacyProjectTab(null)).toBeNull()
  })

  it('abas visíveis seguem as permissões dos antigos itens do menu', () => {
    expect(visibleProjectTabs([], { manage: false })).toEqual(['overview', 'charter', 'files', 'members', 'history'])
    expect(visibleProjectTabs(['plan.view', 'tasks.view'], { manage: true })).toEqual(['overview', 'charter', 'management', 'tasks', 'report', 'files', 'members', 'history', 'settings'])
    // o Informe é montado com as tarefas: só com tasks.view (o Kanban sozinho não basta)
    expect(visibleProjectTabs(['kanban.view'], { manage: false })).not.toContain('report')
    // só o Kanban também abre a aba Tarefas
    expect(visibleProjectTabs(['kanban.view'], { manage: false })).toContain('tasks')
  })

  it('seção aberta pelo endereço respeita a mesma regra das abas', () => {
    expect(canOpenSection('kanban', ['tasks.view'], { manage: false })).toBe(false)
    expect(canOpenSection('planning', ['tasks.view'], { manage: false })).toBe(true)
    expect(canOpenSection('management', ['tasks.view'], { manage: false })).toBe(false)
    expect(canOpenSection('settings', [], { manage: true })).toBe(true)
    expect(canOpenSection('overview', [], { manage: false })).toBe(true)
    expect(canOpenSection('charter', [], { manage: false })).toBe(true)
    expect(canOpenSection('report', [], { manage: false })).toBe(false)
    expect(canOpenSection('report', ['tasks.view'], { manage: false })).toBe(true)
  })

  it('visões da aba Tarefas: lista, planejamento e cronograma com tasks.view; Kanban com kanban.view', () => {
    expect(visibleTaskViews(['tasks.view', 'kanban.view'])).toEqual(['list', 'kanban', 'planning', 'timeline'])
    expect(visibleTaskViews(['tasks.view'])).toEqual(['list', 'planning', 'timeline'])
    expect(visibleTaskViews(['kanban.view'])).toEqual(['kanban'])
    expect(visibleTaskViews([])).toEqual([])
  })
})
