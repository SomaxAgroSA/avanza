import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import i18n from '@/core/i18n'
import type { PermissionCode } from '@/domain/permissions'
import type { PlanReport } from '@/domain/plan-management'
import type { ProjectCharter } from '@/domain/charter'
import type { Project } from '@/domain/projects'
import type { PlanRepository } from '@/domain/repositories'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { routes } from './router'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

const ALL: PermissionCode[] = ['projects.view', 'plan.view', 'tasks.view', 'kanban.view']
const MANAGER = { edit: true, manageMembers: true, archive: true, delete: false, transfer: true, uploadFiles: true }
const READER = { edit: false, manageMembers: false, archive: false, delete: false, transfer: false, uploadFiles: false }

function project(capabilities = MANAGER): Project {
  return {
    id: 'p1',
    key: 'CRM',
    name: 'CRM Corporativo',
    description: 'Implantação do CRM',
    icon: 'folder',
    cover: 'blue',
    status: 'active',
    priority: 'medium',
    urgency: null,
    area: null,
    owner: null,
    startDate: null,
    dueDate: null,
    archivedAt: null,
    createdAt: null,
    updatedAt: null,
    memberCount: 2,
    myRole: 'manager',
    capabilities,
  }
}

const report = (total: number): PlanReport => ({
  today: '2026-02-10',
  summary: { total, done: 1, open: 2, overdue: 1, stuck: 0, canceled: 0, progress: 50 },
  schedule: { onTime: 0, overdue: 1, unscheduled: 1, done: 1 },
  effort: { estimated: 5.5, actual: 3, remaining: 2.5, deviation: { hours: 1, percent: 25 } },
  resources: [],
  groups: [],
  health: {
    level: 'critical',
    factors: [
      { key: 'schedule', level: 'critical', value: 100, count: 1, of: 1 },
      { key: 'progress', level: 'ok', value: 0, planned: 50, actual: 50 },
      { key: 'stuck', level: 'ok', value: 0, count: 0, of: 2 },
      { key: 'effort', level: 'attention', value: 25, hours: 1 },
      { key: 'issues', level: 'ok', value: 0 },
    ],
  },
})

function setup(path: string, { permissions = ALL, capabilities = MANAGER, total = 3 }: { permissions?: PermissionCode[]; capabilities?: Project['capabilities']; total?: number } = {}) {
  const planReport = vi.fn<PlanRepository['report']>(() => Promise.resolve(report(total)))
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(permissions) },
    projects: { get: () => Promise.resolve(project(capabilities)), listMembers: () => Promise.resolve([]) },
    plan: { report: planReport },
  })
  return { ...renderRoutes(routes, { repositories, initialPath: path }), planReport }
}

const projectTabs = () => screen.findByRole('navigation', { name: 'CRM Corporativo' })

const charter: ProjectCharter = {
  projectId: 'p1',
  objective: 'Centralizar o relacionamento com os clientes',
  updatedAt: null,
  updatedBy: null,
  capabilities: { edit: true },
  completeness: { sections: { objectives: true, features: false, scope: false, results: false }, done: 1, total: 4, percent: 25 },
  summary: { featuresTotal: 0, featuresDelivered: 0, tasksTotal: 0, tasksDone: 0, resultsTotal: 0, resultsOnTrack: 0, resultsLate: 0, resultsStale: 0 },
  items: [],
}

describe('Rotas — endereços antigos das visões por projeto (menu → abas do projeto)', () => {
  it.each([
    ['/project-management/p1?item=e1&panel=files', '/projects/p1/management', '?item=e1&panel=files'],
    ['/project-management/p1?view=timeline', '/projects/p1/management', '?view=timeline'],
    ['/planning/p1', '/projects/p1/planning', ''],
    ['/backlog/p1', '/projects/p1/planning', ''],
    ['/timeline/p1', '/projects/p1/timeline', ''],
    ['/kanban/p1', '/projects/p1/kanban', ''],
    ['/project-management', '/projects', ''],
    ['/planning', '/projects', ''],
    ['/timeline', '/projects', ''],
    ['/backlog', '/projects', ''],
  ])('%s → %s%s', async (from, pathname, search) => {
    const { router } = setup(from)
    await waitFor(() => expect(router.state.location.pathname).toBe(pathname))
    expect(router.state.location.search).toBe(search)
  })

  it('/kanban e /kanban/all continuam no Kanban de todos os projetos', async () => {
    const first = setup('/kanban')
    expect(await screen.findByRole('heading', { name: 'Kanban' })).toBeInTheDocument()
    expect(first.router.state.location.pathname).toBe('/kanban')
    first.unmount()
    const { router } = setup('/kanban/all')
    expect(await screen.findByRole('heading', { name: 'Kanban' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/kanban/all')
  })

  it.each([
    ['?tab=plan', '/projects/p1/management', ''],
    ['?tab=timeline', '/projects/p1/management', '?view=timeline'],
    ['?tab=tasks', '/projects/p1/tasks', ''],
    ['?tab=members&x=1', '/projects/p1/members', '?x=1'],
    // Ficha e Informe eram abas com ?tab= na versão anterior
    ['?tab=charter', '/projects/p1/charter', ''],
    ['?tab=report', '/projects/p1/report', ''],
    ['?tab=desconhecida', '/projects/p1', ''],
  ])('/projects/p1%s (aba na query) → %s%s', async (query, pathname, search) => {
    const { router } = setup(`/projects/p1${query}`)
    await waitFor(() => expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(`${pathname}${search}`))
  })

  it('?tab=plan sem plan.view fica na visão geral', async () => {
    const { router } = setup('/projects/p1?tab=plan', { permissions: ['projects.view', 'tasks.view'] })
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(router.state.location.pathname).toBe('/projects/p1')
  })

  it('?tab=report sem tasks.view fica na visão geral (o Informe é montado com as tarefas)', async () => {
    const { router } = setup('/projects/p1?tab=report', { permissions: ['projects.view', 'kanban.view'] })
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(router.state.location.pathname).toBe('/projects/p1')
  })
})

describe('Página do projeto — abas com endereço', () => {
  it('todas as abas na ordem, com a aberta marcada; Tarefas abre na Lista', async () => {
    setup('/projects/p1/planning')
    const nav = await projectTabs()
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Visão geral', 'Ficha', 'Gestão', 'Tarefas', 'Informe', 'Arquivos', 'Membros (2)', 'Histórico', 'Configurações'])
    expect(within(nav).getByRole('link', { name: 'Tarefas' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Tarefas' })).toHaveAttribute('href', '/projects/p1/tasks')
    expect(within(nav).getByRole('link', { name: 'Gestão' })).toHaveAttribute('href', '/projects/p1/management')
    expect(within(nav).getByRole('link', { name: 'Visão geral' })).toHaveAttribute('href', '/projects/p1')
    expect(within(nav).getByRole('link', { name: 'Ficha' })).toHaveAttribute('href', '/projects/p1/charter')
    expect(within(nav).getByRole('link', { name: 'Informe' })).toHaveAttribute('href', '/projects/p1/report')
    // sub-navegação da aba Tarefas
    const views = await screen.findByRole('navigation', { name: 'Visões das tarefas' })
    expect(within(views).getByRole('link', { name: 'Planejamento' })).toHaveAttribute('aria-current', 'page')
  })

  it('cada visão das tarefas abre dentro do projeto (a aba recebe o projeto da página)', async () => {
    const { router } = setup('/projects/p1/tasks', { permissions: [...ALL, 'tasks.create'] })
    const views = await screen.findByRole('navigation', { name: 'Visões das tarefas' })
    expect(within(views).getByRole('link', { name: 'Lista' })).toHaveAttribute('aria-current', 'page')
    const create = await screen.findByRole('button', { name: 'Nova tarefa' })
    expect(router.state.location.pathname).toBe('/projects/p1/tasks')
    // "Colunas" sobe para a linha das visões, ao lado de "Nova tarefa" (a barra de filtros fica numa linha)
    const columns = await screen.findByRole('button', { name: 'Colunas' })
    expect(create.parentElement).toContainElement(columns)
    expect(columns.compareDocumentPosition(screen.getByRole('searchbox')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ['charter', 'Ficha'],
    ['report', 'Informe'],
    ['files', 'Arquivos'],
    ['members', 'Membros (2)'],
    ['history', 'Histórico'],
    ['settings', 'Configurações'],
  ])('aba %s abre com o endereço próprio', async (segment, label) => {
    const { router } = setup(`/projects/p1/${segment}`)
    const nav = await projectTabs()
    expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
    expect(router.state.location.pathname).toBe(`/projects/p1/${segment}`)
  })

  it('abas por permissão: sem plan.view não há Gestão; só com kanban.view, Tarefas abre no Kanban; leitor sem Configurações', async () => {
    const first = setup('/projects/p1', { permissions: ['projects.view', 'tasks.view'], capabilities: READER })
    let nav = await projectTabs()
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Visão geral', 'Ficha', 'Tarefas', 'Informe', 'Arquivos', 'Membros (2)', 'Histórico'])
    first.unmount()

    setup('/projects/p1', { permissions: ['projects.view', 'kanban.view'], capabilities: READER })
    nav = await projectTabs()
    expect(within(nav).getByRole('link', { name: 'Tarefas' })).toHaveAttribute('href', '/projects/p1/kanban')
    // sem tasks.view não há Informe
    expect(within(nav).queryByRole('link', { name: 'Informe' })).not.toBeInTheDocument()
  })

  it('a ação da seção sem sub-navegação fica na linha das abas (Imprimir ficha)', async () => {
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(ALL) },
      projects: { get: () => Promise.resolve(project()), listMembers: () => Promise.resolve([]) },
      charter: { get: () => Promise.resolve(charter) },
    })
    renderRoutes(routes, { repositories, initialPath: '/projects/p1/charter' })
    const nav = await projectTabs()
    const print = await screen.findByRole('button', { name: 'Imprimir ficha' })
    // mesma linha das abas (ao lado da navegação, fora da rolagem dela)
    expect(nav.parentElement).toContainElement(print)
    expect(nav).not.toContainElement(print)
  })

  it('seção que a pessoa não pode abrir volta à visão geral', async () => {
    const first = setup('/projects/p1/management', { permissions: ['projects.view', 'tasks.view'] })
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/projects/p1'))
    first.unmount()
    const second = setup('/projects/p1/kanban', { permissions: ['projects.view', 'tasks.view'] })
    await waitFor(() => expect(second.router.state.location.pathname).toBe('/projects/p1'))
    second.unmount()
    const { router } = setup('/projects/p1/settings', { capabilities: READER })
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1'))
  })

  it('o menu lateral não tem mais Gestão de projetos, Planejamento nem Timeline', async () => {
    setup('/projects/p1')
    const menu = await screen.findByRole('navigation', { name: 'Navegação principal' })
    expect(within(menu).queryByRole('link', { name: 'Gestão de projetos' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('link', { name: 'Planejamento' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('link', { name: 'Timeline' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('link', { name: 'Kanban' })).toHaveAttribute('href', '/kanban')
  })
})

describe('Página do projeto — saúde na visão geral', () => {
  it('com quadro de gestão: nível, cada fator com o valor e o resumo de progresso, cronograma e esforço', async () => {
    const { planReport } = setup('/projects/p1')
    const health = await screen.findByRole('region', { name: 'Saúde do projeto' })
    expect(within(health).getAllByText('Crítico').length).toBeGreaterThan(0)
    expect(within(health).getByText('100% dos abertos com data estão atrasados (1 de 1).')).toBeInTheDocument()
    expect(within(health).getByText('Realizado 25% acima do estimado nos feitos (1 h).')).toBeInTheDocument()
    expect(within(health).getByRole('region', { name: 'Esforço' })).toHaveTextContent('+25%')
    expect(within(health).getByRole('region', { name: 'Cronograma dos pendentes' })).toHaveTextContent('Sem datas1')
    expect(within(health).getByRole('progressbar', { name: 'Progresso' })).toHaveAttribute('aria-valuenow', '50')
    expect(within(health).getByRole('link', { name: /Abrir a gestão do projeto/ })).toHaveAttribute('href', '/projects/p1/management')
    expect(planReport).toHaveBeenCalledWith('p1', new Date().getTimezoneOffset())
  })

  it('quadro sem elementos: sem o bloco; sem plan.view: nem consulta', async () => {
    const first = setup('/projects/p1', { total: 0 })
    expect(await screen.findByText('Implantação do CRM')).toBeInTheDocument()
    await waitFor(() => expect(first.planReport).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Saúde do projeto' })).not.toBeInTheDocument()
    first.unmount()

    const { planReport } = setup('/projects/p1', { permissions: ['projects.view', 'tasks.view'] })
    expect(await screen.findByText('Implantação do CRM')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Saúde do projeto' })).not.toBeInTheDocument()
    expect(planReport).not.toHaveBeenCalled()
  })
})
