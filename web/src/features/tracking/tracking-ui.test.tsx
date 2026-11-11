import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { ExecutiveDashboard, PortfolioRow } from '@/domain/executive'
import type { ExecutiveRepository } from '@/domain/repositories'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { TrackingPage } from './TrackingPage'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})
afterEach(() => {
  vi.restoreAllMocks()
})

function row(key: string, over: Partial<PortfolioRow['project']> & { blocked?: number } = {}): PortfolioRow {
  const { blocked, ...project } = over
  return {
    project: {
      id: key.toLowerCase(),
      key,
      name: `Proyecto ${key}`,
      cover: 'green',
      icon: 'folder',
      status: 'active',
      priority: 'medium',
      area: null,
      startDate: null,
      dueDate: null,
      owner: { id: 'u1', name: 'Angelica Davalos', avatarUrl: null },
      ...project,
    },
    health: { level: 'ok', factors: [] },
    progress: { value: 40, source: 'tasks' },
    plan: null,
    tasks: { total: 3, open: 2, inProgress: 1, blocked: blocked ?? 0, overdue: 0, done: 1 },
    nextMilestone: null,
    openIssues: 0,
  }
}

function dashboard(): ExecutiveDashboard {
  return {
    generatedAt: new Date(2026, 10, 11, 9, 42),
    period: { from: new Date(2026, 7, 14), to: new Date(2026, 10, 11) },
    projects: [],
    summary: {
      activeProjects: 3,
      health: { ok: 3, attention: 0, critical: 0, none: 0 },
      progress: 40,
      deliveries: { tasks: 10, planItems: 0, milestones: 2 },
      overdue: { tasks: 0, planItems: 0 },
      openIssues: 0,
      criticalBugs: 0,
    },
    portfolio: [
      row('BCI', { dueDate: '2026-11-05', area: { id: 'a1', name: 'Desarrollo e Innovación' } }),
      row('ADP', { priority: 'high', area: { id: 'a2', name: 'Directoria' } }),
      row('INN', { status: 'paused', blocked: 1 }),
    ],
    plan: null,
    kanban: {
      funnel: { backlog: 0, todo: 0, in_progress: 0, done: 0, cancelled: 0 },
      created: 12,
      completed: 10,
      leadTime: { hours: 40, count: 10 },
      cycleTime: { hours: 25.5, count: 10 },
      overdue: 0,
      blocked: 1,
      criticalBugs: 0,
      overdueTasks: [],
    },
    timeline: {
      bucket: 'week',
      points: [
        { start: '2026-10-27', tasksCreated: 6, tasksCompleted: 4, planItemsCompleted: 0, tasksInProgress: 3, tasksOverdue: 1 },
        { start: '2026-11-03', tasksCreated: 6, tasksCompleted: 6, planItemsCompleted: 0, tasksInProgress: 2, tasksOverdue: 1 },
      ],
    },
    achievements: [],
  }
}

function setup() {
  const get = vi.fn<ExecutiveRepository['get']>(() => Promise.resolve(dashboard()))
  const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(['executive.view']) }, executive: { get } })
  renderRoutes([{ path: '/tracking', element: <TrackingPage /> }], { repositories, initialPath: '/tracking' })
  return { get }
}

describe('Panorama', () => {
  it('pide solo los proyectos en marcha y muestra la franja de hoy y del período', async () => {
    const { get } = setup()
    expect(await screen.findByRole('heading', { name: 'Panorama' })).toBeInTheDocument()
    expect(get.mock.calls[0]?.[0].statuses).toEqual(['planning', 'active', 'paused'])
    const hero = screen.getByRole('region', { name: 'Resumen' })
    expect(within(hero).getByRole('button', { name: /Atrasados\s*1/ })).toBeInTheDocument()
    expect(within(hero).getByRole('button', { name: /Bloqueados\s*1/ })).toBeInTheDocument()
    expect(within(hero).getByText('40 %')).toBeInTheDocument()
  })

  it('requiere atención trae solo proyectos con motivo y la cartera se agrupa con un clic', async () => {
    setup()
    const attention = await screen.findByRole('region', { name: 'Requiere atención' })
    expect(within(attention).getByText('Pausado')).toBeInTheDocument()
    expect(within(attention).getByText(/1 tarea bloqueada/)).toBeInTheDocument()
    expect(within(attention).queryByText('Proyecto ADP')).not.toBeInTheDocument()

    expect(screen.getByRole('columnheader', { name: /Alta/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Departamento' }))
    expect(screen.getByRole('columnheader', { name: /Directoria/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Sin departamento/ })).toBeInTheDocument()
  })

  it('la pestaña Equipo y tareas muestra los dos gráficos', async () => {
    setup()
    await userEvent.click(await screen.findByRole('tab', { name: /Equipo y tareas/ }))
    expect(await screen.findByRole('heading', { name: 'Creadas y terminadas por semana' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Terminadas, en proceso y vencidas por semana' })).toBeInTheDocument()
    expect(screen.getByText('25,5 h')).toBeInTheDocument()
  })
})
