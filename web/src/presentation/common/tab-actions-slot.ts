import { createContext, useContext } from 'react'

/**
 * Lugar à direita da linha de abas (AppTabs com `actionsSlot`) onde o conteúdo da aba pode pôr as
 * suas ações (ex.: "Colunas" e "Nova tarefa" da aba Tarefas), deixando a barra de filtros numa linha.
 */
export const TabActionsSlotContext = createContext<HTMLElement | null>(null)

export function useTabActionsSlot(): HTMLElement | null {
  return useContext(TabActionsSlotContext)
}
