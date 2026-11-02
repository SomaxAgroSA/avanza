import { createContext, useContext } from 'react'

/**
 * Lugar à direita da linha de abas de uma página (ex.: as abas do projeto) onde a seção aberta põe as
 * suas ações quando não tem sub-navegação própria — assim não sobra uma linha só para um botão. Quem usa
 * é o SectionHeader; fora de uma página com abas, o valor é null e as ações ficam na linha da seção.
 */
export const TabActionsSlotContext = createContext<HTMLElement | null>(null)

export function useTabActionsSlot(): HTMLElement | null {
  return useContext(TabActionsSlotContext)
}
