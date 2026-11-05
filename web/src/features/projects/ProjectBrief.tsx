import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ClipboardList, Gauge, Target } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDay } from '@/core/utils/format'
import type { Project } from '@/domain/projects'
import { AppCard, AppEmptyState, AppErrorState, AppSkeleton } from '@/presentation/components'
import { DueDate, TaskCode, TaskStatusBadge } from '@/features/tasks/task-visuals'
import { UrgencyLight } from '@/features/tasks/TaskUrgency'
import { TaskPreviewDrawer } from '@/features/tasks/TaskPreviewDrawer'
import { useProjectBrief } from './charter/queries'

const utcDay = (day: string) => new Date(`${day}T00:00:00.000Z`)

/**
 * Resumo do projeto para o Responsável TI (regras de negócio §33), na Visão geral da página do projeto:
 * para que o projeto existe (objetivo da ficha), o que precisamos dele — as tarefas atribuídas a ele e as
 * marcadas "Visível para TI" (§36) — e os indicadores da ficha sob a responsabilidade dele. A tarefa abre
 * no painel lateral, onde ele comenta, anexa e muda o status.
 */
export function ProjectBrief({ project }: { project: Project }) {
  const { t, i18n } = useTranslation()
  const brief = useProjectBrief(project.id)
  const [openId, setOpenId] = useState<string | null>(null)

  if (brief.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <AppSkeleton className="h-28 rounded-xl" />
        <AppSkeleton className="h-64 rounded-xl" />
      </div>
    )
  }
  if (brief.isError) return <AppErrorState correlationId={isAppError(brief.error) ? brief.error.correlationId : undefined} onRetry={() => void brief.refetch()} />

  const { objective, tasks, items } = brief.data
  return (
    <div className="flex flex-col gap-4">
      <AppCard title={t('brief.aboutTitle')} description={t('brief.aboutDescription')}>
        <div className="flex gap-3">
          <Target className="mt-0.5 size-5 shrink-0 text-primary-text" aria-hidden />
          <p className="whitespace-pre-line text-sm text-fg">{objective || t('brief.noObjective')}</p>
        </div>
      </AppCard>

      <AppCard title={t('brief.needsTitle')} description={t('brief.needsDescription', { count: tasks.length })}>
        {tasks.length === 0 ? (
          <AppEmptyState icon={<ClipboardList />} title={t('brief.noTasksTitle')} description={t('brief.noTasksDescription')} />
        ) : (
          <ul className="-mx-2 flex flex-col">
            {tasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(task.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <TaskCode task={task} />
                      {task.urgency && <UrgencyLight urgency={task.urgency} />}
                    </span>
                    <span className="mt-0.5 block text-sm font-medium text-fg">{task.title}</span>
                  </span>
                  <span className="hidden text-xs sm:block">{task.dueDate ? <DueDate task={task} /> : <span className="text-subtle">{t('brief.noDueDate')}</span>}</span>
                  <TaskStatusBadge status={task.status} />
                  <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </AppCard>

      {items.length > 0 && (
        <AppCard title={t('brief.itemsTitle')} description={t('brief.itemsDescription')}>
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.id} className="flex gap-3">
                <Gauge className="mt-0.5 size-5 shrink-0 text-primary-text" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">
                    {item.title}
                    {item.target !== null && <span className="ml-2 font-normal text-muted">{t('brief.target', { value: item.target, unit: item.unit })}</span>}
                    {item.dueDate && <span className="ml-2 font-normal text-muted">{t('brief.due', { date: formatDay(utcDay(item.dueDate), i18n.language) })}</span>}
                  </p>
                  {item.description && <p className="mt-0.5 text-xs text-muted">{item.description}</p>}
                </div>
              </li>
            ))}
          </ul>
        </AppCard>
      )}

      <TaskPreviewDrawer taskId={openId} onOpenChange={(open) => !open && setOpenId(null)} quickFields />
    </div>
  )
}
