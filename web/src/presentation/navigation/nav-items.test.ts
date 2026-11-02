import { describe, expect, it } from 'vitest'
import { findNavTrail, visibleNavItems } from './nav-items'

describe('navegação', () => {
  it('esconde módulos sem permissão e grupos sem filhos visíveis', () => {
    const items = visibleNavItems(['tasks.view'])
    const ids = items.map((i) => i.id)
    expect(ids).toContain('dashboard')
    expect(ids).toContain('tasks')
    expect(ids).not.toContain('users')
    expect(ids).not.toContain('settings')
  })

  it('menu global só com visões de todos os projetos, nesta ordem; as de um projeto são abas do projeto', () => {
    const all = visibleNavItems(['executive.view', 'projects.view', 'kanban.view', 'tasks.view', 'reports.view', 'docs.view', 'users.view', 'plan.view', 'settings.manage'])
    expect(all.map((i) => i.id)).toEqual(['dashboard', 'executive', 'projects', 'kanban', 'tasks', 'reports', 'docs', 'users', 'settings'])
    expect(all.find((i) => i.id === 'projects')?.children?.map((c) => c.id)).toEqual(['projects-all', 'projects-mine', 'projects-archived'])
    expect(all.find((i) => i.id === 'kanban')?.to).toBe('/kanban')
    const paths = all.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)])
    expect(paths.some((to) => /project-management|planning|timeline/.test(to))).toBe(false)
  })

  it('mostra apenas os filhos permitidos de configurações', () => {
    const settings = visibleNavItems(['permissions.manage']).find((i) => i.id === 'settings')
    expect(settings?.children?.map((c) => c.id)).toEqual(['access', 'roles', 'permissions'])
  })

  it('auditoria aparece só com audit.view', () => {
    const settings = visibleNavItems(['audit.view']).find((i) => i.id === 'settings')
    expect(settings?.children?.map((c) => c.id)).toEqual(['audit'])
  })

  it('resolve a trilha do breadcrumb', () => {
    expect(findNavTrail('/settings/roles').map((i) => i.id)).toEqual(['settings', 'roles'])
    expect(findNavTrail('/users').map((i) => i.id)).toEqual(['users'])
    expect(findNavTrail('/projects/mine').map((i) => i.id)).toEqual(['projects', 'projects-mine'])
    expect(findNavTrail('/projects').map((i) => i.id)).toEqual(['projects'])
    // abas do projeto ficam sob Projetos
    expect(findNavTrail('/projects/p1/kanban').map((i) => i.id)).toEqual(['projects'])
    expect(findNavTrail('/desconhecido')).toEqual([])
  })
})
