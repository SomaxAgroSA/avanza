import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { OngoingView } from '@/domain/entities'
import { PERMISSION_CODES } from '@/domain/permissions'
import type { Project, ProjectStatus, ProjectPriority, TeamActivity, TeamActivityActedTask } from '@/domain/projects'
import type { ProjectListQuery, ProjectPage } from '@/domain/repositories'
import type { Dependencies } from '@/domain/dependencies'
import type { TaskDetail } from '@/domain/tasks'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { ProjectsPage } from '../ProjectsPage'
import { STATUS_COLORS } from './direction-data'

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
const row = (p: Project, state: 'working' | 'active' | 'idle', recent: number, tasks: TeamActivity['people'][number]['projects'][number]['tasks'] = [], actedTasks: TeamActivityActedTask[] = []) => ({
  project: ref(p), state, inProgress: state === 'working' ? 2 : 0, recent, actions: recent, open: 3, stale: false, lastActivity: new Date(Date.now() - 2 * 864e5), actedTasks, tasks,
})
const hoursAgo = (n: number) => new Date(Date.now() - n * 36e5)
const acted = (id: string, title: string, action: TeamActivityActedTask['action']): TeamActivityActedTask => ({ id, code: id.toUpperCase(), title, status: { id: 's2', name: 'Prueba', color: 'blue', category: 'in_progress' }, inProgress: true, action, actions: 1 })
const ANA_ALFA = [
  acted('a1', 'Portal de acceso · subir el portal de login al servidor', { type: 'status_changed', from: 'Desarrollo', to: 'Prueba', at: hoursAgo(4) }),
  acted('a2', 'Entregar las vistas de Libro Mayor (S/4)', { type: 'commented', excerpt: 'Vistas publicadas en el espacio de pruebas', at: hoursAgo(5) }),
  acted('a3', 'Configurar acceso a la API del integrador', { type: 'edited', at: hoursAgo(26) }),
  acted('a4', 'CRM Fuerza de Ventas Brasil · servidores en Azure', { type: 'attached', count: 1, at: hoursAgo(6 * 24) }),
]
const TEAM: TeamActivity = {
  windowDays: 7,
  people: [
    {
      user: ana,
      projects: [
        row(ALFA, 'working', 4, [{ id: 't1', code: 'ALF-49', title: 'Guardar el trabajo y publicar el repositorio con un título bastante largo que tiene que ocupar varias líneas', status, updatedAt: new Date(Date.now() - 7 * 864e5), inProgress: true, moved: true }], ANA_ALFA),
        row(BETA, 'active', 30),
      ],
    },
    { user: douglas, projects: [row(BETA, 'active', 6, [{ id: 't2', code: 'BET-3', title: 'Revisar el simulador', status, updatedAt: new Date(Date.now() - 3 * 864e5), inProgress: false, moved: true }])] },
  ],
}

const PERMS = [...PERMISSION_CODES]

const victor = { id: 'u9', name: 'Equipo de Informática', email: 'ti@x.com', avatarUrl: null }
const AREA_TI = { key: 'ti', name: 'TI' }
const AREA_FIN = { key: 'finanzas', name: 'Finanzas' }
const tref = (id: string, code: string, title: string, p: Project, dueDate: string | null = null) => ({ id, code, title, project: { id: p.id, key: p.key, name: p.name }, dueDate })
const dref = (id: string, code: string, title: string, p: Project, area = AREA_TI, dueDate: string | null = null) => ({ ...tref(id, code, title, p, dueDate), area })
const depCounts = (extra: Partial<Dependencies['projects'][number]['counts']> = {}) => ({ deliveries: 0, blocked: 0, pending: 0, noneDue: 0, overdue: 0, ...extra })
/**
 * Alfa: 3 entregas (TI sin plazo, TI con plazo en 2027 y Finanzas vencida) y una relacionada;
 * Beta: una tarea bloqueada por una entrega de Alfa.
 */
const DEPS: Dependencies = {
  today: '2026-11-19',
  people: [victor],
  areas: [
    { ...AREA_TI, deliveries: 2 },
    { ...AREA_FIN, deliveries: 1 },
  ],
  projects: [
    {
      project: { id: 'p2', key: 'P2', name: 'Beta', dueDate: '2026-12-15' },
      counts: depCounts({ blocked: 1 }),
      deliveries: [],
      blocked: [{ ...tref('t40', 'BET-40', 'Dashboard de resultado', BETA, '2026-11-20'), waitingOn: [{ ...dref('t39', 'ALF-39', 'Definir la autenticación (SSO)', ALFA), relationId: 'r1' }] }],
      pending: [],
    },
    {
      project: { id: 'p1', key: 'P1', name: 'Alfa', dueDate: '2027-01-31' },
      counts: depCounts({ deliveries: 3, pending: 1, noneDue: 1, overdue: 1 }),
      deliveries: [
        { ...dref('t36', 'ALF-36', 'Cierre contable de noviembre', ALFA, AREA_FIN, '2026-11-09'), assigneeId: 'u7', waitingDays: 12, daysLeft: -10, risk: 'overdue', blocks: 0, blocksProjects: [] },
        { ...dref('t39', 'ALF-39', 'Definir la autenticación (SSO)', ALFA), assigneeId: 'u9', waitingDays: 2, daysLeft: null, risk: 'none_due', blocks: 1, blocksProjects: [{ id: 'p2', key: 'P2', name: 'Beta' }] },
        { ...dref('t38', 'ALF-38', 'Tablas en SAP', ALFA, AREA_TI, '2027-02-04'), assigneeId: 'u9', waitingDays: 1, daysLeft: 77, risk: 'ok', blocks: 0, blocksProjects: [] },
      ],
      blocked: [],
      pending: [{ ...tref('t31', 'ALF-31', 'Capa de seguridad', ALFA, '2026-11-20'), relatedTo: dref('t39', 'ALF-39', 'Definir la autenticación (SSO)', ALFA), relationId: 'r2' }],
    },
  ],
}

/** Detalle de la tarea que abre el clic en una fila del panel. */
const taskDetail = (id: string, title: string) =>
  ({
    id,
    code: 'ALF-39',
    number: 39,
    title,
    project: { id: 'p1', key: 'P1', name: 'Alfa' },
    type: { id: 'ty1', key: 'INT', name: 'Integración', icon: 'plug', color: 'blue' },
    status: { id: 's1', key: 'TODO', name: 'Backlog', color: 'gray', category: 'todo' },
    priority: { id: 'pr1', key: 'MEDIA', name: 'Media', color: 'yellow' },
    creator: null,
    assignee: victor,
    reporter: null,
    parentTaskId: null,
    startDate: null,
    dueDate: null,
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
    inReport: true,
    itVisible: false,
    urgency: null,
    area: null,
    sprint: null,
    description: 'Falta que TI defina la autenticación.',
    customValues: {},
    checklist: [],
    fields: [],
    parent: null,
    forkedFrom: null,
    capabilities: { edit: true, delete: false, assign: true, comment: true, link: true, fork: true },
  }) as unknown as TaskDetail

function setup({
  view = 'executive',
  counts = true,
  perms = PERMS,
  deps = { today: '2026-11-19', people: [], areas: [], projects: [] },
  relations = {},
  tasks = {},
}: { view?: OngoingView; counts?: boolean; perms?: typeof PERMS; deps?: Dependencies; relations?: Record<string, unknown>; tasks?: Record<string, unknown> } = {}) {
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
      dependencies: () => Promise.resolve(deps),
    },
    relations,
    tasks,
  })
  const utils = renderRoutes([{ path: '/projects/ongoing', element: <ProjectsPage view="ongoing" /> }, { path: '/projects/:id', element: <p>detalle</p> }], { repositories, initialPath: '/projects/ongoing' })
  return { list, ...utils }
}

const kpi = (name: RegExp) => screen.getByRole('button', { name })
const lastTableFilters = (list: ReturnType<typeof setup>['list']) => list.mock.calls.filter(([q]) => q.perPage !== 100).at(-1)?.[0]

describe('En marcha: vista de Dirección y gerencia (§41)', () => {
  it('perfil con «Ambas»: selector Gestión | Dirección y gerencia arriba; abre en Dirección y recuerda la elección', async () => {
    window.localStorage.clear()
    const { unmount } = setup({ view: 'both' })
    const sw = await screen.findByRole('group', { name: 'Vista de En marcha' })
    expect(within(sw).getByRole('button', { name: 'Dirección y gerencia' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByTestId('direction-panel')).toBeInTheDocument()
    await userEvent.click(within(sw).getByRole('button', { name: 'Gestión' }))
    await waitFor(() => expect(screen.queryByTestId('direction-panel')).toBeNull())
    expect(screen.getByRole('button', { name: /Nuevo proyecto/ })).toBeInTheDocument()
    unmount()
    setup({ view: 'both' })
    const again = await screen.findByRole('group', { name: 'Vista de En marcha' })
    expect(within(again).getByRole('button', { name: 'Gestión' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('sin «Ambas» no hay selector', async () => {
    setup({ view: 'executive' })
    await screen.findByTestId('direction-panel')
    expect(screen.queryByRole('group', { name: 'Vista de En marcha' })).toBeNull()
  })

  it('el perfil en Gestión sigue con la lista de siempre: sin indicadores, con Nuevo proyecto y Equipo ahora', async () => {
    setup({ view: '' })
    expect(await screen.findByRole('button', { name: 'Nuevo proyecto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Equipo ahora' })).toBeInTheDocument()
    expect(screen.queryByTestId('direction-panel')).toBeNull()
  })

  it('Dirección: 5 indicadores; el % es sobre los en marcha (base, sin %); Finalizados sin %; ninguno marcado al entrar', async () => {
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
    expect(numbers(/^En marcha/)).toEqual(['4', undefined])
    expect(numbers(/^En planificación/)).toEqual(['1', '25 %'])
    expect(numbers(/^En ejecución/)).toEqual(['2', '50 %'])
    expect(numbers(/^Alta prioridad/)).toEqual(['2', '50 %'])
    expect(numbers(/^Finalizados/)).toEqual(['1', undefined])
    expect(within(cards).getByRole('button', { name: /^En marcha/ })).toHaveTextContent('planificación + en curso + pausados')
    expect(within(cards).getByRole('button', { name: /^Alta prioridad/ })).toHaveTextContent('de los 4 en marcha')
    expect(within(cards).getByRole('button', { name: /^Finalizados/ })).toHaveTextContent('concluidos · fuera del cálculo')
    // al entrar ningún indicador está marcado (el panel muestra los en marcha) y no hay franja de filtro
    within(cards).getAllByRole('button').forEach((card) => expect(card).toHaveAttribute('aria-pressed', 'false'))
    expect(screen.queryByRole('status')).toBeNull()
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
    expect(within(panel).getByRole('button', { name: /^En marcha/ })).toHaveAttribute('aria-pressed', 'false')
    expect(within(panel).getByRole('button', { name: /^Alta prioridad/ })).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(lastTableFilters(list)?.filters).toEqual({ status: 'planning,active,paused' }))
    // En marcha también se puede elegir (verde + franja) y un segundo clic lo quita
    await userEvent.click(within(panel).getByRole('button', { name: /^En marcha/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Filtrando todo el panel: En marcha (4 proyectos)')
    await userEvent.click(within(panel).getByRole('button', { name: /^En marcha/ }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    await userEvent.click(within(panel).getByRole('button', { name: /^Finalizados/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Filtrando todo el panel: Finalizados (1 proyecto)')
    await userEvent.click(screen.getByRole('button', { name: 'Quitar filtro' }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    await waitFor(() => expect(lastTableFilters(list)?.filters).toEqual({ status: 'planning,active,paused' }))
  })

  it('Estado de ejecución en torta (25/11): tocar la fila de la leyenda o el sector filtra todo (junto al indicador), atenúa los otros y vuelve a quitarse', async () => {
    const { list } = setup()
    const panel = await screen.findByTestId('direction-panel')
    const card = within(panel).getByRole('region', { name: 'Estado de ejecución' })
    expect(card).toHaveTextContent('4 proyectos')
    expect(within(card).queryByRole('button', { name: /^Completado/ })).toBeNull()
    expect(within(card).getAllByRole('button', { name: /^En curso/ })).toHaveLength(1) // una fila por estado
    await userEvent.click(within(card).getByRole('button', { name: /^Pausado/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Filtrando todo el panel: En marcha · Pausado (1 proyecto)')
    await waitFor(() => expect(lastTableFilters(list)?.filters).toEqual({ status: 'paused' }))
    expect(within(card).getByRole('button', { name: /^Pausado/ })).toHaveAttribute('aria-pressed', 'true')
    // los otros sectores siguen a la vista, atenuados
    const slice = (key: string) => card.querySelector(`[data-slice="${key}"]`)!
    expect(['planning', 'active', 'paused'].map((key) => slice(key).getAttribute('opacity'))).toEqual(['0.3', '0.3', '1'])
    await userEvent.click(within(card).getByRole('button', { name: /^Pausado/ }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    // el sector también filtra
    await userEvent.click(slice('active'))
    expect(await screen.findByRole('status')).toHaveTextContent('Filtrando todo el panel: En marcha · En curso (2 proyectos)')
    await waitFor(() => expect(lastTableFilters(list)?.filters).toEqual({ status: 'active' }))
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
    // los que no tienen fechas aparecen al final, marcados (sin barra), para que el número coincida
    expect(within(timeline).getByText(/Sin fecha de entrega · 1/)).toBeInTheDocument()
    expect(within(timeline).getByText('Gama')).toBeInTheDocument()
    expect(within(timeline).getAllByText('sin fecha de entrega')).toHaveLength(1)
    expect(within(timeline).getByText('Hoy')).toBeInTheDocument()
    ;['Planificación', 'En curso', 'Pausado', 'Entrega vencida'].forEach((label) => expect(within(timeline).getByText(label)).toBeInTheDocument())
  })

  it('Estado de ejecución va al lado de Proyectos por departamento; el bloque Tareas por proyecto ya no aparece', async () => {
    setup()
    const panel = await screen.findByTestId('direction-panel')
    const departments = await within(panel).findByRole('region', { name: 'Proyectos por departamento' })
    const status = within(panel).getByRole('region', { name: 'Estado de ejecución' })
    // los dos en la misma fila (mismo contenedor de la grilla)
    expect(status.parentElement).toBe(departments.parentElement)
    expect(within(panel).queryByRole('region', { name: 'Tareas por proyecto' })).toBeNull()
    // en torta, como la de departamentos (ya no hay barras): sector por estado con los colores de siempre y
    // leyenda con nombre, número y %; el mouse sobre el sector muestra el detalle
    expect(status.querySelector('[data-bar]')).toBeNull()
    const chart = within(status).getByRole('img', { name: 'Gráfico de proyectos por estado de ejecución' })
    const slices = [...chart.querySelectorAll('path')]
    expect(slices.map((p) => [p.getAttribute('data-slice'), p.getAttribute('fill')])).toEqual([
      ['planning', STATUS_COLORS.planning],
      ['active', STATUS_COLORS.active],
      ['paused', STATUS_COLORS.paused],
    ])
    expect(slices[1]!.querySelector('title')).toHaveTextContent('En curso: 2 (50 %)')
    const rows = within(status).getAllByRole('button')
    expect(rows.map((r) => r.textContent)).toEqual(['Planificación125 %', 'En curso250 %', 'Pausado125 %'])
  })

  it('Equipo ahora: una tarjeta por persona, con los grupos y los movimientos; respeta el filtro', async () => {
    setup()
    const team = await screen.findByTestId('direction-team')
    const [first, second] = within(team).getAllByRole('article')
    expect(within(first!).getByRole('heading', { name: 'Angelica Davalos' })).toBeInTheDocument()
    expect(first).toHaveTextContent('Actuó en 34 tareas esta semana')
    expect(first).toHaveTextContent('Trabajando ahora')
    expect(first).toHaveTextContent('Activo esta semana')
    expect(first).toHaveTextContent('30 mov.')
    expect(within(second!).getByRole('heading', { name: 'Douglas Martins' })).toBeInTheDocument()
    // filtro "En planificación": solo Alfa → solo Angelica
    await userEvent.click(kpi(/^En planificación/))
    await waitFor(() => expect(within(screen.getByTestId('direction-team')).getAllByRole('article')).toHaveLength(1))
    expect(within(screen.getByTestId('direction-team')).getByRole('heading', { name: 'Angelica Davalos' })).toBeInTheDocument()
  })

  it('bajo cada proyecto, hasta 3 tareas en que la persona actuó, con la acción y cuándo; "+N más" abre el panel', async () => {
    setup()
    const team = await screen.findByTestId('direction-team')
    const card = within(team).getAllByRole('article')[0]!
    const preview = within(card).getByRole('list', { name: 'Lo que hizo Angelica Davalos en Alfa' })
    expect(within(preview).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Portal de acceso · subir el portal de login al servidor',
      'Entregar las vistas de Libro Mayor (S/4)',
      'Configurar acceso a la API del integrador',
    ])
    expect(preview).toHaveTextContent('pasó a Prueba · hace 4 horas')
    expect(preview).toHaveTextContent('comentó · hace 5 horas')
    expect(preview).toHaveTextContent('editó · ayer')
    expect(within(preview).getByRole('link', { name: 'Entregar las vistas de Libro Mayor (S/4)' })).toHaveAttribute('href', '/tasks/a2')
    await userEvent.click(within(preview).getByRole('button', { name: 'Ver todas las tareas de Angelica Davalos en Alfa' }))
    const drawer = await screen.findByRole('dialog', { name: 'Angelica en Alfa' })
    expect(within(drawer).getByRole('tab', { name: 'Tareas de Angelica · 4' })).toHaveAttribute('aria-selected', 'true')
    expect(within(drawer).getAllByRole('listitem')).toHaveLength(4)
    expect(drawer).toHaveTextContent('Adjuntó 1 archivo')
  })

  it('el "+" de la persona abre "<Nombre> en <Proyecto>": sus tareas con la acción y, en "Todo el proyecto", el panel de siempre', async () => {
    setup()
    const team = await screen.findByTestId('direction-team')
    await userEvent.click(within(team).getByRole('button', { name: 'Ver el detalle de Alfa (Angelica Davalos)' }))
    const drawer = await screen.findByRole('dialog', { name: 'Angelica en Alfa' })
    expect(drawer).toHaveTextContent('Lo que hizo en los últimos 7 días')
    // por defecto, solo las tareas de ella: la acción con el detalle, cuándo y el estado
    const mine = within(drawer).getByRole('list', { name: 'Tareas de Angelica · 4' })
    expect(mine).toHaveTextContent('Pasó de Desarrollo a Prueba · hace 4 horas')
    expect(mine).toHaveTextContent('Comentó: «Vistas publicadas en el espacio de pruebas» · hace 5 horas')
    expect(within(mine).getAllByText('Prueba').length).toBeGreaterThan(0)
    expect(drawer).not.toHaveTextContent('Guardar el trabajo y publicar el repositorio')
    expect(within(drawer).getByRole('link', { name: /Abrir el proyecto/ })).toHaveAttribute('href', '/projects/p1')
    // "Todo el proyecto": estado, tareas (números y barra), tareas recientes sin código y quién trabaja
    await userEvent.click(within(drawer).getByRole('tab', { name: 'Todo el proyecto' }))
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
    // Douglas en Beta: sin acciones propias en la lista de él, el aviso; "Todo el proyecto" con sus tareas
    await userEvent.keyboard('{Escape}')
    await userEvent.click(within(team).getByRole('button', { name: 'Ver el detalle de Beta (Douglas Martins)' }))
    const beta = await screen.findByRole('dialog', { name: 'Douglas en Beta' })
    expect(beta).toHaveTextContent('Douglas no actuó en tareas de este proyecto en los últimos 7 días.')
    await userEvent.click(within(beta).getByRole('tab', { name: 'Todo el proyecto' }))
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

  it('Dependencias: franja entre indicadores y línea de tiempo con solo los alertas que hay, ⚠ junto al nombre en el Gantt y se oculta sin proyectos afectados', async () => {
    setup({ deps: DEPS })
    const panel = await screen.findByTestId('direction-panel')
    const strip = await within(panel).findByTestId('dep-strip')
    expect(strip).toHaveTextContent('Dependencias')
    expect(strip).not.toHaveTextContent('de TI')
    expect(strip).toHaveTextContent('1 bloqueada·1 sin plazo·1 vencida·1 por validar|2 proyectos')
    expect(strip).not.toHaveTextContent('después del cierre')
    expect(strip).toHaveTextContent('Ver impacto')
    // orden: indicadores → franja → línea de tiempo
    const timeline = within(panel).getByRole('region', { name: 'Línea de tiempo de los proyectos' })
    expect(strip.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const flag = within(timeline).getByRole('button', { name: 'Dependencias en este proyecto: Alfa' })
    expect(flag).toHaveAttribute('title', 'Dependencias en este proyecto')
    expect(within(timeline).getByRole('button', { name: 'Dependencias en este proyecto: Beta' })).toBeInTheDocument()
    expect(within(timeline).queryByRole('button', { name: /Dependencias en este proyecto: Delta/ })).toBeNull()
    // En ejecución: solo Beta afectado → solo lo que hay (sin "0 sin plazo")
    await userEvent.click(within(panel).getByRole('button', { name: /^En ejecución/ }))
    await waitFor(() => expect(within(panel).getByTestId('dep-strip')).toHaveTextContent(/^Dependencias1 bloqueada\|1 proyectoVer impacto$/))
    // Finalizados: ningún proyecto afectado → la franja no aparece
    await userEvent.click(within(panel).getByRole('button', { name: /^Finalizados/ }))
    await waitFor(() => expect(within(panel).queryByTestId('dep-strip')).toBeNull())
  })

  it('Ver impacto: panel "Dependencias" sin números ni "a cargo de", chips por área, un bloque por proyecto con el total de pendientes, sin códigos', async () => {
    setup({ deps: DEPS })
    await userEvent.click(await screen.findByTestId('dep-strip'))
    const drawer = await screen.findByRole('dialog', { name: 'Dependencias' })
    // sin la línea de ayuda debajo del título
    expect(drawer).not.toHaveTextContent('entregas pendientes de otras áreas')
    expect(drawer).not.toHaveTextContent('a cargo de')
    expect(drawer).not.toHaveTextContent('Cómo se calcula')
    expect(drawer).not.toHaveTextContent('Entregas pendientes de TI')
    // ningún código de tarea
    ;['BET-40', 'ALF-39', 'ALF-38', 'ALF-36', 'ALF-31'].forEach((code) => expect(drawer).not.toHaveTextContent(code))
    // chips de área: todas + una por área con entregas
    const chips = within(drawer).getByRole('group', { name: 'Área' })
    expect(within(chips).getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['Todas las áreas3', 'true'],
      ['TI2', 'false'],
      ['Finanzas1', 'false'],
    ])
    const blocks = within(drawer).getAllByRole('region')
    expect(blocks.map((b) => b.getAttribute('aria-label'))).toEqual(['Beta', 'Alfa'])
    const [beta, alfa] = blocks as [HTMLElement, HTMLElement]
    // cabecera: nombre + solo el número de entregas pendientes
    expect(within(alfa).getByLabelText('3 entregas pendientes')).toHaveTextContent(/^3$/)
    expect(within(beta).getByLabelText('0 entregas pendientes')).toBeInTheDocument()
    expect(beta).toHaveTextContent('Bloqueado por otra área')
    expect(beta).toHaveTextContent('Dashboard de resultado')
    expect(beta).toHaveTextContent('Espera a Definir la autenticación (SSO)de Alfa')
    expect(beta).toHaveTextContent('20/11 · mañana')
    // Alfa: Por validar y la lista de entregas (columnas Entrega / Plazo), sin título de sección para las entregas
    expect(within(alfa).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Por validarrelacionadas: no cuentan como bloqueo'])
    expect(alfa).toHaveTextContent('EntregaPlazo')
    expect(alfa).toHaveTextContent('Relacionada con Definir la autenticación (SSO)')
    expect(alfa).toHaveTextContent('09/11 · vencida hace 10 días')
    expect(alfa).toHaveTextContent('Sin plazo')
    expect(alfa).toHaveTextContent('04/02/27 · en 77 días')
    expect(alfa).toHaveTextContent('TI· Esperando hace 2 días· bloquea 1 tarea (de Beta)')
    expect(alfa).toHaveTextContent('Finanzas· Esperando hace 12 días')
    // colores: vencida en rojo, sin plazo en ámbar, en plazo en verde
    expect(within(alfa).getByText('09/11 · vencida hace 10 días')).toHaveClass('bg-danger-soft')
    expect(within(alfa).getByText('Sin plazo')).toHaveClass('bg-warning-soft')
    expect(within(alfa).getByText('04/02/27 · en 77 días')).toHaveClass('bg-success-soft')
    // "Por validar" queda solo con la información (sin "Confirmar bloqueo")
    expect(alfa).toHaveTextContent('Relacionada con Definir la autenticación (SSO)')
    expect(within(alfa).queryByRole('button', { name: 'Confirmar bloqueo' })).toBeNull()
    expect(within(drawer).queryByRole('button', { name: /Ver todos los proyectos/ })).toBeNull()
  })

  it('la chip de un área filtra el panel: solo los proyectos y las filas de esa área', async () => {
    setup({ deps: DEPS })
    await userEvent.click(await screen.findByTestId('dep-strip'))
    const drawer = await screen.findByRole('dialog', { name: 'Dependencias' })
    await userEvent.click(within(drawer).getByRole('button', { name: 'Finanzas1' }))
    expect(within(drawer).getByRole('button', { name: 'Finanzas1' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(drawer).getAllByRole('region').map((b) => b.getAttribute('aria-label'))).toEqual(['Alfa'])
    expect(drawer).toHaveTextContent('Cierre contable de noviembre')
    expect(drawer).not.toHaveTextContent('Tablas en SAP')
    expect(drawer).not.toHaveTextContent('Capa de seguridad')
    expect(within(drawer).getByLabelText('1 entrega pendiente')).toBeInTheDocument()
    // TI: Beta vuelve (espera una entrega de TI) y la de Finanzas sale
    await userEvent.click(within(drawer).getByRole('button', { name: 'TI2' }))
    expect(within(drawer).getAllByRole('region').map((b) => b.getAttribute('aria-label'))).toEqual(['Beta', 'Alfa'])
    expect(drawer).not.toHaveTextContent('Cierre contable de noviembre')
    await userEvent.click(within(drawer).getByRole('button', { name: 'Todas las áreas3' }))
    expect(drawer).toHaveTextContent('Cierre contable de noviembre')
  })

  it('clic en una fila (bloqueada o entrega) abre la tarea encima, con "Volver a Dependencias"', async () => {
    const get = vi.fn((id: string) => Promise.resolve(taskDetail(id, id === 't40' ? 'Dashboard de resultado' : 'Definir la autenticación (SSO)')))
    setup({ deps: DEPS, tasks: { get } })
    await userEvent.click(await screen.findByTestId('dep-strip'))
    const drawer = await screen.findByRole('dialog', { name: 'Dependencias' })
    const alfa = within(drawer).getAllByRole('region')[1]!
    const row = within(alfa).getByRole('button', { name: /^Definir la autenticación \(SSO\)/ })
    row.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(get).toHaveBeenCalledWith('t39'))
    const task = await screen.findByRole('dialog', { name: 'Definir la autenticación (SSO)' })
    expect(task).toHaveTextContent('Falta que TI defina la autenticación.')
    expect(within(task).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    await userEvent.click(within(task).getByRole('button', { name: /Volver a Dependencias/ }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Definir la autenticación (SSO)' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Dependencias' })).toBeInTheDocument()
    // la fila bloqueada también abre su tarea
    const beta = within(screen.getByRole('dialog', { name: 'Dependencias' })).getAllByRole('region')[0]!
    await userEvent.click(within(beta).getByRole('button', { name: /^Dashboard de resultado/ }))
    await waitFor(() => expect(get).toHaveBeenCalledWith('t40'))
  })

  it('el ⚠ abre solo ese proyecto con "Ver todos los proyectos"', async () => {
    setup({ deps: DEPS })
    const timeline = await screen.findByRole('region', { name: 'Línea de tiempo de los proyectos' })
    await userEvent.click(await within(timeline).findByRole('button', { name: 'Dependencias en este proyecto: Alfa' }))
    const drawer = await screen.findByRole('dialog', { name: 'Dependencias' })
    expect(within(drawer).getAllByRole('region').map((b) => b.getAttribute('aria-label'))).toEqual(['Alfa'])
    await userEvent.click(within(drawer).getByRole('button', { name: /Ver todos los proyectos/ }))
    await waitFor(() => expect(within(drawer).getAllByRole('region')).toHaveLength(2))
  })
})
