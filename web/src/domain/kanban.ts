import type { UserSummary } from './projects'
import type { CustomField, FieldValue, OptionColor, TaskTypeIcon } from './task-config'
import type { TaskStatusRef, TaskSummary } from './tasks'

export interface BoardCardField {
  field: Pick<CustomField, 'id' | 'name' | 'label' | 'type' | 'options' | 'config'>
  value: FieldValue
}

export interface BoardCard extends TaskSummary {
  /** Campos marcados "no card" no tipo da tarefa. */
  cardFields: BoardCardField[]
}

export interface BoardColumn {
  status: TaskStatusRef & { isDefault: boolean }
  /** 0 = sem limite. */
  wipLimit: number
  /** IDs de destino permitidos; vazio = qualquer. */
  allowedNext: string[]
  total: number
  /** Colunas de encerramento mostram só as mais recentes. */
  truncated: boolean
  cards: BoardCard[]
}

export interface Board {
  project: { id: string; key: string; name: string; archived: boolean }
  capabilities: { move: boolean; create: boolean }
  columns: BoardColumn[]
}

export const SWIMLANES = ['none', 'assignee', 'priority', 'type'] as const
export type Swimlane = (typeof SWIMLANES)[number]

export interface BoardFilters {
  search: string
  /** 'me' | 'none' | id | '' */
  assignee: string
  type: string
  priority: string
  /** 'high' | 'medium' | 'low' | 'none' | '' */
  urgency: string
  tag: string
  /** 'none' | id da sprint | '' */
  sprint: string
}

export const EMPTY_FILTERS: BoardFilters = { search: '', assignee: '', type: '', priority: '', urgency: '', tag: '', sprint: '' }

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Filtros do quadro e do backlog (no navegador: a lista já está carregada). */
export function matchesFilters(card: TaskSummary, filters: BoardFilters, currentUserId: string | undefined): boolean {
  if (filters.search) {
    const q = normalize(filters.search.trim())
    if (q && !normalize(`${card.code} ${card.title}`).includes(q)) return false
  }
  if (filters.assignee === 'me' && card.assignee?.id !== currentUserId) return false
  if (filters.assignee === 'none' && card.assignee) return false
  if (filters.assignee && filters.assignee !== 'me' && filters.assignee !== 'none' && card.assignee?.id !== filters.assignee) return false
  if (filters.type && card.type?.id !== filters.type) return false
  if (filters.priority && card.priority?.id !== filters.priority) return false
  if (filters.urgency === 'none' && card.urgency) return false
  if (filters.urgency && filters.urgency !== 'none' && card.urgency !== filters.urgency) return false
  if (filters.tag && !card.tags.some((t) => t.id === filters.tag)) return false
  if (filters.sprint === 'none' && card.sprint) return false
  if (filters.sprint && filters.sprint !== 'none' && card.sprint?.id !== filters.sprint) return false
  return true
}

/** Chave da raia do card (vazio quando sem raias). */
export function laneOf(card: BoardCard, swimlane: Swimlane): string {
  if (swimlane === 'assignee') return card.assignee?.id ?? ''
  if (swimlane === 'priority') return card.priority?.id ?? ''
  if (swimlane === 'type') return card.type?.id ?? ''
  return 'all'
}

export interface Lane {
  /** Mesmo valor de `laneOf`; vazio = sem responsável/prioridade/tipo. */
  id: string
  name: string
  color?: OptionColor
  icon?: TaskTypeIcon
  person?: UserSummary
}

/**
 * Raias presentes nos cards: responsáveis e tipos em ordem alfabética, prioridades na ordem
 * configurada (`priorityOrder`); a raia "sem valor" fica por último.
 */
export function buildLanes(cards: readonly BoardCard[], swimlane: Swimlane, priorityOrder: readonly string[]): Lane[] {
  if (swimlane === 'none') return [{ id: 'all', name: '' }]
  const lanes = new Map<string, Lane>()
  cards.forEach((card) => {
    const id = laneOf(card, swimlane)
    if (lanes.has(id)) return
    if (swimlane === 'assignee') lanes.set(id, card.assignee ? { id, name: card.assignee.name, person: card.assignee } : { id, name: '' })
    else if (swimlane === 'priority') lanes.set(id, card.priority ? { id, name: card.priority.name, color: card.priority.color } : { id, name: '' })
    else lanes.set(id, card.type ? { id, name: card.type.name, color: card.type.color, icon: card.type.icon } : { id, name: '' })
  })
  const rank = (lane: Lane) => {
    const index = priorityOrder.indexOf(lane.id)
    return index < 0 ? priorityOrder.length : index
  }
  return [...lanes.values()].sort((a, b) => {
    if (!a.id || !b.id) return a.id ? -1 : b.id ? 1 : 0
    if (swimlane === 'priority' && rank(a) !== rank(b)) return rank(a) - rank(b)
    return a.name.localeCompare(b.name)
  })
}

const SEP = '::'
export const containerId = (lane: string, statusId: string) => `${lane}${SEP}${statusId}`
export function parseContainer(id: string): { lane: string; statusId: string } {
  const at = id.lastIndexOf(SEP)
  return { lane: id.slice(0, at), statusId: id.slice(at + SEP.length) }
}

/** Contêineres do arrastar e soltar: raia × coluna -> IDs dos cards (na ordem do quadro). */
export function buildContainers(board: Board, lanes: string[], swimlane: Swimlane, visible: (card: BoardCard) => boolean): Record<string, string[]> {
  const containers: Record<string, string[]> = {}
  lanes.forEach((lane) => {
    board.columns.forEach((column) => {
      containers[containerId(lane, column.status.id)] = []
    })
  })
  board.columns.forEach((column) => {
    column.cards.filter(visible).forEach((card) => {
      const key = containerId(laneOf(card, swimlane), column.status.id)
      if (containers[key]) containers[key].push(card.id)
    })
  })
  return containers
}

/** Pode mover da coluna `from` para `to`? (mesma regra do servidor) */
export function canTransition(board: Board, fromStatusId: string, toStatusId: string): boolean {
  if (fromStatusId === toStatusId) return true
  const from = board.columns.find((c) => c.status.id === fromStatusId)
  return !from || from.allowedNext.length === 0 || from.allowedNext.includes(toStatusId)
}

/** Vizinhos do card na posição final (o servidor calcula a posição entre eles). */
export function neighbors(ids: string[], cardId: string): { prevId?: string; nextId?: string } {
  const index = ids.indexOf(cardId)
  return { prevId: index > 0 ? ids[index - 1] : undefined, nextId: index >= 0 && index < ids.length - 1 ? ids[index + 1] : undefined }
}

/** Atualização otimista: tira o card da coluna atual e o coloca na posição indicada da coluna destino. */
export function moveCardInBoard(board: Board, cardId: string, toStatusId: string, prevId?: string): Board {
  let moving: BoardCard | undefined
  const columns = board.columns.map((column) => {
    const found = column.cards.find((c) => c.id === cardId)
    if (!found) return column
    moving = found
    return { ...column, total: column.total - 1, cards: column.cards.filter((c) => c.id !== cardId) }
  })
  if (!moving) return board
  const target = columns.find((c) => c.status.id === toStatusId)
  if (!target) return board
  const moved: BoardCard = { ...moving, status: { ...target.status } }
  return {
    ...board,
    columns: columns.map((column) => {
      if (column.status.id !== toStatusId) return column
      const cards = [...column.cards]
      const at = prevId ? cards.findIndex((c) => c.id === prevId) + 1 : 0
      cards.splice(at, 0, moved)
      return { ...column, total: column.total + 1, cards }
    }),
  }
}

/** Situação do limite WIP da coluna. */
export function wipState(column: Pick<BoardColumn, 'wipLimit' | 'total'>): 'none' | 'ok' | 'full' | 'over' {
  if (!column.wipLimit) return 'none'
  if (column.total > column.wipLimit) return 'over'
  return column.total === column.wipLimit ? 'full' : 'ok'
}
