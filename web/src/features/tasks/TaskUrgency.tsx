import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import { TASK_URGENCIES, type TaskSummary, type TaskUrgency } from '@/domain/tasks'
import { AppDropdown, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useTaskMutations } from './queries'

const LAMP: Record<TaskUrgency, string> = { high: 'bg-danger', medium: 'bg-warning', low: 'bg-success' }

/** Semáforo de três luzes: só a da urgência escolhida acende (sem urgência = todas apagadas). */
export function UrgencyLight({ urgency, className }: { urgency: TaskUrgency | null; className?: string }) {
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-surface-2 px-1 py-0.5', className)}>
      {TASK_URGENCIES.map((level) => (
        <span key={level} className={cn('size-2 rounded-full', urgency === level ? LAMP[level] : 'bg-surface-3')} />
      ))}
    </span>
  )
}

/** Célula da coluna Urgência: mostra o semáforo e, para quem edita, troca com um clique. */
export function UrgencyCell({ task, canEdit }: { task: TaskSummary; canEdit: boolean }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { setUrgency } = useTaskMutations()
  const label = task.urgency ? t(`tasks.urgency.${task.urgency}`) : t('tasks.urgency.none')
  const content = (
    <>
      <UrgencyLight urgency={task.urgency} />
      <span className={cn('truncate', task.urgency ? 'text-fg' : 'text-subtle')}>{label}</span>
    </>
  )
  if (!canEdit) return <span className="flex items-center gap-2">{content}</span>

  const choose = (urgency: TaskUrgency | null) => {
    if (urgency === task.urgency) return
    setUrgency.mutate(
      { id: task.id, urgency },
      {
        onSuccess: (saved) => notify.success(t('tasks.urgency.saved', { code: saved.code, urgency: saved.urgency ? t(`tasks.urgency.${saved.urgency}`) : t('tasks.urgency.none') })),
        onError: (error) => notify.error(errorMessage(error)),
      },
    )
  }
  return (
    <AppDropdown
      align="start"
      trigger={
        <button
          type="button"
          disabled={setUrgency.isPending}
          aria-label={t('tasks.urgency.change', { code: task.code, urgency: label })}
          className="-mx-1.5 flex max-w-full items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
        >
          {content}
        </button>
      }
      items={[
        ...TASK_URGENCIES.map((level) => ({ key: level, label: t(`tasks.urgency.${level}`), icon: <UrgencyLight urgency={level} />, onSelect: () => choose(level) })),
        { type: 'separator' as const, key: 'sep' },
        { key: 'none', label: t('tasks.urgency.none'), icon: <UrgencyLight urgency={null} />, onSelect: () => choose(null) },
      ]}
    />
  )
}
