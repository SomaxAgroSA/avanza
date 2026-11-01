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

/**
 * Semáforo com o nome da urgência; para quem edita, um clique abre o menu (Alta, Média, Baixa ou
 * Sem urgência). Serve para tarefas e projetos.
 */
export function UrgencyPicker({
  value,
  canEdit,
  pending,
  changeLabel,
  onChoose,
}: {
  value: TaskUrgency | null
  canEdit: boolean
  pending?: boolean
  /** Nome acessível do botão (ex.: "Cambiar urgencia de GCS-3 (ahora: Alta)"). */
  changeLabel: string
  onChoose: (urgency: TaskUrgency | null) => void
}) {
  const { t } = useTranslation()
  const label = value ? t(`tasks.urgency.${value}`) : t('tasks.urgency.none')
  const content = (
    <>
      <UrgencyLight urgency={value} />
      <span className={cn('truncate', value ? 'text-fg' : 'text-subtle')}>{label}</span>
    </>
  )
  if (!canEdit) return <span className="flex items-center gap-2">{content}</span>
  const choose = (next: TaskUrgency | null) => {
    if (next !== value) onChoose(next)
  }
  return (
    <AppDropdown
      align="start"
      trigger={
        <button
          type="button"
          disabled={pending}
          aria-label={changeLabel}
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

/** Célula da coluna Urgência das tarefas. */
export function UrgencyCell({ task, canEdit }: { task: TaskSummary; canEdit: boolean }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { setUrgency } = useTaskMutations()
  const label = task.urgency ? t(`tasks.urgency.${task.urgency}`) : t('tasks.urgency.none')
  return (
    <UrgencyPicker
      value={task.urgency}
      canEdit={canEdit}
      pending={setUrgency.isPending}
      changeLabel={t('tasks.urgency.change', { code: task.code, urgency: label })}
      onChoose={(urgency) =>
        setUrgency.mutate(
          { id: task.id, urgency },
          {
            onSuccess: (saved) => notify.success(t('tasks.urgency.saved', { code: saved.code, urgency: saved.urgency ? t(`tasks.urgency.${saved.urgency}`) : t('tasks.urgency.none') })),
            onError: (error) => notify.error(errorMessage(error)),
          },
        )
      }
    />
  )
}
