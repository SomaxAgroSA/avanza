import { describe, expect, it } from 'vitest'
import type { Project, ProjectPriority, ProjectStatus, TeamActivity, TeamActivityProject } from '@/domain/projects'
import {
  DEFAULT_PANEL,
  PIE_NONE,
  departmentScope,
  departmentSlices,
  ganttModel,
  isPanelFiltered,
  kpiStats,
  panelScope,
  pieSlicePaths,
  recentTasksOf,
  statusScope,
  statusSlices,
  taskBars,
  tableFilters,
  teamInScope,
  workersOf,
} from './direction-data'

const day = (value: string) => new Date(`${value}T00:00:00.000Z`)
const user = (id: string) => ({ id, name: `Pessoa ${id}`, email: `${id}@x.com`, avatarUrl: null })

function make(id: string, status: ProjectStatus, extra: Partial<Project> = {}, priority: ProjectPriority = 'medium'): Project {
  return {
    id, name: `Proyecto ${id}`, key: id.toUpperCase(), description: '', platformUrl: '', icon: 'folder', cover: 'blue', status, priority, urgency: null, area: null, parent: null,
    childCount: 0, owner: null, lead: null, devLead: null, startDate: null, dueDate: null, archivedAt: null, createdAt: null, updatedAt: null, memberCount: 1, myRole: null,
    capabilities: { edit: true, manageMembers: true, archive: true, delete: false, transfer: true, uploadFiles: true, sections: [] },
    ...extra,
  }
}
const area = (id: string, name: string) => ({ id, key: id.toUpperCase(), name, color: 'blue' as const })
const ti = area('a-ti', 'TI')
const com = area('a-com', 'Comercial')
const PROJECTS = [
  make('p1', 'planning', { area: ti }, 'high'),
  make('p2', 'planning', { area: ti }),
  make('p3', 'active', { area: com }, 'critical'),
  make('p4', 'active'),
  make('p5', 'paused', { area: com }),
  make('p6', 'completed', { area: ti }),
  make('p7', 'cancelled'),
]

describe('direction-data: indicadores', () => {
  it('conta cada indicador e o percentual do total de projetos (não arquivados) que a pessoa vê', () => {
    const stats = kpiStats(PROJECTS)
    expect(stats.ongoing).toEqual({ count: 5, percent: 71 })
    expect(stats.planning).toEqual({ count: 2, percent: 29 })
    expect(stats.active).toEqual({ count: 2, percent: 29 })
    expect(stats.high).toEqual({ count: 2, percent: 29 }) // alta ou crítica, entre os em andamento
    expect(stats.completed).toEqual({ count: 1, percent: 14 })
    expect(kpiStats([]).ongoing).toEqual({ count: 0, percent: 0 })
  })

  it('Alta prioridade só conta projetos em andamento', () => {
    const finishedHigh = make('p8', 'completed', {}, 'high')
    expect(kpiStats([...PROJECTS, finishedHigh]).high.count).toBe(2)
  })

  it('o filtro do painel combina indicador, estado e departamento; cada bloco ignora o seu próprio filtro', () => {
    const ids = (list: Project[]) => list.map((p) => p.id)
    expect(ids(panelScope(PROJECTS, DEFAULT_PANEL))).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
    const filter = { kpi: 'ongoing' as const, status: 'active' as const, area: 'a-com' }
    expect(ids(panelScope(PROJECTS, filter))).toEqual(['p3'])
    expect(ids(departmentScope(PROJECTS, filter))).toEqual(['p3', 'p4']) // pizza: sem o departamento
    expect(ids(statusScope(PROJECTS, filter))).toEqual(['p3', 'p5']) // faixa: sem o estado
    expect(isPanelFiltered(DEFAULT_PANEL)).toBe(false)
    expect(isPanelFiltered({ ...DEFAULT_PANEL, kpi: 'high' })).toBe(true)
    expect(isPanelFiltered({ ...DEFAULT_PANEL, area: 'none' })).toBe(true)
  })
})

describe('direction-data: departamentos e estados', () => {
  it('fatias por departamento: maior primeiro, "sem departamento" por último e cinza, cores da paleta', () => {
    const slices = departmentSlices(panelScope(PROJECTS, DEFAULT_PANEL))
    expect(slices.map((s) => [s.key, s.count, s.percent])).toEqual([
      ['a-com', 2, 40],
      ['a-ti', 2, 40],
      ['none', 1, 20],
    ])
    expect(slices[0]!.color).toBe('#2a78d6')
    expect(slices[1]!.color).toBe('#eb6834')
    expect(slices[2]!.color).toBe(PIE_NONE)
  })

  it('o caminho da pizza fecha o círculo quando há uma fatia só', () => {
    const one = departmentSlices([PROJECTS[0]!])
    expect(pieSlicePaths(one, 80, 80, 70)[0]!.d).toContain('a70,70')
    expect(pieSlicePaths(departmentSlices(PROJECTS), 80, 80, 70)).toHaveLength(3)
    expect(pieSlicePaths([], 80, 80, 70)).toEqual([])
  })

  it('faixa de estado: Concluído só aparece com projetos', () => {
    expect(statusSlices(panelScope(PROJECTS, DEFAULT_PANEL)).map((s) => [s.status, s.count, s.percent])).toEqual([
      ['planning', 2, 40],
      ['active', 2, 40],
      ['paused', 1, 20],
    ])
    expect(statusSlices(PROJECTS.filter((p) => p.status === 'completed')).map((s) => s.status)).toEqual(['planning', 'active', 'paused', 'completed'])
  })
})

describe('direction-data: linha do tempo', () => {
  const now = new Date(2026, 10, 18)

  it('só desenha projetos com início e entrega, a entrega mais próxima primeiro; os sem datas ficam de fora', () => {
    const rows = ganttModel(
      [
        make('a', 'active', { startDate: day('2026-10-01'), dueDate: day('2026-12-31') }),
        make('b', 'planning', { startDate: day('2026-09-01'), dueDate: day('2026-11-30') }),
        make('c', 'paused', { startDate: null, dueDate: day('2026-12-01') }),
        make('d', 'paused', { startDate: day('2026-12-01'), dueDate: day('2026-11-01') }), // entrega antes do início: ignorada
      ],
      now,
    )!
    expect(rows.rows.map((r) => r.project.id)).toEqual(['b', 'a'])
    expect(ganttModel([make('x', 'active')], now)).toBeNull()
  })

  it('a escala vai do mês do primeiro início (ou de hoje) ao mês seguinte à última entrega e marca hoje', () => {
    const model = ganttModel([make('a', 'active', { startDate: day('2026-09-10'), dueDate: day('2027-01-20') })], now)!
    expect(model.months.map((m) => m.date.toISOString().slice(0, 7))).toEqual(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'])
    expect(model.today).toBeGreaterThan(40)
    expect(model.today).toBeLessThan(60)
    const row = model.rows[0]!
    expect(row.left).toBeGreaterThan(0)
    expect(row.left + row.width).toBeLessThanOrEqual(100)
  })

  it('entrega vencida (e não concluída) sai com contorno vermelho', () => {
    const model = ganttModel(
      [
        make('late', 'active', { startDate: day('2026-08-01'), dueDate: day('2026-10-31') }),
        make('ok', 'active', { startDate: day('2026-08-01'), dueDate: day('2026-12-31') }),
        make('done', 'completed', { startDate: day('2026-08-01'), dueDate: day('2026-09-30') }),
      ],
      now,
    )!
    expect(Object.fromEntries(model.rows.map((r) => [r.project.id, r.late]))).toEqual({ late: true, ok: false, done: false })
  })
})

describe('direction-data: tarefas por projeto', () => {
  it('os 6 com mais tarefas por fazer, com o percentual executado; sem contagem, fora (nada inventado)', () => {
    const projects = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => make(id, 'active'))
    const counts = [
      { projectId: 'p1', done: 41, open: 34 },
      { projectId: 'p2', done: 0, open: 7 },
      { projectId: 'p3', done: 5, open: 0 },
      { projectId: 'p4', done: 0, open: 0 },
    ]
    const bars = taskBars(projects, counts)
    expect(bars.map((b) => [b.project.id, b.done, b.open, b.percent])).toEqual([
      ['p1', 41, 34, 55],
      ['p2', 0, 7, 0],
      ['p3', 5, 0, 100],
    ])
    expect(taskBars(projects, counts, 2)).toHaveLength(2)
    expect(taskBars(projects, [])).toEqual([])
  })
})

describe('direction-data: filtros da tabela', () => {
  it('une os filtros do painel com os da barra (interseção) e manda o departamento', () => {
    expect(tableFilters(DEFAULT_PANEL, {})).toEqual({ filters: { status: 'planning,active,paused' }, empty: false })
    expect(tableFilters({ kpi: 'high', status: 'paused', area: 'none' }, { urgency: 'high' })).toEqual({
      filters: { status: 'paused', priority: 'high,critical', area: 'none', urgency: 'high' },
      empty: false,
    })
    expect(tableFilters(DEFAULT_PANEL, { status: 'active,completed', priority: 'low' }).filters).toEqual({ status: 'active', priority: 'low' })
  })

  it('sem projeto possível (interseção vazia) a tabela fica vazia sem pedir ao servidor', () => {
    expect(tableFilters({ kpi: 'completed', status: null, area: null }, { status: 'active' }).empty).toBe(true)
    expect(tableFilters({ kpi: 'high', status: null, area: null }, { priority: 'low' }).empty).toBe(true)
    expect(tableFilters({ kpi: 'planning', status: 'paused', area: null }, {}).empty).toBe(true)
  })
})

describe('direction-data: Equipo ahora', () => {
  const row = (id: string, state: TeamActivityProject['state'], recent: number, tasks: TeamActivityProject['tasks'] = []): TeamActivityProject => ({
    project: { id, key: id, name: id, icon: 'folder', cover: 'blue' }, state, inProgress: 0, recent, open: 0, stale: false, lastActivity: null, tasks,
  })
  const task = (id: string, at: string) => ({ id, code: `X-${id}`, title: `Tarefa ${id}`, status: { id: 's', name: 'Em curso', color: 'blue', category: 'in_progress' }, updatedAt: day(at), inProgress: false, moved: true })
  const TEAM: TeamActivity = {
    windowDays: 7,
    people: [
      { user: user('ana'), projects: [row('p1', 'active', 3, [task('t1', '2026-11-10'), task('t2', '2026-11-16')]), row('p2', 'idle', 0)] },
      { user: user('dou'), projects: [row('p1', 'working', 9, [task('t2', '2026-11-16'), task('t3', '2026-11-12')])] },
      { user: user('edu'), projects: [row('p9', 'working', 1)] },
    ],
  }

  it('respeita o filtro: só os projetos do painel; quem fica sem projeto sai', () => {
    const scoped = teamInScope(TEAM, [make('p1', 'active'), make('p2', 'active')])!
    expect(scoped.people.map((p) => [p.user.id, p.projects.map((r) => r.project.id)])).toEqual([
      ['ana', ['p1', 'p2']],
      ['dou', ['p1']],
    ])
    expect(teamInScope(undefined, [])).toBeUndefined()
  })

  it('quem trabalha no projeto, trabalhando agora primeiro; tarefas recentes sem repetir, da mais nova à mais antiga', () => {
    const workers = workersOf(TEAM, 'p1')
    expect(workers.map((w) => [w.user.id, w.row.state])).toEqual([['dou', 'working'], ['ana', 'active']])
    expect(recentTasksOf(workers).map((t) => t.id)).toEqual(['t2', 't3', 't1'])
    expect(recentTasksOf(workers, 2)).toHaveLength(2)
    expect(workersOf(TEAM, 'nenhum')).toEqual([])
  })
})
