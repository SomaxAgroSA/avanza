import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { ExecutiveDashboard, ExecutiveProjectOption, ExecutiveQuery, PortfolioRow } from '@/domain/executive'
import type { HealthLevel } from '@/domain/plan-management'
import type { ExecutiveRepository } from '@/domain/repositories'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { TrackingPage } from './TrackingPage'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})
afterEach(() => {
  vi.restoreAllMocks()
})

const pad = (n: number) => String(n).padStart(2, '0')
/** Dia local relativo a hoje (AAAA-MM-DD). */
function rel(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const ana = { id: 'u1', name: 'Angelica Davalos', avatarUrl: null }
const douglas = { id: 'u2', name: 'Douglas Martins', avatarUrl: null }
const comercial = { id: 'a1', name: 'Comercial' }

function row(
  key: string,
  over: { status?: PortfolioRow['project']['status']; level?: HealthLevel; plan?: [number, number]; blocked?: number; overdue?: number; due?: string; owner?: typeof ana; objective?: string; issues?: number } = {},
): PortfolioRow {
  return {
    project: {
      id: key.toLowerCase(),
      key,
      name: `Proyecto ${key}`,
      cover: 'green',
      icon: 'folder',
      status: over.status ?? 'active',
      priority: 'medium',
      area: null,
      startDate: null,
      dueDate: over.due ?? null,
      owner: over.owner ?? ana,
      objective: over.objective ?? null,
      updatedAt: new Date(2026, 10, 13, 15, 25),
    },
    health: {
      level: over.level ?? (over.plan ? 'ok' : 'none'),
      factors: over.plan
        ? [
            { key: 'schedule', level: over.level === 'critical' ? 'critical' : 'ok', value: over.level === 'critical' ? 67 : 0, count: 4, of: 6 },
            { key: 'progress', level: 'ok', value: Math.max(0, over.plan[1] - over.plan[0]), actual: over.plan[0], planned: over.plan[1] },
          ]
        : [],
    },
    progress: { value: 90, source: 'tasks' },
    plan: null,
    tasks: { total: 10, open: 5, inProgress: 1, blocked: over.blocked ?? 0, overdue: over.overdue ?? 0, done: 5 },
    nextMilestone: null,
    openIssues: over.issues ?? 0,
  }
}

const option = (r: PortfolioRow, area: { id: string; name: string } | null = null): ExecutiveProjectOption => ({
  id: r.project.id,
  key: r.project.key,
  name: r.project.name,
  cover: 'green',
  icon: 'folder',
  status: r.project.status,
  archived: false,
  member: true,
  area,
  owner: r.project.owner,
})

const APP = row('APP', { level: 'critical', plan: [0, 73], due: rel(-12), owner: douglas, objective: 'Aplicación de ofertas directas a los clientes.', issues: 2 })
const BLK = row('BLK', { level: 'ok', plan: [40, 45], blocked: 4, overdue: 3 })
const OK1 = row('OK1', { level: 'ok', plan: [50, 50] })
const PAU = row('PAU', { status: 'paused', blocked: 5, overdue: 2 })
const NOP = row('NOP', { status: 'planning' })

function dashboard(portfolio: PortfolioRow[] = [APP, BLK, OK1, PAU, NOP]): ExecutiveDashboard {
  return {
    generatedAt: new Date(2026, 10, 18, 7, 40),
    period: { from: null, to: new Date() },
    projects: [option(APP, comercial), option(BLK), option(OK1), option(PAU), option(NOP)],
    summary: {
      activeProjects: portfolio.length,
      health: { ok: 0, attention: 0, critical: 0, none: 0 },
      progress: null,
      deliveries: { tasks: 12, planItems: 0, milestones: 1 },
      overdue: { tasks: 0, planItems: 0 },
      openIssues: 0,
      criticalBugs: 0,
    },
    portfolio,
    plan: {
      items: { total: 0, done: 0, open: 0, overdue: 0, stuck: 0, canceled: 0 },
      statusDistribution: [],
      schedule: { onTime: 0, overdue: 0, unscheduled: 0, done: 0 },
      effort: { estimated: null, actual: null, remaining: null },
      issues: [],
      openIssuesTotal: 0,
      upcomingMilestones: [{ id: 'm2', name: 'Cierre DRE', dueDate: rel(2), project: { id: 'blk', key: 'BLK', name: 'Proyecto BLK' } }],
      overdueMilestones: [{ id: 'm1', name: 'Prototipo de pantallas', dueDate: rel(-4), project: { id: 'app', key: 'APP', name: 'Proyecto APP' } }],
      overdueMilestonesTotal: 1,
    },
    kanban: {
      funnel: { backlog: 0, todo: 0, in_progress: 0, done: 0, cancelled: 0 },
      created: 0,
      completed: 12,
      leadTime: { hours: null, count: 0 },
      cycleTime: { hours: null, count: 0 },
      overdue: 0,
      blocked: 0,
      criticalBugs: 0,
      overdueTasks: [],
    },
    timeline: {
      bucket: 'week',
      points: [
        { start: rel(-14), tasksCreated: 0, tasksCompleted: 5, planItemsCompleted: 0, tasksInProgress: 0, tasksOverdue: 0 },
        { start: rel(-7), tasksCreated: 0, tasksCompleted: 7, planItemsCompleted: 0, tasksInProgress: 0, tasksOverdue: 0 },
      ],
    },
    achievements: [],
  }
}

function setup(get: (query: ExecutiveQuery) => Promise<ExecutiveDashboard> = () => Promise.resolve(dashboard())) {
  const spy = vi.fn<ExecutiveRepository['get']>(get)
  const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(['executive.view']) }, executive: { get: spy } })
  renderRoutes([{ path: '/tracking', element: <TrackingPage /> }], { repositories, initialPath: '/tracking' })
  return { get: spy }
}

describe('Panorama ejecutivo', () => {
  it('pide los proyectos supervisados y, solo para las entregas, los concluidos; cabecera con el corte', async () => {
    const { get } = setup()
    expect(await screen.findByRole('heading', { level: 1, name: 'Panorama ejecutivo' })).toBeInTheDocument()
    expect(get.mock.calls[0]?.[0]).toMatchObject({ statuses: ['planning', 'active', 'paused'], deliveryStatuses: ['completed'], areaIds: [], ownerIds: [], projectIds: [] })
    expect(screen.getByText(/Corte de referencia: 18\/11\/2026/)).toBeInTheDocument()
  })

  it('síntesis generada con los mismos números de los indicadores', async () => {
    setup()
    const synthesis = await screen.findByRole('region', { name: '1 proyecto en riesgo y 4 tareas bloqueadas.' })
    expect(within(synthesis).getByText(/2 de 5 proyectos en orden · 3 tareas vencidas · 12 tareas entregadas en el período/)).toBeInTheDocument()
    expect(within(synthesis).getByText('Prioridad: recuperar los proyectos en riesgo.')).toBeInTheDocument()
  })

  it('indicadores: supervisados por estado, avance solo con plan, riesgo, bloqueos y vencidas sin los pausados', async () => {
    setup()
    const kpis = await screen.findByRole('region', { name: 'Indicadores' })
    const supervised = within(kpis).getByRole('button', { name: /Proyectos supervisados/ })
    expect(supervised).toHaveTextContent('5')
    expect(supervised).toHaveTextContent('Planificación 1 · En curso 3 · Pausado 1')
    // (0 + 40 + 50) / 3 = 30 real; (73 + 45 + 50) / 3 = 56 planificado
    expect(within(kpis).getByText('30 %')).toBeInTheDocument()
    expect(within(kpis).getByText(/Planificado 56 %/)).toBeInTheDocument()
    expect(within(kpis).getByText('−26 pp')).toBeInTheDocument()
    expect(within(kpis).getByText(/Promedio de los 3 de 5 proyectos con plan/)).toBeInTheDocument()
    expect(within(kpis).getByRole('button', { name: /Proyectos en riesgo\s*1/ })).toBeInTheDocument()
    expect(within(kpis).getByRole('button', { name: /Bloqueos activos\s*1\s*proyectos · 4 tareas bloqueadas/ })).toBeInTheDocument()
    expect(within(kpis).getByRole('button', { name: /Tareas vencidas\s*3\s*1 proyecto con la fecha objetivo vencida/ })).toBeInTheDocument()
  })

  it('tabla priorizada; la rosca filtra por cualquier situación y se puede quitar el filtro', async () => {
    setup()
    const table = await screen.findByRole('region', { name: 'Proyectos que requieren atención' })
    const names = () => within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]?.textContent ?? '')
    expect(names()).toHaveLength(2)
    expect(names()[0]).toMatch(/Proyecto APP.*Fecha objetivo vencida hace 12 días/)
    expect(names()[1]).toMatch(/Proyecto BLK.*4 tareas bloqueadas · 3 tareas vencidas/)

    await userEvent.click(screen.getByRole('button', { name: 'Filtrar la tabla: Sin plan (2)' }))
    expect(names().map((n) => n.slice(0, 12))).toEqual(['NOPProyecto ', 'PAUProyecto '])
    expect(within(table).getByText(/Solo los proyectos sin plan/)).toBeInTheDocument()
    await userEvent.click(within(table).getByRole('button', { name: 'Quitar filtro' }))
    expect(names()).toHaveLength(2)

    await userEvent.click(within(screen.getByRole('region', { name: 'Indicadores' })).getByRole('button', { name: /Bloqueos activos/ }))
    expect(names()).toHaveLength(1)
    expect(names()[0]).toMatch(/Proyecto BLK/)
  })

  it('resumen del proyecto: objetivo, avance real y planificado, pendientes, responsable y última actualización', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Ver resumen de Proyecto APP' }))
    const drawer = await screen.findByRole('dialog', { name: 'Proyecto APP' })
    expect(within(drawer).getByText('Aplicación de ofertas directas a los clientes.')).toBeInTheDocument()
    expect(within(drawer).getByText('0 % real · 73 % planificado')).toBeInTheDocument()
    expect(within(drawer).getByText('0 tareas bloqueadas · 0 tareas vencidas · 2 problemas abiertos')).toBeInTheDocument()
    expect(within(drawer).getByText('Douglas Martins')).toBeInTheDocument()
    // el próximo hito empieza por el pendiente ya vencido
    expect(within(drawer).getByText(/Prototipo de pantallas · .* · Vencido hace 4 días/)).toBeInTheDocument()
    expect(within(drawer).getByText(/13 nov 2026/)).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Abrir proyecto' })).toBeInTheDocument()
  })

  it('hitos: vencidos en rojo con los días y los próximos con el responsable del proyecto', async () => {
    setup()
    const list = await screen.findByRole('region', { name: 'Próximos hitos relevantes' })
    const items = within(list).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent(/Prototipo de pantallas.*Proyecto APP · Resp\. del proyecto: Douglas Martins.*Vencido hace 4 días/)
    expect(items[1]).toHaveTextContent(/Cierre DRE.*En 2 días/)
  })

  it('los filtros van al servidor y valen para todo; sin proyectos en el filtro no queda cargando', async () => {
    const { get } = setup((query) => Promise.resolve(query.areaIds?.length ? { ...dashboard([]), plan: null } : dashboard()))
    await screen.findByRole('region', { name: 'Indicadores' })
    await userEvent.click(screen.getByRole('combobox', { name: 'Área' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Comercial' }))
    await waitFor(() => expect(get.mock.calls.at(-1)?.[0].areaIds).toEqual(['a1']))
    expect(await screen.findByText('Ningún proyecto con estos filtros')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Indicadores' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(await screen.findByRole('region', { name: 'Indicadores' })).toBeInTheDocument()
  })

  it('período personalizado: manda las fechas elegidas', async () => {
    const { get } = setup()
    await screen.findByRole('region', { name: 'Indicadores' })
    await userEvent.click(screen.getByRole('radio', { name: 'Personalizado' }))
    expect(screen.getByLabelText('Desde')).toBeInTheDocument()
    expect(screen.getByLabelText('Hasta')).toBeInTheDocument()
    const last = get.mock.calls.at(-1)?.[0]
    expect(last?.from).toBe(rel(-89))
    expect(last?.to).toBe(rel(0))
  })
})
