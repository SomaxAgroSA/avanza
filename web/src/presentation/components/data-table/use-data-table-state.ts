import { useCallback, useMemo, useState } from 'react'
import { readJson, writeJson } from '@/core/storage/safe-storage'
import type { ListQuery, SortState } from '@/domain/pagination'

/**
 * Estado de uma DataTable (paginação, ordenação, busca, filtros, colunas).
 * Filtros, busca, ordenação, tamanho de página e layout de colunas são persistidos por tabela;
 * a página atual não (volta para 1 ao reabrir).
 */
export interface DataTableState {
  page: number
  perPage: number
  sort: SortState | null
  search: string
  filters: Record<string, string>
  columnVisibility: Record<string, boolean>
  columnSizing: Record<string, number>
}

type Persisted = Omit<DataTableState, 'page'>

export interface DataTableStateDefaults {
  perPage?: number
  sort?: SortState | null
  /** Filtros iniciais (ex.: só tarefas abertas); valem até o usuário mudar. */
  filters?: Record<string, string>
  /** Colunas ocultas por padrão (`{ coluna: false }`). */
  columnVisibility?: Record<string, boolean>
}

export interface DataTableStateApi {
  state: DataTableState
  query: ListQuery
  hasActiveFilters: boolean
  setPage: (page: number) => void
  setPerPage: (perPage: number) => void
  setSort: (sort: SortState | null) => void
  setSearch: (search: string) => void
  setFilter: (id: string, value: string | undefined) => void
  resetFilters: () => void
  setColumnVisibility: (visibility: Record<string, boolean>) => void
  setColumnSizing: (sizing: Record<string, number>) => void
}

const storageKey = (id: string) => `kamban.table.${id}`

function initialState(id: string, defaults: DataTableStateDefaults): DataTableState {
  const base: Persisted = {
    perPage: defaults.perPage ?? 20,
    sort: defaults.sort ?? null,
    search: '',
    filters: defaults.filters ?? {},
    columnVisibility: defaults.columnVisibility ?? {},
    columnSizing: {},
  }
  const saved = readJson<Partial<Persisted>>(storageKey(id), {})
  return {
    page: 1,
    perPage: typeof saved.perPage === 'number' ? saved.perPage : base.perPage,
    sort: saved.sort === undefined ? base.sort : saved.sort,
    search: typeof saved.search === 'string' ? saved.search : base.search,
    filters: saved.filters && typeof saved.filters === 'object' ? saved.filters : base.filters,
    // coluna nova oculta por padrão continua oculta para quem já tinha colunas salvas
    columnVisibility: { ...base.columnVisibility, ...saved.columnVisibility },
    columnSizing: saved.columnSizing ?? base.columnSizing,
  }
}

export function useDataTableState(id: string, defaults: DataTableStateDefaults = {}): DataTableStateApi {
  const [state, setState] = useState<DataTableState>(() => initialState(id, defaults))

  const update = useCallback(
    (patch: Partial<DataTableState>) => {
      setState((prev) => {
        const next = { ...prev, ...patch }
        const { page: _page, ...persisted } = next
        writeJson(storageKey(id), persisted)
        return next
      })
    },
    [id],
  )

  const setFilter = useCallback(
    (filterId: string, value: string | undefined) => {
      setState((prev) => {
        const filters = { ...prev.filters }
        if (value) filters[filterId] = value
        else delete filters[filterId]
        const next = { ...prev, filters, page: 1 }
        const { page: _page, ...persisted } = next
        writeJson(storageKey(id), persisted)
        return next
      })
    },
    [id],
  )

  const query = useMemo<ListQuery>(
    () => ({ page: state.page, perPage: state.perPage, sort: state.sort, search: state.search, filters: state.filters }),
    [state.page, state.perPage, state.sort, state.search, state.filters],
  )

  return {
    state,
    query,
    hasActiveFilters: state.search.trim() !== '' || Object.keys(state.filters).length > 0,
    setPage: useCallback((page) => update({ page }), [update]),
    setPerPage: useCallback((perPage) => update({ perPage, page: 1 }), [update]),
    setSort: useCallback((sort) => update({ sort, page: 1 }), [update]),
    setSearch: useCallback((search) => update({ search, page: 1 }), [update]),
    setFilter,
    resetFilters: useCallback(() => update({ search: '', filters: {}, page: 1 }), [update]),
    setColumnVisibility: useCallback((columnVisibility) => update({ columnVisibility }), [update]),
    setColumnSizing: useCallback((columnSizing) => update({ columnSizing }), [update]),
  }
}
