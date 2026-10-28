import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  closestCenter,
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
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MoreHorizontal } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatNumber } from '@/core/utils/format'
import { groupOf, type BacklogGroup } from '@/domain/backlog'
import type { SprintRef } from '@/domain/sprints'
import { neighbors } from '@/domain/kanban'
import type { TaskSummary } from '@/domain/tasks'
import { AppAvatar, AppCheckbox, AppDropdown, AppIconButton, type AppDropdownItem } from '@/presentation/components'
import { TagList } from '@/features/tags/tag-visuals'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { DueDate, TaskCode, TaskIndicators } from '@/features/tasks/task-visuals'

export interface BacklogRankEvent {
  item: TaskSummary
  prevId?: string
  nextId?: string
  /** Presente quando o item mudou de grupo (null = sem sprint). */
  sprint?: SprintRef | null
}

export interface BacklogListProps {
  groups: BacklogGroup[]
  /** Arrastar liberado (ordem manual + permissão). */
  sortable: boolean
  selected: ReadonlySet<string>
  /** Grupos recolhidos (só o cabeçalho aparece). */
  collapsed?: ReadonlySet<string>
  onToggle: (id: string, checked: boolean) => void
  onOpen: (id: string) => void
  onRank: (event: BacklogRankEvent) => void
  /** Ações do menu "…" de cada item. */
  itemActions: (item: TaskSummary) => AppDropdownItem[]
  /** Cabeçalho de cada grupo (nome, período, ações). */
  renderHeader: (group: BacklogGroup) => ReactNode
  emptyLabel: (group: BacklogGroup) => string
}

const refOf = (group: BacklogGroup): SprintRef | null =>
  group.sprint
    ? {
        id: group.sprint.id,
        name: group.sprint.name,
        state: group.sprint.state,
      }
    : null

/** Estado do arraste: cópia dos grupos (alterada durante o arraste) e grupo de origem. */
interface DragState {
  items: Record<string, string[]>
  origin: string
  groups: BacklogGroup[]
}

export function BacklogList({ groups, sortable, selected, collapsed, onToggle, onOpen, onRank, itemActions, renderHeader, emptyLabel }: BacklogListProps) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  // depois de soltar, a cópia fica até a lista mudar (atualização otimista): sem "piscar"
  if (drag && !activeId && drag.groups !== groups) setDrag(null)

  const base = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.items.map((i) => i.id)])), [groups])
  const containers = drag ? drag.items : base
  const byId = useMemo(() => new Map(groups.flatMap((g) => g.items.map((i) => [i.id, i] as const))), [groups])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  // Prefere o item mais próximo; o grupo só vale quando está vazio sob o ponteiro
  // (senão a lista inteira "ganha" dos itens e a reordenação no mesmo grupo se perde).
  const collision: CollisionDetection = (args) => {
    const items = closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((d) => !(String(d.id) in containers)),
    })
    const emptyGroup = pointerWithin(args).find((c) => String(c.id) in containers && (containers[String(c.id)] ?? []).length === 0)
    return emptyGroup ? [emptyGroup] : items
  }

  function findGroup(id: UniqueIdentifier, from = containers): string | undefined {
    const key = String(id)
    if (key in from) return key
    return Object.keys(from).find((k) => from[k]?.includes(key))
  }

  function onDragStart({ active }: DragStartEvent) {
    const origin = findGroup(active.id, base)
    if (!origin) return
    setActiveId(String(active.id))
    setDrag({
      items: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, [...v]])),
      origin,
      groups,
    })
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || !drag) return
    const from = findGroup(active.id)
    const to = findGroup(over.id)
    if (!from || !to || from === to) return
    setDrag((current) => {
      if (!current) return current
      const source = (current.items[from] ?? []).filter((id) => id !== String(active.id))
      const target = [...(current.items[to] ?? [])]
      const overIndex = target.indexOf(String(over.id))
      const translated = active.rect.current.translated
      const below = !!translated && translated.top > over.rect.top + over.rect.height / 2
      target.splice(overIndex < 0 ? target.length : overIndex + (below ? 1 : 0), 0, String(active.id))
      return {
        ...current,
        items: { ...current.items, [from]: source, [to]: target },
      }
    })
  }

  function cancel() {
    setDrag(null)
    setActiveId(null)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const state = drag
    const id = String(active.id)
    const item = byId.get(id)
    if (!state || !over || !item) return cancel()
    const current = findGroup(id, state.items)
    if (!current) return cancel()
    let list = state.items[current] ?? []
    if (findGroup(over.id, state.items) === current && over.id !== active.id && !(String(over.id) in state.items)) {
      list = arrayMove(list, list.indexOf(id), list.indexOf(String(over.id)))
    }
    const unchanged = current === state.origin && list.join('|') === (base[state.origin] ?? []).join('|')
    if (unchanged) return cancel()
    setDrag({ ...state, items: { ...state.items, [current]: list } })
    setActiveId(null)
    const group = groups.find((g) => g.id === current)
    onRank({
      item,
      ...neighbors(list, id),
      ...(current !== groupOf(item) && group ? { sprint: refOf(group) } : {}),
    })
  }

  const labelOf = (id: UniqueIdentifier) => {
    const item = byId.get(String(id))
    return item ? `${item.code} · ${item.title}` : String(id)
  }
  const groupName = (id: UniqueIdentifier | undefined) => {
    const key = id === undefined ? undefined : findGroup(id)
    const group = groups.find((g) => g.id === key)
    return group?.sprint?.name ?? t('backlog.noSprintGroup')
  }
  const positionIn = (id: UniqueIdentifier) => {
    const key = findGroup(id)
    return key ? (containers[key] ?? []).indexOf(String(id)) + 1 : 0
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t('backlog.announce.picked', {
        item: labelOf(active.id),
        group: groupName(active.id),
        position: positionIn(active.id),
      }),
    onDragOver: ({ active, over }) =>
      over
        ? t('backlog.announce.over', {
            item: labelOf(active.id),
            group: groupName(over.id),
            position: positionIn(active.id),
          })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t('backlog.announce.dropped', {
            item: labelOf(active.id),
            group: groupName(over.id),
          })
        : undefined,
    onDragCancel: ({ active }) => t('backlog.announce.cancelled', { item: labelOf(active.id) }),
  }

  const active = activeId ? byId.get(activeId) : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={cancel}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: t('backlog.announce.instructions'),
        },
      }}
    >
      <div className="flex flex-col gap-4" data-testid="backlog-list">
        {groups.map((group) => (
          <section
            key={group.id}
            className="relative rounded-2xl border border-border bg-surface shadow-card"
            aria-label={group.sprint?.name ?? t('backlog.noSprintGroup')}
            data-testid={`backlog-group-${group.id}`}
          >
            {renderHeader(group)}
            {!collapsed?.has(group.id) && (
              <GroupBody id={group.id} ids={containers[group.id] ?? []} empty={emptyLabel(group)} highlight={!!activeId}>
                {(containers[group.id] ?? []).map((itemId) => {
                  const item = byId.get(itemId)
                  return item ? (
                    <SortableRow
                      key={itemId}
                      item={item}
                      sortable={sortable}
                      checked={selected.has(itemId)}
                      onToggle={onToggle}
                      onOpen={onOpen}
                      actions={itemActions(item)}
                    />
                  ) : null
                })}
              </GroupBody>
            )}
          </section>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="rounded-lg border border-border bg-surface shadow-float">
            <RowContent item={active} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function GroupBody({ id, ids, empty, highlight, children }: { id: string; ids: string[]; empty: string; highlight: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <SortableContext id={id} items={ids} strategy={verticalListSortingStrategy}>
      <ul
        ref={setNodeRef}
        className={cn('flex min-h-14 flex-col divide-y divide-border border-t border-border transition-colors', highlight && isOver && 'bg-primary-soft')}
      >
        {children}
        {ids.length === 0 && <li className="px-4 py-5 text-center text-sm text-subtle">{empty}</li>}
      </ul>
    </SortableContext>
  )
}

/** Conteúdo da linha: código, título, tags, prioridade, responsável, estimativa e prazo. */
function RowContent({ item, onOpen }: { item: TaskSummary; onOpen?: (id: string) => void }) {
  const { t, i18n } = useTranslation()
  const title = <span className="truncate">{item.title}</span>
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2">
      <TaskCode task={item} className="shrink-0" />
      {onOpen ? (
        <button type="button" onClick={() => onOpen(item.id)} className="flex min-w-0 flex-1 basis-40 text-left text-sm font-medium text-fg hover:text-primary-text">
          {title}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 basis-40 text-sm font-medium text-fg">{title}</span>
      )}
      <TagList tags={item.tags} max={2} className="hidden md:flex" />
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {/* backlog e já analisadas convivem na lista: o status diz em que ponto o item está */}
        <TaskIndicators task={item} />
        {item.status && <LookupBadge item={item.status} />}
        {item.priority && <LookupBadge item={item.priority} />}
        {item.dueDate && <DueDate task={item} />}
        <span className="w-12 text-right tabular-nums text-muted" title={t('tasks.fields.estimatedHours')}>
          {item.estimatedHours === null
            ? '—'
            : t('backlog.hours', {
                value: formatNumber(item.estimatedHours, i18n.language),
              })}
        </span>
        {item.assignee ? (
          <span title={item.assignee.name}>
            <AppAvatar name={item.assignee.name} src={item.assignee.avatarUrl} size="xs" />
            <span className="sr-only">{t('kanban.assignedTo', { name: item.assignee.name })}</span>
          </span>
        ) : (
          <span className="size-6" aria-hidden />
        )}
      </span>
    </div>
  )
}

function SortableRow({
  item,
  sortable,
  checked,
  onToggle,
  onOpen,
  actions,
}: {
  item: TaskSummary
  sortable: boolean
  checked: boolean
  onToggle: (id: string, checked: boolean) => void
  onOpen: (id: string) => void
  actions: AppDropdownItem[]
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !sortable })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('flex items-center gap-1 bg-surface pr-2 pl-1 first:rounded-none last:rounded-b-2xl hover:bg-surface-2', isDragging && 'opacity-40')}
      data-testid={`backlog-item-${item.id}`}
    >
      {sortable ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t('backlog.dragHandle', {
            item: `${item.code} · ${item.title}`,
          })}
          className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-subtle hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      ) : (
        <span className="size-7 shrink-0" aria-hidden />
      )}
      <AppCheckbox checked={checked} onCheckedChange={(value) => onToggle(item.id, value)} aria-label={t('backlog.select', { item: item.code })} />
      <RowContent item={item} onOpen={onOpen} />
      {actions.length > 0 && (
        <AppDropdown
          trigger={<AppIconButton size="sm" variant="ghost" icon={<MoreHorizontal />} label={t('backlog.actionsFor', { item: item.code })} />}
          items={actions}
        />
      )}
    </li>
  )
}
