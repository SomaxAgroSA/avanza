import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDataTableState } from './use-data-table-state'

beforeEach(() => window.localStorage.clear())

describe('useDataTableState — colunas', () => {
  it('coluna nova oculta por padrão continua oculta para quem já tinha colunas salvas; a escolha salva vale', () => {
    window.localStorage.setItem('kamban.table.t', JSON.stringify({ columnVisibility: { tags: true } }))
    const { result } = renderHook(() => useDataTableState('t', { columnVisibility: { tags: false, plan_item: false } }))
    expect(result.current.state.columnVisibility).toEqual({ tags: true, plan_item: false })
  })
})

describe('useDataTableState — filtros', () => {
  it('"Limpar filtros" volta ao padrão da tabela (ex.: só abertas) e só conta como ativo o que difere dele', () => {
    const { result } = renderHook(() => useDataTableState('f', { filters: { category: 'open' } }))
    expect(result.current.hasActiveFilters).toBe(false)
    act(() => result.current.setFilter('status', 's1'))
    expect(result.current.hasActiveFilters).toBe(true)
    act(() => result.current.setFilter('category', undefined))
    act(() => result.current.setSearch('login'))
    act(() => result.current.resetFilters())
    expect(result.current.state.filters).toEqual({ category: 'open' })
    expect(result.current.state.search).toBe('')
    expect(result.current.hasActiveFilters).toBe(false)
  })
})

describe('useDataTableState — quantos filtros estão ativos ("Limpar (n)")', () => {
  it('conta cada valor escolhido (os vários de um filtro em botões contam um a um) e a busca; o padrão da tabela não conta', () => {
    const { result } = renderHook(() => useDataTableState('n', { filters: { category: 'open' } }))
    expect(result.current.activeFilterCount).toBe(0)
    act(() => result.current.setFilter('priority', 'high,critical'))
    act(() => result.current.setFilter('status', 's1'))
    expect(result.current.activeFilterCount).toBe(3)
    act(() => result.current.setSearch('login'))
    expect(result.current.activeFilterCount).toBe(4)
    // tirar o filtro padrão também é uma mudança (Limpar volta a ele)
    act(() => result.current.setFilter('category', undefined))
    expect(result.current.activeFilterCount).toBe(5)
    act(() => result.current.resetFilters())
    expect(result.current.activeFilterCount).toBe(0)
  })
})
