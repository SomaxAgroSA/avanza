import type { TableFilterDef } from './TableFilters'

/** Os valores escolhidos de um filtro (vários = unidos por vírgula). */
export const filterValues = (value: string | undefined): string[] => (value ? value.split(',').filter(Boolean) : [])

/** Filtro de vários valores ao mesmo tempo (botões ou menu); o seletor é de um só. */
export const isMultiFilter = (filter: Pick<TableFilterDef, 'variant'>): boolean => filter.variant === 'buttons' || filter.variant === 'menu'

/** Texto para comparar na busca das opções: sem acentos e em minúsculas. */
export const foldText = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
