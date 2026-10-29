import { useId, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/core/utils/cn'
import type { HealthLevel } from '@/domain/plan-management'
import { chartToneBg } from '@/presentation/components'
import { HEALTH_TONE } from '@/features/plan/health-visuals'
import { useHealthLabel } from './use-executive-format'

/** Bolinha da saúde na cor do nível (sempre com o rótulo ao lado — a cor nunca sozinha). */
export function HealthDot({ level, className }: { level: HealthLevel; className?: string }) {
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', chartToneBg(HEALTH_TONE[level]), className)} />
}

/** Saúde em texto: bolinha + nível. */
export function HealthStatus({ level, className }: { level: HealthLevel; className?: string }) {
  const label = useHealthLabel()
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium text-fg', className)}>
      <HealthDot level={level} />
      {label(level)}
    </span>
  )
}

/** Chave do projeto em destaque discreto (identifica o projeto em listas mistas). */
export function ProjectKey({ value, className }: { value: string; className?: string }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded bg-surface-3 px-1.5 font-mono text-[11px] font-medium leading-5 text-muted', className)}>{value}</span>
}

/**
 * Bloco do painel: cartão com título (e, no máximo, uma linha curta ao lado), região nomeada e sem
 * quebra entre páginas na impressão. `flush`: o conteúdo encosta nas bordas (tabelas).
 */
export function ExecutiveSection({
  title,
  meta,
  actions,
  children,
  className,
  flush,
  style,
}: {
  title: string
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  flush?: boolean
  style?: CSSProperties
}) {
  const id = useId()
  return (
    <section
      aria-labelledby={id}
      style={style}
      className={cn(
        'flex min-w-0 flex-col rounded-xl border border-border bg-surface shadow-card motion-safe:animate-rise print:break-inside-avoid print:shadow-none',
        flush && 'overflow-hidden',
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 pt-5 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h2 id={id} className="text-base font-semibold text-fg">
            {title}
          </h2>
          {meta && <span className="text-sm text-muted">{meta}</span>}
        </div>
        {actions}
      </header>
      <div className={cn('flex flex-1 flex-col', flush ? 'mt-4' : 'px-5 pt-4 pb-5 sm:px-6 sm:pb-6')}>{children}</div>
    </section>
  )
}
