import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef } from 'react'
import {
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type Column,
  type ColumnSizingState,
  type SortingState,
  type Updater,
  type ColumnVisibilityState,
  type RowData,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import { AppDropdown, type AppDropdownItem } from './AppDropdown'
import { AppIconButton } from './AppIconButton'
import { AppButton } from './AppButton'
import { AppPagination } from './AppPagination'
import { AppEmptyState, AppErrorState, AppSkeleton } from './AppStates'
import { AppFilterBar } from './AppFilterBar'
import { AppSearch } from './AppSearch'
import { AppSelect, SELECT_ALL } from './AppSelect'
import type { DataTableStateApi } from './data-table/use-data-table-state'
import { useMediaQuery } from '@/presentation/common/use-media-query'
import { useDelayedFlag } from '@/presentation/common/use-delayed-flag'

/* ------------------------------------------------------------------ tipos públicos */

export interface DataTableColumn<T> {
  id: string
  header: string
  cell: (row: T) => ReactNode
  sortable?: boolean
  /** Pode ser ocultada pelo usuário (padrão: true). */
  hideable?: boolean
  size?: number
  minSize?: number
  /** Fixa a coluna no início da tabela ao rolar horizontalmente. */
  pinned?: boolean
  align?: 'start' | 'end'
  /** Filtro por coluna exibido na barra de filtros. */
  filter?: { label: string; options: Array<{ value: string; label: string }> }
}

export interface DataTableRowActions<T> {
  /** Clique na linha (e o botão "Visualizar"): abre a visualização rápida. */
  onView?: (row: T) => void
  /** Linha sem visualização: o botão fica desativado e o clique na linha não faz nada. */
  canView?: (row: T) => boolean
  /** Duplo clique na linha: abre a página completa (no teclado, use o "Abrir" do menu da linha). */
  onOpen?: (row: T) => void
  onEdit?: (row: T) => void
  canEdit?: (row: T) => boolean
  onDelete?: (row: T) => void
  canDelete?: (row: T) => boolean
  /** Rótulo da ação destrutiva (ex.: "Desativar" para usuários). */
  deleteLabel?: (row: T) => string
  /** Ícone da ação (padrão: lixeira) — ex.: arquivar usa ícone de arquivo. */
  deleteIcon?: (row: T) => ReactNode
  /** "danger" (padrão) para ações destrutivas; "ghost" para reversíveis (ex.: arquivar). */
  deleteTone?: (row: T) => 'danger' | 'ghost'
  more?: (row: T) => AppDropdownItem[]
}

export interface AppDataTableProps<T extends RowData> {
  columns: DataTableColumn<T>[]
  data: T[]
  total: number
  getRowId: (row: T) => string
  table: DataTableStateApi
  loading?: boolean
  fetching?: boolean
  error?: { correlationId?: string | undefined } | null
  onRetry?: () => void
  actions?: DataTableRowActions<T>
  /** Rótulo acessível da tabela. */
  caption: string
  searchPlaceholder?: string
  /** Filtros/controles extras na barra (além dos filtros por coluna). */
  toolbar?: ReactNode
  toolbarActions?: ReactNode
  emptyState?: ReactNode
  /** Desativa busca/paginação (listas pequenas carregadas de uma vez). */
  searchable?: boolean
  paginated?: boolean
}

/* ------------------------------------------------------------------ implementação */

const features = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  columnSizingFeature,
  columnResizingFeature,
  columnPinningFeature,
})

const ACTIONS_ID = '__actions'
/** Espera do clique simples quando a linha também abre com duplo clique. */
const DOUBLE_CLICK_MS = 250
/** Clique em botão, link ou item de menu da linha não conta como clique na linha. */
const isControl = (target: EventTarget) => !!(target as HTMLElement).closest('button, a, [role="menuitem"]')
const EMPTY_PINNING: string[] = []

function resolve<S>(updater: Updater<S>, previous: S): S {
  return typeof updater === 'function' ? (updater as (old: S) => S)(previous) : updater
}

function pinnedStyle(column: Column<typeof features, never, unknown>): CSSProperties {
  const pinned = column.getIsPinned()
  return {
    width: column.getSize(),
    minWidth: column.getSize(),
    position: pinned ? 'sticky' : undefined,
    insetInlineStart: pinned === 'start' ? column.getStart('start') : undefined,
    insetInlineEnd: pinned === 'end' ? column.getAfter('end') : undefined,
    zIndex: pinned ? 1 : undefined,
  }
}

/**
 * DataTable padrão do sistema: paginação e ordenação no servidor, busca global com debounce,
 * filtros por coluna, seleção/redimensionamento de colunas, colunas fixas, estados de
 * carregamento/vazio/erro e ações por linha (Visualizar, Editar, Excluir, Mais).
 */
export function AppDataTable<T extends RowData>({
  columns,
  data,
  total,
  getRowId,
  table: tableState,
  loading,
  fetching,
  error,
  onRetry,
  actions,
  caption,
  searchPlaceholder,
  toolbar,
  toolbarActions,
  emptyState,
  searchable = true,
  paginated = true,
}: AppDataTableProps<T>) {
  const { t } = useTranslation()
  const { state } = tableState
  const clickTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(clickTimer.current), [])

  const columnDefs = useMemo(() => {
    const helper = createColumnHelper<typeof features, T>()
    const defs = columns.map((col) =>
      helper.accessor((row) => row as unknown, {
        id: col.id,
        header: col.header,
        cell: (ctx) => col.cell(ctx.row.original),
        enableSorting: !!col.sortable,
        // O accessor devolve a linha inteira; sem isto a primeira ordenação seria descendente.
        sortDescFirst: false,
        enableHiding: col.hideable !== false,
        enableResizing: true,
        size: col.size ?? 180,
        minSize: col.minSize ?? 80,
      }),
    )
    if (actions) {
      defs.push(
        helper.accessor((row) => row as unknown, {
          id: ACTIONS_ID,
          header: t('table.actions'),
          cell: (ctx) => <RowActions row={ctx.row.original} actions={actions} />,
          enableSorting: false,
          enableHiding: false,
          enableResizing: false,
          size: 148,
          minSize: 148,
        }),
      )
    }
    return defs
  }, [columns, actions, t])

  const sorting: SortingState = state.sort ? [{ id: state.sort.id, desc: state.sort.direction === 'desc' }] : []
  // Em telas estreitas nada fica fixo: as colunas fixas ocupariam toda a largura e esconderiam as demais.
  const canPin = useMediaQuery('(min-width: 768px)')
  const pinnedStart = useMemo(() => (canPin ? columns.filter((c) => c.pinned).map((c) => c.id) : EMPTY_PINNING), [columns, canPin])

  const table = useTable({
    features,
    columns: columnDefs,
    data,
    getRowId: (row: T) => getRowId(row),
    manualSorting: true,
    enableMultiSort: false,
    columnResizeMode: 'onChange',
    state: {
      sorting,
      columnVisibility: state.columnVisibility as ColumnVisibilityState,
      columnSizing: state.columnSizing as ColumnSizingState,
      columnPinning: { start: pinnedStart, end: actions && canPin ? [ACTIONS_ID] : EMPTY_PINNING },
    },
    onSortingChange: (updater) => {
      const next = resolve(updater, sorting)[0]
      tableState.setSort(next ? { id: next.id, direction: next.desc ? 'desc' : 'asc' } : null)
    },
    onColumnVisibilityChange: (updater) => tableState.setColumnVisibility(resolve(updater, state.columnVisibility)),
    onColumnSizingChange: (updater) => tableState.setColumnSizing(resolve(updater, state.columnSizing)),
  })

  const filterColumns = columns.filter((c) => c.filter)
  const hideableColumns = table.getAllLeafColumns().filter((c) => c.getCanHide())
  const visibleColumnCount = table.getVisibleLeafColumns().length
  const showSkeleton = loading && data.length === 0
  // Recargas rápidas (ex.: após salvar) não exibem indicador; só as que demoram.
  const slowFetch = useDelayedFlag(!!fetching && !showSkeleton)

  const columnMenu: AppDropdownItem[] = [
    { type: 'label', key: 'label', label: t('table.visibleColumns') },
    ...hideableColumns.map<AppDropdownItem>((column) => ({
      type: 'checkbox',
      key: column.id,
      label: String(column.columnDef.header ?? column.id),
      checked: column.getIsVisible(),
      // mantém ao menos uma coluna de dados visível
      disabled: column.getIsVisible() && visibleColumnCount <= (actions ? 2 : 1),
      onCheckedChange: (checked) => column.toggleVisibility(checked),
    })),
  ]

  return (
    <div className="flex flex-col gap-3">
      <AppFilterBar
        search={
          searchable ? (
            <AppSearch value={state.search} onSearch={tableState.setSearch} placeholder={searchPlaceholder} />
          ) : undefined
        }
        filters={
          <>
            {filterColumns.map((column) => (
              <AppSelect
                key={column.id}
                size="sm"
                aria-label={column.filter!.label}
                value={state.filters[column.id] ?? SELECT_ALL}
                onValueChange={(value) => tableState.setFilter(column.id, value === SELECT_ALL ? undefined : value)}
                options={[
                  { value: SELECT_ALL, label: `${column.filter!.label}: ${t('common.all')}` },
                  ...column.filter!.options.map((option) => ({ value: option.value, label: `${column.filter!.label}: ${option.label}` })),
                ]}
                triggerClassName="min-w-40"
              />
            ))}
            {toolbar}
          </>
        }
        hasActiveFilters={tableState.hasActiveFilters}
        onReset={tableState.resetFilters}
        actions={
          <>
            {hideableColumns.length > 0 && (
              <AppDropdown
                items={columnMenu}
                trigger={
                  <AppButton variant="secondary" size="sm" leftIcon={<Columns3 />} aria-label={t('table.columns')}>
                    <span className="hidden sm:inline">{t('table.columns')}</span>
                  </AppButton>
                }
              />
            )}
            {toolbarActions}
          </>
        }
      />

      <div className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        {slowFetch && (
          <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden" role="progressbar" aria-label={t('common.loading')}>
            <div className="h-full w-1/3 animate-[kb-progress_1s_ease-in-out_infinite] bg-primary" />
          </div>
        )}
        <div className="overflow-x-auto">
          <table
            className="w-full border-separate border-spacing-0 text-sm"
            style={{ minWidth: table.getTotalSize() }}
            aria-busy={loading || fetching || undefined}
          >
            <caption className="sr-only">{caption}</caption>
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => {
                    const column = header.column
                    const sorted = column.getIsSorted()
                    const def = columns.find((c) => c.id === column.id)
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                        style={pinnedStyle(column as never)}
                        className={cn(
                          'group relative h-10 border-b border-border bg-surface-2 px-3 text-left first:pl-5 last:pr-5 text-xs font-semibold uppercase tracking-wide text-muted',
                          def?.align === 'end' && 'text-right',
                          column.id === ACTIONS_ID && 'text-right',
                        )}
                      >
                        {column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1 uppercase hover:text-fg"
                          >
                            <table.FlexRender header={header} />
                            {sorted === 'asc' ? (
                              <ArrowUp className="size-3.5 text-primary-text" aria-hidden />
                            ) : sorted === 'desc' ? (
                              <ArrowDown className="size-3.5 text-primary-text" aria-hidden />
                            ) : (
                              <ChevronsUpDown className="size-3.5 opacity-40" aria-hidden />
                            )}
                          </button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                        {column.getCanResize() && (
                          // Separador focável (padrão "window splitter"): mouse/touch arrastam, setas redimensionam.
                          /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
                          <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={t('table.resizeColumn')}
                            aria-valuenow={column.getSize()}
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                              event.preventDefault()
                              const delta = event.key === 'ArrowRight' ? 16 : -16
                              const min = columns.find((c) => c.id === column.id)?.minSize ?? 80
                              tableState.setColumnSizing({ ...state.columnSizing, [column.id]: Math.max(min, column.getSize() + delta) })
                            }}
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            onDoubleClick={() => column.resetSize()}
                            className={cn(
                              'absolute right-0 top-1/4 h-1/2 w-1 cursor-col-resize touch-none select-none rounded bg-border opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                              column.getIsResizing() && 'bg-primary opacity-100',
                            )}
                          />
                          /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
                        )}
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {showSkeleton &&
                Array.from({ length: Math.min(state.perPage, 8) }).map((_, i) => (
                  <tr key={`sk-${i}`}>
                    {table.getVisibleLeafColumns().map((column) => (
                      <td key={column.id} className="border-b border-border px-3 py-3 first:pl-5 last:pr-5">
                        <AppSkeleton className="h-4 w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))}

              {!showSkeleton && error && (
                <tr>
                  <td colSpan={visibleColumnCount}>
                    <AppErrorState correlationId={error.correlationId} onRetry={onRetry} />
                  </td>
                </tr>
              )}

              {!showSkeleton && !error && data.length === 0 && (
                <tr>
                  <td colSpan={visibleColumnCount}>
                    {emptyState ?? (
                      <AppEmptyState
                        title={tableState.hasActiveFilters ? t('table.noMatches') : t('table.empty')}
                        description={tableState.hasActiveFilters ? t('table.noMatchesHint') : undefined}
                        action={
                          tableState.hasActiveFilters ? (
                            <AppButton variant="secondary" size="sm" onClick={tableState.resetFilters}>
                              {t('table.clearFilters')}
                            </AppButton>
                          ) : undefined
                        }
                      />
                    )}
                  </td>
                </tr>
              )}

              {!showSkeleton &&
                !error &&
                table.getRowModel().rows.map((row) => (
                  // Clique na linha é atalho de mouse (no teclado, o botão "Visualizar"); com `onOpen`, o duplo
                  // clique abre a página completa e o clique simples espera um instante para não abrir os dois.
                  <tr
                    key={row.id}
                    onClick={(event) => {
                      if (!actions?.onView || isControl(event.target) || actions.canView?.(row.original) === false) return
                      const view = actions.onView
                      if (!actions.onOpen) return view(row.original)
                      window.clearTimeout(clickTimer.current)
                      clickTimer.current = window.setTimeout(() => view(row.original), DOUBLE_CLICK_MS)
                    }}
                    onDoubleClick={(event) => {
                      if (!actions?.onOpen || isControl(event.target)) return
                      window.clearTimeout(clickTimer.current)
                      actions.onOpen(row.original)
                    }}
                    title={actions?.onOpen ? t('table.openHint') : undefined}
                    className={cn('group/row transition-colors hover:bg-surface-2', actions?.onView && 'cursor-pointer', slowFetch && 'opacity-70')}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const def = columns.find((c) => c.id === cell.column.id)
                      return (
                        <td
                          key={cell.id}
                          style={pinnedStyle(cell.column as never)}
                          className={cn(
                            // primeira e última colunas mais afastadas da borda arredondada do cartão
                            'border-b border-border px-3 py-2.5 align-middle text-fg group-last/row:border-b-0 first:pl-5 last:pr-5',
                            cell.column.getIsPinned() && 'bg-surface group-hover/row:bg-surface-2',
                            (def?.align === 'end' || cell.column.id === ACTIONS_ID) && 'text-right',
                          )}
                        >
                          <table.FlexRender cell={cell} />
                        </td>
                      )
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {paginated && (
        <AppPagination
          page={state.page}
          perPage={state.perPage}
          total={total}
          onPageChange={tableState.setPage}
          onPerPageChange={tableState.setPerPage}
        />
      )}
    </div>
  )
}

function RowActions<T extends RowData>({ row, actions }: { row: T; actions: DataTableRowActions<T> }) {
  const { t } = useTranslation()
  const canView = actions.onView && (actions.canView ? actions.canView(row) : true)
  const canEdit = actions.onEdit && (actions.canEdit ? actions.canEdit(row) : true)
  const canDelete = actions.onDelete && (actions.canDelete ? actions.canDelete(row) : true)
  const moreItems = actions.more?.(row) ?? []
  const deleteLabel = actions.deleteLabel?.(row) ?? t('common.delete')

  return (
    <div className="flex items-center justify-end gap-0.5">
      {actions.onView && <AppIconButton size="sm" label={t('common.view')} icon={<Eye />} disabled={!canView} onClick={() => actions.onView?.(row)} />}
      {actions.onEdit && (
        <AppIconButton size="sm" label={t('common.edit')} icon={<Pencil />} disabled={!canEdit} onClick={() => actions.onEdit?.(row)} />
      )}
      {actions.onDelete && (
        <AppIconButton
          size="sm"
          variant={actions.deleteTone?.(row) ?? 'danger'}
          label={deleteLabel}
          icon={actions.deleteIcon?.(row) ?? <Trash2 />}
          disabled={!canDelete}
          onClick={() => actions.onDelete?.(row)}
        />
      )}
      <AppDropdown
        items={moreItems.length > 0 ? moreItems : [{ type: 'label', key: 'none', label: t('table.noMoreActions') }]}
        trigger={
          <button
            type="button"
            aria-label={t('common.more')}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-3 hover:text-fg"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        }
      />
    </div>
  )
}
