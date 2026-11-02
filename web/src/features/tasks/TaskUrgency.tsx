import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import type { TaskSummary } from '@/domain/tasks'
import { URGENCIES, type Urgency } from '@/domain/urgency'
import { AppDropdown, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useTaskMutations } from './queries'

const LAMP: Record<Urgency, string> = { high: 'bg-danger', medium: 'bg-warning', low: 'bg-success' }

/** Semáforo de três luzes: só a da urgência escolhida acende (sem urgência = todas apagadas). Decorativo: o nome vai ao lado. */
export function UrgencyLight({ urgency, className }: { urgency: Urgency | null; className?: string }) {
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-surface-2 px-1 py-0.5', className)}>
      {URGENCIES.map((level) => (
        <span key={level} className={cn('size-2 rounded-full', urgency === level ? LAMP[level] : 'bg-surface-3')} />
      ))}
    </span>
  )
}

/** Semáforo com o nome da urgência (só leitura). */
export function UrgencyLabel({ urgency }: { urgency: Urgency | null }) {
  const { t } = useTranslation()
  return (
    <span className="flex min-w-0 items-center gap-2">
      <UrgencyLight urgency={urgency} />
      <span className={cn('truncate', urgency ? 'text-fg' : 'text-subtle')}>{urgency ? t(`tasks.urgency.${urgency}`) : t('tasks.urgency.none')}</span>
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
  value: Urgency | null
  canEdit: boolean
  pending?: boolean
  /** Nome acessível do botão (ex.: "Mudar urgência de CRM-3 (agora: Alta)"). */
  changeLabel: string
  onChoose: (urgency: Urgency | null) => void
}) {
  const { t } = useTranslation()
  if (!canEdit) return <UrgencyLabel urgency={value} />
  const choose = (next: Urgency | null) => {
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
          className="-mx-1.5 flex max-w-full items-center rounded-md px-1.5 py-1 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
        >
          <UrgencyLabel urgency={value} />
        </button>
      }
      items={[
        ...URGENCIES.map((level) => ({ key: level, label: t(`tasks.urgency.${level}`), icon: <UrgencyLight urgency={level} />, onSelect: () => choose(level) })),
        { type: 'separator' as const, key: 'sep' },
        { key: 'none', label: t('tasks.urgency.none'), icon: <UrgencyLight urgency={null} />, onSelect: () => choose(null) },
      ]}
    />
  )
}

/** Indicador compacto (cartão do Kanban): só o semáforo, com o nome para leitores de tela e no título. */
export function UrgencyBadge({ urgency }: { urgency: Urgency | null }) {
  const { t } = useTranslation()
  if (!urgency) return null
  const text = `${t('tasks.fields.urgency')}: ${t(`tasks.urgency.${urgency}`)}`
  return (
    <span title={text} className="flex shrink-0">
      <UrgencyLight urgency={urgency} />
      <span className="sr-only">{text}</span>
    </span>
  )
}

/** Célula da coluna Urgência das tarefas: troca com um clique, sem exigir os obrigatórios do status. */
export function UrgencyCell({ task, canEdit }: { task: TaskSummary; canEdit: boolean }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { setUrgency } = useTaskMutations()
  const label = task.urgency ? t(`tasks.urgency.${task.urgency}`) : t('tasks.urgency.none')
  return (
    <UrgencyPicker
      value={task.urgency}
      canEdit={canEdit}
      pending={setUrgency.isPending && setUrgency.variables?.id === task.id}
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
