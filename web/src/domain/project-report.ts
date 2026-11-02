/**
 * Informe do projeto (aba Informe): junta tarefas escolhidas, marcos, Diário e as fases do quadro de gestão
 * num retrato do projeto até a data de corte — capa, indicadores, cronograma, fases, marcos, linha do tempo,
 * tarefas e próximos passos. Só regras; o desenho do documento fica na feature.
 * Datas são "dia puro" AAAA-MM-DD.
 */
import { buildChronology, type Chronology } from './project-chronology'
import type { JournalEntry } from './plan-management'
import type { Plan, PlanStatusCategory } from './plan'
import type { TaskSummary } from './tasks'
import type { StatusCategory } from './workflow'
import type { Milestone } from './timeline'

export const REPORT_SECTIONS = ['summary', 'phases', 'milestones', 'chronology', 'tasks', 'next'] as const
export type ReportSection = (typeof REPORT_SECTIONS)[number]

export interface ReportOptions {
  title: string
  subtitle: string
  /** Texto livre do resumo (abre a seção 1). */
  summary: string
  /** Texto livre ao lado dos próximos passos (riscos, observações). */
  notes: string
  /** Período (inclusivo); vazio = desde o início / até o corte. */
  from: string
  to: string
  /** Data de corte do informe ("hoje" do documento). */
  cutoff: string
  /** Grupo do quadro de gestão cujos elementos são as fases ('' = sem fases). */
  phaseGroupId: string
  sections: Record<ReportSection, boolean>
}

export function defaultReportOptions(today: string): ReportOptions {
  return {
    title: '',
    subtitle: '',
    summary: '',
    notes: '',
    from: '',
    to: '',
    cutoff: today,
    phaseGroupId: '',
    sections: { summary: true, phases: true, milestones: true, chronology: true, tasks: true, next: true },
  }
}

export interface ReportPhase {
  id: string
  name: string
  start: string | null
  end: string | null
  statusName: string | null
  statusCategory: PlanStatusCategory | null
  done: boolean
  /** 0–100 (o do quadro de gestão). */
  progress: number
  /** Dias corridos, do início ao fim (ou ao corte, se em andamento). */
  days: number | null
}

/** Situação das tarefas no informe (agrupamento da tabela). */
export type ReportTaskState = 'in_progress' | 'pending' | 'done' | 'cancelled'
export const REPORT_TASK_STATES: ReportTaskState[] = ['in_progress', 'pending', 'done', 'cancelled']

export interface ProjectReport {
  /** Primeiro dia do informe (período, início do projeto ou o fato mais antigo). */
  start: string | null
  /** Último dia (fim do período ou corte). */
  end: string
  kpis: {
    days: number | null
    workdays: number | null
    tasksDone: number
    tasksTotal: number
    milestonesDone: number
    milestonesTotal: number
    phasesDone: number
    phasesTotal: number
  }
  phases: ReportPhase[]
  milestones: Milestone[]
  chronology: Chronology
  tasks: Array<{ state: ReportTaskState; tasks: TaskSummary[] }>
  next: { milestones: Milestone[]; tasks: TaskSummary[] }
  /** Responsáveis das tarefas do informe (nome), em ordem alfabética. */
  team: string[]
}

export interface ReportInput {
  projectStart: string | null
  tasks: TaskSummary[]
  milestones: Milestone[]
  journal: JournalEntry[]
  plan: Plan | null
  options: ReportOptions
}

const DAY = 86_400_000
const dayOf = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`)

/** Dias corridos entre duas datas, contando as duas pontas. */
export function calendarDays(from: string, to: string): number {
  return Math.max(Math.round((ms(to) - ms(from)) / DAY) + 1, 0)
}

/** Dias úteis (segunda a sexta) entre duas datas, contando as duas pontas. */
export function workdays(from: string, to: string): number {
  let count = 0
  for (let t = ms(from); t <= ms(to); t += DAY) {
    const weekday = new Date(t).getUTCDay()
    if (weekday !== 0 && weekday !== 6) count += 1
  }
  return count
}

export function taskState(category: StatusCategory | undefined): ReportTaskState {
  if (category === 'done') return 'done'
  if (category === 'cancelled') return 'cancelled'
  if (category === 'in_progress') return 'in_progress'
  return 'pending'
}

/** Dia em que a tarefa aparece no informe: início, ou prazo. */
const taskDay = (task: TaskSummary) => dayOf(task.startDate) ?? dayOf(task.dueDate)

function inPeriod(day: string | null, from: string, to: string): boolean {
  if (!day) return !from && !to
  return (!from || day >= from) && (!to || day <= to)
}

/** Grupo escolhido e os subgrupos dele. */
function groupTree(plan: Plan, rootId: string): Set<string> {
  const ids = new Set([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const group of plan.groups) {
      if (group.parentId && ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id)
        grew = true
      }
    }
  }
  return ids
}

function buildPhases(plan: Plan | null, groupId: string, cutoff: string): ReportPhase[] {
  if (!plan || !groupId) return []
  const groups = groupTree(plan, groupId)
  const statuses = new Map(plan.statuses.map((s) => [s.id, s]))
  const groupOrder = new Map(plan.groups.map((g, i) => [g.id, i]))
  return plan.items
    .filter((item) => !item.parentId && groups.has(item.groupId))
    .sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) || a.position - b.position)
    .map((item) => {
      const status = item.statusId ? statuses.get(item.statusId) : undefined
      const done = status?.category === 'done'
      const start = item.startDate
      const end = item.endDate ?? item.dueDate
      const days = start ? calendarDays(start, end ?? cutoff) : null
      return {
        id: item.id,
        name: item.name,
        start,
        end,
        statusName: status?.name ?? null,
        statusCategory: status?.category ?? null,
        done,
        progress: done ? 100 : Math.round(item.progress.value),
        days,
      }
    })
}

export function buildProjectReport(input: ReportInput): ProjectReport {
  const { options } = input
  const from = options.from
  const to = options.to
  const end = to && to < options.cutoff ? to : options.cutoff

  const tasks = input.tasks.filter((task) => task.inReport && inPeriod(taskDay(task), from, to))
  const milestones = input.milestones
    .filter((m) => inPeriod(m.dueDate.slice(0, 10), from, to))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const journal = input.journal.filter((entry) => inPeriod(entry.entryDate.slice(0, 10), from, to))
  const phases = buildPhases(input.plan, options.phaseGroupId, options.cutoff)

  const firstFact = [
    ...tasks.map(taskDay),
    ...milestones.map((m) => m.dueDate.slice(0, 10)),
    ...journal.map((e) => e.entryDate.slice(0, 10)),
    ...phases.map((p) => p.start),
  ]
    .filter((d): d is string => !!d)
    .sort()[0]
  const start = from || input.projectStart || firstFact || null
  const span = start && start <= end ? start : null

  const byState = new Map<ReportTaskState, TaskSummary[]>()
  for (const task of tasks) {
    const state = taskState(task.status?.category)
    byState.set(state, [...(byState.get(state) ?? []), task])
  }
  const byDate = (a: TaskSummary, b: TaskSummary) => (taskDay(a) ?? '9999').localeCompare(taskDay(b) ?? '9999') || a.number - b.number
  const open = tasks.filter((task) => {
    const state = taskState(task.status?.category)
    return state === 'in_progress' || state === 'pending'
  })
  const dueOf = (task: TaskSummary) => dayOf(task.dueDate) ?? '9999'

  return {
    start,
    end,
    kpis: {
      days: span ? calendarDays(span, end) : null,
      workdays: span ? workdays(span, end) : null,
      tasksDone: tasks.filter((t) => t.status?.category === 'done').length,
      tasksTotal: tasks.filter((t) => t.status?.category !== 'cancelled').length,
      milestonesDone: milestones.filter((m) => m.state === 'done').length,
      milestonesTotal: milestones.length,
      phasesDone: phases.filter((p) => p.done).length,
      phasesTotal: phases.length,
    },
    phases,
    milestones,
    chronology: buildChronology({ journal, milestones, tasks }),
    tasks: REPORT_TASK_STATES.filter((state) => byState.has(state)).map((state) => ({ state, tasks: (byState.get(state) ?? []).sort(byDate) })),
    next: {
      milestones: milestones.filter((m) => m.state !== 'done'),
      tasks: open.sort((a, b) => dueOf(a).localeCompare(dueOf(b)) || a.number - b.number),
    },
    team: [...new Set(tasks.map((t) => t.assignee?.name).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b)),
  }
}
