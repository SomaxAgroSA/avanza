import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import {
  boardWipLimit,
  buildContainers,
  canMoveCard,
  canTransition,
  containerId,
  isAllProjects,
  neighbors,
  parseContainer,
  wipState,
  type Board,
  type BoardCard,
  type BoardColumn,
  type Lane,
  type Swimlane,
  columnTemplate,
  DEFAULT_VIEW,
  type BoardView,
} from '@/domain/kanban'
import { isClosedCategory } from '@/domain/workflow'
import { cn } from '@/core/utils/cn'
import { useFillHeight } from '@/presentation/common/use-fill-height'
import { AppAvatar, AppIconButton, AppKanbanCard, AppKanbanColumnHeader, AppKanbanDropZone } from '@/presentation/components'
import type { CustomFieldReferences } from '@/features/task-config/CustomFieldInput'
import { TaskTypeIconBadge } from '@/features/task-config/config-visuals'
import { optionColor } from '@/features/task-config/config-theme'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { KanbanCardContent, SortableKanbanCard } from './KanbanCard'

export interface KanbanDrop {
  card: BoardCard
  from: BoardColumn
  to: BoardColumn
  /** Vizinhos na tela (acima e abaixo) na posição final. */
  prevId?: string
  nextId?: string
  /** Ordem final dos cards (ids) na célula de destino. */
  order: string[]
}

export interface KanbanBoardProps {
  board: Board
  swimlane: Swimlane
  lanes: Lane[]
  visible: (card: BoardCard) => boolean
  references?: CustomFieldReferences
  onOpen: (taskId: string) => void
  onQuickAdd?: (statusId: string) => void
  /** Soltou em posição nova (mesma coluna ou outra permitida). */
  onMove: (drop: KanbanDrop) => void
  /** Soltou numa coluna fora das transições permitidas. */
  onBlocked: (from: BoardColumn, to: BoardColumn) => void
  onDraggingChange?: (dragging: boolean) => void
  /** Colunas recolhidas e modo compacto (preferência da pessoa). */
  view?: BoardView
  onToggleCollapse?: (statusId: string) => void
}

const isContainer = (id: UniqueIdentifier) => String(id).includes('::')

/** Estado do arraste: cópia dos contêineres (movida durante o arraste) presa ao quadro de origem. */
interface DragState {
  items: Record<string, string[]>
  origin: string
  board: Board
}

export function KanbanBoard({ board, swimlane, lanes, visible, references, onOpen, onQuickAdd, onMove, onBlocked, onDraggingChange, view = DEFAULT_VIEW, onToggleCollapse }: KanbanBoardProps) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  // Depois de soltar, a cópia fica até o quadro mudar (atualização otimista): sem "piscar".
  if (drag && !activeId && drag.board !== board) setDrag(null)

  const laneIds = useMemo(() => lanes.map((l) => l.id), [lanes])
  const base = useMemo(() => buildContainers(board, laneIds, swimlane, visible), [board, laneIds, swimlane, visible])
  const containers = drag ? drag.items : base

  const cards = useMemo(() => {
    const map = new Map<string, { card: BoardCard; column: BoardColumn }>()
    board.columns.forEach((column) => column.cards.forEach((card) => map.set(card.id, { card, column })))
    return map
  }, [board])
  const columnOf = (statusId: string) => board.columns.find((c) => c.status.id === statusId)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    // Enter fica para abrir o card; Espaço pega e solta
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  )

  function findContainer(id: UniqueIdentifier, from = containers): string | undefined {
    const key = String(id)
    if (key in from) return key
    return Object.keys(from).find((k) => from[k]?.includes(key))
  }

  /** Destino permitido a partir da origem do arraste: mesma raia e transição liberada. */
  function allowed(target: string, origin = drag?.origin): boolean {
    if (!origin) return true
    const a = parseContainer(origin)
    const b = parseContainer(target)
    return a.lane === b.lane && canTransition(board, a.statusId, b.statusId)
  }

  // Sob o ponteiro, prefere o card mais próximo; fora de qualquer área, o canto mais próximo.
  const collision: CollisionDetection = (args) => {
    const within = pointerWithin(args)
    if (within.length === 0) return closestCorners(args)
    const overCards = new Set(within.filter((c) => !isContainer(c.id)).map((c) => c.id))
    if (overCards.size === 0) return within
    return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((d) => overCards.has(d.id)) })
  }

  function onDragStart({ active }: DragStartEvent) {
    const origin = findContainer(active.id, base)
    if (!origin) return
    setActiveId(String(active.id))
    setDrag({ items: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, [...v]])), origin, board })
    onDraggingChange?.(true)
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || !drag) return
    const from = findContainer(active.id)
    const to = findContainer(over.id)
    if (!from || !to || from === to || !allowed(to)) return
    setDrag((current) => {
      if (!current) return current
      const source = (current.items[from] ?? []).filter((id) => id !== String(active.id))
      const target = [...(current.items[to] ?? [])]
      let index = target.length
      if (!isContainer(over.id)) {
        const overIndex = target.indexOf(String(over.id))
        const translated = active.rect.current.translated
        const below = !!translated && translated.top > over.rect.top + over.rect.height / 2
        index = overIndex < 0 ? target.length : overIndex + (below ? 1 : 0)
      }
      target.splice(index, 0, String(active.id))
      return { ...current, items: { ...current.items, [from]: source, [to]: target } }
    })
  }

  function finish() {
    setActiveId(null)
    onDraggingChange?.(false)
  }

  function onDragCancel() {
    setDrag(null)
    finish()
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const state = drag
    const id = String(active.id)
    const entry = cards.get(id)
    if (!state || !over || !entry) return onDragCancel()
    const current = findContainer(id, state.items)
    const target = findContainer(over.id, state.items)
    if (!current || !target) return onDragCancel()

    // soltou sobre coluna bloqueada: o card nunca saiu da origem
    if (target !== current && !allowed(target, state.origin)) {
      const to = columnOf(parseContainer(target).statusId)
      if (to && parseContainer(target).lane === parseContainer(state.origin).lane) onBlocked(entry.column, to)
      return onDragCancel()
    }

    let list = state.items[current] ?? []
    if (target === current && !isContainer(over.id) && over.id !== active.id) {
      list = arrayMove(list, list.indexOf(id), list.indexOf(String(over.id)))
    }
    const originList = base[state.origin] ?? []
    const unchanged = current === state.origin && list.join('|') === originList.join('|')
    const to = columnOf(parseContainer(current).statusId)
    if (unchanged || !to) return onDragCancel()

    setDrag({ ...state, items: { ...state.items, [current]: list } })
    finish()
    onMove({ card: entry.card, from: entry.column, to, order: list, ...neighbors(list, id) })
  }

  const labelOf = (id: UniqueIdentifier) => {
    const card = cards.get(String(id))?.card
    return card ? `${card.code} · ${card.title}` : String(id)
  }
  const columnName = (id: UniqueIdentifier | undefined) => {
    const key = id === undefined ? undefined : findContainer(id)
    return key ? (columnOf(parseContainer(key).statusId)?.status.name ?? '') : ''
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('kanban.announce.picked', { card: labelOf(active.id), column: columnName(active.id) }),
    onDragOver: ({ active, over }) => (over ? t('kanban.announce.over', { card: labelOf(active.id), column: columnName(over.id) }) : undefined),
    onDragEnd: ({ active, over }) => (over ? t('kanban.announce.dropped', { card: labelOf(active.id), column: columnName(over.id) }) : undefined),
    onDragCancel: ({ active }) => t('kanban.announce.cancelled', { card: labelOf(active.id) }),
  }

  const active = activeId ? cards.get(activeId)?.card : undefined
  const originStatus = drag && activeId ? parseContainer(drag.origin).statusId : null
  const showLanes = swimlane !== 'none'
  const isCollapsed = (column: BoardColumn) => view.collapsed.includes(column.status.id)
  // o quadro ocupa só a tela visível: sem raias, cada coluna rola por dentro; com raias, o quadro rola
  // (cabeçalho das colunas fica preso no topo)
  const [boardRef, boardHeight] = useFillHeight<HTMLDivElement>()
  const fixed = boardHeight !== undefined
  const showProject = isAllProjects(board)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t('kanban.announce.instructions') } }}
    >
      {/* rolagem horizontal com "encaixe" por coluna no celular */}
      <div
        ref={boardRef}
        className={cn('relative -mx-4 snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:snap-none sm:px-0', fixed && showLanes && 'overflow-y-auto')}
        style={fixed ? { height: boardHeight } : undefined}
        data-testid="kanban-board"
      >
        {/* colunas crescem para ocupar a largura; abaixo do mínimo (16rem, 13rem no compacto) o quadro rola na
            horizontal; as recolhidas viram uma faixa estreita */}
        <div
          className={cn('grid min-w-full', view.compact ? 'gap-2' : 'gap-3', fixed && !showLanes && 'h-full')}
          style={{ gridTemplateColumns: columnTemplate(board.columns, view), gridTemplateRows: fixed && !showLanes ? 'auto minmax(0, 1fr)' : undefined }}
        >
          {board.columns.map((column) => {
            // no quadro de todos os projetos o limite (que é por projeto) não aparece
            const wipLimit = boardWipLimit(board, column)
            const wip = wipState({ wipLimit, total: column.total })
            const blocked = !!originStatus && !canTransition(board, originStatus, column.status.id)
            return (
              <div key={column.status.id} className={cn('snap-start', fixed && showLanes && 'sticky top-0 z-10 bg-bg pb-1')}>
                <AppKanbanColumnHeader
                  title={column.status.name}
                  accent={optionColor(column.status.color)}
                  count={wipLimit ? `${column.total}/${wipLimit}` : column.total}
                  countLabel={wipLimit ? t('kanban.wipCount', { count: column.total, limit: wipLimit }) : t('kanban.count', { count: column.total })}
                  wip={wip}
                  blocked={blocked}
                  collapsed={isCollapsed(column)}
                  compact={view.compact}
                  onToggleCollapse={onToggleCollapse && (() => onToggleCollapse(column.status.id))}
                  toggleLabel={t(isCollapsed(column) ? 'kanban.expand' : 'kanban.collapse', { name: column.status.name })}
                  actions={
                    onQuickAdd &&
                    !view.compact && (
                      <AppIconButton
                        size="sm"
                        variant="ghost"
                        icon={<Plus />}
                        label={t('kanban.addTo', { name: column.status.name })}
                        onClick={() => onQuickAdd(column.status.id)}
                      />
                    )
                  }
                />
              </div>
            )
          })}

          {lanes.map((lane) => (
            <Fragment key={lane.id}>
              {showLanes && (
                <div className="sticky left-0 col-span-full mt-2 flex items-center gap-2 text-sm font-medium text-fg" role="heading" aria-level={2}>
                  <LaneLabel lane={lane} swimlane={swimlane} />
                </div>
              )}
              {board.columns.map((column) => {
                const key = containerId(lane.id, column.status.id)
                if (isCollapsed(column)) {
                  return (
                    <CollapsedCell
                      key={key}
                      id={key}
                      ids={containers[key] ?? []}
                      blocked={!!drag && !!activeId && !allowed(key)}
                      tall={!showLanes}
                      fixed={fixed}
                      compact={view.compact}
                      name={column.status.name}
                      expandLabel={t('kanban.expand', { name: column.status.name })}
                      onExpand={onToggleCollapse && (() => onToggleCollapse(column.status.id))}
                    />
                  )
                }
                return (
                  <Cell
                    key={key}
                    id={key}
                    ids={containers[key] ?? []}
                    blocked={!!drag && !!activeId && !allowed(key)}
                    tall={!showLanes}
                      fixed={fixed}
                      compact={view.compact}
                    label={showLanes ? `${column.status.name} · ${lane.name || t(`kanban.noLane.${swimlane}`)}` : column.status.name}
                    footer={
                      column.truncated && !showLanes ? (
                        <p className="px-1 pt-1 text-xs text-subtle">
                          {/* encerradas: as mais recentes; abertas: as primeiras pela ordem do quadro */}
                          {t(isClosedCategory(column.status.category) ? 'kanban.truncated' : 'kanban.truncatedOpen', { shown: column.cards.length, total: column.total })}
                        </p>
                      ) : null
                    }
                    empty={!showLanes ? t('kanban.emptyColumn') : undefined}
                  >
                    {(containers[key] ?? []).map((cardId) => {
                      const card = cards.get(cardId)?.card
                      return card ? (
                        <SortableKanbanCard key={cardId} card={card} locked={!canMoveCard(board, card)} onOpen={onOpen} references={references} showProject={showProject} compact={view.compact} />
                      ) : null
                    })}
                  </Cell>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {active ? (
          <AppKanbanCard overlay className={view.compact ? 'w-56 gap-1.5 p-2.5' : 'w-72'}>
            <KanbanCardContent card={active} references={references} showProject={showProject} compact={view.compact} />
          </AppKanbanCard>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

/**
 * Coluna recolhida: faixa estreita com o nome na vertical e a quantidade de cards; continua recebendo
 * cards soltos (o card entra e fica escondido). Clicar expande.
 */
function CollapsedCell({
  id,
  ids,
  blocked,
  tall,
  name,
  expandLabel,
  onExpand,
  fixed,
  compact,
}: {
  id: string
  ids: string[]
  blocked: boolean
  tall: boolean
  fixed: boolean
  compact: boolean
  name: string
  expandLabel: string
  onExpand?: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <SortableContext id={id} items={ids} strategy={verticalListSortingStrategy}>
      <AppKanbanDropZone ref={setNodeRef} over={isOver} blocked={blocked} aria-label={name} data-testid={`kanban-cell-${id}`} className={cn('items-center p-1', compact && 'rounded-lg', tall && 'min-h-40', tall && fixed && 'h-full')}>
        <button
          type="button"
          onClick={onExpand}
          title={expandLabel}
          aria-label={`${expandLabel} (${ids.length})`}
          className="flex flex-1 flex-col items-center gap-2 rounded-lg py-2 text-xs font-medium text-muted hover:bg-surface-3 hover:text-fg"
        >
          <span className="rounded-full bg-surface-3 px-1.5 py-0.5 tabular-nums">{ids.length}</span>
          <span className="[writing-mode:vertical-rl]">{name}</span>
        </button>
      </AppKanbanDropZone>
    </SortableContext>
  )
}

function Cell({
  id,
  ids,
  blocked,
  tall,
  label,
  footer,
  empty,
  children,
  fixed,
  compact,
}: {
  id: string
  ids: string[]
  blocked: boolean
  tall: boolean
  fixed: boolean
  compact: boolean
  label: string
  footer: ReactNode
  empty?: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <SortableContext id={id} items={ids} strategy={verticalListSortingStrategy}>
      <AppKanbanDropZone
        ref={setNodeRef}
        over={isOver}
        blocked={blocked}
        aria-label={label}
        data-testid={`kanban-cell-${id}`}
        // quadro fixo: a coluna ocupa a altura disponível e rola por dentro; sem medida, um teto aproximado
        className={cn(compact && 'gap-1.5 rounded-lg p-1.5', tall && (fixed ? 'h-full min-h-0 overflow-y-auto' : 'max-h-[calc(100dvh-17rem)] min-h-40 overflow-y-auto'))}
      >
        {children}
        {ids.length === 0 && empty && <p className="py-6 text-center text-xs text-subtle">{empty}</p>}
        {footer}
      </AppKanbanDropZone>
    </SortableContext>
  )
}

function LaneLabel({ lane, swimlane }: { lane: Lane; swimlane: Swimlane }) {
  const { t } = useTranslation()
  if (!lane.id) return <span className="text-muted">{t(`kanban.noLane.${swimlane}`)}</span>
  if (lane.person) {
    return (
      <>
        <AppAvatar name={lane.person.name} src={lane.person.avatarUrl} size="xs" />
        {lane.name}
      </>
    )
  }
  if (lane.icon && lane.color) {
    return (
      <>
        <TaskTypeIconBadge icon={lane.icon} color={lane.color} size="sm" />
        {lane.name}
      </>
    )
  }
  return lane.color ? <LookupBadge item={{ name: lane.name, color: lane.color }} /> : <>{lane.name}</>
}
