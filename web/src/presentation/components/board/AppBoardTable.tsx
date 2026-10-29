import { useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronsLeftRight, ChevronsRightLeft, EyeOff, Filter, GripVertical, MoreHorizontal, X } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { AppDropdown, type AppDropdownItem } from '../AppDropdown'
import { BOARD_TRAIL_WIDTH, boardTableStyle, visibleColumns, type BoardColumnDef } from './board-columns'
import type { BoardColumnsApi } from './use-board-columns'

/** Extras entregues à célula: a alça de arrastar (só na 1ª coluna, quando a tabela é ordenável). */
export interface BoardCellExtra {
  dragHandle: ReactNode | null
}

export interface AppBoardColumn<Row> extends BoardColumnDef {
  /** Rótulo do cabeçalho (também nos menus e no grupo recolhido). */
  label: string
  cell: (row: Row, extra: BoardCellExtra) => ReactNode
  /** Mostra "Filtrar" no menu da coluna. */
  onFilter?: () => void
  /** Mostra "Ordenar" no menu da coluna. */
  sortable?: boolean
  /** Célula sem espaçamento interno (ex.: status em bloco cheio). */
  flush?: boolean
  align?: 'start' | 'center'
  /** Itens a mais no fim do menu da coluna (ex.: renomear, duplicar, excluir coluna personalizada). */
  menuExtra?: AppDropdownItem[]
}

export interface AppBoardTableProps<Row> {
  /** Nome acessível da tabela (ex.: "1.0 Iniciação"). */
  caption: string
  /** Cor da faixa à esquerda (cor do grupo). */
  accent: string
  columns: AppBoardColumn<Row>[]
  api: BoardColumnsApi
  rows: Row[]
  rowKey: (row: Row) => string
  /** Conteúdo abaixo da linha (ex.: tabela de subelementos); null = nada. */
  renderExpanded?: (row: Row) => ReactNode | null
  /** Linha "+ Adicionar…" (conteúdo da 1ª coluna). */
  addRow?: ReactNode
  /** Totais por coluna (rodapé e grupo recolhido). */
  footer?: Partial<Record<string, ReactNode>>
  /** Grupo recolhido: uma linha com o resumo na 1ª coluna e os totais alinhados às colunas. */
  collapsed?: boolean
  collapsedSummary?: ReactNode
  /** Tabela aninhada (subelementos): mais compacta. */
  nested?: boolean
  /** Conteúdo antes do rótulo da 1ª coluna (ex.: marcar todos). */
  headerLead?: ReactNode
  /** Conteúdo no fim do cabeçalho, depois da última coluna (ex.: "+" para adicionar coluna). */
  headerTrail?: ReactNode
  /** Linha destacada (ex.: selecionada). */
  isRowSelected?: (row: Row) => boolean
  /**
   * Linhas arrastáveis (dnd-kit; o DndContext fica com quem usa): `containerId` identifica a tabela
   * (também é a área de soltar quando ela está vazia).
   */
  sortable?: { containerId: string; disabled?: boolean; handleLabel: (row: Row) => string }
  className?: string
}

const DRAG_TYPE = 'application/x-kamban-board-column'
const RESIZE_STEP = 16

/**
 * Tabela de grupo do quadro (estilo Monday): faixa colorida à esquerda, 1ª coluna fixa ao rolar,
 * cabeçalho com menu por coluna (ordenar, recolher, ocultar, mover), arrastar para reordenar,
 * redimensionar (mouse ou setas), linha de adicionar, rodapé de totais e modo recolhido.
 * Ocupa a largura toda: uma coluna vazia no fim absorve a sobra (as colunas mantêm a largura); a largura
 * vem de `boardTableStyle` (px, nunca %), então a rolagem lateral acaba na última coluna.
 * Linhas arrastáveis (`sortable`), destaque de selecionadas e "Filtrar" no menu da coluna (`onFilter`).
 * O estado das colunas vem de `useBoardColumns` e vale para todas as tabelas do quadro.
 */
export function AppBoardTable<Row>({
  caption,
  accent,
  columns,
  api,
  rows,
  rowKey,
  renderExpanded,
  addRow,
  footer,
  collapsed = false,
  collapsedSummary,
  nested = false,
  headerLead,
  headerTrail,
  isRowSelected,
  sortable,
  className,
}: AppBoardTableProps<Row>) {
  const { t } = useTranslation()
  const visible = visibleColumns(columns, api.state)
  const [live, setLive] = useState<{ id: string; width: number } | null>(null)
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null)
  const dragId = useRef<string | null>(null)
  const widthOf = (c: (typeof visible)[number]) => (live && live.id === c.id ? live.width : c.effectiveWidth)
  // mesma reserva recolhido ou não: as tabelas de todos os grupos acabam no mesmo ponto
  const tableStyle: CSSProperties = boardTableStyle(visible.map(widthOf), headerTrail ? BOARD_TRAIL_WIDTH : 0)
  const accentStyle: CSSProperties = { borderLeftColor: accent }
  const cellPad = nested ? 'px-2 py-1' : 'px-2 py-1.5'
  const rowHeight = nested ? 'h-8' : 'h-9'

  const first = visible[0]
  const rest = visible.slice(1)

  function startResize(event: ReactPointerEvent<HTMLDivElement>, column: (typeof visible)[number]) {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = column.effectiveWidth
    const min = column.minWidth ?? 72
    let width = startWidth
    const onMove = (e: PointerEvent) => {
      width = Math.max(min, startWidth + e.clientX - startX)
      setLive({ id: column.id, width })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setLive(null)
      if (width !== startWidth) api.resize(column.id, width)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function menuItems(column: (typeof visible)[number]): AppDropdownItem[] {
    const items: AppDropdownItem[] = []
    if (column.onFilter) items.push({ key: 'filter', label: t('board.filterColumn'), icon: <Filter />, onSelect: column.onFilter }, { type: 'separator', key: 'sep-0' })
    if (column.sortable) {
      const current = api.sort?.column === column.id ? api.sort.direction : null
      items.push(
        { key: 'asc', label: t('board.sortAsc'), icon: <ArrowUp />, disabled: current === 'asc', onSelect: () => api.setSort({ column: column.id, direction: 'asc' }) },
        { key: 'desc', label: t('board.sortDesc'), icon: <ArrowDown />, disabled: current === 'desc', onSelect: () => api.setSort({ column: column.id, direction: 'desc' }) },
      )
      if (current) items.push({ key: 'unsort', label: t('board.clearSort'), icon: <X />, onSelect: () => api.setSort(null) })
    }
    if (!column.pinned) {
      if (items.length) items.push({ type: 'separator', key: 'sep-1' })
      items.push({
        key: 'collapse',
        label: column.collapsed ? t('board.expandColumn') : t('board.collapseColumn'),
        icon: column.collapsed ? <ChevronsLeftRight /> : <ChevronsRightLeft />,
        onSelect: () => api.setCollapsed(column.id, !column.collapsed),
      })
      if (column.hideable !== false) items.push({ key: 'hide', label: t('board.hideColumn'), icon: <EyeOff />, onSelect: () => api.setHidden(column.id, true) })
      items.push(
        { type: 'separator', key: 'sep-2' },
        { key: 'left', label: t('board.moveLeft'), icon: <ArrowLeft />, disabled: !api.canShift(column.id, -1), onSelect: () => api.shift(column.id, -1) },
        { key: 'right', label: t('board.moveRight'), icon: <ArrowRight />, disabled: !api.canShift(column.id, 1), onSelect: () => api.shift(column.id, 1) },
      )
    }
    if (column.menuExtra?.length) items.push({ type: 'separator', key: 'sep-extra' }, ...column.menuExtra)
    return items
  }

  function onDragOver(event: DragEvent<HTMLTableCellElement>, column: (typeof visible)[number]) {
    if (!event.dataTransfer.types.includes(DRAG_TYPE) || column.pinned) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const box = event.currentTarget.getBoundingClientRect()
    const after = event.clientX > box.left + box.width / 2
    if (dropAt?.id !== column.id || dropAt.after !== after) setDropAt({ id: column.id, after })
  }

  function onDrop(event: DragEvent<HTMLTableCellElement>, column: (typeof visible)[number]) {
    const id = event.dataTransfer.getData(DRAG_TYPE) || dragId.current
    setDropAt(null)
    if (!id || column.pinned) return
    event.preventDefault()
    api.move(id, column.id, dropAt?.after ?? false)
  }

  const colgroup = (
    <colgroup>
      {visible.map((c) => (
        <col key={c.id} style={{ width: widthOf(c) }} />
      ))}
      <col />
    </colgroup>
  )

  const stickyCell = 'sm:sticky sm:left-0 z-[1]'

  if (collapsed) {
    return (
      <table aria-label={caption} className={cn('table-fixed border-separate border-spacing-0 text-sm', className)} style={tableStyle}>
        {colgroup}
        <thead className="sr-only">
          <tr>
            {visible.map((c) => (
              <th key={c.id} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {first && (
              <td className={cn(stickyCell, 'rounded-l-lg border-y border-l-4 border-r border-border bg-surface px-3 py-2')} style={accentStyle}>
                {collapsedSummary}
              </td>
            )}
            {rest.map((c) => (
              <td key={c.id} className="border-y border-r border-border bg-surface px-2 py-1.5 text-center">
                <span aria-hidden className="block truncate text-[11px] text-subtle">
                  {c.collapsed ? '' : c.label}
                </span>
                {!c.collapsed && <div className="flex min-h-5 items-center justify-center">{footer?.[c.id]}</div>}
              </td>
            ))}
            <td aria-hidden className="rounded-r-lg border-y border-r border-border bg-surface" />
          </tr>
        </tbody>
      </table>
    )
  }

  return (
    <table aria-label={caption} className={cn('table-fixed border-separate border-spacing-0 text-sm', className)} style={tableStyle}>
      {colgroup}
      <thead>
        <tr>
          {visible.map((c, index) => {
            const sorted = api.sort?.column === c.id ? api.sort.direction : null
            const items = menuItems(c)
            const indicator = dropAt?.id === c.id
            return (
              <th
                key={c.id}
                scope="col"
                aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                draggable={!c.pinned}
                onDragStart={(event) => {
                  dragId.current = c.id
                  event.dataTransfer.setData(DRAG_TYPE, c.id)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={() => {
                  dragId.current = null
                  setDropAt(null)
                }}
                onDragOver={(event) => onDragOver(event, c)}
                onDragLeave={() => setDropAt((current) => (current?.id === c.id ? null : current))}
                onDrop={(event) => onDrop(event, c)}
                style={index === 0 ? accentStyle : undefined}
                className={cn(
                  'group/th relative border-b border-r border-t border-border bg-surface font-medium text-muted',
                  nested ? 'h-8 text-xs' : 'h-9 text-[13px]',
                  index === 0 && cn(stickyCell, 'z-[2] rounded-tl-lg border-l-4 text-left'),
                  !c.pinned && 'cursor-grab active:cursor-grabbing',
                  indicator && (dropAt?.after ? 'shadow-[inset_-3px_0_0_var(--color-primary)]' : 'shadow-[inset_3px_0_0_var(--color-primary)]'),
                )}
              >
                {c.collapsed ? (
                  <button
                    type="button"
                    onClick={() => api.setCollapsed(c.id, false)}
                    aria-label={t('board.expandColumnNamed', { name: c.label })}
                    title={c.label}
                    className="mx-auto flex size-7 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg [&_svg]:size-3.5"
                  >
                    <ChevronsLeftRight />
                  </button>
                ) : (
                  <div className={cn('flex min-w-0 items-center gap-1 px-2', index === 0 ? 'justify-start' : 'justify-center')}>
                    {index === 0 && headerLead}
                    {/* contrapeso do botão de menu (à direita): o título fica no centro da coluna */}
                    {index > 0 && items.length > 0 && <span aria-hidden className="size-6 shrink-0" />}
                    <span className="truncate">{c.label}</span>
                    {sorted === 'asc' && <ArrowUp aria-hidden className="size-3.5 shrink-0 text-primary-text" />}
                    {sorted === 'desc' && <ArrowDown aria-hidden className="size-3.5 shrink-0 text-primary-text" />}
                    {items.length > 0 && (
                      <AppDropdown
                        align="start"
                        items={items}
                        trigger={
                          <button
                            type="button"
                            aria-label={t('board.columnMenu', { name: c.label })}
                            className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg focus-visible:opacity-100 group-hover/th:opacity-100 data-[state=open]:opacity-100 [&_svg]:size-3.5"
                          >
                            <MoreHorizontal />
                          </button>
                        }
                      />
                    )}
                  </div>
                )}
                {!c.collapsed && (
                  // Separador focável (padrão "window splitter"): arrastar redimensiona; setas ajustam; duplo clique volta ao padrão.
                  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={t('board.resizeColumn', { name: c.label })}
                    aria-valuenow={widthOf(c)}
                    tabIndex={0}
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    onPointerDown={(event) => startResize(event, c)}
                    onDoubleClick={() => api.resize(c.id, null)}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                      event.preventDefault()
                      api.resize(c.id, c.effectiveWidth + (event.key === 'ArrowRight' ? RESIZE_STEP : -RESIZE_STEP))
                    }}
                    className={cn(
                      'absolute -right-1 top-0 z-[3] h-full w-2 cursor-col-resize touch-none select-none after:absolute after:inset-y-2 after:left-[3px] after:w-0.5 after:rounded after:bg-border-strong after:opacity-0 hover:after:opacity-100 focus-visible:after:bg-primary focus-visible:after:opacity-100',
                      live?.id === c.id && 'after:bg-primary after:opacity-100',
                    )}
                  />
                  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
                )}
              </th>
            )
          })}
          {headerTrail ? (
            <td className="rounded-tr-lg border-b border-r border-t border-border bg-surface px-1">
              <div className="flex items-center">{headerTrail}</div>
            </td>
          ) : (
            <td aria-hidden className="rounded-tr-lg border-b border-r border-t border-border bg-surface" />
          )}
        </tr>
      </thead>
      <BoardBody containerId={sortable?.containerId} ids={rows.map(rowKey)}>
        {rows.map((row) => {
          const key = rowKey(row)
          const expanded = renderExpanded ? renderExpanded(row) : null
          const selected = !!isRowSelected?.(row)
          const cells = (dragHandle: ReactNode | null) => (
            <>
              {visible.map((c, index) => (
                <td
                  key={c.id}
                  style={index === 0 ? accentStyle : undefined}
                  className={cn(
                    'border-b border-r border-border transition-colors',
                    selected ? 'bg-primary-soft' : 'bg-surface group-hover/row:bg-surface-2',
                    index === 0 && cn(stickyCell, 'border-l-4'),
                    c.collapsed ? 'p-0' : c.flush ? 'p-0' : cellPad,
                    index > 0 && c.align !== 'start' && 'text-center',
                  )}
                >
                  {c.collapsed ? null : c.cell(row, { dragHandle: index === 0 ? dragHandle : null })}
                </td>
              ))}
              <td aria-hidden className={cn('border-b border-r border-border transition-colors', selected ? 'bg-primary-soft' : 'bg-surface group-hover/row:bg-surface-2')} />
            </>
          )
          const rowClass = cn('group/row', rowHeight)
          return [
            sortable ? (
              <SortableRow key={key} id={key} container={sortable.containerId} disabled={!!sortable.disabled} label={sortable.handleLabel(row)} className={rowClass}>
                {cells}
              </SortableRow>
            ) : (
              <tr key={key} className={rowClass}>
                {cells(null)}
              </tr>
            ),
            expanded ? (
              <tr key={`${key}:expanded`}>
                <td colSpan={visible.length + 1} style={accentStyle} className="border-b border-l-4 border-r border-border bg-surface-2/40 p-0">
                  {expanded}
                </td>
              </tr>
            ) : null,
          ]
        })}
        {addRow && (
          <tr className={rowHeight}>
            <td style={accentStyle} className={cn(stickyCell, 'rounded-bl-lg border-b border-l-4 border-r border-border bg-surface p-0')}>
              {addRow}
            </td>
            <td colSpan={rest.length + 1} className="rounded-br-lg border-b border-r border-border bg-surface" />
          </tr>
        )}
      </BoardBody>
      {footer && (
        <tfoot>
          <tr className={rowHeight}>
            {first && <td className={cn(stickyCell, 'bg-bg')} />}
            {rest.map((c, index) => (
              <td
                key={c.id}
                className={cn('border-b border-r border-border bg-surface px-2 py-1 text-center', index === 0 && 'rounded-bl-lg border-l', index === rest.length - 1 && 'rounded-br-lg')}
              >
                {c.collapsed ? null : footer[c.id]}
              </td>
            ))}
            <td aria-hidden />
          </tr>
        </tfoot>
      )}
    </table>
  )
}

/** Corpo da tabela; ordenável: área de soltar + contexto das linhas (dnd-kit). */
function BoardBody({ containerId, ids, children }: { containerId?: string; ids: string[]; children: ReactNode }) {
  if (!containerId) return <tbody>{children}</tbody>
  return (
    <SortableBody containerId={containerId} ids={ids}>
      {children}
    </SortableBody>
  )
}

function SortableBody({ containerId, ids, children }: { containerId: string; ids: string[]; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: containerId, data: { container: containerId } })
  return (
    <tbody ref={setNodeRef}>
      <SortableContext id={containerId} items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </tbody>
  )
}

function SortableRow({
  id,
  container,
  disabled,
  label,
  className,
  children,
}: {
  id: string
  container: string
  disabled: boolean
  label: string
  className: string
  children: (handle: ReactNode | null) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled, data: { container } })
  const handle = disabled ? null : (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-subtle opacity-0 hover:bg-surface-3 hover:text-fg focus-visible:opacity-100 group-hover/row:opacity-100 active:cursor-grabbing [&_svg]:size-3.5"
    >
      <GripVertical />
    </button>
  )
  return (
    <tr ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn(className, isDragging && 'opacity-40')}>
      {children(handle)}
    </tr>
  )
}
