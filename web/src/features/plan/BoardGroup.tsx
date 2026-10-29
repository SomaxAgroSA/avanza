import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, ChevronRight, Copy, FolderPlus, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { PlanItem } from '@/domain/plan'
import { groupTitle, type BoardSection } from '@/domain/plan-view'
import { AppBoardTable, AppCheckbox, AppDropdown, type AppBoardColumn, type AppDropdownItem, type BoardColumnsApi } from '@/presentation/components'
import { optionColor, optionText } from '@/features/task-config/config-theme'

export interface GroupActions {
  edit: () => void
  addSubgroup?: () => void
  addItem?: () => void
  moveUp?: () => void
  moveDown?: () => void
  duplicate: () => void
  remove: () => void
}

/** Marcar todos os elementos visíveis do grupo. */
export interface GroupSelection {
  checked: boolean | 'indeterminate'
  onChange: (checked: boolean) => void
}

/** Título colorido do grupo ("2.0 Planejamento | 2.1 Plano do Projeto") com recolher, alça de arrastar e menu. */
function GroupTitle({
  section,
  collapsed,
  onToggle,
  count,
  actions,
  dragHandle,
}: {
  section: BoardSection
  collapsed: boolean
  onToggle: () => void
  count: ReactNode
  actions: GroupActions | null
  dragHandle?: ReactNode
}) {
  const { t } = useTranslation()
  const { group, parent } = section
  const title = parent ? `${groupTitle(parent)} | ${groupTitle(group)}` : groupTitle(group)
  const items: AppDropdownItem[] = actions
    ? [
        { key: 'edit', label: t('plan.group.edit'), icon: <Pencil />, onSelect: actions.edit },
        ...(actions.addItem ? [{ key: 'add-item', label: t('plan.addItemHere'), icon: <Plus />, onSelect: actions.addItem }] : []),
        ...(actions.addSubgroup ? [{ key: 'add-sub', label: t('plan.group.addSub'), icon: <FolderPlus />, onSelect: actions.addSubgroup }] : []),
        { type: 'separator', key: 'sep-1' },
        { key: 'up', label: t('plan.group.moveUp'), icon: <ArrowUp />, disabled: !actions.moveUp, onSelect: () => actions.moveUp?.() },
        { key: 'down', label: t('plan.group.moveDown'), icon: <ArrowDown />, disabled: !actions.moveDown, onSelect: () => actions.moveDown?.() },
        { key: 'duplicate', label: t('plan.group.duplicate'), icon: <Copy />, onSelect: actions.duplicate },
        { type: 'separator', key: 'sep-2' },
        { key: 'delete', label: t('plan.group.delete'), icon: <Trash2 />, tone: 'danger', onSelect: actions.remove },
      ]
    : []
  return (
    <div className="group/title flex min-w-0 items-center gap-1.5">
      {dragHandle}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('plan.expandGroup', { name: title }) : t('plan.collapseGroup', { name: title })}
        className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
        style={{ color: optionText(group.color) }}
      >
        <ChevronRight className={cn('size-4 transition-transform', !collapsed && 'rotate-90')} />
      </button>
      <h3 className="min-w-0 truncate text-[15px] font-semibold">
        {parent && (
          <>
            <span style={{ color: optionText(parent.color) }}>{groupTitle(parent)}</span>
            <span className="text-subtle"> | </span>
          </>
        )}
        <span style={{ color: optionText(group.color) }}>{groupTitle(group)}</span>
      </h3>
      <span className="shrink-0 text-xs text-muted">{count}</span>
      {items.length > 0 && (
        <AppDropdown
          align="start"
          items={items}
          trigger={
            <button
              type="button"
              aria-label={t('plan.group.actions', { name: title })}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4"
            >
              <MoreHorizontal />
            </button>
          }
        />
      )}
    </div>
  )
}

/** Um grupo do quadro: título + tabela (ou a linha de resumo, recolhido). Fase só com subgrupos: só o título. */
export function BoardGroup({
  section,
  collapsed,
  onToggle,
  columns,
  api,
  rows,
  footer,
  actions,
  renderExpanded,
  addRow,
  selection,
  isRowSelected,
  sortable,
  dragHandle,
  headerTrail,
}: {
  section: BoardSection
  collapsed: boolean
  onToggle: () => void
  columns: AppBoardColumn<PlanItem>[]
  api: BoardColumnsApi
  /** Linhas na ordem da tela (durante o arraste, a da tela). */
  rows: PlanItem[]
  footer: Partial<Record<string, ReactNode>>
  actions: GroupActions | null
  renderExpanded: (item: PlanItem) => ReactNode | null
  addRow: ReactNode
  selection?: GroupSelection
  isRowSelected?: (item: PlanItem) => boolean
  sortable?: { containerId: string; disabled: boolean }
  dragHandle?: ReactNode
  /** Fim do cabeçalho da tabela (ex.: "+" para adicionar coluna). */
  headerTrail?: ReactNode
}) {
  const { t } = useTranslation()
  const { group, parent } = section
  const caption = parent ? `${groupTitle(parent)} | ${groupTitle(group)}` : groupTitle(group)
  const count = section.headerOnly ? t('plan.subgroupsCount', { count: section.subgroups }) : t('plan.itemsCount', { count: section.items.length })
  const title = <GroupTitle section={section} collapsed={collapsed} onToggle={onToggle} count={count} actions={actions} dragHandle={dragHandle} />
  // fora da tabela, o título fica parado à esquerda ao rolar para o lado (como a 1ª coluna)
  const stickyTitle = <div className="w-fit sm:sticky sm:left-0">{title}</div>

  if (section.headerOnly)
    return (
      <section aria-label={caption} className="pt-2">
        {stickyTitle}
      </section>
    )

  return (
    <section aria-label={caption} className="flex flex-col gap-1">
      {!collapsed && stickyTitle}
      <AppBoardTable
        caption={caption}
        accent={optionColor(group.color)}
        columns={columns}
        api={api}
        rows={rows}
        rowKey={(item) => item.id}
        renderExpanded={renderExpanded}
        addRow={addRow}
        footer={footer}
        collapsed={collapsed}
        collapsedSummary={title}
        isRowSelected={isRowSelected}
        headerTrail={headerTrail}
        headerLead={
          selection && (
            // alinhado à caixa das linhas (depois da alça de arrastar)
            <span className="flex shrink-0 pl-[26px] pr-1.5">
              <AppCheckbox checked={selection.checked} onCheckedChange={selection.onChange} aria-label={t('plan.selectAll', { name: caption })} />
            </span>
          )
        }
        sortable={sortable ? { ...sortable, handleLabel: (item) => t('plan.dragItem', { name: item.name }) } : undefined}
      />
    </section>
  )
}

/** Bloco de grupo arrastável (fase com os subgrupos, ou um subgrupo): a alça fica no título. */
export function SortableGroupBlock({ id, container, disabled, label, children }: { id: string; container: string; disabled: boolean; label: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled, data: { container } })
  const handle = disabled ? null : (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-subtle opacity-0 hover:bg-surface-2 hover:text-fg focus-visible:opacity-100 group-hover/title:opacity-100 active:cursor-grabbing [&_svg]:size-4"
    >
      <GripVertical />
    </button>
  )
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn('flex flex-col gap-5', isDragging && 'opacity-40')}>
      {children(handle)}
    </div>
  )
}

/** Linha "+ Adicionar elemento/subelemento": Enter cria e mantém o foco para o próximo. */
export function AddRowInput({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  async function add() {
    const value = name.trim()
    if (!value || pending) return
    setPending(true)
    try {
      await onAdd(value)
      setName('')
    } catch {
      // a mensagem de erro já foi mostrada
    } finally {
      setPending(false)
    }
  }
  return (
    <input
      value={name}
      aria-label={label}
      placeholder={placeholder}
      maxLength={255}
      disabled={pending}
      onChange={(event) => setName(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void add()
        } else if (event.key === 'Escape') setName('')
      }}
      className="h-full min-h-9 w-full bg-transparent px-3 text-sm text-fg outline-none placeholder:text-subtle focus:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    />
  )
}
