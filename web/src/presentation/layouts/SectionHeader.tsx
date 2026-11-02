import type { ReactNode } from 'react'

export interface SectionHeaderProps {
  /** Sub-navegação da seção (ex.: as visões da aba Tarefas). */
  nav?: ReactNode
  actions?: ReactNode
}

/**
 * Barra de uma seção dentro de uma página com cabeçalho próprio (ex.: uma aba do projeto): a
 * sub-navegação à esquerda e as ações à direita. Ao contrário do PageHeader, não repete o título nem
 * muda o título da aba do navegador — o cabeçalho da página é o contexto.
 */
export function SectionHeader({ nav, actions }: SectionHeaderProps) {
  if (!nav && !actions) return null
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">{nav}</div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
