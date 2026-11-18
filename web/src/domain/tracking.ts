/**
 * Panorama executivo (regras de negócio §26.1): a tela da direção. Os números vêm prontos do servidor
 * (GET /executive, já recortados pelos filtros); aqui ficam só as regras de apresentação — os
 * indicadores, a síntese, a tabela "Projetos que requerem atenção" e os marcos.
 *
 * Definições (as mesmas do texto de cada indicador):
 * - Pausado não é atrasado nem bloqueado: os projetos pausados ficam fora de "Bloqueios ativos" e de
 *   "Tarefas vencidas" (o trabalho está parado de propósito) e aparecem como pausados no total.
 * - Avanço real e planejado: os do fator "Avanço" da saúde do projeto (elementos de 1º nível com data,
 *   ponderados pelo esforço estimado). Só projetos com esse plano entram na média; os outros, não.
 * - Atrasado: a data-alvo passou e o projeto não está concluído, cancelado nem pausado.
 */
import type { ExecutiveAchievement, ExecutiveDashboard, ExecutivePerson, ExecutiveProjectOption, ExecutiveProjectRef, ExecutiveTimelinePoint, PortfolioRow } from './executive'
import type { ProjectStatus } from './projects'
import type { HealthLevel } from './plan-management'

const DAY_MS = 86_400_000
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, '0')
const toDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS)
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
const byKey = (a: PortfolioRow, b: PortfolioRow) => a.project.key.localeCompare(b.project.key)

/** Hoje como AAAA-MM-DD (local). */
export const todayOf = (now: Date) => toDay(now)

/* ------------------------------------------------------------------ período */

export const TRACKING_PERIODS = ['30d', '90d', 'year', 'custom'] as const
export type TrackingPeriod = (typeof TRACKING_PERIODS)[number]
export const DEFAULT_TRACKING_PERIOD: TrackingPeriod = '90d'

export function isTrackingPeriod(value: string): value is TrackingPeriod {
  return (TRACKING_PERIODS as readonly string[]).includes(value)
}

export const isDay = (value: string | null | undefined): value is string => !!value && DAY_PATTERN.test(value)

/**
 * De/até (AAAA-MM-DD, dias locais, contando hoje). Personalizado: as datas escolhidas; faltando uma
 * ou com o fim antes do início, vale o padrão (90 dias).
 */
export function trackingPeriodRange(period: TrackingPeriod, now: Date, custom?: { from: string | null; to: string | null }): { from: string; to: string } {
  const to = toDay(now)
  if (period === 'custom' && isDay(custom?.from) && isDay(custom?.to) && custom.from <= custom.to) return { from: custom.from, to: custom.to }
  if (period === 'year') return { from: `${now.getFullYear()}-01-01`, to }
  return { from: addDays(to, -(period === '30d' ? 29 : 89)), to }
}

/** Status de projeto que a tela supervisiona (os mesmos de "Em andamento"). */
export const TRACKED_STATUSES = ['planning', 'active', 'paused'] as const satisfies readonly ProjectStatus[]
/** Status a mais que entram só nas entregas do período (o que um projeto já concluído entregou). */
export const DELIVERY_ONLY_STATUSES = ['completed'] as const satisfies readonly ProjectStatus[]
const STATUS_ORDER: ProjectStatus[] = ['planning', 'active', 'paused', 'completed', 'cancelled']

/* ------------------------------------------------------------------ cada projeto */

export type TrackingSituation = 'risk' | 'watch' | 'ok' | 'none'

const SITUATION_OF: Record<HealthLevel, TrackingSituation> = { critical: 'risk', attention: 'watch', ok: 'ok', none: 'none' }

export const situationOf = (row: PortfolioRow): TrackingSituation => SITUATION_OF[row.health.level]

const isPaused = (row: PortfolioRow) => row.project.status === 'paused'

/** Dias de atraso da data-alvo (0 = em dia, sem data ou já fechado). `today` = AAAA-MM-DD. */
export function lateDays(row: PortfolioRow, today: string): number {
  const due = row.project.dueDate
  if (!due || row.project.status === 'completed' || row.project.status === 'cancelled') return 0
  return Math.max(0, dayNumber(today) - dayNumber(due))
}

/** Projeto atrasado: data-alvo vencida e não pausado. */
export const isLateProject = (row: PortfolioRow, today: string) => !isPaused(row) && lateDays(row, today) > 0
/** Tarefas bloqueadas que contam (0 para projeto pausado). */
export const activeBlocked = (row: PortfolioRow) => (isPaused(row) ? 0 : row.tasks.blocked)
/** Tarefas vencidas que contam (0 para projeto pausado). */
export const activeOverdue = (row: PortfolioRow) => (isPaused(row) ? 0 : row.tasks.overdue)

export interface PlanProgress {
  /** % real (0–100). */
  real: number
  /** % esperado pelo tempo decorrido. */
  planned: number
}

/** Avanço real × planejado do plano do projeto (fator "Avanço" da saúde); null = sem plano com datas. */
export function planProgress(row: PortfolioRow): PlanProgress | null {
  const factor = row.health.factors.find((f) => f.key === 'progress')
  if (!factor || typeof factor.planned !== 'number' || typeof factor.actual !== 'number') return null
  return { real: factor.actual, planned: factor.planned }
}

/* ------------------------------------------------------------------ indicadores */

export interface PanoramaKpis {
  supervised: { total: number; byStatus: Array<{ status: ProjectStatus; count: number }> }
  /** Médias só dos projetos com plano; `real`/`planned`/`gap` null quando nenhum tem. */
  progress: { withPlan: number; total: number; real: number | null; planned: number | null; gap: number | null }
  risk: { critical: number; attention: number }
  blocked: { projects: number; tasks: number }
  overdue: { tasks: number; lateProjects: number }
  health: Record<HealthLevel, number>
}

const mean = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) / values.length)

export function panoramaKpis(rows: PortfolioRow[], today: string): PanoramaKpis {
  const health: Record<HealthLevel, number> = { ok: 0, attention: 0, critical: 0, none: 0 }
  const statuses = new Map<ProjectStatus, number>()
  rows.forEach((row) => {
    health[row.health.level] += 1
    statuses.set(row.project.status, (statuses.get(row.project.status) ?? 0) + 1)
  })
  const plans = rows.map(planProgress).filter((p): p is PlanProgress => p !== null)
  const real = plans.length ? mean(plans.map((p) => p.real)) : null
  const planned = plans.length ? mean(plans.map((p) => p.planned)) : null
  return {
    supervised: { total: rows.length, byStatus: STATUS_ORDER.filter((s) => statuses.has(s)).map((status) => ({ status, count: statuses.get(status) ?? 0 })) },
    progress: { withPlan: plans.length, total: rows.length, real, planned, gap: real !== null && planned !== null ? real - planned : null },
    risk: { critical: health.critical, attention: health.attention },
    blocked: { projects: rows.filter((r) => activeBlocked(r) > 0).length, tasks: rows.reduce((sum, r) => sum + activeBlocked(r), 0) },
    overdue: { tasks: rows.reduce((sum, r) => sum + activeOverdue(r), 0), lateProjects: rows.filter((r) => isLateProject(r, today)).length },
    health,
  }
}

/* ------------------------------------------------------------------ síntese para a direção */

export type SynthesisFact =
  | { kind: 'risk'; count: number }
  | { kind: 'blocked'; count: number }
  | { kind: 'overdue'; count: number }
  | { kind: 'late'; count: number }
  | { kind: 'attention'; count: number }

export interface PanoramaSynthesis {
  /** Até dois fatos, do mais grave; vazio = portfólio em ordem. */
  headline: SynthesisFact[]
  ok: number
  total: number
  /** Tarefas vencidas na linha de apoio (null quando já estão no título). */
  overdueTasks: number | null
  /** Tarefas concluídas no período. */
  deliveries: number
  /** O que atacar primeiro (o fato mais grave); null = nada. */
  priority: SynthesisFact['kind'] | null
}

/**
 * Síntese gerada pelas mesmas contas dos indicadores. Ordem de gravidade: projetos em risco, tarefas
 * bloqueadas, tarefas vencidas, projetos atrasados e projetos em atenção.
 */
export function panoramaSynthesis(kpis: PanoramaKpis, deliveries: number): PanoramaSynthesis {
  const facts: SynthesisFact[] = []
  if (kpis.risk.critical > 0) facts.push({ kind: 'risk', count: kpis.risk.critical })
  if (kpis.blocked.tasks > 0) facts.push({ kind: 'blocked', count: kpis.blocked.tasks })
  if (kpis.overdue.tasks > 0) facts.push({ kind: 'overdue', count: kpis.overdue.tasks })
  if (kpis.overdue.lateProjects > 0) facts.push({ kind: 'late', count: kpis.overdue.lateProjects })
  if (kpis.risk.attention > 0) facts.push({ kind: 'attention', count: kpis.risk.attention })
  const headline = facts.slice(0, 2)
  return {
    headline,
    ok: kpis.health.ok,
    total: kpis.supervised.total,
    overdueTasks: headline.some((f) => f.kind === 'overdue') ? null : kpis.overdue.tasks,
    deliveries,
    priority: facts[0]?.kind ?? null,
  }
}

/* ------------------------------------------------------------------ projetos que requerem atenção */

/** 'attention' = o padrão (só quem pede atenção); a situação (risk, watch, ok, none) vem da rosca. */
export type PanoramaFilter = 'attention' | 'all' | TrackingSituation | 'blocked' | 'overdue'
export const PANORAMA_FILTERS = ['attention', 'all', 'risk', 'watch', 'ok', 'none', 'blocked', 'overdue'] as const satisfies readonly PanoramaFilter[]

export function isPanoramaFilter(value: string): value is PanoramaFilter {
  return (PANORAMA_FILTERS as readonly string[]).includes(value)
}

export type PanoramaCause =
  | { kind: 'health'; level: 'critical' | 'attention' }
  | { kind: 'late'; days: number }
  | { kind: 'blocked'; count: number }
  | { kind: 'overdueTasks'; count: number }
  | { kind: 'paused' }

/** O que faz o projeto pedir atenção, do mais grave; "pausado" só informa (não pede atenção sozinho). */
export function causesOf(row: PortfolioRow, today: string): PanoramaCause[] {
  const causes: PanoramaCause[] = []
  if (row.health.level === 'critical' || row.health.level === 'attention') causes.push({ kind: 'health', level: row.health.level })
  if (isLateProject(row, today)) causes.push({ kind: 'late', days: lateDays(row, today) })
  if (activeBlocked(row) > 0) causes.push({ kind: 'blocked', count: activeBlocked(row) })
  if (activeOverdue(row) > 0) causes.push({ kind: 'overdueTasks', count: activeOverdue(row) })
  if (isPaused(row)) causes.push({ kind: 'paused' })
  return causes
}

export const needsAttention = (row: PortfolioRow, today: string) => causesOf(row, today).some((c) => c.kind !== 'paused')

/** Faixa da prioridade: saúde crítica → data-alvo vencida → tarefas bloqueadas → atenção → tarefas vencidas → o resto. */
function tierOf(row: PortfolioRow, today: string): number {
  if (row.health.level === 'critical') return 0
  if (isLateProject(row, today)) return 1
  if (activeBlocked(row) > 0) return 2
  if (row.health.level === 'attention') return 3
  if (activeOverdue(row) > 0) return 4
  return 5
}

/** Linhas da tabela no filtro escolhido, na ordem de prioridade. */
export function panoramaRows(rows: PortfolioRow[], today: string, filter: PanoramaFilter): PortfolioRow[] {
  const keep = (row: PortfolioRow) => {
    if (filter === 'all') return true
    if (filter === 'attention') return needsAttention(row, today)
    if (filter === 'blocked') return activeBlocked(row) > 0
    if (filter === 'overdue') return activeOverdue(row) > 0 || isLateProject(row, today)
    return situationOf(row) === filter
  }
  return rows
    .filter(keep)
    .sort(
      (a, b) =>
        tierOf(a, today) - tierOf(b, today) ||
        lateDays(b, today) - lateDays(a, today) ||
        activeBlocked(b) - activeBlocked(a) ||
        activeOverdue(b) - activeOverdue(a) ||
        byKey(a, b),
    )
}

/* ------------------------------------------------------------------ marcos */

export type MilestoneState = 'overdue' | 'soon' | 'planned'

export interface PanoramaMilestone {
  id: string
  name: string
  /** AAAA-MM-DD */
  date: string
  project: ExecutiveProjectRef
  /** Responsável do projeto (o marco não tem responsável próprio). */
  owner: ExecutivePerson | null
  state: MilestoneState
  /** Vencido: dias de atraso; senão, dias até a data (0 = hoje). */
  days: number
}

/** Marcos vencidos e os dos próximos 30 dias dos projetos na tela, em ordem de data. Perto = até `soonDays` dias. */
export function panoramaMilestones(plan: ExecutiveDashboard['plan'], rows: PortfolioRow[], today: string, soonDays = 7): PanoramaMilestone[] {
  if (!plan) return []
  const byId = new Map(rows.map((r) => [r.project.id, r]))
  return [...plan.overdueMilestones, ...plan.upcomingMilestones]
    .filter((m, i, all) => byId.has(m.project.id) && all.findIndex((other) => other.id === m.id) === i)
    .map((m) => {
      const diff = dayNumber(m.dueDate) - dayNumber(today)
      const state: MilestoneState = diff < 0 ? 'overdue' : diff <= soonDays ? 'soon' : 'planned'
      return { id: m.id, name: m.name, date: m.dueDate, project: m.project, owner: byId.get(m.project.id)?.project.owner ?? null, state, days: Math.abs(diff) }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.project.key.localeCompare(b.project.key) || a.name.localeCompare(b.name))
}

/* ------------------------------------------------------------------ entregas no período */

export interface DeliveryBucket {
  /** AAAA-MM-DD (início da semana ou do mês). */
  start: string
  tasks: number
  /** Marcos concluídos com data nesse balde. */
  milestones: number
}

/** Tarefas concluídas por balde da série e, quando há, os marcos concluídos (pela data do marco). */
export function deliveryBuckets(points: ExecutiveTimelinePoint[], achievements: ExecutiveAchievement[]): DeliveryBucket[] {
  const buckets = points.map((p) => ({ start: p.start, tasks: p.tasksCompleted, milestones: 0 }))
  achievements.forEach((a) =>
    a.milestonesDone.forEach((m) => {
      if (!m.dueDate) return
      const date = m.dueDate
      const bucket = buckets.filter((b) => b.start <= date).at(-1)
      if (bucket) bucket.milestones += 1
    }),
  )
  return buckets
}

/* ------------------------------------------------------------------ opções dos filtros */

export interface PanoramaScope {
  areaId: string
  ownerId: string
  projectId: string
}

export interface PanoramaOptions {
  areas: Array<{ id: string; name: string }>
  /** Há projeto supervisionado sem área (opção "Sem área"). */
  withoutArea: boolean
  owners: Array<{ id: string; name: string }>
  /** Projetos da área e do responsável escolhidos. */
  projects: Array<{ id: string; key: string; name: string }>
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

/** Opções dos filtros: os projetos supervisionados (não arquivados, nos status acompanhados). */
export function panoramaOptions(catalog: ExecutiveProjectOption[], scope: Pick<PanoramaScope, 'areaId' | 'ownerId'>): PanoramaOptions {
  const tracked = catalog.filter((p) => !p.archived && !!p.status && (TRACKED_STATUSES as readonly string[]).includes(p.status))
  const areas = new Map<string, string>()
  const owners = new Map<string, string>()
  tracked.forEach((p) => {
    if (p.area) areas.set(p.area.id, p.area.name)
    if (p.owner) owners.set(p.owner.id, p.owner.name)
  })
  const inScope = (p: ExecutiveProjectOption) =>
    (!scope.areaId || (scope.areaId === 'none' ? !p.area : p.area?.id === scope.areaId)) && (!scope.ownerId || p.owner?.id === scope.ownerId)
  return {
    areas: [...areas].map(([id, name]) => ({ id, name })).sort(byName),
    withoutArea: tracked.some((p) => !p.area),
    owners: [...owners].map(([id, name]) => ({ id, name })).sort(byName),
    projects: tracked
      .filter(inScope)
      .map((p) => ({ id: p.id, key: p.key, name: p.name }))
      .sort(byName),
  }
}
