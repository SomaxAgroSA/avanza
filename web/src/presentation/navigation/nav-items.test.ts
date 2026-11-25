import { describe, expect, it } from 'vitest'
import { findNavTrail, platformNavItems, showsBreadcrumb, visibleNavItems, withNavEntry, withProjectLists } from './nav-items'

describe('navegação', () => {
  it('Panorama desligado na plataforma (§26.2): some do menu de todos, mesmo com executive.view; ligado, fica', () => {
    const perms: Parameters<typeof visibleNavItems>[0] = ['executive.view', 'reports.view', 'projects.view']
    expect(visibleNavItems(perms, platformNavItems({ panoramaEnabled: false })).map((i) => i.id)).toEqual(['projects'])
    expect(visibleNavItems(perms, platformNavItems({ panoramaEnabled: true })).map((i) => i.id)).toEqual(['tracking', 'projects'])
    expect(visibleNavItems(perms, platformNavItems(undefined)).map((i) => i.id)).toEqual(['tracking', 'projects'])
  })

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
    // Tarefas logo depois de Projetos (Lista de tarefas, §44)
    expect(all.map((i) => i.id)).toEqual(['tracking', 'projects', 'tasks', 'kanban', 'docs', 'users', 'settings'])
    expect(all.filter((i) => !i.hidden).map((i) => i.id)).toEqual(['tracking', 'projects', 'tasks', 'kanban', 'docs', 'users', 'settings'])
    expect(all.find((i) => i.id === 'projects')?.children?.map((c) => c.id)).toEqual(['projects-all', 'projects-ongoing', 'projects-finished', 'projects-archived', 'projects-mine'])
    // no menu lateral: Todos, Em andamento, Concluídos e Arquivados; Meus projetos segue como página
    expect(all.find((i) => i.id === 'projects')?.children?.filter((c) => !c.hidden).map((c) => c.id)).toEqual(['projects-all', 'projects-ongoing', 'projects-finished', 'projects-archived'])
    expect(all.find((i) => i.id === 'kanban')?.to).toBe('/kanban')
    const paths = all.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)])
    expect(paths.some((to) => /project-management|planning|timeline/.test(to))).toBe(false)
  })

  it('Tarefas (§44) só com a Lista de tarefas E ver tarefas: tasks.view sozinho não mostra o menu (as tarefas seguem nos projetos)', () => {
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

describe('Tarefas abre onde o perfil escolheu (ajuste 23/11)', () => {
  it('o item Tarefas ganha a entrada; com a Lista (o próprio endereço), nada muda', () => {
    const items = visibleNavItems(['tasks.view', 'tasks.list', 'projects.view'])
    expect(withNavEntry(items, 'tasks', '/tasks/demands?box=all').find((item) => item.id === 'tasks')).toMatchObject({ to: '/tasks', entry: '/tasks/demands?box=all' })
    expect(withNavEntry(items, 'tasks', '/tasks').find((item) => item.id === 'tasks')?.entry).toBeUndefined()
    expect(withNavEntry(items, 'tasks', '/tasks/demands').find((item) => item.id === 'projects')?.entry).toBeUndefined()
  })
})

describe('Projetos por perfil: listas do menu (ajuste 25/11)', () => {
  const items = visibleNavItems(['projects.view', 'tasks.view', 'tasks.list'])
  const projects = (lists: Parameters<typeof withProjectLists>[1]) => withProjectLists(items, lists).find((item) => item.id === 'projects')!

  it('as quatro: o submenu de sempre', () => {
    expect(projects(['all', 'ongoing', 'finished', 'archived']).children?.filter((c) => !c.hidden).map((c) => c.to)).toEqual([
      '/projects',
      '/projects/ongoing',
      '/projects/finished',
      '/projects/archived',
    ])
  })

  it('só as do perfil, na ordem do menu; Meus projetos segue fora do menu', () => {
    const group = projects(['ongoing', 'archived'])
    expect(group.children?.map((c) => [c.to, !!c.hidden])).toEqual([
      ['/projects/ongoing', false],
      ['/projects/archived', false],
      ['/projects/mine', true],
    ])
    expect(group.entry).toBeUndefined()
  })

  it('com uma só: sem submenu, leva direto a ela e o rótulo diz qual é', () => {
    expect(projects(['ongoing'])).toMatchObject({ to: '/projects', entry: '/projects/ongoing', detailKey: 'nav.projectsOngoing' })
    expect(projects(['ongoing']).children).toBeUndefined()
    const all = projects(['all'])
    expect([all.to, all.entry, all.detailKey, all.children]).toEqual(['/projects', undefined, 'nav.projectsAll', undefined])
    // os outros itens não mudam
    expect(withProjectLists(items, ['ongoing']).find((item) => item.id === 'tasks')).toEqual(items.find((item) => item.id === 'tasks'))
  })
})
