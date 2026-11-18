import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { OngoingView } from '@/domain/entities'
import { PERMISSION_CODES } from '@/domain/permissions'
import type { Project, ProjectStatus, ProjectPriority, TeamActivity } from '@/domain/projects'
import type { ProjectListQuery, ProjectPage } from '@/domain/repositories'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { ProjectsPage } from '../ProjectsPage'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})
beforeEach(() => {
  window.localStorage.clear()
})

const ana = { id: 'u1', name: 'Angelica Davalos', email: 'a@x.com', avatarUrl: null }
const douglas = { id: 'u2', name: 'Douglas Martins', email: 'd@x.com', avatarUrl: null }
const day = (value: string) => new Date(`${value}T00:00:00.000Z`)
const area = (id: string, name: string) => ({ id, key: id.toUpperCase(), name, color: 'blue' as const })
const TI = area('a-ti', 'TI')
const COM = area('a-com', 'Comercial')

function project(id: string, name: string, status: ProjectStatus, priority: ProjectPriority, extra: Partial<Project> = {}): Project {
  return {
    id, name, key: id.toUpperCase(), description: '', platformUrl: '', icon: 'folder', cover: 'blue', status, priority, urgency: null, area: null, parent: null,
    childCount: 0, owner: ana, lead: ana, devLead: null, startDate: null, dueDate: null, archivedAt: null, createdAt: null, updatedAt: null, memberCount: 2, myRole: 'owner',
    capabilities: { edit: true, manageMembers: true, archive: true, delete: false, transfer: true, uploadFiles: true, sections: [] },
    ...extra,
  }
}

const ALFA = project('p1', 'Alfa', 'planning', 'high', { area: TI, startDate: day('2026-09-01'), dueDate: day('2027-01-31') })
const BETA = project('p2', 'Beta', 'active', 'critical', { area: COM, startDate: day('2026-10-01'), dueDate: day('2026-12-15') })
const GAMA = project('p3', 'Gama', 'active', 'medium') // sin departamento, sin fechas
const DELTA = project('p4', 'Delta', 'paused', 'low', { area: TI, startDate: day('2026-08-01'), dueDate: day('2026-10-31') })
const EPSILON = project('p5', 'Épsilon', 'completed', 'medium', { area: TI })
const ALL = [ALFA, BETA, GAMA, DELTA, EPSILON]

const ref = (p: Project) => ({ id: p.id, key: p.key, name: p.name, icon: p.icon, cover: p.cover })
const status = { id: 's1', name: 'En curso', color: 'blue', category: 'in_progress' }
const row = (p: Project, state: 'working' | 'active' | 'idle', recent: number, tasks: TeamActivity['people'][number]['projects'][number]['tasks'] = []) => ({
  project: ref(p), state, inProgress: state === 'working' ? 2 : 0, recent, open: 3, stale: false, lastActivity: new Date(Date.now() - 2 * 864e5), tasks,
})
const TEAM: TeamActivity = {
  windowDays: 7,
  people: [
    {
      user: ana,
      projects: [
        row(ALFA, 'working', 4, [{ id: 't1', code: 'ALF-49', title: 'Guardar el trabajo y publicar el repositorio con un título bastante largo que tiene que ocupar varias líneas', status, updatedAt: new Date(Date.now() - 7 * 864e5), inProgress: true, moved: true }]),
        row(BETA, 'active', 30),
      ],
    },
    { user: douglas, projects: [row(BETA, 'active', 6, [{ id: 't2', code: 'BET-3', title: 'Revisar el simulador', status, updatedAt: new Date(Date.now() - 3 * 864e5), inProgress: false, moved: true }])] },
  ],
}

const PERMS = [...PERMISSION_CODES]

function setup({ view = 'executive', counts = true, perms = PERMS }: { view?: OngoingView; counts?: boolean; perms?: typeof PERMS } = {}) {
  const list = vi.fn((query: ProjectListQuery): Promise<ProjectPage> => {
    // simula el servidor: estado, prioridad y departamento de la tabla; la lista completa del panel no filtra
    const csv = (value?: string) => (value ? value.split(',') : null)
    const statuses = csv(query.filters.status)
    const priorities = csv(query.filters.priority)
    const items = ALL.filter(
      (p) =>
        (!statuses || statuses.includes(p.status)) &&
        (!priorities || priorities.includes(p.priority)) &&
        (!query.filters.area || (query.filters.area === 'none' ? !p.area : p.area?.id === query.filters.area)),
    )
    return Promise.resolve({ items, page: 1, perPage: query.perPage, total: items.length, totalPages: 1 })
  })
  const me = makeCurrentUser(perms)
  const repositories = fakeRepositories({
    auth: { me: async () => ({ ...me, role: { ...me.role!, ongoingView: view } }) },
    projects: {
      list,
      teamActivity: () => Promise.resolve(TEAM),
      taskCounts: () =>
        Promise.resolve(
          counts
            ? [
                { projectId: 'p1', done: 41, open: 34 },
                { projectId: 'p2', done: 0, open: 7 },
                { projectId: 'p5', done: 9, open: 0 },
              ]
            : [],
        ),
    },
  })
  const utils = renderRoutes([{ path: '/projects/ongoing', element: <ProjectsPage view="ongoing" /> }, { path: '/projects/:id', element: <p>detalle</p> }], { repositories, initialPath: '/projects/ongoing' })
  return { list, ...utils }
}

const kpi = (name: RegExp) => screen.getByRole('button', { name })
const lastTableFilters = (list: ReturnType<typeof setup>['list']) => list.mock.calls.filter(([q]) => q.perPage !== 100).at(-1)?.[0]

describe('En marcha: vista de Dirección y gerencia (§41)', () => {
  it('el perfil en Gestión sigue con la lista de siempre: sin indicadores, con Nuevo proyecto y Equipo ahora', async () => {
    setup({ view: '' })
    expect(await screen.findByRole('button', { name: 'Nuevo proyecto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Equipo ahora' })).toBeInTheDocument()
    expect(screen.queryByTestId('direction-panel')).toBeNull()
  })

  it('Dirección: título y 5 indicadores con cantidad y porcentaje, sin aviso ni acciones de cabecera', async () => {
    const { list } = setup()
    expect(await screen.findByRole('heading', { level: 1, name: 'En marcha' })).toBeInTheDocument()
    expect(screen.queryByText('Vista de consulta · sin editar, archivar ni eliminar')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo proyecto' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Equipo ahora' })).toBeNull()
    const panel = await screen.findByTestId('direction-panel')
    const cards = within(panel).getByRole('group', { name: 'Indicadores de los proyectos' })
    const numbers = (name: RegExp) => {
      const card = within(cards).getByRole('button', { name })
      return [card.querySelector('.text-3xl')?.textContent, card.querySelector('.text-sm.font-bold')?.textContent]
    }
    expect(numbers(/^En marcha/)).toEqual(['4', '80 %'])
    expect(numbers(/^En planificación/)).toEqual(['1', '20 %'])
    expect(numbers(/^En ejecución/)).toEqual(['2', '40 %'])
    expect(numbers(/^Alta prioridad/)).toEqual(['2', '40 %'])
    expect(numbers(/^Finalizados/)).toEqual(['1', '20 %'])
    expect(within(cards).getByRole('button', { name: /^En marcha/ })).toHaveAttribute('aria-pressed', 'true')
    // sin la barra de progreso dentro de las tarjetas
    expect(within(cards).queryByRole('progressbar')).toBeNull()
    // la tabla pide todos los proyectos en marcha (vista "all" + estados)
    await waitFor(() => expect(lastTableFilters(list)).toEqual(expect.objectContaining({ view: 'all', filters: { status: 'planning,active,paused' } })))
    expect(screen.queryByRole('band')).toBeNull()
  })

  it('clic en un indicador filtra todo el panel (línea de tiempo, gráficos, equipo y tabla) y aparece la franja; otro clic lo quita', async () => {
    const { list } = setup()
    const panel = await screen.findByTestId('direction-panel')
    await userEvent.click(within(panel).getByRole('button', { name: /^Alta prioridad/ }))
    const band = await screen.findByRole('status')
    expect(band).toHaveTextContent('Filtrando todo el panel: Alta prioridad (2 proyectos)')
    expect(within(panel).getByRole('button', { name: /^Alta prioridad/ })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(lastTableFilters(list)?.filters).toEqual({ status: 'planning,active,paused', priority: 'high,critical' }))
    // línea de tiempo: solo Alfa y Beta (Gama no tiene fechas y Delta sale del filtro)
    const timeline = within(panel).getByRole('region', { name: 'Línea de tiempo de los proyectos' })
    expect(within(timeline).getAllByRole('img').map((e) => e.getAttribute('aria-label')?.split(' · ')[0])).toEqual(['Beta', 'Alfa'])
    // pizza, estado y equipo respetan el filtro
    const departments = within(panel).getByRole('region', { name: 'Proyectos por departamento' })
    expect(within(departments).getByRole('button', { name: /^TI/ })).toHaveTextContent('1')
    expect(within(departments).queryByRole('button', { name: /^Sin departamento/ })).toBeNull()
    const strip = within(panel).getByRole('region', { name: 'Estado de ejecución' })
    expect(within(within(strip).getByRole('list')).getByRole('button', { name: /^En curso/ })).toHaveTextContent('1')
    expect(within(screen.getByTestId('direction-team')).getAllByRole('article')).toHaveLength(2)

    await userEvent.click(within(panel).getByRole('button', { name: /^Alta prioridad/ }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(within(panel).getByRole('button', { name: /^En marcha/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(panel).getByRole('button', { name: /^Finalizados/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Filtrando todo el panel: Finalizados (1 proyecto)')
    await userEvent.click(screen.getByRole('button', { name: 'Quitar filtro' }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    await waitFor(() => expect(lastTableFilters(list)?.filters).toEqual({ status: 'planning,active,paused' }))
  })

  it('la faja de Estado de ejecución filtra todo (junto al indicador), atenúa los otros tramos y vuelve a quitarse', async () => {
    const { list } = setup()
    const panel = await screen.findByTestId('direction-panel')
    const strip = within(panel).getByRole('region', { name: 'Estado de ejecución' })
    expect(strip).toHaveTextContent('· 4 proyectos')
    expect(within(strip).queryByRole('button', { name: /^Completado/ })).toBeNull()
    expect(within(strip).getAllByRole('button', { name: /^En curso/ })).toHaveLength(2) // tramo de la barra + leyenda
    const legend = within(strip).getByRole('list')
    await userEvent.click(within(legend).getByRole('button', { name: /^Pausado/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Filtrando todo el panel: En marcha · Pausado (1 proyecto)')
    await waitFor(() => expect(lastTableFilters(list)?.filters).toEqual({ status: 'paused' }))
    // la barra mantiene todos los tramos, atenuados los demás
    const segments = within(strip).getAllByRole('button', { pressed: false }).filter((b) => b.getAttribute('aria-label')?.includes('clic para filtrar'))
    expect(segments.length).toBe(2)
    segments.forEach((segment) => expect(segment.style.opacity).toBe('0.3'))
    await userEvent.click(within(legend).getByRole('button', { name: /^Pausado/ }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('el departamento de la pizza se combina con el indicador; "Sin departamento" también filtra', async () => {
    const { list } = setup()
    const panel = await screen.findByTestId('direction-panel')
    const departments = within(panel).getByRole('region', { name: 'Proyectos por departamento' })
    expect(within(departments).getByRole('button', { name: /^TI/ })).toHaveTextContent('2')
    expect(within(departments).getByRole('button', { name: /^Comercial/ })).toHaveTextContent('1')
    await userEvent.click(within(panel).getByRole('button', { name: /^En ejecución/ }))
    await userEvent.click(within(departments).getByRole('button', { name: /^Sin departamento/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Filtrando todo el panel: En ejecución · Sin departamento (1 proyecto)')
    await waitFor(() => expect(lastTableFilters(list)?.filters).toEqual({ status: 'active', area: 'none' }))
    // la pizza sigue mostrando los departamentos del indicador (Comercial queda atenuado, no desaparece)
    expect(within(departments).getByRole('button', { name: /^Comercial/ })).toBeInTheDocument()
    await userEvent.click(within(departments).getByRole('button', { name: /^Sin departamento/ }))
    await waitFor(() => expect(lastTableFilters(list)?.filters).toEqual({ status: 'active' }))
  })

  it('línea de tiempo: solo con fechas reales, colores por estado (con nombre en la leyenda), vencidas marcadas y sin lista de "sin fecha"', async () => {
    setup()
    const panel = await screen.findByTestId('direction-panel')
    const timeline = within(panel).getByRole('region', { name: 'Línea de tiempo de los proyectos' })
    const bars = within(timeline).getAllByRole('img')
    // Delta (entrega 31/10, ya vencida) → Beta (15/12) → Alfa (31/01/27); Gama no tiene fechas y no se dibuja
    expect(bars.map((e) => e.getAttribute('aria-label')?.split(' · ')[0])).toEqual(['Delta', 'Beta', 'Alfa'])
    expect(bars[0]!.getAttribute('aria-label')).toContain('(vencida)')
    expect(bars[1]!.getAttribute('aria-label')).not.toContain('(vencida)')
    expect(within(timeline).queryByText('Gama')).toBeNull()
    expect(within(timeline).getByText('Hoy')).toBeInTheDocument()
    ;['Planificación', 'En curso', 'Pausado', 'Entrega vencida'].forEach((label) => expect(within(timeline).getByText(label)).toBeInTheDocument())
  })

  it('tareas por proyecto: porcentaje a la derecha del nombre y barra de dos partes con los números; sin conteos, el bloque no aparece', async () => {
    const { unmount } = setup()
    const panel = await screen.findByTestId('direction-panel')
    const tasks = await within(panel).findByRole('region', { name: 'Tareas por proyecto' })
    const alfa = within(tasks).getByRole('img', { name: /^Alfa: 41 de 75 tareas ejecutadas \(55 %\) · faltan 34/ })
    expect(alfa).toHaveTextContent('55 %')
    expect(alfa).toHaveTextContent('41')
    expect(alfa).toHaveTextContent('34')
    // los de mayor cantidad por hacer primero; Épsilon (completado) y proyectos sin tareas no entran en "En marcha"
    expect(within(tasks).getAllByRole('img').map((e) => e.getAttribute('aria-label')?.split(':')[0])).toEqual(['Alfa', 'Beta'])
    unmount()
    setup({ counts: false })
    const second = await screen.findByTestId('direction-panel')
    await within(second).findByRole('region', { name: 'Proyectos por departamento' })
    expect(within(second).queryByRole('region', { name: 'Tareas por proyecto' })).toBeNull()
  })

  it('Equipo ahora: una tarjeta por persona, con los grupos y los movimientos; respeta el filtro', async () => {
    setup()
    const team = await screen.findByTestId('direction-team')
    const [first, second] = within(team).getAllByRole('article')
    expect(within(first!).getByRole('heading', { name: 'Angelica Davalos' })).toBeInTheDocument()
    expect(first).toHaveTextContent('1 proyecto(s) en curso · 1 con actividad esta semana')
    expect(first).toHaveTextContent('Trabajando ahora')
    expect(first).toHaveTextContent('Activo esta semana')
    expect(first).toHaveTextContent('30 mov.')
    expect(within(second!).getByRole('heading', { name: 'Douglas Martins' })).toBeInTheDocument()
    // filtro "En planificación": solo Alfa → solo Angelica
    await userEvent.click(kpi(/^En planificación/))
    await waitFor(() => expect(within(screen.getByTestId('direction-team')).getAllByRole('article')).toHaveLength(1))
    expect(within(screen.getByTestId('direction-team')).getByRole('heading', { name: 'Angelica Davalos' })).toBeInTheDocument()
  })

  it('el "+" de un proyecto abre el panel lateral: estado, tareas (números y barra), tareas recientes sin código, quién trabaja y abrir el proyecto', async () => {
    setup()
    const team = await screen.findByTestId('direction-team')
    await userEvent.click(within(team).getByRole('button', { name: 'Ver el detalle de Alfa (Angelica Davalos)' }))
    const drawer = await screen.findByRole('dialog', { name: 'Alfa' })
    expect(within(drawer).getByText('Planificación')).toBeInTheDocument()
    const tasks = within(drawer).getByRole('region', { name: 'Tareas' })
    expect(tasks).toHaveTextContent('41ejecutadas')
    expect(tasks).toHaveTextContent('34faltan')
    expect(tasks).toHaveTextContent('55 %avance')
    const recent = within(drawer).getByRole('region', { name: 'Tareas recientes' })
    expect(within(recent).getByText(/Guardar el trabajo y publicar el repositorio con un título bastante largo/)).toBeInTheDocument()
    expect(within(recent).getByText('En curso')).toBeInTheDocument()
    expect(within(recent).getByText(/semana pasada|hace 1 semana/)).toBeInTheDocument()
    expect(drawer).not.toHaveTextContent('ALF-49') // sin código de tarea
    const who = within(drawer).getByRole('region', { name: 'Quién está trabajando' })
    expect(who).toHaveTextContent('Angelica Davalos')
    expect(who).toHaveTextContent('Trabajando ahora')
    expect(within(drawer).queryByText(/Responsables|Fechas/)).toBeNull()
    expect(within(drawer).getByRole('link', { name: /Abrir el proyecto/ })).toHaveAttribute('href', '/projects/p1')
    // Beta sin tareas recientes de Angelica pero con las de Douglas
    await userEvent.keyboard('{Escape}')
    await userEvent.click(within(team).getByRole('button', { name: 'Ver el detalle de Beta (Douglas Martins)' }))
    const beta = await screen.findByRole('dialog', { name: 'Beta' })
    expect(within(beta).getByText('Revisar el simulador')).toBeInTheDocument()
    expect(within(beta).getByRole('region', { name: 'Quién está trabajando' })).toHaveTextContent('Douglas Martins')
  })

  it('solo consulta: la tabla ofrece solo "Ver" (sin editar, archivar ni eliminar) y la urgencia no se cambia con un clic', async () => {
    setup()
    const table = await screen.findByRole('table')
    const body = await within(table).findAllByRole('row')
    expect(body.length).toBeGreaterThan(1)
    expect(within(table).getAllByRole('button', { name: 'Ver' }).length).toBeGreaterThan(0)
    expect(within(table).queryByRole('button', { name: 'Editar' })).toBeNull()
    expect(within(table).queryByRole('button', { name: /Archivar|Eliminar|Más acciones/ })).toBeNull()
    expect(within(table).queryByRole('button', { name: /^Cambiar la urgencia/ })).toBeNull()
  })

  it('la barra de filtros de la tabla sigue (Estado, Prioridad, Urgencia) y se suma al panel', async () => {
    const { list } = setup()
    await screen.findByTestId('direction-panel')
    await userEvent.click(within(await screen.findByRole('group', { name: 'Prioridad' })).getByRole('button', { name: 'Alta' }))
    await waitFor(() => expect(lastTableFilters(list)?.filters).toEqual({ status: 'planning,active,paused', priority: 'high' }))
    // Alta prioridad (alta o crítica) ∩ Baja = nada: la tabla queda vacía sin ir al servidor
    await userEvent.click(within(screen.getByRole('group', { name: 'Prioridad' })).getByRole('button', { name: 'Alta' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Prioridad' })).getByRole('button', { name: 'Baja' }))
    await userEvent.click(within(screen.getByTestId('direction-panel')).getByRole('button', { name: /^Alta prioridad/ }))
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Delta')).toBeNull())
  })
})
