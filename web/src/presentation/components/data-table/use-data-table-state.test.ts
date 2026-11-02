import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDataTableState } from './use-data-table-state'

beforeEach(() => window.localStorage.clear())

describe('useDataTableState — colunas', () => {
  it('coluna nova oculta por padrão continua oculta para quem já tinha colunas salvas; a escolha salva vale', () => {
    window.localStorage.setItem('kamban.table.t', JSON.stringify({ columnVisibility: { tags: true } }))
    const { result } = renderHook(() => useDataTableState('t', { columnVisibility: { tags: false, plan_item: false } }))
    expect(result.current.state.columnVisibility).toEqual({ tags: true, plan_item: false })
  })
})
