/**
 * Estado das colunas do quadro (estilo Monday): ordem, largura, ocultas e recolhidas.
 * Preferência de interface por pessoa (localStorage), compartilhada por todos os grupos do quadro.
 * A coluna fixa (`pinned`, ex.: "Elemento") fica sempre em primeiro e não se move nem se oculta.
 */

export interface BoardColumnDef {
  id: string
  /** Largura inicial (px). */
  width: number
  /** Largura mínima (px). */
  minWidth?: number
  pinned?: boolean
  /** Pode ser ocultada (padrão: sim, exceto a fixa). */
  hideable?: boolean
}

export interface BoardColumnsState {
  order: string[]
  widths: Record<string, number>
  hidden: string[]
  collapsed: string[]
}

export const COLLAPSED_WIDTH = 44
export const MAX_COLUMN_WIDTH = 640
const DEFAULT_MIN = 72

export const emptyColumnsState = (): BoardColumnsState => ({ order: [], widths: {}, hidden: [], collapsed: [] })

/** Estado salvo + definições atuais → estado válido (colunas novas no fim, removidas somem). */
export function normalizeColumns(defs: BoardColumnDef[], saved: Partial<BoardColumnsState> | null | undefined): BoardColumnsState {
  const ids = defs.map((d) => d.id)
  const known = new Set(ids)
  const pinned = defs.filter((d) => d.pinned).map((d) => d.id)
  const savedOrder = Array.isArray(saved?.order) ? saved.order.filter((id) => known.has(id) && !pinned.includes(id)) : []
  const rest = ids.filter((id) => !pinned.includes(id) && !savedOrder.includes(id))
  const widths: Record<string, number> = {}
  defs.forEach((d) => {
    const value = saved?.widths?.[d.id]
    if (typeof value === 'number' && Number.isFinite(value)) widths[d.id] = clampWidth(d, value)
  })
  const canHide = (id: string) => {
    const def = defs.find((d) => d.id === id)
    return !!def && !def.pinned && def.hideable !== false
  }
  return {
    order: [...pinned, ...new Set(savedOrder), ...rest],
    widths,
    hidden: Array.isArray(saved?.hidden) ? saved.hidden.filter(canHide) : [],
    collapsed: Array.isArray(saved?.collapsed) ? saved.collapsed.filter((id) => known.has(id) && !pinned.includes(id)) : [],
  }
}

export function clampWidth(def: BoardColumnDef, width: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(def.minWidth ?? DEFAULT_MIN, width)))
}

/** Move a coluna para a posição de `targetId` (antes dela; `after` = depois). A fixa não se move. */
export function moveColumn(state: BoardColumnsState, defs: BoardColumnDef[], id: string, targetId: string, after = false): BoardColumnsState {
  const pinned = new Set(defs.filter((d) => d.pinned).map((d) => d.id))
  if (id === targetId || pinned.has(id) || !state.order.includes(id) || !state.order.includes(targetId)) return state
  const without = state.order.filter((x) => x !== id)
  let index = without.indexOf(targetId) + (after ? 1 : 0)
  // nunca à frente das fixas
  const firstFree = without.findIndex((x) => !pinned.has(x))
  if (firstFree >= 0 && index < firstFree) index = firstFree
  const order = [...without.slice(0, index), id, ...without.slice(index)]
  return order.every((x, i) => x === state.order[i]) ? state : { ...state, order }
}

/**
 * Guarda `id` logo depois de `afterId` na ordem — mesmo antes de a coluna existir (ex.: recém-criada,
 * ainda chegando do servidor): a ordem salva só vale para colunas conhecidas, então ela entra na
 * posição assim que aparece.
 */
export function placeAfter(state: BoardColumnsState, id: string, afterId: string): BoardColumnsState {
  const order = state.order.filter((x) => x !== id)
  const index = order.indexOf(afterId)
  if (index < 0) return state
  return { ...state, order: [...order.slice(0, index + 1), id, ...order.slice(index + 1)] }
}

/** Uma posição para a esquerda (-1) ou direita (+1), pulando as ocultas. */
export function shiftColumn(state: BoardColumnsState, defs: BoardColumnDef[], id: string, step: -1 | 1): BoardColumnsState {
  const visible = state.order.filter((x) => !state.hidden.includes(x))
  const index = visible.indexOf(id)
  const target = visible[index + step]
  if (index < 0 || !target) return state
  return moveColumn(state, defs, id, target, step === 1)
}

export function canShift(state: BoardColumnsState, defs: BoardColumnDef[], id: string, step: -1 | 1): boolean {
  return shiftColumn(state, defs, id, step) !== state
}

const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id))

export const setHidden = (state: BoardColumnsState, id: string, hidden: boolean): BoardColumnsState => ({ ...state, hidden: toggle(state.hidden, id, hidden) })
export const setCollapsed = (state: BoardColumnsState, id: string, collapsed: boolean): BoardColumnsState => ({
  ...state,
  collapsed: toggle(state.collapsed, id, collapsed),
})

/** Reserva no fim da tabela para o conteúdo depois da última coluna (ex.: "+" de nova coluna). */
export const BOARD_TRAIL_WIDTH = 40

/**
 * Largura da tabela do quadro: a soma das colunas (+ a reserva do fim) em px, esticada até a largura
 * do contêiner por `min-width: 100%` (a coluna vazia do fim absorve a sobra).
 * Nunca `width` em %: dentro de um pai de largura intrínseca (`w-max`, que alinha os grupos), o Chrome
 * trata a tabela de largura percentual como infinita (1.000.000 px) e a rolagem lateral não acaba.
 */
export function boardTableStyle(widths: number[], trail = 0): { width: string; minWidth: string } {
  return { width: `${widths.reduce((sum, w) => sum + w, trail)}px`, minWidth: '100%' }
}

/** Colunas visíveis, na ordem, com a largura efetiva. */
export function visibleColumns<T extends BoardColumnDef>(defs: T[], state: BoardColumnsState): Array<T & { effectiveWidth: number; collapsed: boolean }> {
  const byId = new Map(defs.map((d) => [d.id, d]))
  return state.order
    .filter((id) => !state.hidden.includes(id))
    .map((id) => byId.get(id))
    .filter((d): d is T => !!d)
    .map((d) => {
      const collapsed = state.collapsed.includes(d.id)
      return { ...d, collapsed, effectiveWidth: collapsed ? COLLAPSED_WIDTH : (state.widths[d.id] ?? d.width) }
    })
}
