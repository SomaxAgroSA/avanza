import { describe, expect, it } from 'vitest'
import { COLLAPSED_WIDTH, boardTableStyle, canShift, moveColumn, normalizeColumns, placeAfter, setCollapsed, setHidden, shiftColumn, visibleColumns, type BoardColumnDef } from './board-columns'

const defs: BoardColumnDef[] = [
  { id: 'name', width: 320, pinned: true },
  { id: 'status', width: 140 },
  { id: 'schedule', width: 160 },
  { id: 'effort', width: 120, minWidth: 90 },
]

describe('estado das colunas do quadro', () => {
  it('normaliza: fixa primeiro, desconhecidas somem, novas no fim, larguras nos limites', () => {
    const state = normalizeColumns(defs, { order: ['effort', 'ghost', 'name', 'status'], widths: { effort: 10, status: 9999, ghost: 100 }, hidden: ['name', 'schedule'], collapsed: ['name'] })
    expect(state.order).toEqual(['name', 'effort', 'status', 'schedule'])
    expect(state.widths).toEqual({ effort: 90, status: 640 })
    expect(state.hidden).toEqual(['schedule'])
    expect(state.collapsed).toEqual([])
    expect(normalizeColumns(defs, null).order).toEqual(['name', 'status', 'schedule', 'effort'])
  })

  it('move antes/depois do alvo e nunca à frente da fixa', () => {
    const state = normalizeColumns(defs, null)
    expect(moveColumn(state, defs, 'effort', 'status').order).toEqual(['name', 'effort', 'status', 'schedule'])
    expect(moveColumn(state, defs, 'status', 'schedule', true).order).toEqual(['name', 'schedule', 'status', 'effort'])
    expect(moveColumn(state, defs, 'effort', 'name').order).toEqual(['name', 'effort', 'status', 'schedule'])
    expect(moveColumn(state, defs, 'name', 'effort')).toBe(state)
  })

  it('coloca depois de outra coluna mesmo antes de ela existir (entra na posição quando aparece)', () => {
    const state = normalizeColumns(defs, null)
    const saved = placeAfter(state, 'nova', 'status')
    expect(normalizeColumns(defs, saved).order).toEqual(state.order)
    const withNew = [...defs, { id: 'nova', width: 120 }]
    const order = normalizeColumns(withNew, saved).order
    expect(order.indexOf('nova')).toBe(order.indexOf('status') + 1)
    expect(placeAfter(state, 'nova', 'inexistente')).toBe(state)
  })

  it('desloca pulando ocultas; nos extremos não muda', () => {
    const state = setHidden(normalizeColumns(defs, null), 'schedule', true)
    expect(shiftColumn(state, defs, 'status', 1).order).toEqual(['name', 'schedule', 'effort', 'status'])
    expect(canShift(state, defs, 'status', -1)).toBe(false)
    expect(canShift(state, defs, 'effort', 1)).toBe(false)
  })

  it('visíveis com largura efetiva (recolhida = estreita)', () => {
    const state = setCollapsed(setHidden(normalizeColumns(defs, { widths: { status: 200 } }), 'effort', true), 'schedule', true)
    expect(visibleColumns(defs, state).map((c) => [c.id, c.effectiveWidth, c.collapsed])).toEqual([
      ['name', 320, false],
      ['status', 200, false],
      ['schedule', COLLAPSED_WIDTH, true],
    ])
  })

  it('largura da tabela: soma das colunas (+ reserva do fim) em px, nunca em % (senão a tabela fica com 1.000.000 px num pai de largura intrínseca)', () => {
    expect(boardTableStyle([320, 140, 44])).toEqual({ width: '504px', minWidth: '100%' })
    expect(boardTableStyle([320, 140], 40)).toEqual({ width: '500px', minWidth: '100%' })
    expect(boardTableStyle([])).toEqual({ width: '0px', minWidth: '100%' })
    expect(boardTableStyle([320, 140]).width).not.toContain('%')
  })
})
