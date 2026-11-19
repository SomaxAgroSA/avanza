import { describe, expect, it } from 'vitest'
import { findNavTrail, showsBreadcrumb, visibleNavItems } from './nav-items'

describe('navegação', () => {
  it('esconde módulos sem permissão e grupos sem filhos visíveis', () => {
    const items = visibleNavItems(['tasks.view', 'tasks.list'])
    const ids = items.map((i) => i.id)
    expect(ids).not.toContain('dashboard')
    expect(ids).toContain('tasks')
    expect(ids).not.toContain('users')
    expect(ids).not.toContain('settings')
  })

  it('menu global só com visões de todos os projetos, nesta ordem; as de um projeto são abas do projeto', () => {
    const all = visibleNavItems(['executive.view', 'projects.view', 'kanban.view', 'tasks.view', 'tasks.list', 'reports.view', 'docs.view', 'users.view', 'plan.view', 'settings.manage'])
    // Tarefas logo depois de Projetos (Lista de tarefas, §42)
    expect(all.map((i) => i.id)).toEqual(['tracking', 'projects', 'tasks', 'kanban', 'docs', 'users', 'settings'])
    expect(all.filter((i) => !i.hidden).map((i) => i.id)).toEqual(['tracking', 'projects', 'tasks', 'kanban', 'docs', 'users', 'settings'])
    expect(all.find((i) => i.id === 'projects')?.children?.map((c) => c.id)).toEqual(['projects-all', 'projects-ongoing', 'projects-finished', 'projects-archived', 'projects-mine'])
    // no menu lateral: Todos, Em andamento, Concluídos e Arquivados; Meus projetos segue como página
    expect(all.find((i) => i.id === 'projects')?.children?.filter((c) => !c.hidden).map((c) => c.id)).toEqual(['projects-all', 'projects-ongoing', 'projects-finished', 'projects-archived'])
    expect(all.find((i) => i.id === 'kanban')?.to).toBe('/kanban')
    const paths = all.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)])
    expect(paths.some((to) => /project-management|planning|timeline/.test(to))).toBe(false)
  })

  it('Tarefas (§42) só com a Lista de tarefas E ver tarefas: tasks.view sozinho não mostra o menu (as tarefas seguem nos projetos)', () => {
    const ids = (permissions: Parameters<typeof visibleNavItems>[0]) => visibleNavItems(permissions).map((i) => i.id)
    expect(ids(['projects.view', 'tasks.view'])).not.toContain('tasks')
    expect(ids(['projects.view', 'tasks.list'])).not.toContain('tasks')
    expect(ids(['projects.view', 'tasks.view', 'tasks.list'])).toContain('tasks')
    expect(visibleNavItems(['tasks.view', 'tasks.list']).find((i) => i.id === 'tasks')?.to).toBe('/tasks')
  })

  it('mostra apenas os filhos permitidos de configurações', () => {
    const settings = visibleNavItems(['permissions.manage']).find((i) => i.id === 'settings')
    // Perfis e Permissões são abas do Controle de acesso
    expect(settings?.children?.map((c) => c.id)).toEqual(['access'])
  })

  it('auditoria aparece só com audit.view', () => {
    const settings = visibleNavItems(['audit.view']).find((i) => i.id === 'settings')
    expect(settings?.children?.map((c) => c.id)).toEqual(['audit'])
  })

  it('resolve a trilha do breadcrumb', () => {
    expect(findNavTrail('/settings/access').map((i) => i.id)).toEqual(['settings', 'access'])
    expect(findNavTrail('/users').map((i) => i.id)).toEqual(['users'])
    expect(findNavTrail('/projects/mine').map((i) => i.id)).toEqual(['projects', 'projects-mine'])
    expect(findNavTrail('/projects').map((i) => i.id)).toEqual(['projects'])
    expect(findNavTrail('/projects/archived').map((i) => i.id)).toEqual(['projects', 'projects-archived'])
    // abas do projeto ficam sob Projetos
    expect(findNavTrail('/projects/p1/kanban').map((i) => i.id)).toEqual(['projects'])
    expect(findNavTrail('/desconhecido')).toEqual([])
  })

  it('as quatro listas de projetos não mostram a trilha (repetiria o título da página); as demais páginas, sim', () => {
    expect(['/projects', '/projects/ongoing', '/projects/finished', '/projects/archived', '/projects/ongoing/'].map((path) => showsBreadcrumb(path))).toEqual([false, false, false, false, false])
    expect(['/projects/mine', '/projects/p1', '/projects/p1/kanban', '/kanban', '/settings/access', '/desconhecido'].map((path) => showsBreadcrumb(path))).toEqual([true, true, true, true, true, true])
  })
})
