import type { Attachment } from './attachments'
import type { PlanItemRef } from './plan'
import type { SprintRef } from './sprints'
import type { UserSummary } from './projects'
import { isRequiredIn, valueIssue, type FieldValue, type OptionColor, type TaskTypeField, type TaskTypeIcon } from './task-config'
import type { StatusCategory } from './workflow'
import type { Urgency } from './urgency'

export interface TaskStatusRef {
  id: string
  key: string
  name: string
  color: OptionColor
  category: StatusCategory
}

export interface TaskPriorityRef {
  id: string
  key: string
  name: string
  color: OptionColor
}

export interface TagRef {
  id: string
  name: string
  color: OptionColor
}

export interface Tag extends TagRef {
  taskCount: number
}

export interface ChecklistItem {
  /** Itens novos ainda sem id (o servidor gera). */
  id?: string
  text: string
  done: boolean
}

export interface TaskComment {
  id: string
  taskId: string
  author: UserSummary | null
  /** Texto com Markdown simples e menções `@[Nome](id)`; vazio se excluído. */
  content: string
  mentions: UserSummary[]
  attachments: Attachment[]
  deleted: boolean
  createdAt: Date | null
  editedAt: Date | null
  capabilities: { edit: boolean; delete: boolean }
}

export interface TaskSummary {
  id: string
  code: string
  number: number
  title: string
  project: { id: string; key: string; name: string } | null
  type: { id: string; key: string; name: string; icon: TaskTypeIcon; color: OptionColor } | null
  status: TaskStatusRef | null
  priority: TaskPriorityRef | null
  /** Sprint planejada (backlog). */
  sprint: SprintRef | null
  creator: UserSummary | null
  assignee: UserSummary | null
  reporter: UserSummary | null
  parentTaskId: string | null
  /** Início planejado (timeline); somente dia (meia-noite UTC). */
  startDate: Date | null
  /** Somente dia (meia-noite UTC). */
  dueDate: Date | null
  estimatedHours: number | null
  actualHours: number | null
  startedAt: Date | null
  completedAt: Date | null
  createdAt: Date | null
  updatedAt: Date | null
  tags: TagRef[]
  checklistProgress: { done: number; total: number }
  commentCount: number
  attachmentCount: number
  /** Subtarefas (done = encerradas). */
  subtaskProgress: { done: number; total: number }
  /** Algum bloqueio (bloqueado por / depende de) ainda aberto. */
  blocked: boolean
  /** Elemento da Gestão de projetos que a tarefa executa (ver plan-tasks.ts); null/ausente = sem vínculo. */
  planItem?: PlanItemRef | null
  /** Entra no informe do projeto (aba Informe); padrão: sim. */
  inReport: boolean
  /** Urgência (semáforo); null = sem urgência. */
  urgency: Urgency | null
}

export interface TaskCapabilities {
  edit: boolean
  delete: boolean
  assign: boolean
  /** Pode comentar (qualquer pessoa com acesso ao projeto, fora de projeto arquivado). */
  comment: boolean
  /** Relacionar com outras tarefas (tasks.link). */
  link: boolean
  /** Fazer fork (tasks.fork). */
  fork: boolean
}

export interface TaskRef {
  id: string
  code: string
  title: string
}

export interface TaskDetail extends TaskSummary {
  description: string
  /** Valores por nome técnico do campo. */
  customValues: Record<string, FieldValue>
  checklist: ChecklistItem[]
  /** Tarefa pai (subtarefa) e origem do fork. */
  parent: TaskRef | null
  forkedFrom: TaskRef | null
  /** Campos do tipo (base do formulário dinâmico). */
  fields: TaskTypeField[]
  capabilities: TaskCapabilities
}

export interface TaskInput {
  projectId?: string
  taskTypeId?: string
  title?: string
  description?: string
  statusId?: string
  priorityId?: string
  /** null limpa. */
  assigneeId?: string | null
  reporterId?: string | null
  /** AAAA-MM-DD; null limpa. Não pode passar do prazo. */
  startDate?: string | null
  /** AAAA-MM-DD; null limpa. */
  dueDate?: string | null
  estimatedHours?: number | null
  actualHours?: number | null
  customValues?: Record<string, FieldValue>
  tagIds?: string[]
  checklist?: ChecklistItem[]
  /** null tira da sprint. */
  sprintId?: string | null
  /** Subtarefa: tarefa pai (null solta). */
  parentTaskId?: string | null
  /** Elemento ou subelemento da Gestão do mesmo projeto (null desvincula). */
  planItemId?: string | null
}

// ---------------------------------------------------------------- menções (@)

export interface MentionPerson {
  id: string
  name: string
}

/** Formato salvo: `@[Nome](id)`. */
const MENTION_PATTERN = /@\[([^\]\n]{1,120})\]\(([A-Za-z0-9_]{1,64})\)/g

/** Salvo -> exibido no editor ("@Nome") + pessoas mencionadas. */
export function mentionsToDisplay(content: string): { text: string; people: MentionPerson[] } {
  const people: MentionPerson[] = []
  const text = content.replace(MENTION_PATTERN, (_, name: string, id: string) => {
    if (!people.some((p) => p.id === id)) people.push({ id, name })
    return `@${name}`
  })
  return { text, people }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Exibido -> salvo: cada "@Nome" de uma pessoa escolhida na lista vira `@[Nome](id)`.
 * Nomes mais longos primeiro (evita "@Ana" casar dentro de "@Ana Paula").
 * Se o texto "@Nome" foi apagado, a pessoa simplesmente não é mencionada.
 */
export function mentionsToStorage(text: string, people: MentionPerson[]): string {
  let result = text
  const sorted = [...people].sort((a, b) => b.name.length - a.name.length)
  sorted.forEach((person, index) => {
    const pattern = new RegExp(`@${escapeRegExp(person.name)}(?![\\p{L}\\p{N}_])`, 'gu')
    result = result.replace(pattern, `\u0000${index}\u0000`)
  })
  sorted.forEach((person, index) => {
    result = result.split(`\u0000${index}\u0000`).join(`@[${person.name}](${person.id})`)
  })
  return result
}

/**
 * Consulta de menção em andamento: texto digitado depois de "@" até o cursor
 * (sem quebra de linha; "@" no início ou depois de espaço/pontuação). null = não está mencionando.
 */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  const prev = at === 0 ? ' ' : before.charAt(at - 1)
  if (!/[\s([{"'.,;:!?]/.test(prev)) return null
  const query = before.slice(at + 1)
  if (query.length > 40 || /[\n@]/.test(query) || /^\s/.test(query)) return null
  return { start: at, query }
}

export const TASK_SORTS = ['code', 'title', 'created_at', 'updated_at', 'due_date', 'priority', 'status'] as const

/** Tarefa encerrada (concluída ou cancelada). */
export function isClosed(task: Pick<TaskSummary, 'status'>): boolean {
  return task.status?.category === 'done' || task.status?.category === 'cancelled'
}

/** Prazo vencido: tarefa aberta com prazo anterior a hoje. */
export function isOverdue(task: Pick<TaskSummary, 'status' | 'dueDate'>, today: Date = new Date()): boolean {
  if (!task.dueDate || isClosed(task)) return false
  const startOfToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return task.dueDate.getTime() < startOfToday
}

/** Horas digitadas ("1,5") -> número; vazio -> null; inválido -> NaN. */
export function parseHours(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const n = Number(trimmed.replace(',', '.'))
  return Number.isFinite(n) ? n : Number.NaN
}

/**
 * Valida no cliente os campos personalizados visíveis (o servidor revalida tudo).
 * Retorna erros por nome técnico do campo.
 */
/** Problemas dos campos personalizados; `statusId` = status em que a tarefa vai ficar (soma os exigidos nele). */
export function customValueIssues(
  fields: TaskTypeField[],
  values: Record<string, FieldValue | undefined>,
  statusId?: string | null,
  heldFiles?: Record<string, number>,
): Record<string, string> {
  const issues: Record<string, string> = {}
  fields
    .filter((link) => link.visible)
    .forEach((link) => {
      if (link.field.type === 'image' || link.field.type === 'file') {
        // na criação (`heldFiles`: arquivos escolhidos por campo, enviados logo depois de criar), o
        // campo exigido precisa de ao menos um arquivo; na edição o valor são anexos e o servidor confere
        if (heldFiles && isRequiredIn(link, statusId) && !((heldFiles[link.field.name] ?? 0) > 0)) issues[link.field.name] = 'required'
        return
      }
      const issue = valueIssue(link.field, values[link.field.name], isRequiredIn(link, statusId))
      if (issue) issues[link.field.name] = issue
    })
  return issues
}

/** Início planejado depois do prazo (espelha backend domain/timeline.js); datas AAAA-MM-DD. */
export function datesIssue(startDate: string | null | undefined, dueDate: string | null | undefined): 'after_due_date' | null {
  if (!startDate || !dueDate) return null
  return startDate.slice(0, 10) > dueDate.slice(0, 10) ? 'after_due_date' : null
}
