import type { UserSummary } from './projects'
import type { CustomField, FieldValue, OptionColor, TaskTypeIcon } from './task-config'
import type { TaskStatusRef, TaskSummary } from './tasks'
import { matchesUrgency } from './urgency'
import { matchesArea } from './workflow'

export interface BoardCardField {
  field: Pick<CustomField, 'id' | 'name' | 'label' | 'type' | 'options' | 'config'>
  value: FieldValue
}

export interface BoardCard extends TaskSummary {
  /** Campos marcados "no card" no tipo da tarefa. */
  cardFields: BoardCardField[]
  /** Quadro de todos os projetos: pode mover este card (permissão no projeto dele). */
  canMove?: boolean
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

export interface BoardProject {
  id: string
  key: string
  name: string
}

export interface Board {
  /** null = quadro de todos os projetos (`/kanban/all`). */
  project: (BoardProject & { archived: boolean }) | null
  /** Projetos incluídos no quadro, pela chave (no quadro do projeto, só ele). */
  projects: BoardProject[]
  /** No quadro de todos os projetos: mover/criar em algum projeto. */
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
  /** 'high' | 'medium' | 'low' | 'none' (sem urgência) | '' */
  urgency: string
  /** id da área | 'none' (sem área) | '' */
  area: string
  tag: string
  /** 'none' | id da sprint | '' */
  sprint: string
  /** Quadro de todos os projetos: só os projetos escolhidos (vazio = todos). */
  projects: string[]
  /** Etapas (colunas de status) mostradas; vazio = todas. */
  statuses: string[]
}

/** Filtros de escolha única (os que viram uma lista de seleção na barra). */
export type BoardSelectFilter = Exclude<keyof BoardFilters, 'search' | 'projects' | 'statuses'>

export const EMPTY_FILTERS: BoardFilters = { search: '', assignee: '', type: '', priority: '', urgency: '', area: '', tag: '', sprint: '', projects: [], statuses: [] }

/** Colunas da etapa escolhida no filtro "Etapas" (vazio = todas; etapa que sumiu do fluxo é ignorada). */
export function visibleColumns(columns: BoardColumn[], statuses: string[]): BoardColumn[] {
  if (statuses.length === 0) return columns
  const shown = columns.filter((c) => statuses.includes(c.status.id))
  return shown.length > 0 ? shown : columns
}

/** Como a pessoa prefere ver o quadro (fica no navegador): colunas recolhidas e modo compacto. */
export interface BoardView {
  /** Status das colunas recolhidas (viram uma faixa estreita com o nome e a contagem). */
  collapsed: string[]
  /** Colunas mais estreitas e cards mais enxutos. */
  compact: boolean
}

export const DEFAULT_VIEW: BoardView = { collapsed: [], compact: false }

/** Lê a preferência salva, descartando o que não tem o formato esperado. */
export function parseBoardView(value: unknown): BoardView {
  const raw = value && typeof value === 'object' ? (value as Partial<BoardView>) : {}
  return {
    collapsed: Array.isArray(raw.collapsed) ? raw.collapsed.filter((id): id is string => typeof id === 'string') : [],
    compact: raw.compact === true,
  }
}

export function toggleCollapsed(view: BoardView, statusId: string): BoardView {
  const collapsed = view.collapsed.includes(statusId) ? view.collapsed.filter((id) => id !== statusId) : [...view.collapsed, statusId]
  return { ...view, collapsed }
}

/** Largura mínima de cada coluna aberta (rem): abaixo disso o quadro rola na horizontal. */
export const COLUMN_MIN_REM = { normal: 16, compact: 13 } as const
/** Largura da coluna recolhida. */
export const COLLAPSED_COLUMN = '2.75rem'

/** grid-template-columns do quadro: recolhidas estreitas; as demais dividem o espaço. */
export function columnTemplate(columns: BoardColumn[], view: BoardView): string {
  const open = `minmax(${view.compact ? COLUMN_MIN_REM.compact : COLUMN_MIN_REM.normal}rem, 1fr)`
  return columns.map((c) => (view.collapsed.includes(c.status.id) ? COLLAPSED_COLUMN : open)).join(' ')
}

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
  if (!matchesUrgency(card.urgency, filters.urgency)) return false
  if (!matchesArea(card.area, filters.area)) return false
  if (filters.tag && !card.tags.some((t) => t.id === filters.tag)) return false
  if (filters.sprint === 'none' && card.sprint) return false
  if (filters.sprint && filters.sprint !== 'none' && card.sprint?.id !== filters.sprint) return false
  if (filters.projects.length > 0 && !filters.projects.includes(card.project?.id ?? '')) return false
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

// ------------------------------------------------------------ quadro de todos os projetos (§5)

/** Quadro de todos os projetos (`/kanban/all`)? */
export function isAllProjects(board: Board): boolean {
  return board.project === null
}

/**
 * Limite WIP que vale para a coluna no quadro: o limite é por projeto, então no quadro de todos os
 * projetos (total somando vários) não há limite nem alerta.
 */
export function boardWipLimit(board: Board, column: Pick<BoardColumn, 'wipLimit'>): number {
  return isAllProjects(board) ? 0 : column.wipLimit
}

/** Pode arrastar o card? No quadro de todos os projetos vale a permissão no projeto do card. */
export function canMoveCard(board: Board, card: Pick<BoardCard, 'canMove'>): boolean {
  return card.canMove ?? board.capabilities.move
}

/**
 * Vizinhos do mesmo projeto na posição final (quadro de todos os projetos): a posição é de cada
 * projeto e o servidor ignora vizinhos de outro projeto — o mais próximo acima e abaixo do mesmo projeto.
 */
export function neighborsInProject(ids: string[], cardId: string, projectOf: (id: string) => string | undefined): { prevId?: string; nextId?: string } {
  const index = ids.indexOf(cardId)
  const project = projectOf(cardId)
  if (index < 0 || !project) return {}
  const same = (id: string) => projectOf(id) === project
  const prevId = ids.slice(0, index).reverse().find(same)
  const nextId = ids.slice(index + 1).find(same)
  return { prevId, nextId }
}

/** Responsáveis presentes nos cards (opções do filtro e das raias), por nome. */
export function boardPeople(board: Board): UserSummary[] {
  const people = new Map<string, UserSummary>()
  board.columns.forEach((column) =>
    column.cards.forEach((card) => {
      if (card.assignee && !people.has(card.assignee.id)) people.set(card.assignee.id, card.assignee)
    }),
  )
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Pessoas citadas nos cards (responsável, autor, relator): nomes dos campos de pessoa. */
export function boardPersonReferences(board: Board): Array<{ id: string; name: string }> {
  const people = new Map<string, { id: string; name: string }>()
  board.columns.forEach((column) =>
    column.cards.forEach((card) =>
      [card.assignee, card.creator, card.reporter].forEach((person) => {
        if (person && !people.has(person.id)) people.set(person.id, { id: person.id, name: person.name })
      }),
    ),
  )
  return [...people.values()]
}

/** Ids dos projetos com algum card carregado no quadro. */
function projectsWithCards(board: Board): Set<string> {
  const ids = new Set<string>()
  board.columns.forEach((column) => column.cards.forEach((card) => card.project && ids.add(card.project.id)))
  return ids
}

/** Opções do filtro de projeto: os projetos com cards no quadro (e os já escolhidos), pela chave. */
export function projectFilterOptions(board: Board, selected: readonly string[]): BoardProject[] {
  const withCards = projectsWithCards(board)
  return board.projects.filter((project) => withCards.has(project.id) || selected.includes(project.id))
}

/**
 * Projetos do quadro que a tela assina no tempo real, até `max` (o servidor aceita um número limitado
 * de tópicos por conexão): primeiro os que têm cards. `complete` = todos couberam; senão, a tela
 * volta à consulta periódica curta para não deixar de ver os demais.
 */
export function liveProjectIds(board: Board, max: number): { ids: string[]; complete: boolean } {
  const withCards = projectsWithCards(board)
  const ordered = [...board.projects.filter((p) => withCards.has(p.id)), ...board.projects.filter((p) => !withCards.has(p.id))]
  // na ordem do quadro (pela chave): a lista só muda quando muda quem entra, sem refazer assinaturas à toa
  const chosen = new Set(ordered.slice(0, max).map((p) => p.id))
  return { ids: board.projects.filter((p) => chosen.has(p.id)).map((p) => p.id), complete: ordered.length <= max }
}
