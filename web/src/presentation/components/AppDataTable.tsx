import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
import { labelOf, resolveColumnLabel, withColumnLabel, type ColumnLabels } from '@/domain/column-labels'
import { useCan } from '@/features/auth/session'
import { useCompanyColumnLabels, useOwnColumnLabels } from '@/presentation/common/use-column-labels'
import { AppDropdown, type AppDropdownItem } from './AppDropdown'
import { AppIconButton } from './AppIconButton'
import { AppButton } from './AppButton'
import { AppPagination } from './AppPagination'
import { AppEmptyState, AppErrorState, AppLoadingBar, AppSkeleton } from './AppStates'
import { AppFilterBar } from './AppFilterBar'
import { AppSearch } from './AppSearch'
import { FilterButtons, FilterSelect, type TableFilterDef } from './data-table/TableFilters'
import { ColumnsMenu, type ColumnsMenuAction, type ColumnsMenuColumn } from './data-table/ColumnsMenu'
import type { DataTableStateApi } from './data-table/use-data-table-state'
import { useMediaQuery } from '@/presentation/common/use-media-query'
import { useDelayedFlag } from '@/presentation/common/use-delayed-flag'

/* ------------------------------------------------------------------ tipos públicos */

export interface DataTableColumn<T> {
  id: string
  header: string
  cell: (row: T) => ReactNode
  sortable?: boolean
  /** Primeiro clique ordena do maior para o menor (ex.: prioridade, quantidade). */
  sortDescFirst?: boolean
  /** Pode ser ocultada pelo usuário (padrão: true). */
  hideable?: boolean
  size?: number
  minSize?: number
  /** Fixa a coluna no início da tabela ao rolar horizontalmente. */
  pinned?: boolean
  align?: 'start' | 'end'
  /**
   * Filtro por coluna, sempre à vista na barra de filtros (não há "Mais filtros"); `addon` fica colado ao
   * filtro (ex.: engrenagem do configurador).
   */
  filter?: {
    label: string
    options: Array<{ value: string; label: string }>
    addon?: ReactNode
    /** `buttons`: um botão por valor, vários ao mesmo tempo (§37). Padrão: seletor. */
    variant?: 'select' | 'buttons'
    /** O que vale sem nada escolhido (ex.: "Abertas"): o seletor parado mostra "Status: Abertas". Padrão: "Todos". */
    allLabel?: string
  }
}

export interface DataTableRowActions<T> {
  /** Ação própria da tela, antes do "Visualizar" (ex.: incluir a tarefa no informe do projeto). */
  leading?: (row: T) => ReactNode
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
  /** Nome da ação destrutiva em "Colunas e ações" (ex.: "Desativar", "Arquivar"); padrão: "Excluir". */
  deleteName?: string
  /** Ícone da ação (padrão: lixeira) — ex.: arquivar usa ícone de arquivo. */
  deleteIcon?: (row: T) => ReactNode
  /** "danger" (padrão) para ações destrutivas; "ghost" para reversíveis (ex.: arquivar). */
  deleteTone?: (row: T) => 'danger' | 'ghost'
  more?: (row: T) => AppDropdownItem[]
  /** Sem o menu "⋯" (telas só de consulta, como o Em andamento da Direção). */
  hideMore?: boolean
}

export interface AppDataTableProps<T extends RowData> {
  /**
   * Id estável da tabela (ex.: `tasks`, `projects`, `users`): chave dos nomes das colunas, os da pessoa
   * (no navegador) e os definidos para todos (§44). Mesmo id = mesmos nomes (ex.: todas as visões de Projetos).
   */
  tableId: string
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
  /** À direita da barra, depois de "Colunas" (ex.: a ação principal da tela). */
  toolbarActions?: ReactNode
  /**
   * Põe "Colunas" e as ações da barra noutro lugar da tela (ex.: na linha da sub-navegação da seção),
   * deixando a barra de filtros numa linha só. `null` = o lugar ainda está montando.
   */
  actionsSlot?: HTMLElement | null
  emptyState?: ReactNode
  /** Desativa busca/paginação (listas pequenas carregadas de uma vez). */
  searchable?: boolean
  paginated?: boolean
  /**
   * Moldura própria (borda, cantos e sombra). Desligue quando a tabela fica dentro de um cartão
   * que já tem a moldura (ex.: blocos de um painel), para não aninhar caixas.
   */
  bordered?: boolean
  /**
   * Clique em qualquer ponto da linha (sem coluna de ações), ex.: abrir o registro. Links e botões da
   * linha continuam com o próprio clique; no teclado, use o link da linha.
   */
  onRowClick?: (row: T) => void
  /**
   * "Colunas e ações" (padrão ligado em toda tabela com ações por linha): o menu de colunas ganha "Ações em
   * cada linha" (Visualizar, Editar, Excluir, Mais), guardadas com as colunas (`rowActions` do estado).
   * Excluir começa desligado e fica no "⋯" (que aparece só para ele quando a tela não tem outras ações);
   * nenhuma ligada (e sem ação própria da tela) = sem a coluna Ações.
   */
  configurableActions?: boolean
}

/** Ações da linha que "Colunas e ações" liga e desliga. */
const ROW_ACTION_KEYS = ['view', 'edit', 'delete', 'more'] as const
type RowActionKey = (typeof ROW_ACTION_KEYS)[number]
const ROW_ACTION_LABELS: Record<RowActionKey, string> = { view: 'common.view', edit: 'common.edit', delete: 'common.delete', more: 'table.moreActions' }
/** Escolha guardada da ação: Excluir só ligado quando a pessoa ligou; as demais, ligadas até desligar. */
const actionChosen = (prefs: Record<string, boolean>, key: RowActionKey) => (key === 'delete' ? prefs.delete === true : prefs[key] !== false)
/** Ações que a tela oferece (as que aparecem em "Ações em cada linha"). */
function offeredActions<T>(actions: DataTableRowActions<T>): RowActionKey[] {
  return ROW_ACTION_KEYS.filter((key) => (key === 'view' ? !!actions.onView : key === 'edit' ? !!actions.onEdit : key === 'delete' ? !!actions.onDelete : !actions.hideMore))
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
  tableId,
  columns: baseColumns,
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
  actionsSlot,
  emptyState,
  searchable = true,
  paginated = true,
  bordered = true,
  onRowClick,
  configurableActions = true,
}: AppDataTableProps<T>) {
  const { t } = useTranslation()
  const { state } = tableState
  const clickTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(clickTimer.current), [])

  // Nomes das colunas (§44): o da pessoa > o definido para todos > o do sistema
  const own = useOwnColumnLabels(tableId)
  const company = useCompanyColumnLabels(tableId)
  const canNameForAll = useCan('platform.manage')
  const [namesForAll, setNamesForAll] = useState(false)
  const columns = useMemo(
    () =>
      baseColumns.map((col) => {
        const header = resolveColumnLabel(col.id, col.header, own.labels, company.labels)
        if (header === col.header) return col
        // o filtro com o mesmo nome da coluna acompanha o nome novo
        return { ...col, header, filter: col.filter && col.filter.label === col.header ? { ...col.filter, label: header } : col.filter }
      }),
    [baseColumns, own.labels, company.labels],
  )
  const builtInOf = (id: string) => baseColumns.find((c) => c.id === id)?.header ?? id
  const forAll = canNameForAll && namesForAll
  const renameColumn = (id: string, value: string) => {
    const builtIn = builtInOf(id)
    if (forAll) {
      void company.save(withColumnLabel(company.labels, id, value, builtIn))
      if (labelOf(own.labels, id) !== undefined) own.save(withColumnLabel(own.labels, id, '', builtIn))
      return
    }
    own.save(withColumnLabel(own.labels, id, value, resolveColumnLabel(id, builtIn, undefined, company.labels)))
  }
  // "Usar estes nomes para todos": os nomes à vista passam a valer para todos (e deixam de ser só da pessoa)
  const chooseNamesForAll = (checked: boolean) => {
    setNamesForAll(checked)
    if (!checked || Object.keys(own.labels).length === 0) return
    const next = baseColumns.reduce<ColumnLabels>((labels, col) => {
      const name = labelOf(own.labels, col.id)
      return name ? withColumnLabel(labels, col.id, name, col.header) : labels
    }, company.labels)
    void company.save(next)
    own.save({})
  }
  const canResetNames = Object.keys(own.labels).length > 0 || (forAll && Object.keys(company.labels).length > 0)
  const resetNames = () => {
    own.save({})
    if (forAll) void company.save({})
  }

  // "Colunas e ações": quais ações a linha mostra (só as que a tela oferece); nenhuma = sem a coluna Ações.
  // Excluir começa desligado (fica no "⋯"); as demais começam ligadas.
  const rowActionPrefs = state.rowActions
  const visibleActions = useMemo<Record<RowActionKey, boolean> | null>(() => {
    if (!actions) return null
    const on = (key: RowActionKey) => !configurableActions || actionChosen(rowActionPrefs, key)
    const remove = !!actions.onDelete && on('delete')
    return {
      view: !!actions.onView && on('view'),
      edit: !!actions.onEdit && on('edit'),
      delete: remove,
      // tela sem outras ações no "⋯" (hideMore): ele aparece só para levar o Excluir desligado
      more: actions.hideMore ? configurableActions && !!actions.onDelete && !remove : on('more'),
    }
  }, [actions, configurableActions, rowActionPrefs])
  const actionButtons = visibleActions ? ROW_ACTION_KEYS.filter((key) => visibleActions[key]).length : 0
  const hasActionsColumn = !!actions && !!visibleActions && (actionButtons > 0 || !!actions.leading)

  const columnDefs = useMemo(() => {
    const helper = createColumnHelper<typeof features, T>()
    const defs = columns.map((col) =>
      helper.accessor((row) => row as unknown, {
        id: col.id,
        header: col.header,
        cell: (ctx) => col.cell(ctx.row.original),
        enableSorting: !!col.sortable,
        // O accessor devolve a linha inteira; sem isto a primeira ordenação seria descendente.
        sortDescFirst: !!col.sortDescFirst,
        enableHiding: col.hideable !== false,
        enableResizing: true,
        size: col.size ?? 180,
        minSize: col.minSize ?? 80,
      }),
    )
    if (actions && visibleActions && hasActionsColumn) {
      // largura pelos botões à vista (a ação própria da tela, `leading`, cabe até dois botões)
      const width = Math.max(72, 40 + (actionButtons + (actions.leading ? 2 : 0)) * 28)
      defs.push(
        helper.accessor((row) => row as unknown, {
          id: ACTIONS_ID,
          header: t('table.actions'),
          cell: (ctx) => <RowActions row={ctx.row.original} actions={actions} visible={visibleActions} />,
          enableSorting: false,
          enableHiding: false,
          enableResizing: false,
          size: width,
          minSize: width,
        }),
      )
    }
    return defs
  }, [columns, actions, visibleActions, hasActionsColumn, actionButtons, t])

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
      columnPinning: { start: pinnedStart, end: hasActionsColumn && canPin ? [ACTIONS_ID] : EMPTY_PINNING },
    },
    onSortingChange: (updater) => {
      const next = resolve(updater, sorting)[0]
      tableState.setSort(next ? { id: next.id, direction: next.desc ? 'desc' : 'asc' } : null)
    },
    onColumnVisibilityChange: (updater) => tableState.setColumnVisibility(resolve(updater, state.columnVisibility)),
    onColumnSizingChange: (updater) => tableState.setColumnSizing(resolve(updater, state.columnSizing)),
  })

  const filterColumns = columns.filter((c) => c.filter)
  // todos os filtros à vista, na ordem das colunas
  const filterDefs: TableFilterDef[] = filterColumns.map((c) => ({ id: c.id, ...c.filter! }))
  const visibleColumnCount = table.getVisibleLeafColumns().length
  const showSkeleton = loading && data.length === 0
  // Recargas rápidas (ex.: após salvar) não exibem indicador; só as que demoram.
  const slowFetch = useDelayedFlag(!!fetching && !showSkeleton)

  // "Colunas" / "Colunas e ações": todas as colunas (as fixas, como a primeira, sem ocultar), com o nome editável
  const menuColumns: ColumnsMenuColumn[] = table
    .getAllLeafColumns()
    .filter((column) => column.id !== ACTIONS_ID)
    .map((column) => ({
      id: column.id,
      label: String(column.columnDef.header ?? column.id),
      builtIn: builtInOf(column.id),
      visible: column.getIsVisible(),
      // mantém ao menos uma coluna de dados visível
      locked: !column.getCanHide() || (column.getIsVisible() && visibleColumnCount <= (hasActionsColumn ? 2 : 1)),
    }))
  const actionsMenu = configurableActions && actions
  const menuActions: ColumnsMenuAction[] = actionsMenu
    ? offeredActions(actions).map((key) => ({
        key,
        label: key === 'delete' && actions.deleteName ? actions.deleteName : t(ROW_ACTION_LABELS[key]),
        checked: actionChosen(rowActionPrefs, key),
      }))
    : []
  // guarda as quatro escolhas explícitas (o padrão pode mudar sem mexer no que a pessoa escolheu)
  const toggleAction = (key: string, checked: boolean) =>
    tableState.setRowActions({ ...Object.fromEntries(ROW_ACTION_KEYS.map((k) => [k, actionChosen(rowActionPrefs, k)])), [key]: checked })
  const columnsLabel = actionsMenu ? t('table.columnsAndActions') : t('table.columns')

  // "Colunas" e a ação principal: na barra ou no lugar indicado pela tela (actionsSlot)
  const toolbarButtons = (
    <>
      {menuColumns.length > 0 && (
        <ColumnsMenu
          label={columnsLabel}
          columns={menuColumns}
          onToggleColumn={(id, visible) => table.getColumn(id)?.toggleVisibility(visible)}
          onRename={renameColumn}
          canResetNames={canResetNames}
          onResetNames={resetNames}
          forAll={canNameForAll ? { checked: namesForAll, onChange: chooseNamesForAll } : undefined}
          actions={menuActions}
          onToggleAction={toggleAction}
          trigger={
            <AppButton variant="secondary" leftIcon={<Columns3 />} aria-label={columnsLabel}>
              <span className="hidden sm:inline">{columnsLabel}</span>
            </AppButton>
          }
        />
      )}
      {toolbarActions}
    </>
  )

  // sem busca, filtros, colunas para escolher nem extras: nada de barra vazia acima da tabela
  const hasToolbar = searchable || filterColumns.length > 0 || menuColumns.length > 0 || !!toolbar || !!toolbarActions

  return (
    <div className="flex flex-col gap-3">
      {actionsSlot && createPortal(toolbarButtons, actionsSlot)}
      {hasToolbar && (
        <AppFilterBar
          search={
            searchable ? (
              <AppSearch value={state.search} onSearch={tableState.setSearch} placeholder={searchPlaceholder} />
            ) : undefined
          }
          filters={
            <>
              {filterDefs.map((filter) =>
                filter.variant === 'buttons' ? (
                  <FilterButtons key={filter.id} filter={filter} value={state.filters[filter.id]} onChange={(value) => tableState.setFilter(filter.id, value)} />
                ) : (
                  <FilterSelect key={filter.id} filter={filter} value={state.filters[filter.id]} onChange={(value) => tableState.setFilter(filter.id, value)} />
                ),
              )}
              {toolbar}
            </>
          }
          hasActiveFilters={tableState.hasActiveFilters}
          activeFilterCount={tableState.activeFilterCount}
          onReset={tableState.resetFilters}
          // com lugar pedido (mesmo que ainda montando, null), os botões não aparecem na barra
          actions={actionsSlot === undefined ? toolbarButtons : undefined}
        />
      )}

      <div className={cn('relative overflow-hidden', bordered && 'rounded-xl border border-border bg-surface shadow-card')}>
        {slowFetch && <AppLoadingBar />}
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
                      if (onRowClick && !actions?.onView && !isControl(event.target)) return onRowClick(row.original)
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
                    className={cn('group/row transition-colors hover:bg-surface-2', (actions?.onView || onRowClick) && 'cursor-pointer', slowFetch && 'opacity-70')}
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

function RowActions<T extends RowData>({ row, actions, visible }: { row: T; actions: DataTableRowActions<T>; visible: Record<RowActionKey, boolean> }) {
  const { t } = useTranslation()
  const canView = actions.onView && (actions.canView ? actions.canView(row) : true)
  const canEdit = actions.onEdit && (actions.canEdit ? actions.canEdit(row) : true)
  const canDelete = actions.onDelete && (actions.canDelete ? actions.canDelete(row) : true)
  const deleteLabel = actions.deleteLabel?.(row) ?? t('common.delete')
  // Excluir fora da linha ("Colunas e ações"): continua no "⋯", para quem pode (reversível, como arquivar, sem o vermelho)
  const extraItems = actions.more?.(row) ?? []
  const moreItems: AppDropdownItem[] = [
    ...extraItems,
    ...(actions.onDelete && !visible.delete && canDelete
      ? [
          ...(extraItems.length > 0 ? [{ type: 'separator' as const, key: 'delete-separator' }] : []),
          {
            key: 'delete',
            label: deleteLabel,
            icon: actions.deleteIcon?.(row) ?? <Trash2 />,
            tone: actions.deleteTone?.(row) === 'ghost' ? ('default' as const) : ('danger' as const),
            onSelect: () => actions.onDelete?.(row),
          },
        ]
      : []),
  ]

  return (
    <div className="flex items-center justify-end gap-0.5">
      {actions.leading?.(row)}
      {visible.view && <AppIconButton size="sm" label={t('common.view')} icon={<Eye />} disabled={!canView} onClick={() => actions.onView?.(row)} />}
      {visible.edit && (
        <AppIconButton size="sm" label={t('common.edit')} icon={<Pencil />} disabled={!canEdit} onClick={() => actions.onEdit?.(row)} />
      )}
      {visible.delete && (
        <AppIconButton
          size="sm"
          variant={actions.deleteTone?.(row) ?? 'danger'}
          label={deleteLabel}
          icon={actions.deleteIcon?.(row) ?? <Trash2 />}
          disabled={!canDelete}
          onClick={() => actions.onDelete?.(row)}
        />
      )}
      {visible.more && (
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
      )}
    </div>
  )
}
