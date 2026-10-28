import { useTranslation } from 'react-i18next'
import { CalendarClock, ListChecks, ListTree, Lock, MessageSquare, Paperclip } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatDay } from '@/core/utils/format'
import type { UserSummary } from '@/domain/projects'
import { isOverdue, type TaskSummary } from '@/domain/tasks'
import { AppAvatar } from '@/presentation/components'
import { TaskTypeIconBadge } from '@/features/task-config/config-visuals'
import { LookupBadge } from '@/features/workflow/workflow-visuals'

/** Ícone do tipo + código (ex.: [bug] CRM-12). */
export function TaskCode({ task, className, compact = false }: { task: Pick<TaskSummary, 'code' | 'type'>; className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap text-muted', compact && 'gap-1 text-[11px]', className)} title={task.type?.name}>
      {task.type && <TaskTypeIconBadge icon={task.type.icon} color={task.type.color} size={compact ? 'xs' : 'sm'} />}
      <span className="truncate">{task.code}</span>
    </span>
  )
}

export function TaskStatusBadge({ status, className }: { status: TaskSummary['status']; className?: string }) {
  return status ? <LookupBadge item={status} className={className} /> : <span className="text-subtle">—</span>
}

export function TaskPriorityBadge({ priority, className }: { priority: TaskSummary['priority']; className?: string }) {
  return priority ? <LookupBadge item={priority} className={className} /> : <span className="text-subtle">—</span>
}

/** Pessoa com avatar; "Sem responsável" quando vazio. */
export function PersonCell({ person, emptyLabel }: { person: UserSummary | null; emptyLabel?: string }) {
  const { t } = useTranslation()
  if (!person) return <span className="text-subtle">{emptyLabel ?? t('tasks.unassigned')}</span>
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <AppAvatar name={person.name} src={person.avatarUrl} size="xs" />
      <span className="truncate">{person.name}</span>
    </span>
  )
}

/** Indicadores compactos: bloqueio, subtarefas, checklist, anexos e comentários (some quando não há nada). */
export function TaskIndicators({
  task,
  className,
}: {
  task: Pick<TaskSummary, 'checklistProgress' | 'commentCount' | 'attachmentCount'> & Partial<Pick<TaskSummary, 'subtaskProgress' | 'blocked'>>
  className?: string
}) {
  const { t } = useTranslation()
  const { done, total } = task.checklistProgress
  const subtasks = task.subtaskProgress ?? { done: 0, total: 0 }
  if (total === 0 && task.commentCount === 0 && task.attachmentCount === 0 && subtasks.total === 0 && !task.blocked) return null
  return (
    <span className={cn('mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted', className)}>
      {task.blocked && (
        <span className="inline-flex items-center gap-1 font-medium text-danger" title={t('relations.blockedHint')}>
          <Lock className="size-3.5" aria-hidden />
          {t('relations.blocked')}
        </span>
      )}
      {subtasks.total > 0 && (
        <span
          className={cn('inline-flex items-center gap-1', subtasks.done === subtasks.total && 'text-success')}
          title={t('relations.subtasksOf', { done: subtasks.done, total: subtasks.total })}
        >
          <ListTree className="size-3.5" aria-hidden />
          <span className="sr-only">{t('relations.subtasksOf', { done: subtasks.done, total: subtasks.total })}</span>
          <span aria-hidden>
            {subtasks.done}/{subtasks.total}
          </span>
        </span>
      )}
      {total > 0 && (
        <span className={cn('inline-flex items-center gap-1', done === total && 'text-success')} title={t('checklist.progressOf', { done, total })}>
          <ListChecks className="size-3.5" aria-hidden />
          <span className="sr-only">{t('checklist.progressOf', { done, total })}</span>
          <span aria-hidden>
            {done}/{total}
          </span>
        </span>
      )}
      {task.attachmentCount > 0 && (
        <span className="inline-flex items-center gap-1" title={t('attachments.count', { count: task.attachmentCount })}>
          <Paperclip className="size-3.5" aria-hidden />
          <span className="sr-only">{t('attachments.count', { count: task.attachmentCount })}</span>
          <span aria-hidden>{task.attachmentCount}</span>
        </span>
      )}
      {task.commentCount > 0 && (
        <span className="inline-flex items-center gap-1" title={t('comments.count', { count: task.commentCount })}>
          <MessageSquare className="size-3.5" aria-hidden />
          <span className="sr-only">{t('comments.count', { count: task.commentCount })}</span>
          <span aria-hidden>{task.commentCount}</span>
        </span>
      )}
    </span>
  )
}

/** Prazo; vencido em destaque (tarefa aberta com prazo antes de hoje). */
export function DueDate({ task }: { task: Pick<TaskSummary, 'dueDate' | 'status'> }) {
  const { t, i18n } = useTranslation()
  if (!task.dueDate) return <span className="text-subtle">—</span>
  const overdue = isOverdue(task)
  return (
    <span className={cn('inline-flex items-center gap-1.5', overdue ? 'font-medium text-danger' : 'text-muted')} title={overdue ? t('tasks.overdue') : undefined}>
      {overdue && <CalendarClock className="size-3.5" aria-hidden />}
      {formatDay(task.dueDate, i18n.language)}
      {overdue && <span className="sr-only">{t('tasks.overdue')}</span>}
    </span>
  )
}
