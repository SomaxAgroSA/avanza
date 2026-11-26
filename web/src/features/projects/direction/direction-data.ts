import { ganttScale, type GanttScale } from '@/domain/gantt-scale'
import { isOverdue, type Project, type ProjectPriority, type ProjectStatus, type ProjectTaskCount, type TeamActivity, type TeamActivityProject, type TeamActivityTask, type UserSummary } from '@/domain/projects'

/**
 * Vista "Direção e gerência" de Em andamento (regras §41): tudo o que o painel calcula a partir dos projetos
 * reais (lista da API), das contagens de tarefas e do "Equipo ahora". Funções puras, sem tela.
 */

export const ONGOING_STATUSES: readonly ProjectStatus[] = ['planning', 'active', 'paused']
const HIGH_PRIORITIES: readonly ProjectPriority[] = ['high', 'critical']

/** Indicadores clicáveis do topo. Ao entrar nenhum fica selecionado e o painel mostra os em andamento. */
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

/** O que o painel inteiro está filtrando: indicador (null = nenhum: os em andamento), estado (faixa) e departamento (pizza). */
export interface PanelFilter {
  kpi: KpiId | null
  status: ProjectStatus | null
  area: string | null
}

export const DEFAULT_PANEL: PanelFilter = { kpi: null, status: null, area: null }

/** Indicador que vale para o recorte: sem nenhum escolhido, os em andamento. */
export const kpiOf = (filter: Pick<PanelFilter, 'kpi'>): KpiId => filter.kpi ?? 'ongoing'

export const isPanelFiltered = (filter: PanelFilter): boolean => filter.kpi !== null || filter.status !== null || filter.area !== null

export const matchesKpi = (project: Project, kpi: KpiId): boolean => {
  const rule = KPI_RULES[kpi]
  return rule.statuses.includes(project.status) && (!rule.priorities || rule.priorities.includes(project.priority))
}

/** Indicadores sem percentual: Em andamento é a base; Finalizados fica fora do cálculo. */
const KPI_WITHOUT_PERCENT: readonly KpiId[] = ['ongoing', 'completed']

/**
 * Quantos projetos há em cada indicador e quanto isso é dos **em andamento** (planejamento + em curso +
 * pausados; percentual inteiro, base 0 = 0). Em andamento e Finalizados vêm sem percentual (null).
 */
export function kpiStats(projects: readonly Project[]): { base: number; stats: Record<KpiId, { count: number; percent: number | null }> } {
  const base = projects.filter((p) => matchesKpi(p, 'ongoing')).length
  const stats = {} as Record<KpiId, { count: number; percent: number | null }>
  KPI_IDS.forEach((kpi) => {
    const count = projects.filter((p) => matchesKpi(p, kpi)).length
    stats[kpi] = { count, percent: KPI_WITHOUT_PERCENT.includes(kpi) ? null : percentOf(count, base) }
  })
  return { base, stats }
}

export const percentOf = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0)

/** Indicador + estado + departamento: o que o Gantt, as tarefas, o Equipo ahora e a tabela mostram. */
export const panelScope = (projects: readonly Project[], filter: PanelFilter): Project[] =>
  projects.filter((p) => matchesKpi(p, kpiOf(filter)) && (!filter.status || p.status === filter.status) && (!filter.area || areaKey(p) === filter.area))

/** Para a pizza: indicador + estado (o departamento escolhido não esconde as outras fatias). */
export const departmentScope = (projects: readonly Project[], filter: PanelFilter): Project[] =>
  projects.filter((p) => matchesKpi(p, kpiOf(filter)) && (!filter.status || p.status === filter.status))

/** Para a faixa de estado: indicador + departamento (o estado escolhido não esconde os outros trechos). */
export const statusScope = (projects: readonly Project[], filter: PanelFilter): Project[] =>
  projects.filter((p) => matchesKpi(p, kpiOf(filter)) && (!filter.area || areaKey(p) === filter.area))

/* ------------------------------------------------------------------ departamentos (pizza) */

/**
 * Paleta categórica da pizza: 8 cores em ordem fixa, nunca reaproveitadas (ajuste 25/11). Com mais de 8
 * departamentos, os 7 primeiros ganham cor e o resto vai para "Outros" (cinza). "Sem departamento" fica no
 * cinza claro e não gasta cor.
 */
export const PIE_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'] as const
export const PIE_NONE = '#b9bcb6'
/** "Outros": cinza mais escuro que o de "Sem departamento", para os dois não se confundirem. */
export const PIE_OTHER = '#8c918a'
/** Chave da fatia "Outros" (não é área: abre a lista dos departamentos agrupados). */
export const OTHER_AREAS = '__other'

export interface DepartmentSlice {
  /** Id da área, 'none' ou OTHER_AREAS. */
  key: string
  /** Nome da área; vazio em "Sem departamento" e em "Outros" (a tela traduz). */
  name: string
  count: number
  percent: number
  color: string
  /** Só em "Outros": os departamentos agrupados, maior primeiro. */
  children?: DepartmentSlice[]
}

/** Projetos por área ('none' incluído), maior primeiro e, no empate, por nome. */
function countByArea(projects: readonly Project[]): Array<[string, { name: string; count: number }]> {
  const byKey = new Map<string, { name: string; count: number }>()
  projects.forEach((p) => {
    const key = areaKey(p)
    const entry = byKey.get(key) ?? { name: p.area?.name ?? '', count: 0 }
    entry.count++
    byKey.set(key, entry)
  })
  return [...byKey.entries()].sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name))
}

/**
 * Fatias da pizza de departamentos. A cor (e quem vai para "Outros") sai da ordem em `reference` — no painel,
 * os em andamento —, para a cor seguir o departamento quando o filtro muda; as contagens saem de `projects`.
 * Ordem: departamentos com cor (maior primeiro), "Outros" e, por último, "Sem departamento".
 */
export function departmentSlices(projects: readonly Project[], reference: readonly Project[] = projects): DepartmentSlice[] {
  const counted = countByArea(projects)
  // ordem das cores: a da referência; quem só existe no recorte entra depois
  const rank = countByArea(reference)
    .map(([key]) => key)
    .filter((key) => key !== NO_AREA)
  counted.forEach(([key]) => key !== NO_AREA && !rank.includes(key) && rank.push(key))
  const colored = rank.length <= PIE_PALETTE.length ? rank.length : PIE_PALETTE.length - 1
  const slice = (key: string, name: string, count: number, color: string): DepartmentSlice => ({ key, name, count, percent: percentOf(count, projects.length), color })
  const main: DepartmentSlice[] = []
  const grouped: DepartmentSlice[] = []
  let none: DepartmentSlice | null = null
  for (const [key, { name, count }] of counted) {
    const at = rank.indexOf(key)
    if (key === NO_AREA) none = slice(key, name, count, PIE_NONE)
    else if (at < colored) main.push(slice(key, name, count, PIE_PALETTE[at]!))
    else grouped.push(slice(key, name, count, PIE_OTHER))
  }
  if (grouped.length > 0) {
    const count = grouped.reduce((sum, s) => sum + s.count, 0)
    main.push({ ...slice(OTHER_AREAS, '', count, PIE_OTHER), children: grouped })
  }
  return none ? [...main, none] : main
}

const pt = (cx: number, cy: number, r: number, angle: number) => `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`

/**
 * Fatia como caminho SVG (centro cx,cy; raio r; `inner` > 0 = rosca, com furo desse raio). Uma fatia de 100%
 * vira círculo — ou anel inteiro na rosca (o furo é desenhado no sentido contrário) —, porque o arco não fecha sozinho.
 */
export function pieSlicePaths(
  slices: ReadonlyArray<{ key: string; count: number }>,
  cx: number,
  cy: number,
  r: number,
  inner = 0,
): Array<{ key: string; d: string }> {
  const total = slices.reduce((sum, s) => sum + s.count, 0)
  if (total === 0) return []
  let angle = -Math.PI / 2
  return slices.map((slice) => {
    if (slice.count === total) {
      const circle = (radius: number, sweep: 0 | 1) => `M${cx - radius},${cy} a${radius},${radius} 0 1 ${sweep} ${2 * radius},0 a${radius},${radius} 0 1 ${sweep} ${-2 * radius},0 Z`
      return { key: slice.key, d: inner > 0 ? `${circle(r, 0)} ${circle(inner, 1)}` : circle(r, 0) }
    }
    const sweep = (slice.count / total) * Math.PI * 2
    const start = angle
    angle += sweep
    const large = sweep > Math.PI ? 1 : 0
    if (inner > 0) {
      return {
        key: slice.key,
        d: `M${pt(cx, cy, r, start)} A${r},${r} 0 ${large} 1 ${pt(cx, cy, r, angle)} L${pt(cx, cy, inner, angle)} A${inner},${inner} 0 ${large} 0 ${pt(cx, cy, inner, start)} Z`,
      }
    }
    return { key: slice.key, d: `M${cx},${cy} L${pt(cx, cy, r, start)} A${r},${r} 0 ${large} 1 ${pt(cx, cy, r, angle)} Z` }
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
  /** Cabeçalho por meses (§52): os meses em cima, as segundas-feiras embaixo, o mês atual e HOJE em destaque. */
  scale: GanttScale
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
  return {
    scale: ganttScale(from.getTime(), to.getTime(), today, 'months'),
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
  const rule = KPI_RULES[kpiOf(panel)]
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
