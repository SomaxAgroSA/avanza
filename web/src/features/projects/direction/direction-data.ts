import { isOverdue, type Project, type ProjectPriority, type ProjectStatus, type ProjectTaskCount, type TeamActivity, type TeamActivityProject, type TeamActivityTask, type UserSummary } from '@/domain/projects'

/**
 * Vista "Direção e gerência" de Em andamento (regras §41): tudo o que o painel calcula a partir dos projetos
 * reais (lista da API), das contagens de tarefas e do "Equipo ahora". Funções puras, sem tela.
 */

export const ONGOING_STATUSES: readonly ProjectStatus[] = ['planning', 'active', 'paused']
const HIGH_PRIORITIES: readonly ProjectPriority[] = ['high', 'critical']

/** Indicadores clicáveis do topo; o primeiro (Em andamento) é a seleção inicial. */
export const KPI_IDS = ['ongoing', 'planning', 'active', 'high', 'completed'] as const
export type KpiId = (typeof KPI_IDS)[number]

interface KpiRule {
  statuses: readonly ProjectStatus[]
  /** Só estas prioridades (Alta prioridade = alta ou crítica, entre os em andamento). */
  priorities?: readonly ProjectPriority[]
}

const KPI_RULES: Record<KpiId, KpiRule> = {
  ongoing: { statuses: ONGOING_STATUSES },
  planning: { statuses: ['planning'] },
  active: { statuses: ['active'] },
  high: { statuses: ONGOING_STATUSES, priorities: HIGH_PRIORITIES },
  completed: { statuses: ['completed'] },
}

/** Departamento do projeto: id da área, ou 'none' quando não tem. */
export const NO_AREA = 'none'
export const areaKey = (project: Pick<Project, 'area'>): string => project.area?.id ?? NO_AREA

/** O que o painel inteiro está filtrando: indicador, estado (faixa) e departamento (pizza). */
export interface PanelFilter {
  kpi: KpiId
  status: ProjectStatus | null
  area: string | null
}

export const DEFAULT_PANEL: PanelFilter = { kpi: 'ongoing', status: null, area: null }

export const isPanelFiltered = (filter: PanelFilter): boolean => filter.kpi !== DEFAULT_PANEL.kpi || filter.status !== null || filter.area !== null

export const matchesKpi = (project: Project, kpi: KpiId): boolean => {
  const rule = KPI_RULES[kpi]
  return rule.statuses.includes(project.status) && (!rule.priorities || rule.priorities.includes(project.priority))
}

/** Quantos projetos há em cada indicador e quanto isso é do total (percentual inteiro; total 0 = 0). */
export function kpiStats(projects: readonly Project[]): Record<KpiId, { count: number; percent: number }> {
  const total = projects.length
  const stats = {} as Record<KpiId, { count: number; percent: number }>
  KPI_IDS.forEach((kpi) => {
    const count = projects.filter((p) => matchesKpi(p, kpi)).length
    stats[kpi] = { count, percent: percentOf(count, total) }
  })
  return stats
}

export const percentOf = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0)

/** Indicador + estado + departamento: o que o Gantt, as tarefas, o Equipo ahora e a tabela mostram. */
export const panelScope = (projects: readonly Project[], filter: PanelFilter): Project[] =>
  projects.filter((p) => matchesKpi(p, filter.kpi) && (!filter.status || p.status === filter.status) && (!filter.area || areaKey(p) === filter.area))

/** Para a pizza: indicador + estado (o departamento escolhido não esconde as outras fatias). */
export const departmentScope = (projects: readonly Project[], filter: PanelFilter): Project[] =>
  projects.filter((p) => matchesKpi(p, filter.kpi) && (!filter.status || p.status === filter.status))

/** Para a faixa de estado: indicador + departamento (o estado escolhido não esconde os outros trechos). */
export const statusScope = (projects: readonly Project[], filter: PanelFilter): Project[] =>
  projects.filter((p) => matchesKpi(p, filter.kpi) && (!filter.area || areaKey(p) === filter.area))

/* ------------------------------------------------------------------ departamentos (pizza) */

/** Paleta categórica validada da pizza (sem azul/laranja/verde repetidos); "Sem departamento" fica cinza. */
export const PIE_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'] as const
export const PIE_NONE = '#b9bcb6'

export interface DepartmentSlice {
  /** Id da área ou 'none'. */
  key: string
  /** Nome da área; vazio em "Sem departamento" (a tela traduz). */
  name: string
  count: number
  percent: number
  color: string
}

export function departmentSlices(projects: readonly Project[]): DepartmentSlice[] {
  const byKey = new Map<string, { name: string; count: number }>()
  projects.forEach((p) => {
    const key = areaKey(p)
    const entry = byKey.get(key) ?? { name: p.area?.name ?? '', count: 0 }
    entry.count++
    byKey.set(key, entry)
  })
  const ordered = [...byKey.entries()].sort(
    (a, b) => Number(a[0] === NO_AREA) - Number(b[0] === NO_AREA) || b[1].count - a[1].count || a[1].name.localeCompare(b[1].name),
  )
  let next = 0
  return ordered.map(([key, { name, count }]) => ({
    key,
    name,
    count,
    percent: percentOf(count, projects.length),
    color: key === NO_AREA ? PIE_NONE : PIE_PALETTE[next++ % PIE_PALETTE.length]!,
  }))
}

/** Fatia como caminho SVG (centro cx,cy; raio r). Uma fatia de 100% vira círculo (o arco não fecha sozinho). */
export function pieSlicePaths(slices: readonly DepartmentSlice[], cx: number, cy: number, r: number): Array<{ key: string; d: string }> {
  const total = slices.reduce((sum, s) => sum + s.count, 0)
  if (total === 0) return []
  let angle = -Math.PI / 2
  return slices.map((slice) => {
    if (slice.count === total) return { key: slice.key, d: `M${cx - r},${cy} a${r},${r} 0 1 0 ${2 * r},0 a${r},${r} 0 1 0 ${-2 * r},0 Z` }
    const sweep = (slice.count / total) * Math.PI * 2
    const x1 = cx + r * Math.cos(angle)
    const y1 = cy + r * Math.sin(angle)
    angle += sweep
    const x2 = cx + r * Math.cos(angle)
    const y2 = cy + r * Math.sin(angle)
    return { key: slice.key, d: `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z` }
  })
}

/* ------------------------------------------------------------------ estado de execução (faixa) */

export interface StatusSlice {
  status: ProjectStatus
  count: number
  percent: number
}

/** Planejamento, em curso e pausado sempre; Concluído só quando há projetos nele. */
export function statusSlices(projects: readonly Project[]): StatusSlice[] {
  const order: ProjectStatus[] = ['planning', 'active', 'paused', 'completed']
  return order
    .map((status) => {
      const count = projects.filter((p) => p.status === status).length
      return { status, count, percent: percentOf(count, projects.length) }
    })
    .filter((slice) => slice.count > 0 || slice.status !== 'completed')
}

/** Cores das marcas por estado (sempre com o nome ao lado: a cor nunca fica sozinha). */
export const STATUS_COLORS: Record<ProjectStatus, string> = {
  planning: '#2a78d6',
  active: '#1f9d55',
  paused: '#eda100',
  completed: '#8c918a',
  cancelled: '#8c918a',
}

/* ------------------------------------------------------------------ linha do tempo (Gantt) */

const DAY_MS = 86_400_000
/** Dia "puro" (meia-noite UTC) de uma data de projeto, em milissegundos. */
const dayMs = (date: Date): number => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
/** Hoje no calendário local do navegador, como dia UTC (as datas dos projetos são dias puros). */
const todayMs = (now: Date): number => Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())

export interface GanttRow {
  project: Project
  /** Posição e largura da barra, em % da linha do tempo. */
  left: number
  width: number
  late: boolean
}

export interface GanttModel {
  rows: GanttRow[]
  /** Início de cada mês mostrado e onde ele começa na linha do tempo, em %. */
  months: Array<{ date: Date; left: number }>
  /** Posição de hoje, em %. */
  today: number
}

/** Só entram os projetos com início e entrega (o resto simplesmente não é desenhado); por entrega, a mais próxima primeiro. */
export function ganttModel(projects: readonly Project[], now: Date = new Date()): GanttModel | null {
  const dated = projects
    .filter((p): p is Project & { startDate: Date; dueDate: Date } => !!p.startDate && !!p.dueDate && dayMs(p.dueDate) >= dayMs(p.startDate))
    .sort((a, b) => dayMs(a.dueDate) - dayMs(b.dueDate) || a.name.localeCompare(b.name))
  if (dated.length === 0) return null
  const today = todayMs(now)
  const first = Math.min(today, ...dated.map((p) => dayMs(p.startDate)))
  const last = Math.max(today, ...dated.map((p) => dayMs(p.dueDate)))
  const from = new Date(first)
  from.setUTCDate(1)
  const to = new Date(last)
  to.setUTCDate(1)
  to.setUTCMonth(to.getUTCMonth() + 1)
  const span = to.getTime() - from.getTime()
  const pct = (ms: number) => Math.max(0, Math.min(100, ((ms - from.getTime()) / span) * 100))
  const months: GanttModel['months'] = []
  for (const m = new Date(from); m < to; m.setUTCMonth(m.getUTCMonth() + 1)) months.push({ date: new Date(m), left: pct(m.getTime()) })
  return {
    months,
    today: pct(today),
    rows: dated.map((project) => {
      // a barra cobre o dia inteiro da entrega
      const left = pct(dayMs(project.startDate))
      const right = pct(dayMs(project.dueDate) + DAY_MS)
      return { project, left, width: Math.max(0.8, right - left), late: isOverdue(project, now) }
    }),
  }
}

/* ------------------------------------------------------------------ tarefas por projeto */

export interface TaskBar {
  project: Project
  done: number
  open: number
  percent: number
}

/** Os projetos do filtro com mais tarefas por fazer (só os que têm tarefas contadas; nada inventado). */
export function taskBars(projects: readonly Project[], counts: readonly ProjectTaskCount[], limit = 6): TaskBar[] {
  const byProject = new Map(counts.map((c) => [c.projectId, c]))
  return projects
    .map((project) => ({ project, count: byProject.get(project.id) }))
    .filter((row): row is { project: Project; count: ProjectTaskCount } => !!row.count && row.count.done + row.count.open > 0)
    .map(({ project, count }) => ({ project, done: count.done, open: count.open, percent: percentOf(count.done, count.done + count.open) }))
    .sort((a, b) => b.open - a.open || b.done - a.done || a.project.name.localeCompare(b.project.name))
    .slice(0, limit)
}

/* ------------------------------------------------------------------ tabela */

const csv = (value: string | undefined): string[] | null => (value ? value.split(',').filter(Boolean) : null)
const intersect = <T extends string>(base: readonly T[], other: readonly string[] | null): T[] => (other ? base.filter((item) => other.includes(item)) : [...base])

/**
 * Filtros que o painel acrescenta aos da barra da tabela (Estado, Prioridade, Urgência): o servidor recebe a
 * interseção. `empty` = não existe projeto que cumpra os dois (a tabela fica vazia sem perguntar).
 */
export function tableFilters(panel: PanelFilter, bar: Record<string, string>): { filters: Record<string, string>; empty: boolean } {
  const rule = KPI_RULES[panel.kpi]
  const statuses = intersect(intersect(rule.statuses, panel.status ? [panel.status] : null), csv(bar.status))
  const priorities = rule.priorities ? intersect(rule.priorities, csv(bar.priority)) : null
  const filters: Record<string, string> = { ...bar, status: statuses.join(',') }
  if (priorities) filters.priority = priorities.join(',')
  if (panel.area) filters.area = panel.area
  return { filters, empty: statuses.length === 0 || (priorities !== null && priorities.length === 0) }
}

/* ------------------------------------------------------------------ Equipo ahora */

/** O "Equipo ahora" só com os projetos do filtro; quem fica sem nenhum projeto sai. */
export function teamInScope(team: TeamActivity | undefined, projects: readonly Project[]): TeamActivity | undefined {
  if (!team) return undefined
  const ids = new Set(projects.map((p) => p.id))
  return {
    ...team,
    people: team.people
      .map((person) => ({ ...person, projects: person.projects.filter((row) => ids.has(row.project.id)) }))
      .filter((person) => person.projects.length > 0),
  }
}

export interface ProjectWorker {
  user: UserSummary
  row: TeamActivityProject
}

/** Quem trabalhou no projeto (trabalhando agora, ativo na semana ou com tarefas abertas sem movimento). */
export function workersOf(team: TeamActivity | undefined, projectId: string): ProjectWorker[] {
  const rank = (row: TeamActivityProject) => (row.state === 'working' ? 0 : row.state === 'active' ? 1 : 2)
  const workers: ProjectWorker[] = []
  team?.people.forEach((person) =>
    person.projects.filter((row) => row.project.id === projectId).forEach((row) => workers.push({ user: person.user, row })),
  )
  return workers.sort((a, b) => rank(a.row) - rank(b.row) || b.row.recent - a.row.recent)
}

/** Tarefas recentes do projeto: as que o "+" do Equipo ahora já traz, de todas as pessoas, da mais recente à mais antiga. */
export function recentTasksOf(workers: readonly ProjectWorker[], limit = 10): TeamActivityTask[] {
  const seen = new Map<string, TeamActivityTask>()
  workers.forEach(({ row }) => row.tasks.forEach((task) => seen.set(task.id, task)))
  return [...seen.values()].sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0)).slice(0, limit)
}
