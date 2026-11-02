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
