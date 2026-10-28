import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ExternalLink, SearchX } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { AppButton, AppDialog, AppEmptyState, AppErrorState, AppSkeleton } from '@/presentation/components'
import { useTask } from './queries'
import { TaskDetailView } from './TaskDetailPage'
import { TaskCode } from './task-visuals'

/**
 * Tarefa completa numa janela sobre a tela atual (ex.: Kanban), sem sair dela: as mesmas abas e ações da
 * página da tarefa. "Abrir em página inteira" continua disponível.
 */
export function TaskDetailDialog({ taskId, onOpenChange }: { taskId: string | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const task = useTask(taskId ?? undefined)
  const data = task.data
  return (
    <AppDialog
      open={!!taskId}
      onOpenChange={onOpenChange}
      size="2xl"
      tall
      title={data?.title ?? t('common.loading')}
      description={data ? <TaskCode task={data} /> : undefined}
      footer={
        data && (
          <AppButton asChild variant="ghost" leftIcon={<ExternalLink />}>
            <Link to={`/tasks/${data.id}`}>{t('tasks.openFullPage')}</Link>
          </AppButton>
        )
      }
    >
      {task.isPending && taskId ? (
        <div className="flex flex-col gap-4">
          <AppSkeleton className="h-28 rounded-2xl" />
          <AppSkeleton className="h-72 rounded-2xl" />
        </div>
      ) : task.isError ? (
        isAppError(task.error) && task.error.code === 'TASK_NOT_FOUND' ? (
          <AppEmptyState icon={<SearchX />} title={t('tasks.notFound')} description={t('tasks.notFoundHint')} />
        ) : (
          <AppErrorState onRetry={() => void task.refetch()} />
        )
      ) : data ? (
        <TaskDetailView task={data} embedded onDeleted={() => onOpenChange(false)} />
      ) : null}
    </AppDialog>
  )
}
