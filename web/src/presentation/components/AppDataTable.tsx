import { Fragment, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
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
import { FilterButtons, FilterMenu, FilterSelect, type TableFilterDef } from './data-table/TableFilters'
import { ColumnFilterButton, ColumnSearchButton } from './data-table/ColumnFilter'
import { filterValues } from './data-table/filter-values'
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
   * Filtro da coluna: na barra de filtros (sempre à vista, sem "Mais filtros") e no funil do cabeçalho — os dois
   * mexem no mesmo valor (ajuste 24/11/2026). `placement: 'column'` deixa só o funil; `addon` fica colado ao
   * filtro da barra (ex.: engrenagem do configurador).
   */
  filter?: Omit<TableFilterDef, 'id'>
  /** A coluna do nome: o funil abre "contém", que é a busca da tabela (ajuste 24/11/2026). */
  searchFilter?: boolean
}

/**
 * Ação própria da tela que entra em "Colunas e ações" › "Ações em cada linha", como Visualizar e Editar (ex.: o
 * "Fixar" da Lista de tarefas, §50): a pessoa liga e desliga; aparece antes do "Visualizar".
 */
export interface DataTableCustomAction<T> {
  key: string
  /** Nome em "Ações em cada linha". */
  label: string
  /** Começa ligada (padrão) ou desligada. */
  defaultOn?: boolean
  render: (row: T) => ReactNode
}

/**
 * Linhas em grupos (ex.: as fixadas no topo da Lista de tarefas, §50): uma faixa antes da primeira linha de cada
 * grupo. As linhas já vêm na ordem (o servidor ordena); a faixa só aparece onde `of` devolve um grupo.
 */
export interface DataTableRowGroups<T> {
  /** Grupo da linha; null = sem faixa. */
  of: (row: T) => string | null
  /** Conteúdo da faixa (`count` = linhas do grupo nesta página). */
  header: (group: string, count: number) => ReactNode
  /** Faixa e linhas do grupo em destaque (tokens do tema). */
  highlight?: (group: string) => boolean
}

export interface DataTableRowActions<T> {
  /** Ação própria da tela, antes do "Visualizar" (ex.: incluir a tarefa no informe do projeto). */
  leading?: (row: T) => ReactNode
  /** Ações próprias da tela que "Colunas e ações" liga e desliga (antes do "Visualizar"). */
  custom?: DataTableCustomAction<T>[]
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
  /** Linhas em grupos, com uma faixa antes de cada um (ex.: "Fixadas" no topo da Lista de tarefas, §50). */
  rowGroups?: DataTableRowGroups<T>
}

/** Ações da linha que "Colunas e ações" liga e desliga. */
const ROW_ACTION_KEYS = ['view', 'edit', 'delete', 'more'] as const
type RowActionKey = (typeof ROW_ACTION_KEYS)[number]
const ROW_ACTION_LABELS: Record<RowActionKey, string> = { view: 'common.view', edit: 'common.edit', delete: 'common.delete', more: 'table.moreActions' }
/** Escolha guardada da ação: Excluir só ligado quando a pessoa ligou; as demais, ligadas até desligar. */
const actionChosen = (prefs: Record<string, boolean>, key: RowActionKey) => (key === 'delete' ? prefs.delete === true : prefs[key] !== false)
/** Escolha guardada de uma ação própria da tela: o padrão dela até a pessoa escolher. */
const customChosen = <T,>(prefs: Record<string, boolean>, action: DataTableCustomAction<T>) => prefs[action.key] ?? action.defaultOn !== false
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
/**
 * Fundo das linhas do grupo em destaque (ex.: as fixadas, §50): o tom de aviso do tema misturado à superfície, opaco
 * (a coluna fixa cobre o que rola por baixo) e claro o bastante para o texto secundário manter o contraste AA nos
 * dois temas.
 */
const HIGHLIGHT_ROW = 'bg-[color-mix(in_oklab,var(--color-warning-soft)_50%,var(--color-surface))]'
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
  rowGroups,
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
  const visibleCustom = useMemo(
    () => (actions?.custom ?? []).filter((action) => !configurableActions || customChosen(rowActionPrefs, action)),
    [actions, configurableActions, rowActionPrefs],
  )
  const actionButtons = visibleActions ? ROW_ACTION_KEYS.filter((key) => visibleActions[key]).length + visibleCustom.length : 0
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
          cell: (ctx) => <RowActions row={ctx.row.original} actions={actions} visible={visibleActions} custom={visibleCustom} />,
          enableSorting: false,
          enableHiding: false,
          enableResizing: false,
          size: width,
          minSize: width,
        }),
      )
    }
    return defs
  }, [columns, actions, visibleActions, visibleCustom, hasActionsColumn, actionButtons, t])

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
  const filterDefs: TableFilterDef[] = filterColumns.map((c) => ({ id: c.id, ...c.filter! }))
  // na barra (ajuste 24/11): os seletores e menus juntos, um ao lado do outro, e depois os grupos de botões; dentro
  // de cada parte, `barOrder` e a ordem das colunas. Os de `placement: 'column'` ficam só no funil da coluna
  const barFilters = filterDefs
    .map((filter, index) => ({ filter, index }))
    .filter(({ filter }) => filter.placement !== 'column')
    .sort((a, b) => Number(a.filter.variant === 'buttons') - Number(b.filter.variant === 'buttons') || (a.filter.barOrder ?? 1000 + a.index) - (b.filter.barOrder ?? 1000 + b.index))
    .map(({ filter }) => filter)

  /**
   * Larguras escolhidas pela pessoa (ajuste 24/11/2026). Sem nenhuma, a tabela se arruma sozinha, como sempre
   * (ocupa a largura e cada coluna cresce com o conteúdo). Ao arrastar o primeiro separador, as larguras que
   * estão na tela viram as escolhidas — nada pula — e a tabela passa a respeitar exatamente o que se arrasta:
   * o conteúdo corta ou quebra dentro da coluna, e o espaço que sobra fica numa coluna vazia antes das ações.
   */
  const customWidths = Object.keys(state.columnSizing).length > 0
  const tableRef = useRef<HTMLTableElement>(null)
  const [resizing, setResizing] = useState<string | null>(null)
  const minWidthOf = (id: string) => columns.find((c) => c.id === id)?.minSize ?? 80
  const measuredWidths = (): Record<string, number> => {
    const widths: Record<string, number> = { ...state.columnSizing }
    tableRef.current?.querySelectorAll<HTMLElement>('thead th[data-column]').forEach((th) => {
      const id = th.dataset.column
      if (!id || id === ACTIONS_ID) return
      // sem medida (teste sem layout): a largura que a coluna pede
      widths[id] = Math.round(th.getBoundingClientRect().width) || table.getColumn(id)?.getSize() || minWidthOf(id)
    })
    return widths
  }
  const startResize = (event: ReactPointerEvent, id: string) => {
    if (event.button !== 0) return
    event.preventDefault()
    const base = measuredWidths()
    const startX = event.clientX
    const startWidth = base[id] ?? minWidthOf(id)
    const min = minWidthOf(id)
    const { userSelect, cursor } = document.body.style
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    setResizing(id)
    tableState.setColumnSizing(base)
    const move = (e: PointerEvent) => tableState.setColumnSizing({ ...base, [id]: Math.max(min, Math.round(startWidth + e.clientX - startX)) })
    const stop = () => {
      setResizing(null)
      document.body.style.userSelect = userSelect
      document.body.style.cursor = cursor
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }
  const resizeBy = (id: string, delta: number) => {
    const base = measuredWidths()
    tableState.setColumnSizing({ ...base, [id]: Math.max(minWidthOf(id), (base[id] ?? minWidthOf(id)) + delta) })
  }
  /** Duplo clique no separador: a coluna volta à largura original (sem nenhuma escolhida, a tabela volta a se arrumar sozinha). */
  const resetWidth = (id: string) => {
    const next = { ...state.columnSizing }
    delete next[id]
    tableState.setColumnSizing(next)
  }
  /** Coluna vazia que fica com o espaço que sobra quando as larguras são as escolhidas. */
  const filler = (key: string, className: string) => <td key={key} aria-hidden className={cn('p-0', className)} />
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
  // as ações próprias da tela entram logo depois de Visualizar e Editar (Visualizar, Editar, Fixar…, Excluir, Mais)
  const customMenu: ColumnsMenuAction[] = actionsMenu ? (actions.custom ?? []).map((a) => ({ key: a.key, label: a.label, checked: customChosen(rowActionPrefs, a) })) : []
  const builtInMenu: ColumnsMenuAction[] = actionsMenu
    ? offeredActions(actions).map((key) => ({
        key,
        label: key === 'delete' && actions.deleteName ? actions.deleteName : t(ROW_ACTION_LABELS[key]),
        checked: actionChosen(rowActionPrefs, key),
      }))
    : []
  const customAt = builtInMenu.filter((a) => a.key === 'view' || a.key === 'edit').length
  const menuActions: ColumnsMenuAction[] = [...builtInMenu.slice(0, customAt), ...customMenu, ...builtInMenu.slice(customAt)]
  // guarda as escolhas explícitas (o padrão pode mudar sem mexer no que a pessoa escolheu)
  const toggleAction = (key: string, checked: boolean) =>
    tableState.setRowActions({
      ...Object.fromEntries(ROW_ACTION_KEYS.map((k) => [k, actionChosen(rowActionPrefs, k)])),
      ...Object.fromEntries((actions?.custom ?? []).map((a) => [a.key, customChosen(rowActionPrefs, a)])),
      [key]: checked,
    })
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
            // numa barra apertada (AppToolbar < 1150px) fica só o ícone; o nome segue no aria-label e na dica
            <AppButton variant="secondary" leftIcon={<Columns3 />} aria-label={columnsLabel} title={columnsLabel}>
              <span className="hidden sm:inline @max-[1150px]:hidden [[data-compact~='2']_&]:hidden">{columnsLabel}</span>
            </AppButton>
          }
        />
      )}
      {toolbarActions}
    </>
  )

  // sem busca, filtros, colunas para escolher nem extras: nada de barra vazia acima da tabela
  const hasToolbar = searchable || barFilters.length > 0 || menuColumns.length > 0 || !!toolbar || !!toolbarActions

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
              {barFilters.map((filter) => {
                const Control = filter.variant === 'buttons' ? FilterButtons : filter.variant === 'menu' ? FilterMenu : FilterSelect
                return <Control key={filter.id} filter={filter} value={state.filters[filter.id]} onChange={(value) => tableState.setFilter(filter.id, value)} />
              })}
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
            ref={tableRef}
            className={cn('w-full border-separate border-spacing-0 text-sm', customWidths && 'table-fixed')}
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
                    const filter = def?.filter
                    const searchFilter = !!def?.searchFilter && searchable
                    // coluna filtrando (ajuste 24/11): fundo e traço na cor do botão principal, e o funil cheio
                    const filtering = searchFilter ? state.search.trim() !== '' : !!filter && filterValues(state.filters[column.id]).length > 0
                    const end = def?.align === 'end' || column.id === ACTIONS_ID
                    const cell = (
                      <th
                        key={header.id}
                        scope="col"
                        data-column={column.id}
                        data-filtering={filtering || undefined}
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                        style={pinnedStyle(column as never)}
                        className={cn(
                          'group relative h-10 border-b border-border bg-surface-2 px-3 text-left first:pl-5 last:pr-5 text-xs font-semibold uppercase tracking-wide text-muted',
                          end && 'text-right',
                          filtering && 'border-b-2 border-b-primary bg-primary-soft text-primary-soft-fg',
                        )}
                      >
                        <div className={cn('flex min-w-0 items-center gap-1', end && 'justify-end')}>
                          {column.getCanSort() ? (
                            <button type="button" onClick={column.getToggleSortingHandler()} className="inline-flex min-w-0 items-center gap-1 uppercase hover:text-fg">
                              <span className="truncate" title={def?.header}>
                                <table.FlexRender header={header} />
                              </span>
                              {sorted === 'asc' ? (
                                <ArrowUp className="size-3.5 shrink-0 text-primary-text" aria-hidden />
                              ) : sorted === 'desc' ? (
                                <ArrowDown className="size-3.5 shrink-0 text-primary-text" aria-hidden />
                              ) : (
                                <ChevronsUpDown className="size-3.5 shrink-0 opacity-40" aria-hidden />
                              )}
                            </button>
                          ) : (
                            <span className="truncate" title={def?.header}>
                              <table.FlexRender header={header} />
                            </span>
                          )}
                          {(searchFilter || filter) && (
                            <span className="ml-auto flex shrink-0 normal-case tracking-normal">
                              {searchFilter ? (
                                <ColumnSearchButton label={def?.header ?? ''} value={state.search} onSearch={tableState.setSearch} />
                              ) : (
                                filter && <ColumnFilterButton filter={{ id: column.id, ...filter }} value={state.filters[column.id]} onChange={(value) => tableState.setFilter(column.id, value)} />
                              )}
                            </span>
                          )}
                        </div>
                        {column.getCanResize() && (
                          // Separador focável (padrão "window splitter"): arrastar ajusta, as setas também, duplo clique volta
                          // ao original. A área de pegar é larga (8px); o traço fino aparece sempre e engrossa em verde.
                          /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
                          <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={t('table.resizeColumn')}
                            aria-valuenow={Math.round(column.getSize())}
                            title={t('table.resizeHint')}
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                              event.preventDefault()
                              resizeBy(column.id, event.key === 'ArrowRight' ? 16 : -16)
                            }}
                            onPointerDown={(event) => startResize(event, column.id)}
                            onDoubleClick={() => resetWidth(column.id)}
                            className={cn(
                              'absolute right-0 top-0 z-[2] h-full w-2 cursor-col-resize touch-none select-none focus-visible:outline-none',
                              "after:absolute after:right-0 after:top-1/4 after:h-1/2 after:w-px after:rounded after:bg-border-strong after:content-['']",
                              'hover:after:w-[3px] hover:after:bg-primary focus-visible:after:w-[3px] focus-visible:after:bg-primary',
                              resizing === column.id && 'after:w-[3px] after:bg-primary',
                            )}
                          />
                          /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
                        )}
                      </th>
                    )
                    // com larguras escolhidas, a coluna vazia fica antes das ações (que seguem na borda direita)
                    return column.id === ACTIONS_ID && customWidths ? (
                      <Fragment key={header.id}>
                        <th aria-hidden className="border-b border-border bg-surface-2 p-0" />
                        {cell}
                      </Fragment>
                    ) : (
                      cell
                    )
                  })}
                  {customWidths && !hasActionsColumn && <th aria-hidden className="border-b border-border bg-surface-2 p-0" />}
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
                    {customWidths && filler('filler', 'border-b border-border')}
                  </tr>
                ))}

              {!showSkeleton && error && (
                <tr>
                  <td colSpan={visibleColumnCount + (customWidths ? 1 : 0)}>
                    <AppErrorState correlationId={error.correlationId} onRetry={onRetry} />
                  </td>
                </tr>
              )}

              {!showSkeleton && !error && data.length === 0 && (
                <tr>
                  <td colSpan={visibleColumnCount + (customWidths ? 1 : 0)}>
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
                table.getRowModel().rows.map((row, index, rows) => {
                  const group = rowGroups?.of(row.original) ?? null
                  const highlight = group !== null && !!rowGroups?.highlight?.(group)
                  const startsGroup = group !== null && (index === 0 || rowGroups?.of(rows[index - 1]!.original) !== group)
                  return (
                    <Fragment key={row.id}>
                      {startsGroup && (
                        <tr data-testid="row-group">
                          <td
                            colSpan={visibleColumnCount + (customWidths ? 1 : 0)}
                            className={cn(
                              'border-b border-border px-5 py-1.5 text-left text-xs font-semibold tracking-wide uppercase',
                              highlight ? 'bg-warning-soft text-warning-soft-fg' : 'bg-surface text-muted',
                            )}
                          >
                            {rowGroups!.header(group, rows.filter((r) => rowGroups!.of(r.original) === group).length)}
                          </td>
                        </tr>
                      )}
                      {/* Clique na linha é atalho de mouse (no teclado, o botão "Visualizar"); com `onOpen`, o duplo
                          clique abre a página completa e o clique simples espera um instante para não abrir os dois. */}
                      <tr
                        data-highlight={highlight || undefined}
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
                        className={cn(
                          'group/row transition-colors',
                          highlight ? HIGHLIGHT_ROW : 'hover:bg-surface-2',
                          (actions?.onView || onRowClick) && 'cursor-pointer',
                          slowFetch && 'opacity-70',
                        )}
                      >
                        {row.getVisibleCells().map((cell) => {
                          const def = columns.find((c) => c.id === cell.column.id)
                          const content = (
                            <td
                              key={cell.id}
                              style={pinnedStyle(cell.column as never)}
                              className={cn(
                                // primeira e última colunas mais afastadas da borda arredondada do cartão
                                'border-b border-border px-3 py-2.5 align-middle text-fg group-last/row:border-b-0 first:pl-5 last:pr-5',
                                cell.column.getIsPinned() && (highlight ? HIGHLIGHT_ROW : 'bg-surface group-hover/row:bg-surface-2'),
                                (def?.align === 'end' || cell.column.id === ACTIONS_ID) && 'text-right',
                                // largura escolhida: o que não cabe fica dentro da coluna (corta ou quebra), sem invadir a vizinha
                                customWidths && 'overflow-hidden',
                              )}
                            >
                              <table.FlexRender cell={cell} />
                            </td>
                          )
                          return cell.column.id === ACTIONS_ID && customWidths ? (
                            <Fragment key={cell.id}>
                              {filler('filler', 'border-b border-border group-last/row:border-b-0')}
                              {content}
                            </Fragment>
                          ) : (
                            content
                          )
                        })}
                        {customWidths && !hasActionsColumn && filler('filler', 'border-b border-border group-last/row:border-b-0')}
                      </tr>
                    </Fragment>
                  )
                })}
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

function RowActions<T extends RowData>({
  row,
  actions,
  visible,
  custom,
}: {
  row: T
  actions: DataTableRowActions<T>
  visible: Record<RowActionKey, boolean>
  custom: DataTableCustomAction<T>[]
}) {
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
      {custom.map((action) => (
        <Fragment key={action.key}>{action.render(row)}</Fragment>
      ))}
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
