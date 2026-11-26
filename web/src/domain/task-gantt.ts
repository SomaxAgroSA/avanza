import type { DemandStatus } from './demands'
import type { UserSummary } from './projects'
import type { TaskSummary } from './tasks'

/**
 * Linha do tempo das tarefas da Caixa de entrada (ajuste 25/11, opção B aprovada em demonstração): um Gantt das
 * tarefas do filtro/caixa atual, agrupado por pessoa (Atribuída a) ou por projeto. Cada barra vai do início
 * planejado (sem ele, a abertura da tarefa) até o prazo; sem prazo, a tarefa não entra (fica na Lista). As
 * concluídas não entram. Só cálculo: cores e textos ficam na tela.
 */

export const GANTT_GROUP_BY = ['person', 'project'] as const
export type GanttGroupBy = (typeof GANTT_GROUP_BY)[number]
export const toGanttGroupBy = (value: unknown): GanttGroupBy => (GANTT_GROUP_BY.includes(value as GanttGroupBy) ? (value as GanttGroupBy) : 'person')

export interface TaskGanttRow {
  task: TaskSummary
  step: Exclude<DemandStatus, 'done'>
  /** Começo da barra (dia, meia-noite UTC). */
  start: Date
  /** Prazo com hora (fluxo do responsável) ou null quando o prazo é só o dia. */
  dueAt: Date | null
  /** Dia do prazo (meia-noite UTC). */
  dueDay: Date
  /** Posição e largura da barra, em % da linha do tempo. */
  left: number
  width: number
  /** Prazo já passou. */
  late: boolean
}

export interface TaskGanttGroup {
  /** Id da pessoa ou do projeto; '' = sem atribuir / demanda interna (sem projeto). */
  key: string
  person: UserSummary | null
  project: { id: string; name: string } | null
  rows: TaskGanttRow[]
  /** Horas estimadas das tarefas do grupo. */
  hours: number
}

export interface TaskGanttModel {
  groups: TaskGanttGroup[]
  /** Marcas do eixo (segundas-feiras ou, numa janela longa, o dia 1 de cada mês), em %. */
  ticks: Array<{ date: Date; left: number }>
  monthly: boolean
  /** Posição de hoje, em %. */
  today: number
}

const DAY_MS = 86_400_000
/** Janela acima disso marca os meses, não as semanas. */
const WEEKLY_LIMIT_DAYS = 120

/** Dia puro (já vem como meia-noite UTC). */
const pureDay = (date: Date): number => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
/** Dia no calendário de quem olha (datas com hora), como meia-noite UTC. */
const localDay = (date: Date): number => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())

/** Prazo da tarefa: o do fluxo (data e hora) ou o dia de entrega; null = sem prazo. */
function deadlineOf(task: TaskSummary, now: Date): { day: number; dueAt: Date | null; late: boolean } | null {
  const dueAt = task.demand?.dueAt ?? null
  if (dueAt) return { day: localDay(dueAt), dueAt, late: dueAt.getTime() < now.getTime() }
  if (task.dueDate) return { day: pureDay(task.dueDate), dueAt: null, late: pureDay(task.dueDate) < localDay(now) }
  return null
}

const isOpen = (task: TaskSummary): task is TaskSummary & { demand: { status: Exclude<DemandStatus, 'done'> } } => !!task.demand && task.demand.status !== 'done'

export function taskGantt(tasks: readonly TaskSummary[], groupBy: GanttGroupBy, now: Date = new Date()): { model: TaskGanttModel | null; undated: number } {
  const open = tasks.filter(isOpen)
  const dated = open.flatMap((task) => {
    const deadline = deadlineOf(task, now)
    if (!deadline) return []
    const begin = task.startDate ? pureDay(task.startDate) : task.createdAt ? localDay(task.createdAt) : deadline.day
    return [{ task, deadline, start: Math.min(begin, deadline.day) }]
  })
  const undated = open.length - dated.length
  if (dated.length === 0) return { model: null, undated }

  const today = localDay(now)
  const first = Math.min(today, ...dated.map((d) => d.start))
  const last = Math.max(today, ...dated.map((d) => d.deadline.day)) + DAY_MS
  const monthly = (last - first) / DAY_MS > WEEKLY_LIMIT_DAYS
  let from: number
  let to: number
  const ticks: number[] = []
  if (monthly) {
    const start = new Date(first)
    from = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
    const end = new Date(last - 1)
    to = Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1)
    for (let m = new Date(from); m.getTime() < to; m.setUTCMonth(m.getUTCMonth() + 1)) ticks.push(m.getTime())
  } else {
    // semanas de segunda a domingo
    from = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY_MS
    to = last + ((7 - ((new Date(last).getUTCDay() + 6) % 7)) % 7) * DAY_MS
    for (let w = from; w < to; w += 7 * DAY_MS) ticks.push(w)
  }
  const span = to - from
  const pct = (ms: number) => Math.max(0, Math.min(100, ((ms - from) / span) * 100))

  const byKey = new Map<string, TaskGanttGroup>()
  for (const { task, deadline, start } of dated) {
    const key = groupBy === 'person' ? (task.assignee?.id ?? '') : (task.project?.id ?? '')
    let group = byKey.get(key)
    if (!group) {
      group = {
        key,
        person: groupBy === 'person' ? task.assignee : null,
        project: groupBy === 'project' && task.project ? { id: task.project.id, name: task.project.name } : null,
        rows: [],
        hours: 0,
      }
      byKey.set(key, group)
    }
    const left = pct(start)
    group.hours += task.estimatedHours ?? 0
    group.rows.push({
      task,
      step: task.demand.status,
      start: new Date(start),
      dueAt: deadline.dueAt,
      dueDay: new Date(deadline.day),
      left,
      width: Math.max(0.8, pct(deadline.day + DAY_MS) - left),
      late: deadline.late,
    })
  }
  const nameOf = (group: TaskGanttGroup) => group.person?.name ?? group.project?.name ?? ''
  const groups = [...byKey.values()]
    // sem atribuir / demanda interna por último
    .sort((a, b) => Number(a.key === '') - Number(b.key === '') || nameOf(a).localeCompare(nameOf(b)))
  for (const group of groups) {
    group.rows.sort((a, b) => a.dueDay.getTime() - b.dueDay.getTime() || (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0) || a.task.title.localeCompare(b.task.title))
  }
  return { model: { groups, monthly, today: pct(today + DAY_MS / 2), ticks: ticks.map((ms) => ({ date: new Date(ms), left: pct(ms) })) }, undated }
}

/**
 * Coluna dos títulos da linha do tempo (ajuste aprovado em demonstração, 26/11, §50): sempre abre "estendida" —
 * a largura automática acompanha o título mais longo (numa linha, até o limite; o que passar quebra em até duas
 * linhas), entre `GANTT_LABEL_MIN` e o menor de `GANTT_LABEL_MAX` e `GANTT_LABEL_SHARE` da largura. O divisor deixa
 * a pessoa escolher outra largura (de `GANTT_LABEL_MIN` até sobrar `GANTT_BARS_MIN` para as barras).
 */
export const GANTT_LABEL_MIN = 200
export const GANTT_LABEL_MAX = 480
export const GANTT_LABEL_SHARE = 0.4
export const GANTT_BARS_MIN = 260
/** Passo das setas ← → no divisor. */
export const GANTT_LABEL_STEP = 20
/** Largura média de um caractere do título (12px) e a folga da coluna. */
const CHAR_PX = 6.6
const LABEL_PADDING = 16

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

/** Largura automática da coluna dos títulos; `available` = largura da linha do tempo (0 = ainda sem medida). */
export function autoLabelWidth(titles: readonly string[], available: number): number {
  const longest = titles.reduce((max, title) => Math.max(max, title.trim().length), 0)
  const wanted = Math.ceil(longest * CHAR_PX + LABEL_PADDING)
  const cap = available > 0 ? Math.min(GANTT_LABEL_MAX, Math.round(available * GANTT_LABEL_SHARE)) : GANTT_LABEL_MAX
  return clamp(wanted, GANTT_LABEL_MIN, cap)
}

/** Largura escolhida pela pessoa dentro dos limites (sobra ao menos `GANTT_BARS_MIN` para as barras). */
export function clampLabelWidth(width: number, available: number): number {
  const max = available > 0 ? available - GANTT_BARS_MIN : Number.POSITIVE_INFINITY
  return Math.round(clamp(width, GANTT_LABEL_MIN, max))
}

/** Largura guardada no navegador: número positivo ou null (= automática). */
export const toLabelWidth = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null)
