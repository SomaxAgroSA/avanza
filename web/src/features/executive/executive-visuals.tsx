import { useId, type ReactNode } from 'react'
import { cn } from '@/core/utils/cn'
import type { HealthLevel } from '@/domain/plan-management'
import { AppBadge } from '@/presentation/components'
import { HEALTH_TONE } from '@/features/plan/health-visuals'
import { useHealthLabel } from './use-executive-format'

export function HealthBadge({ level, className }: { level: HealthLevel; className?: string }) {
  const label = useHealthLabel()
  return (
    <AppBadge tone={HEALTH_TONE[level]} dot className={className}>
      {label(level)}
    </AppBadge>
  )
}

/** Bloco do painel (região nomeada; não quebra entre páginas na impressão). */
export function ExecutiveSection({ title, description, actions, children, className }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cn('flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5 print:break-inside-avoid print:shadow-none', className)}>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold text-fg">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  )
}

/** Subtítulo dentro de um bloco. */
export function SubTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle">{children}</h3>
}
