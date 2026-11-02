import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTabActionsSlot } from '@/presentation/common/tab-actions-slot'

export interface SectionHeaderProps {
  /** Sub-navegação da seção (ex.: as visões da aba Tarefas). */
  nav?: ReactNode
  actions?: ReactNode
}

/**
 * Barra de uma seção dentro de uma página com cabeçalho próprio (ex.: uma aba do projeto): a
 * sub-navegação à esquerda e as ações à direita. Ao contrário do PageHeader, não repete o título nem
 * muda o título da aba do navegador — o cabeçalho da página é o contexto.
 *
 * As ações ficam sempre na ponta direita da linha de navegação logo acima do conteúdo: com
 * sub-navegação, na linha dela; sem, na linha das abas da página (TabActionsSlotContext), sem ocupar
 * uma linha só para elas.
 */
export function SectionHeader({ nav, actions }: SectionHeaderProps) {
  const slot = useTabActionsSlot()
  if (!nav && !actions) return null
  const actionsBox = actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
  if (!nav && slot) return createPortal(actionsBox, slot)
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">{nav}</div>
      {actionsBox}
    </div>
  )
}
