import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { PermissionCode } from '@/domain/permissions'
import type { ReportRepository } from '@/domain/repositories'
import type { Report } from '@/domain/reports'
import type { TaskSummary } from '@/domain/tasks'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { ReportsPage } from './ReportsPage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const overdueTask = {
  id: 't1',
  code: 'CRM-1',
  number: 1,
  title: 'Relatório atrasado',
  project: { id: 'p1', key: 'CRM', name: 'CRM' },
  type: null,
  status: { id: 's1', key: 'TODO', name: 'A fazer', color: 'gray', category: 'todo' },
  priority: null,
  sprint: null,
  creator: null,
  assignee: null,
  reporter: null,
  parentTaskId: null,
  startDate: null,
  dueDate: new Date('2026-09-01T00:00:00Z'),
  estimatedHours: null,
  actualHours: null,
  startedAt: null,
  completedAt: null,
  createdAt: null,
  updatedAt: null,
  tags: [],
  checklistProgress: { done: 0, total: 0 },
  commentCount: 0,
  attachmentCount: 0,
  subtaskProgress: { done: 0, total: 0 },
  blocked: false,
  inReport: true, itVisible: false,
    urgency: null,
    area: null,
} satisfies TaskSummary

function report(overrides: Partial<Report> = {}): Report {
  return {
    period: { from: new Date(2026, 8, 1), to: new Date(2026, 8, 30, 23, 59, 59), tzOffset: 180 },
    generatedAt: new Date(2026, 8, 30, 10, 0),
    definitions: { bugTypes: [{ id: 'bug', name: 'Bug' }], criticalPriority: { id: 'crit', name: 'Crítica' } },
    indicators: {
      total: 12,
      open: 7,
      backlog: 3,
      todo: 2,
      inProgress: 2,
      blocked: 1,
      overdue: 1,
      criticalBugs: 2,
      created: 9,
      completed: 4,
      cancelled: 1,
      leadTime: { hours: 72, count: 4 },
      cycleTime: { hours: 30, count: 3 },
      bugResolution: { hours: null, count: 0 },
    },
    series: { bucket: 'day', points: [{ date: '2026-09-29', created: 2, completed: 1 }] },
    breakdown: {
      dimension: 'status',
      rows: [
        { key: 's1', label: { kind: 'status', id: 's1', name: 'A fazer', color: 'gray', category: 'todo' }, total: 5, open: 5, overdue: 1, blocked: 0, created: 3, completed: 0, leadTime: { hours: null, count: 0 } },
        { key: 's2', label: { kind: 'status', id: 's2', name: 'Concluído', color: 'green', category: 'done' }, total: 4, open: 0, overdue: 0, blocked: 0, created: 2, completed: 4, leadTime: { hours: 72, count: 4 } },
      ],
    },
    overdueTasks: [overdueTask],
    ...overrides,
  }
}

function setup(path: string, permissions: PermissionCode[] = ['reports.view', 'projects.view', 'tasks.view']) {
  const get = vi.fn<ReportRepository['get']>(() => Promise.resolve(report()))
  const listTasks = vi.fn<ReportRepository['listTasks']>(() => Promise.resolve({ items: [{ ...overdueTask, metricHours: 72 }], page: 1, perPage: 20, total: 1, totalPages: 1 }))
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(permissions) },
    reports: { get, listTasks },
    projects: { list: () => Promise.resolve({ items: [], page: 1, perPage: 100, total: 0, totalPages: 0 }) },
  })
  const utils = renderRoutes(
    [
      { path: '/reports', element: <ReportsPage /> },
      { path: '/dashboard', element: <DashboardPage /> },
    ],
    { repositories, initialPath: path },
  )
  return { ...utils, get, listTasks }
}

describe('ReportsPage', () => {
  it('mostra o período considerado, a situação atual, o período e as definições', async () => {
    const { get } = setup('/reports')
    expect(await screen.findByText(/Período considerado: 1 de set\. de 2026 a 30 de set\. de 2026/)).toBeInTheDocument()
    // pede os últimos 30 dias no fuso local, agrupado por status
    const query = get.mock.calls[0]?.[0]
    expect(query).toMatchObject({ groupBy: 'status', tzOffset: new Date().getTimezoneOffset() })
    expect(Math.round(((query?.to.getTime() ?? 0) - (query?.from.getTime() ?? 0)) / 86400000)).toBe(30)

    const now = screen.getByRole('region', { name: 'Situação atual' })
    expect(within(now).getByText('Abertas').parentElement?.parentElement).toHaveTextContent('7')
    expect(within(now).getByText('abertos, prioridade Crítica')).toBeInTheDocument()
    const period = screen.getByRole('region', { name: 'No período' })
    expect(within(period).getByText('3 dias')).toBeInTheDocument()
    expect(within(period).getByText('nenhuma concluída no período')).toBeInTheDocument()
    expect(screen.getByText('Relatório atrasado')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Abertas por Status' })).toHaveTextContent('A fazer')
  })

  it('trocar o agrupamento e os filtros refaz a consulta (estado na URL)', async () => {
    const { get, router } = setup('/reports')
    await screen.findByText(/Período considerado/)
    await userEvent.click(screen.getByRole('combobox', { name: 'Agrupar por' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Responsável' }))
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ groupBy: 'assignee' })))
    expect(router.state.location.search).toContain('group=assignee')

    await userEvent.click(screen.getByRole('combobox', { name: 'Responsável' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Minhas tarefas' }))
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ assigneeId: 'me' })))
  })

  it('cada card de indicador abre as tarefas por trás do número, com a mesma consulta do relatório', async () => {
    const { get, listTasks } = setup('/reports')
    const now = await screen.findByRole('region', { name: 'Situação atual' })
    const blocked = within(now).getByRole('button', { name: /Bloqueadas/ })
    expect(blocked).toHaveTextContent('Ver tarefas')
    await userEvent.click(blocked)

    const drawer = await screen.findByRole('dialog', { name: 'Bloqueadas' })
    expect(drawer).toHaveTextContent('Abertas com alguma tarefa que as bloqueia')
    expect(await within(drawer).findByText('Relatório atrasado')).toBeInTheDocument()
    expect(within(drawer).getByText('1 tarefa')).toBeInTheDocument()
    const [query, metric, page] = listTasks.mock.calls[0] ?? []
    expect(metric).toBe('blocked')
    expect(page).toEqual({ page: 1, perPage: 20 })
    expect(query).toEqual(get.mock.calls[0]?.[0])
  })

  it('indicador de tempo mostra a duração de cada tarefa', async () => {
    const { listTasks } = setup('/reports')
    const period = await screen.findByRole('region', { name: 'No período' })
    await userEvent.click(within(period).getByRole('button', { name: /Tempo até concluir/ }))
    const drawer = await screen.findByRole('dialog', { name: 'Tempo até concluir' })
    expect(await within(drawer).findByRole('columnheader', { name: /Duração/ })).toBeInTheDocument()
    expect(within(drawer).getByText('3 dias')).toBeInTheDocument()
    expect(listTasks.mock.calls[0]?.[1]).toBe('lead_time')
  })

  it('período personalizado incompleto avisa e não consulta', async () => {
    const { get } = setup('/reports?period=custom&from=2026-09-10')
    expect(await screen.findByRole('alert')).toHaveTextContent('Escolha as duas datas do período')
    expect(get).not.toHaveBeenCalled()
  })
})

describe('Dashboard', () => {
  it('mostra indicadores reais com o período, só para quem vê relatórios', async () => {
    setup('/dashboard')
    expect(await screen.findByText(/Período considerado/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver relatórios/ })).toHaveAttribute('href', '/reports')
  })

  it('cards do dashboard também abrem o detalhamento', async () => {
    const { listTasks } = setup('/dashboard')
    await userEvent.click(await screen.findByRole('button', { name: /^Concluídas/ }))
    expect(await screen.findByRole('dialog', { name: 'Concluídas' })).toBeInTheDocument()
    expect(listTasks.mock.calls[0]?.[1]).toBe('completed')
  })

  it('sem reports.view, nada de indicadores', async () => {
    const { get } = setup('/dashboard', ['projects.view'])
    expect(await screen.findByText('Acesso rápido')).toBeInTheDocument()
    expect(screen.queryByText(/Período considerado/)).not.toBeInTheDocument()
    expect(get).not.toHaveBeenCalled()
  })
})
