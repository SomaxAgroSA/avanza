/**
 * Seguimento de projetos: a tela única da gerência (junta o Painel executivo e os Relatórios). Os
 * números vêm prontos do servidor (GET /executive); aqui ficam só as regras de apresentação — a
 * situação de cada projeto, o que pede decisão, os agrupamentos da carteira e as próximas entregas.
 *
 * - Atrasado: a data-alvo passou e o projeto não está concluído nem cancelado.
 * - Bloqueado: pausado ou com alguma tarefa aberta bloqueada (regra provisória, a confirmar).
 * - Situação: a saúde do quadro de Gestão em palavras claras (em risco, vigiar, em ordem, sem plano).
 */
import type { ExecutiveDashboard, PortfolioRow } from './executive'
import type { ProjectPriority, ProjectStatus } from './projects'
import type { HealthLevel } from './plan-management'

const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')
const toDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS)
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

/* ------------------------------------------------------------------ período do bloco "trabalho do equipe" */

export const TRACKING_PERIODS = ['30d', '90d', 'year'] as const
export type TrackingPeriod = (typeof TRACKING_PERIODS)[number]
export const DEFAULT_TRACKING_PERIOD: TrackingPeriod = '90d'

export function isTrackingPeriod(value: string): value is TrackingPeriod {
  return (TRACKING_PERIODS as readonly string[]).includes(value)
}

/** De/até (AAAA-MM-DD, dias locais, contando hoje). */
export function trackingPeriodRange(period: TrackingPeriod, now: Date): { from: string; to: string } {
  const to = toDay(now)
  if (period === 'year') return { from: `${now.getFullYear()}-01-01`, to }
  return { from: addDays(to, -(period === '30d' ? 29 : 89)), to }
}

/** Status de projeto que a tela acompanha (os mesmos de "Projetos ativos"). */
export const TRACKED_STATUSES = ['planning', 'active', 'paused'] as const satisfies readonly ProjectStatus[]

/* ------------------------------------------------------------------ situação de cada projeto */

export type TrackingSituation = 'risk' | 'watch' | 'ok' | 'none'

const SITUATION_OF: Record<HealthLevel, TrackingSituation> = { critical: 'risk', attention: 'watch', ok: 'ok', none: 'none' }
const SITUATION_RANK: Record<TrackingSituation, number> = { risk: 0, watch: 1, ok: 2, none: 3 }
const PRIORITY_RANK: Record<ProjectPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const STATUS_RANK: Record<string, number> = { active: 0, planning: 1, paused: 2, completed: 3, cancelled: 4 }

export const situationOf = (row: PortfolioRow): TrackingSituation => SITUATION_OF[row.health.level]

/** Dias de atraso da data-alvo (0 = em dia, sem data ou já fechado). `today` = AAAA-MM-DD. */
export function lateDays(row: PortfolioRow, today: string): number {
  const due = row.project.dueDate
  if (!due || row.project.status === 'completed' || row.project.status === 'cancelled') return 0
  return Math.max(0, dayNumber(today) - dayNumber(due))
}

export const isBlocked = (row: PortfolioRow): boolean => row.project.status === 'paused' || row.tasks.blocked > 0

export interface TrackingSummary {
  active: number
  late: number
  blocked: number
  risk: number
}

export function trackingSummary(rows: PortfolioRow[], today: string): TrackingSummary {
  return {
    active: rows.length,
    late: rows.filter((r) => lateDays(r, today) > 0).length,
    blocked: rows.filter(isBlocked).length,
    risk: rows.filter((r) => situationOf(r) === 'risk').length,
  }
}

/* ------------------------------------------------------------------ filtros */

export type TrackingFilter = 'late' | 'blocked' | 'risk'

export function applyTrackingFilter(rows: PortfolioRow[], filter: TrackingFilter | null, today: string): PortfolioRow[] {
  if (filter === 'late') return rows.filter((r) => lateDays(r, today) > 0)
  if (filter === 'blocked') return rows.filter(isBlocked)
  if (filter === 'risk') return rows.filter((r) => situationOf(r) === 'risk')
  return rows
}

/** Departamento e responsável escolhidos no topo ('none' = sem área / sem responsável; '' = todos). */
export function scopeRows(rows: PortfolioRow[], scope: { areaId: string; ownerId: string }): PortfolioRow[] {
  return rows.filter(
    (r) =>
      (!scope.areaId || (scope.areaId === 'none' ? !r.project.area : r.project.area?.id === scope.areaId)) &&
      (!scope.ownerId || (scope.ownerId === 'none' ? !r.project.owner : r.project.owner?.id === scope.ownerId)),
  )
}

/** Opções do filtro (departamentos ou responsáveis presentes na carteira), em ordem alfabética. */
export function scopeOptions(rows: PortfolioRow[], kind: 'area' | 'owner'): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>()
  rows.forEach((r) => {
    const item = kind === 'area' ? r.project.area : r.project.owner
    if (item) seen.set(item.id, item.name)
  })
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/* ------------------------------------------------------------------ o que pede decisão */

export type DecisionReason = { kind: 'late'; days: number } | { kind: 'paused' } | { kind: 'blockedTasks'; count: number } | { kind: 'risk' }

export interface DecisionItem {
  row: PortfolioRow
  reasons: DecisionReason[]
}

/** Projetos atrasados, bloqueados ou em risco: por prioridade, depois o maior atraso. */
export function decisionItems(rows: PortfolioRow[], today: string, limit = 8): DecisionItem[] {
  return rows
    .map((row) => {
      const reasons: DecisionReason[] = []
      const late = lateDays(row, today)
      if (late > 0) reasons.push({ kind: 'late', days: late })
      if (row.project.status === 'paused') reasons.push({ kind: 'paused' })
      if (row.tasks.blocked > 0) reasons.push({ kind: 'blockedTasks', count: row.tasks.blocked })
      if (situationOf(row) === 'risk') reasons.push({ kind: 'risk' })
      return { row, reasons }
    })
    .filter((item) => item.reasons.length > 0)
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.row.project.priority] - PRIORITY_RANK[b.row.project.priority] ||
        lateDays(b.row, today) - lateDays(a.row, today) ||
        a.row.project.key.localeCompare(b.row.project.key),
    )
    .slice(0, limit)
}

/* ------------------------------------------------------------------ carteira agrupada */

export const TRACKING_GROUPS = ['priority', 'area', 'owner', 'status'] as const
export type TrackingGroup = (typeof TRACKING_GROUPS)[number]

export interface PortfolioGroup {
  /** Prioridade/status (chave para traduzir), id da área/pessoa ou 'none'. */
  key: string
  /** Nome da área/pessoa (vazio para prioridade, status e 'none'). */
  name: string
  rows: PortfolioRow[]
  late: number
}

/** Dentro do grupo: em risco primeiro, depois o maior atraso, depois a data-alvo mais próxima. */
export function sortPortfolio(rows: PortfolioRow[], today: string): PortfolioRow[] {
  return rows
    .slice()
    .sort(
      (a, b) =>
        SITUATION_RANK[situationOf(a)] - SITUATION_RANK[situationOf(b)] ||
        lateDays(b, today) - lateDays(a, today) ||
        (a.project.dueDate ?? '9999').localeCompare(b.project.dueDate ?? '9999') ||
        a.project.key.localeCompare(b.project.key),
    )
}

export function groupPortfolio(rows: PortfolioRow[], by: TrackingGroup, today: string): PortfolioGroup[] {
  const groups = new Map<string, PortfolioGroup>()
  rows.forEach((row) => {
    const person = by === 'area' ? row.project.area : by === 'owner' ? row.project.owner : null
    const key = by === 'priority' ? row.project.priority : by === 'status' ? row.project.status : (person?.id ?? 'none')
    const group = groups.get(key) ?? { key, name: person?.name ?? '', rows: [], late: 0 }
    group.rows.push(row)
    if (lateDays(row, today) > 0) group.late += 1
    groups.set(key, group)
  })
  const rank = (g: PortfolioGroup) =>
    by === 'priority' ? PRIORITY_RANK[g.key as ProjectPriority] : by === 'status' ? (STATUS_RANK[g.key] ?? 9) : g.key === 'none' ? 1 : 0
  return [...groups.values()]
    .map((g) => ({ ...g, rows: sortPortfolio(g.rows, today) }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/* ------------------------------------------------------------------ próximas entregas */

export interface UpcomingDelivery {
  /** AAAA-MM-DD */
  date: string
  kind: 'milestone' | 'due'
  /** Nome do marco (vazio para a data-alvo do projeto). */
  name: string
  row: PortfolioRow
}

/** Marcos e datas-alvo de projetos nos próximos `days` dias (hoje incluído), por data. */
export function upcomingDeliveries(data: Pick<ExecutiveDashboard, 'plan' | 'portfolio'>, rows: PortfolioRow[], today: string, days = 30): UpcomingDelivery[] {
  const limit = addDays(today, days)
  const inWindow = (day: string | null): day is string => !!day && day >= today && day <= limit
  const byId = new Map(rows.map((r) => [r.project.id, r]))
  const list: UpcomingDelivery[] = []
  ;(data.plan?.upcomingMilestones ?? []).forEach((m) => {
    const row = byId.get(m.project.id)
    if (row && inWindow(m.dueDate)) list.push({ date: m.dueDate, kind: 'milestone', name: m.name, row })
  })
  rows.forEach((row) => {
    if (inWindow(row.project.dueDate)) list.push({ date: row.project.dueDate, kind: 'due', name: '', row })
  })
  return list.sort((a, b) => a.date.localeCompare(b.date) || a.row.project.key.localeCompare(b.row.project.key))
}

/** Hoje como AAAA-MM-DD (local). */
export const todayOf = (now: Date) => toDay(now)
