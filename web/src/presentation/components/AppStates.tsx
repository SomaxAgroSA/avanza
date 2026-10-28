import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import { AppButton } from './AppButton'

/* ------------------------------------------------------------------ AppEmptyState */

export interface AppEmptyStateProps {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
}

/** Estado vazio útil: explica o que é a área e qual o próximo passo. */
export function AppEmptyState({ title, description, icon, action, className, compact }: AppEmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 py-8' : 'gap-3 py-16', className)}>
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-fg [&_svg]:size-6">
        {icon ?? <Inbox />}
      </div>
      <div className="max-w-sm">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ AppErrorState */

export interface AppErrorStateProps {
  title?: ReactNode
  description?: ReactNode
  correlationId?: string | undefined
  onRetry?: () => void
  className?: string
}

export function AppErrorState({ title, description, correlationId, onRetry, className }: AppErrorStateProps) {
  const { t } = useTranslation()
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-3 py-14 text-center', className)}>
      <div className="flex size-12 items-center justify-center rounded-xl bg-danger-soft text-danger-soft-fg">
        <AlertTriangle className="size-6" />
      </div>
      <div className="max-w-sm">
        <h3 className="text-sm font-semibold text-fg">{title ?? t('states.errorTitle')}</h3>
        <p className="mt-1 text-sm text-muted">{description ?? t('states.errorDescription')}</p>
        {correlationId && (
          <p className="mt-2 font-mono text-[11px] text-subtle">
            {t('states.reference')}: {correlationId}
          </p>
        )}
      </div>
      {onRetry && (
        <AppButton variant="secondary" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </AppButton>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ AppSkeleton / AppLoading */

export function AppSkeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-surface-3', className)} />
}

export function AppLoading({ label, className, fullscreen }: { label?: string; className?: string; fullscreen?: boolean }) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex items-center justify-center gap-2 text-sm text-muted', fullscreen ? 'min-h-dvh' : 'py-10', className)}
    >
      <Loader2 className="size-4 animate-spin text-primary-text" aria-hidden />
      <span>{label ?? t('common.loading')}</span>
    </div>
  )
}
