/**
 * Colunas personalizadas do quadro (Gerenciamento de Projetos, GP-5). As regras (quem define, validação
 * dos valores, troca de tipo) ficam no servidor (backend/src/domain/plan-columns.js); aqui
 * ficam os tipos, os limites da tela, a ordenação e as somas dos recortes.
 */
import type { OptionColor } from './task-config'

export const COLUMN_TYPES = ['text', 'number', 'date', 'checkbox', 'dropdown', 'people', 'link'] as const
export type ColumnType = (typeof COLUMN_TYPES)[number]

/** Limites (iguais aos do servidor). */
export const COLUMN_LIMITS = { columns: 30, name: 60, optionName: 40, options: 30, text: 500, link: 2000, number: 1e12, unit: 8 } as const

export interface ColumnOption {
  id: string
  name: string
  color: OptionColor
}

export interface ColumnSettings {
  /** Lista de opções (tipo "dropdown"). */
  options?: ColumnOption[]
  /** Unidade do número (ex.: "R$", "kg"). */
  unit?: string
}

export interface PlanColumn {
  id: string
  name: string
  type: ColumnType
  settings: ColumnSettings
  position: number
}

/** Valor de célula: texto, número, data (AAAA-MM-DD), caixa, id da opção, id da pessoa ou link. */
export type CustomValue = string | number | boolean

export interface PlanColumnInput {
  name?: string
  type?: ColumnType
  settings?: ColumnSettings
}

/** Prévia da troca de tipo: quantos valores convertem e quantos se perdem. */
export interface ColumnTypePreview {
  converted: number
  lost: number
}

/** Id da coluna no quadro (para não colidir com as colunas fixas). */
export const customColumnId = (id: string) => `custom:${id}`
export const isCustomColumnId = (id: string): id is `custom:${string}` => id.startsWith('custom:')
export const columnIdOf = (boardId: string) => boardId.slice('custom:'.length)

export const optionOf = (column: PlanColumn, value: unknown): ColumnOption | undefined => column.settings.options?.find((o) => o.id === value)

/** Pessoa (só o id) não tem ordem natural sem a lista de membros: não ordena. */
export const isSortableType = (type: ColumnType) => type !== 'people'

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Chave para ordenar (null = vazio, sempre no fim). */
export function customSortKey(column: PlanColumn, value: CustomValue | undefined): string | number | null {
  if (value === undefined || value === null || value === '') return null
  switch (column.type) {
    case 'number':
      return typeof value === 'number' ? value : null
    case 'checkbox':
      return value === true ? 1 : 0
    case 'dropdown': {
      const index = (column.settings.options ?? []).findIndex((o) => o.id === value)
      return index >= 0 ? index : null
    }
    case 'people':
      return null
    default:
      return fold(String(value))
  }
}

/** Somas das colunas numéricas (mesma regra do servidor; null quando ninguém tem valor). */
export function sumCustom(items: Array<{ custom: Record<string, CustomValue> }>, columns: PlanColumn[]): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  columns
    .filter((c) => c.type === 'number')
    .forEach((c) => {
      const values = items.map((i) => i.custom[c.id]).filter((v): v is number => typeof v === 'number')
      out[c.id] = values.length ? Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100 : null
    })
  return out
}

/** Só links http(s) viram âncora (o servidor também recusa outros esquemas). */
export const isSafeLink = (value: string) => /^https?:\/\/\S+$/i.test(value)
