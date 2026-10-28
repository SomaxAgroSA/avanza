/**
 * Timeline do projeto (expansão, Onda 1). Regras de datas espelham backend/src/domain/timeline.js;
 * o resto é a geometria da tela (dias inteiros, escala por zoom, grupos e régua).
 *
 * Dias são números (dias desde 1970-01-01 em UTC): as datas da API são "dia puro" (meia-noite UTC),
 * então somar/subtrair dias não sofre com horário de verão nem fuso.
 */
import type { Sprint, SprintRef } from './sprints'
import type { TaskSummary } from './tasks'

const DAY_MS = 24 * 3600 * 1000

export const MILESTONE_STATES = ['pending', 'done'] as const
export type MilestoneState = (typeof MILESTONE_STATES)[number]

/** Marco do projeto (entrega-chave). */
export interface Milestone {
  id: string
  projectId: string
  name: string
  description: string
  /** AAAA-MM-DD */
  dueDate: string
  state: MilestoneState
  createdAt: Date | null
  updatedAt: Date | null
}

export interface MilestoneInput {
  name?: string
  description?: string
  /** AAAA-MM-DD */
  dueDate?: string
  state?: MilestoneState
}

/** Seta "vem antes → vem depois" (bloqueia / depende de); `conflict` = começa antes do prazo da anterior. */
export interface TimelineDependency {
  id: string
  type: 'blocks' | 'depends_on'
  from: string
  to: string
  conflict: boolean
}

export interface Timeline {
  project: { id: string; key: string; name: string; startDate: Date | null; dueDate: Date | null; archived: boolean }
  /** `edit` = mover barras; `manageMilestones` = gestor do projeto. */
  capabilities: { edit: boolean; manageMilestones: boolean }
  tasks: TaskSummary[]
  dependencies: TimelineDependency[]
  milestones: Milestone[]
  sprints: Sprint[]
  truncated: boolean
}

export const TIMELINE_ZOOMS = ['day', 'week', 'month', 'quarter'] as const
export type TimelineZoom = (typeof TIMELINE_ZOOMS)[number]
/** Largura de um dia (px) em cada zoom. */
export const PX_PER_DAY: Record<TimelineZoom, number> = { day: 40, week: 18, month: 6, quarter: 2.5 }

export const TIMELINE_GROUPS = ['none', 'sprint', 'assignee', 'status', 'type'] as const
export type TimelineGroupBy = (typeof TIMELINE_GROUPS)[number]

export interface DaySpan {
  start: number
  end: number
}

export const dayOf = (date: Date): number => Math.floor(date.getTime() / DAY_MS)
export const dayFromIso = (iso: string): number => dayOf(new Date(`${iso.slice(0, 10)}T00:00:00.000Z`))
export const isoFromDay = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10)
export const dateFromDay = (day: number): Date => new Date(day * DAY_MS)
/** "Hoje" no calendário de quem está vendo. */
export const todayOf = (now: Date): number => dayOf(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())))
/** 0 = domingo … 6 = sábado. */
export const weekdayOf = (day: number): number => new Date(day * DAY_MS).getUTCDay()

/** Período da barra: início→prazo; só uma das datas = um dia; nenhuma = sem datas (null). */
export function taskSpan(task: Pick<TaskSummary, 'startDate' | 'dueDate'>): DaySpan | null {
  const start = task.startDate ? dayOf(task.startDate) : null
  const end = task.dueDate ? dayOf(task.dueDate) : null
  if (start === null && end === null) return null
  return { start: start ?? (end as number), end: end ?? (start as number) }
}

/** A tarefa `after` começa antes do prazo de `before` (de que ela depende)? */
export function isConflict(before: DaySpan | null, after: DaySpan | null): boolean {
  if (!before || !after) return false
  return after.start < before.end
}

export function barBox(span: DaySpan, rangeStart: number, pxPerDay: number): { left: number; width: number } {
  return { left: (span.start - rangeStart) * pxPerDay, width: (span.end - span.start + 1) * pxPerDay }
}

export const daysFromPixels = (px: number, pxPerDay: number): number => Math.round(px / pxPerDay)

/** Arrastar (`move`) ou puxar uma ponta (`start`/`end`); a ponta não passa da outra. */
export function shiftSpan(span: DaySpan, delta: number, edge: 'move' | 'start' | 'end'): DaySpan {
  if (edge === 'move') return { start: span.start + delta, end: span.end + delta }
  if (edge === 'start') return { start: Math.min(span.start + delta, span.end), end: span.end }
  return { start: span.start, end: Math.max(span.end + delta, span.start) }
}

/** Tarefa sem datas solta num dia: dura pela estimativa (8 h por dia; mínimo 1 dia). */
export function dropSpan(day: number, estimatedHours: number | null): DaySpan {
  const days = Math.max(1, Math.ceil((estimatedHours ?? 0) / 8))
  return { start: day, end: day + days - 1 }
}

/** Período exibido: das datas de interesse (e hoje) com 1 semana antes e 3 depois; mínimo 6 semanas. */
export function timelineRange(days: number[], today: number): DaySpan {
  const all = days.concat(today)
  let start = Math.min(...all) - 7
  let end = Math.max(...all) + 21
  const MIN = 42
  if (end - start + 1 < MIN) {
    const missing = MIN - (end - start + 1)
    start -= Math.floor(missing / 3)
    end += missing - Math.floor(missing / 3)
  }
  return { start, end }
}

export interface TimelineGroup {
  key: string
  tasks: TaskSummary[]
}

const CATEGORY_ORDER = ['backlog', 'todo', 'in_progress', 'done', 'cancelled']

/** Dentro do grupo: pelo início (sem datas por último), depois pelo número. */
function byStart(a: TaskSummary, b: TaskSummary): number {
  const sa = taskSpan(a)?.start ?? Number.MAX_SAFE_INTEGER
  const sb = taskSpan(b)?.start ?? Number.MAX_SAFE_INTEGER
  return sa - sb || a.number - b.number
}

/** Grupos da timeline; "sem valor" (sem sprint, sem responsável…) sempre por último. */
export function groupTimelineTasks(tasks: TaskSummary[], groupBy: TimelineGroupBy, sprints: SprintRef[]): TimelineGroup[] {
  if (groupBy === 'none') return [{ key: 'all', tasks: [...tasks].sort(byStart) }]
  const keyOf = (t: TaskSummary): string => {
    if (groupBy === 'sprint') return t.sprint?.id ?? 'none'
    if (groupBy === 'assignee') return t.assignee?.id ?? 'none'
    if (groupBy === 'status') return t.status?.id ?? 'none'
    return t.type?.id ?? 'none'
  }
  const buckets = new Map<string, TaskSummary[]>()
  tasks.forEach((t) => {
    const key = keyOf(t)
    buckets.set(key, [...(buckets.get(key) ?? []), t])
  })
  const sample = (key: string) => buckets.get(key)?.[0]
  const rank = (key: string): [number, string] => {
    if (key === 'none') return [Number.MAX_SAFE_INTEGER, '']
    if (groupBy === 'sprint') {
      const index = sprints.findIndex((s) => s.id === key)
      return [index < 0 ? sprints.length : index, sample(key)?.sprint?.name ?? '']
    }
    if (groupBy === 'status') {
      const status = sample(key)?.status
      return [CATEGORY_ORDER.indexOf(status?.category ?? ''), status?.name ?? '']
    }
    const name = groupBy === 'assignee' ? sample(key)?.assignee?.name : sample(key)?.type?.name
    return [0, name ?? '']
  }
  return [...buckets.keys()]
    .sort((a, b) => {
      const [ra, na] = rank(a)
      const [rb, nb] = rank(b)
      return ra - rb || na.localeCompare(nb)
    })
    .map((key) => ({ key, tasks: (buckets.get(key) ?? []).sort(byStart) }))
}

export interface HeaderSegment {
  start: number
  end: number
}

/** Corta [start, end] em pedaços que começam em `isBoundary` (o primeiro pode ser parcial). */
function segments(range: DaySpan, isBoundary: (day: number) => boolean): HeaderSegment[] {
  const out: HeaderSegment[] = []
  let current = range.start
  for (let day = range.start + 1; day <= range.end + 1; day++) {
    if (day === range.end + 1 || isBoundary(day)) {
      out.push({ start: current, end: day - 1 })
      current = day
    }
  }
  return out
}

const isMonthStart = (day: number) => new Date(day * DAY_MS).getUTCDate() === 1
const isYearStart = (day: number) => {
  const date = new Date(day * DAY_MS)
  return date.getUTCDate() === 1 && date.getUTCMonth() === 0
}

/** Régua: faixa de cima e de baixo conforme o zoom (dias/semanas/meses; meses/anos). */
export function headerTiers(range: DaySpan, zoom: TimelineZoom): { top: HeaderSegment[]; bottom: HeaderSegment[] } {
  if (zoom === 'day') return { top: segments(range, isMonthStart), bottom: segments(range, () => true) }
  if (zoom === 'week') return { top: segments(range, isMonthStart), bottom: segments(range, (day) => weekdayOf(day) === 1) }
  return { top: segments(range, isYearStart), bottom: segments(range, isMonthStart) }
}
