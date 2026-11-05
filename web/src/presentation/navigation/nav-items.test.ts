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

  it('mostra apenas os filhos permitidos de configurações', () => {
    const settings = visibleNavItems(['permissions.manage']).find((i) => i.id === 'settings')
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
    expect(findNavTrail('/desconhecido')).toEqual([])
  })
})
