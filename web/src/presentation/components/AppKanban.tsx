import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { FoldHorizontal, UnfoldHorizontal } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { AppIconButton } from './AppIconButton'

export type AppKanbanWipState = 'none' | 'ok' | 'full' | 'over'

const WIP_TONE: Record<AppKanbanWipState, string> = {
  none: 'bg-surface-3 text-muted',
  ok: 'bg-surface-3 text-muted',
  full: 'bg-warning-soft text-warning-soft-fg',
  over: 'bg-danger-soft text-danger-soft-fg',
}

export interface AppKanbanColumnHeaderProps {
  title: ReactNode
  /** Contagem (ex.: "3" ou "3/5" com limite WIP). */
  count: ReactNode
  countLabel?: string
  wip?: AppKanbanWipState
  /** Barra de cor no topo (cor do status). */
  accent?: string
  actions?: ReactNode
  /** Destino não permitido para o card em arraste. */
  blocked?: boolean
  /** Coluna recolhida: faixa estreita só com a contagem e o botão de expandir. */
  collapsed?: boolean
  /** Quadro compacto: cabeçalho mais baixo e texto menor. */
  compact?: boolean
  /** Recolher/expandir a coluna (o rótulo diz qual das duas). */
  onToggleCollapse?: () => void
  toggleLabel?: string
  className?: string
}

/** Cabeçalho da coluna do quadro: nome, contagem/limite WIP e ações. */
export function AppKanbanColumnHeader({ title, count, countLabel, wip = 'none', accent, actions, blocked, collapsed, compact, onToggleCollapse, toggleLabel, className }: AppKanbanColumnHeaderProps) {
  const toggle = onToggleCollapse && (
    <AppIconButton size="sm" variant="ghost" icon={collapsed ? <UnfoldHorizontal /> : <FoldHorizontal />} label={toggleLabel ?? ''} onClick={onToggleCollapse} />
  )
  if (collapsed) {
    return (
      <div
        className={cn(
          'relative flex min-h-11 flex-col items-center justify-center gap-1 overflow-hidden rounded-md border border-border bg-surface px-0.5 py-1.5 shadow-card transition-opacity',
          compact && 'min-h-9 py-0.5',
          wip === 'over' && 'border-danger',
          blocked && 'opacity-50',
          className,
        )}
      >
        {accent && <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: accent }} />}
        <span className="sr-only">{title}</span>
        {toggle}
      </div>
    )
  }
  return (
    <div
      className={cn(
        'relative flex min-h-11 items-center gap-2 overflow-hidden rounded-md border border-border bg-surface px-3 py-2 shadow-card transition-opacity',
        compact && 'min-h-9 gap-1.5 px-2.5 py-1',
        wip === 'over' && 'border-danger',
        blocked && 'opacity-50',
        className,
      )}
    >
      {accent && <span aria-hidden className={cn('absolute inset-x-0 top-0', compact ? 'h-0.5' : 'h-1')} style={{ backgroundColor: accent }} />}
      <div className={cn('min-w-0 flex-1 truncate font-semibold text-fg', compact ? 'text-xs' : 'text-sm')}>{title}</div>
      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums', compact && 'px-1.5 py-0 text-[11px]', WIP_TONE[wip])} title={countLabel}>
        {count}
        {countLabel && <span className="sr-only"> {countLabel}</span>}
      </span>
      {actions}
      {toggle}
    </div>
  )
}

export interface AppKanbanDropZoneProps extends HTMLAttributes<HTMLDivElement> {
  /** O card em arraste está sobre esta área. */
  over?: boolean
  /** Destino não permitido (transição bloqueada ou outra raia). */
  blocked?: boolean
}

/** Área de cards de uma coluna (e raia): recebe os cards soltos. */
export const AppKanbanDropZone = forwardRef<HTMLDivElement, AppKanbanDropZoneProps>(function AppKanbanDropZone(
  { over, blocked, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        // relative: textos só para leitor de tela (sr-only, absolutos) ficam presos à rolagem da coluna; sem
        // isso eles escapam e esticam o quadro inteiro, criando uma 2ª barra de rolagem
        'relative flex min-h-24 flex-col gap-2 rounded-xl border border-transparent bg-surface-2 p-2 transition-colors',
        over && !blocked && 'border-primary bg-primary-soft',
        blocked && 'cursor-not-allowed border-dashed border-border-strong opacity-50',
        className,
      )}
      {...props}
    />
  )
})

export interface AppKanbanCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Card de origem enquanto é arrastado (fica "fantasma"). */
  dragging?: boolean
  /** Cópia que segue o ponteiro. */
  overlay?: boolean
  /** Sem arrastar (sem permissão). */
  locked?: boolean
}

/** Card do quadro (a feature define o conteúdo). */
export const AppKanbanCard = forwardRef<HTMLDivElement, AppKanbanCardProps>(function AppKanbanCard(
  { dragging, overlay, locked, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'group relative flex select-none flex-col gap-2 rounded-xl border border-border bg-surface p-3 text-left shadow-card outline-none',
        'transition-[border-color,box-shadow,opacity] duration-200 ease-out',
        // passar o mouse: a borda acende na cor da marca, com um halo suave (destaca o cartão que vai mexer)
        'hover:border-primary hover:ring-4 hover:ring-primary/25 focus-visible:ring-2 focus-visible:ring-ring',
        locked ? 'cursor-pointer' : 'cursor-grab touch-manipulation',
        dragging && 'opacity-40 hover:border-border hover:ring-0',
        overlay && 'rotate-2 cursor-grabbing border-primary shadow-float ring-4 ring-primary/25',
        className,
      )}
      {...props}
    />
  )
})
