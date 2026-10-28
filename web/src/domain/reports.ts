/**
 * Relatórios e indicadores (espelha backend/src/domain/report.js).
 * O período é sempre explícito: atalhos viram datas locais (início do primeiro dia até o fim do
 * último), e o fuso (getTimezoneOffset) vai junto para o servidor contar "hoje" e os dias da série.
 */
import type { OptionColor, TaskTypeIcon } from './task-config'
import type { StatusCategory } from './workflow'
import type { TaskSummary } from './tasks'
import type { UserSummary } from './projects'

export const REPORT_DIMENSIONS = ['status', 'priority', 'type', 'assignee', 'project'] as const
export type ReportDimension = (typeof REPORT_DIMENSIONS)[number]

/**
 * Indicadores que abrem o detalhamento (as tarefas por trás do número). O servidor usa a mesma
 * regra da contagem, então a lista sempre bate com o card.
 */
export const REPORT_METRICS = [
  'open',
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'overdue',
  'critical_bugs',
  'created',
  'completed',
  'cancelled',
  'lead_time',
  'cycle_time',
  'bug_resolution',
] as const
export type ReportMetric = (typeof REPORT_METRICS)[number]

/** Indicadores de tempo: no detalhamento, cada tarefa mostra a própria duração. */
export function isTimeMetric(metric: ReportMetric): boolean {
  return metric === 'lead_time' || metric === 'cycle_time' || metric === 'bug_resolution'
}

/** Indicadores do período (dependem das datas); os demais são a situação de agora. */
export function isPeriodMetric(metric: ReportMetric): boolean {
  return isTimeMetric(metric) || metric === 'created' || metric === 'completed' || metric === 'cancelled'
}

/** Tarefa do detalhamento; `metricHours` = duração nos indicadores de tempo. */
export interface ReportTask extends TaskSummary {
  metricHours: number | null
}

export const PERIOD_PRESETS = ['7d', '30d', '90d', 'month', 'custom'] as const
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]

export interface Duration {
  /** Média em horas (null = sem amostra). */
  hours: number | null
  count: number
}

export interface ReportIndicators {
  total: number
  open: number
  backlog: number
  todo: number
  inProgress: number
  blocked: number
  overdue: number
  criticalBugs: number
  created: number
  completed: number
  cancelled: number
  leadTime: Duration
  cycleTime: Duration
  bugResolution: Duration
}

export type BreakdownLabel =
  | { kind: 'status'; id: string; name: string; color: OptionColor; category: StatusCategory }
  | { kind: 'priority'; id: string; name: string; color: OptionColor }
  | { kind: 'type'; id: string; name: string; icon: TaskTypeIcon; color: OptionColor }
  | { kind: 'assignee'; user: UserSummary }
  | { kind: 'project'; id: string; key: string; name: string }

export interface BreakdownRow {
  key: string
  /** null = sem valor (ex.: sem responsável) ou item removido. */
  label: BreakdownLabel | null
  total: number
  open: number
  overdue: number
  blocked: number
  created: number
  completed: number
  leadTime: Duration
}

export interface Report {
  period: { from: Date; to: Date; tzOffset: number }
  generatedAt: Date
  definitions: { bugTypes: Array<{ id: string; name: string }>; criticalPriority: { id: string; name: string } | null }
  indicators: ReportIndicators
  series: { bucket: 'day' | 'week'; points: Array<{ date: string; created: number; completed: number }> }
  breakdown: { dimension: ReportDimension; rows: BreakdownRow[] }
  overdueTasks: TaskSummary[]
}

export interface ReportFilters {
  projectId?: string
  /** id | 'me' | 'none' */
  assigneeId?: string
  typeId?: string
  priorityId?: string
  statusId?: string
}

export interface ReportQuery extends ReportFilters {
  from: Date
  to: Date
  tzOffset: number
  groupBy: ReportDimension
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)

/** Dia local (AAAA-MM-DD) -> Date local. */
function parseDay(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

/** Datas do período (início do primeiro dia até o fim do último, no fuso local). */
export function periodRange(preset: PeriodPreset, now: Date, custom?: { from: string; to: string }): { from: Date; to: Date } | null {
  if (preset === 'custom') {
    const from = custom ? parseDay(custom.from) : null
    const to = custom ? parseDay(custom.to) : null
    if (!from || !to || to < from) return null
    return { from: startOfDay(from), to: endOfDay(to) }
  }
  if (preset === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
  return { from: startOfDay(first), to: endOfDay(now) }
}

/** Tempo legível: horas até 48 h; depois, dias (1 casa). */
export function durationParts(hours: number | null): { value: number; unit: 'hours' | 'days' } | null {
  if (hours === null) return null
  if (hours < 48) return { value: Math.round(hours * 10) / 10, unit: 'hours' }
  return { value: Math.round((hours / 24) * 10) / 10, unit: 'days' }
}

/** Percentual de concluídas sobre (concluídas + abertas) — usado nas barras do recorte. */
export const share = (value: number, max: number) => (max > 0 ? Math.round((value / max) * 100) : 0)
