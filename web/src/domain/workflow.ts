import type { OptionColor } from './task-config'

/** Categoria do status: dá significado ao fluxo independentemente do nome escolhido. */
export const STATUS_CATEGORIES = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'] as const
export type StatusCategory = (typeof STATUS_CATEGORIES)[number]

/** Listas configuráveis que compartilham as mesmas regras (chave, ordem, cor, ativo e um padrão). */
export const LOOKUP_KINDS = ['status', 'priority', 'area'] as const
export type LookupKind = (typeof LOOKUP_KINDS)[number]

/** A área não tem padrão: tarefa e projeto podem ficar sem área. */
export function lookupHasDefault(kind: LookupKind): boolean {
  return kind !== 'area'
}

export interface LookupItem {
  id: string
  key: string
  name: string
  description: string
  color: OptionColor
  order: number
  isActive: boolean
  isDefault: boolean
  /** Só em status. */
  category?: StatusCategory
  /** Só em status: limite WIP da coluna (0 = sem limite). */
  wipLimit?: number
  /** Só em status: destinos permitidos (vazio = qualquer). */
  allowedNext?: string[]
  createdAt: Date | null
  updatedAt: Date | null
}

export interface TaskStatus extends LookupItem {
  category: StatusCategory
}

export type TaskPriority = LookupItem

/** Área responsável (Configurações → Áreas). */
export type Area = LookupItem

/** Área resumida que vem na tarefa e no projeto. */
export type AreaRef = Pick<LookupItem, 'id' | 'key' | 'name' | 'color'>

/** Tarefas em status destas categorias são consideradas encerradas. */
export function isClosedCategory(category: StatusCategory): boolean {
  return category === 'done' || category === 'cancelled'
}

/**
 * Status que a tarefa pode escolher a partir do atual: o próprio atual e os destinos permitidos
 * (na ordem do fluxo). Sem transições configuradas no status atual — ou tarefa nova —, todos.
 */
export function statusChoices<S extends { id: string; allowedNext?: string[] }>(statuses: readonly S[], currentId: string | null | undefined): S[] {
  const current = currentId ? statuses.find((s) => s.id === currentId) : undefined
  const allowed = current?.allowedNext ?? []
  if (!current || allowed.length === 0) return [...statuses]
  return statuses.filter((s) => s.id === current.id || allowed.includes(s.id))
}
