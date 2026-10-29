/**
 * Linha do tempo do projeto (aba Histórico): os fatos do projeto pela data em que aconteceram — registros
 * do Diário, marcos e tarefas — e não pela hora em que foram gravados (isso é a auditoria).
 * Dias são "dia puro" AAAA-MM-DD; a ordem é do mais antigo ao mais recente.
 */
import type { JournalEntry } from './plan-management'
import type { UserSummary } from './projects'
import type { TaskStatusRef, TaskSummary } from './tasks'
import type { Milestone, MilestoneState } from './timeline'

export type ChronologyItem =
  | { kind: 'journal'; id: string; content: string; author: UserSummary | null }
  | { kind: 'milestone'; id: string; name: string; description: string; state: MilestoneState }
  | { kind: 'task'; id: string; code: string; title: string; status: TaskStatusRef | null; assignee: UserSummary | null; start: string | null; due: string | null }

export interface ChronologyDay {
  /** AAAA-MM-DD */
  date: string
  items: ChronologyItem[]
}

export interface Chronology {
  days: ChronologyDay[]
  /** Tarefas sem início nem prazo: ficam no fim, fora da linha do tempo. */
  undated: ChronologyItem[]
}

/** Dentro do mesmo dia: primeiro o relato (Diário), depois os marcos, depois as tarefas. */
const KIND_ORDER: Record<ChronologyItem['kind'], number> = { journal: 0, milestone: 1, task: 2 }

const dayOf = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)

/** Tarefa entra no dia em que começou; sem início, no prazo. */
export function buildChronology(input: { journal?: JournalEntry[]; milestones?: Milestone[]; tasks?: TaskSummary[] }): Chronology {
  const dated: { date: string; item: ChronologyItem }[] = []
  const undated: ChronologyItem[] = []

  for (const entry of input.journal ?? []) {
    dated.push({ date: entry.entryDate.slice(0, 10), item: { kind: 'journal', id: entry.id, content: entry.content, author: entry.author } })
  }
  for (const milestone of input.milestones ?? []) {
    dated.push({
      date: milestone.dueDate.slice(0, 10),
      item: { kind: 'milestone', id: milestone.id, name: milestone.name, description: milestone.description, state: milestone.state },
    })
  }
  for (const task of input.tasks ?? []) {
    const start = dayOf(task.startDate)
    const due = dayOf(task.dueDate)
    const item: ChronologyItem = { kind: 'task', id: task.id, code: task.code, title: task.title, status: task.status, assignee: task.assignee, start, due }
    const date = start ?? due
    if (date) dated.push({ date, item })
    else undated.push(item)
  }

  dated.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind])
  const days: ChronologyDay[] = []
  for (const { date, item } of dated) {
    const last = days.at(-1)
    if (last && last.date === date) last.items.push(item)
    else days.push({ date, items: [item] })
  }
  return { days, undated }
}
