import { describe, expect, it } from 'vitest'
import { canOpenSection, itProjectTabs, legacyProjectTab, projectPath, sectionFromPath, tabOfSection, visibleProjectTabs, visibleTaskViews, type ProjectTabAccess } from './project-routes'
import { PROJECT_PROFILE_SECTIONS } from './projects'

const ALL = [...PROJECT_PROFILE_SECTIONS]
const access = (manage: boolean, extra: Partial<ProjectTabAccess> = {}): ProjectTabAccess => ({ manage, sections: ALL, ...extra })

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
    expect(visibleProjectTabs([], access(false))).toEqual(['overview', 'charter', 'files', 'members', 'history'])
    expect(visibleProjectTabs(['plan.view', 'tasks.view'], access(true))).toEqual(['overview', 'charter', 'management', 'tasks', 'report', 'files', 'members', 'history', 'settings'])
    // Documentação, com docs.view (entre Arquivos e Membros)
    expect(visibleProjectTabs(['docs.view'], access(false))).toEqual(['overview', 'charter', 'files', 'docs', 'members', 'history'])
    // o Informe é montado com as tarefas: só com tasks.view (o Kanban sozinho não basta)
    expect(visibleProjectTabs(['kanban.view'], access(false))).not.toContain('report')
    // só o Kanban também abre a aba Tarefas
    expect(visibleProjectTabs(['kanban.view'], access(false))).toContain('tasks')
  })

  it('seção aberta pelo endereço respeita a mesma regra das abas', () => {
    expect(canOpenSection('kanban', ['tasks.view'], access(false))).toBe(false)
    expect(canOpenSection('planning', ['tasks.view'], access(false))).toBe(true)
    expect(canOpenSection('management', ['tasks.view'], access(false))).toBe(false)
    expect(canOpenSection('settings', [], access(true))).toBe(true)
    expect(canOpenSection('overview', [], access(false))).toBe(true)
    expect(canOpenSection('charter', [], access(false))).toBe(true)
    expect(canOpenSection('report', [], access(false))).toBe(false)
    expect(canOpenSection('report', ['tasks.view'], access(false))).toBe(true)
  })

  it('seções do perfil (§35): Ficha, Histórico, Membros e Informe somem e ficam fechadas pelo endereço', () => {
    const none = access(false, { sections: [] })
    expect(visibleProjectTabs(['plan.view', 'tasks.view'], none)).toEqual(['overview', 'management', 'tasks', 'files'])
    expect(visibleProjectTabs(['tasks.view'], access(false, { sections: ['history'] }))).toEqual(['overview', 'tasks', 'files', 'history'])
    expect(canOpenSection('charter', [], none)).toBe(false)
    expect(canOpenSection('history', [], none)).toBe(false)
    expect(canOpenSection('members', [], none)).toBe(false)
    // o Informe precisa da seção e das tarefas
    expect(canOpenSection('report', ['tasks.view'], none)).toBe(false)
    expect(canOpenSection('report', ['tasks.view'], access(false, { sections: ['report'] }))).toBe(true)
    expect(canOpenSection('report', [], access(false, { sections: ['report'] }))).toBe(false)
    // Arquivos e a Visão geral continuam para quem vê o projeto
    expect(canOpenSection('files', [], none)).toBe(true)
    expect(canOpenSection('overview', [], none)).toBe(true)
  })

  it('Responsável TI (§33): só o resumo e, com a seção, a Ficha — nenhuma outra aba abre', () => {
    expect(itProjectTabs([])).toEqual(['overview'])
    expect(itProjectTabs(['charter'])).toEqual(['overview', 'charter'])
    const it = access(false, { it: true, sections: ['charter'] })
    const perms = ['plan.view', 'tasks.view', 'kanban.view']
    expect(visibleProjectTabs(perms, it)).toEqual(['overview', 'charter'])
    expect(canOpenSection('charter', perms, it)).toBe(true)
    ;(['management', 'list', 'kanban', 'planning', 'timeline', 'report', 'files', 'members', 'history', 'settings'] as const).forEach((section) =>
      expect(canOpenSection(section, perms, it)).toBe(false),
    )
    expect(canOpenSection('charter', perms, access(false, { it: true, sections: [] }))).toBe(false)
  })

  it('visões da aba Tarefas: lista, planejamento e cronograma com tasks.view; Kanban com kanban.view', () => {
    expect(visibleTaskViews(['tasks.view', 'kanban.view'])).toEqual(['list', 'kanban', 'planning', 'timeline'])
    expect(visibleTaskViews(['tasks.view'])).toEqual(['list', 'planning', 'timeline'])
    expect(visibleTaskViews(['kanban.view'])).toEqual(['kanban'])
    expect(visibleTaskViews([])).toEqual([])
  })
})
