import { useMemo } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Pencil } from 'lucide-react'
import { AppButton, AppDrawer, AppErrorState, AppMarkdown, AppSkeleton } from '@/presentation/components'
import { useProjectMembers } from '@/features/projects/queries'
import { useTask, useTaskAttachments } from './queries'
import { TaskCustomValues, TaskProperties } from './TaskProperties'
import { TaskQuickFields } from './TaskQuickFields'
import { TaskCode, TaskIndicators, TaskPriorityBadge, TaskStatusBadge } from './task-visuals'
import { TagList } from '@/features/tags/tag-visuals'

/** "Visualizar": resumo completo da tarefa sem sair da listagem. */
export function TaskPreviewDrawer({
  taskId,
  onOpenChange,
  onEdit,
  quickFields = false,
  onOpenFull,
}: {
  taskId: string | null
  onOpenChange: (open: boolean) => void
  onEdit?: (id: string) => void
  /** Status, prioridade e responsável editáveis no painel (Kanban). */
  quickFields?: boolean
  /** "Abrir tarefa" abre a tarefa completa sem sair da tela (janela); sem isto, vai para a página da tarefa. */
  onOpenFull?: (id: string) => void
}) {
  const { t } = useTranslation()
  const task = useTask(taskId ?? undefined)
  const data = task.data
  const members = useProjectMembers(data?.project?.id)
  const attachments = useTaskAttachments(data?.id)
  const references = useMemo(
    () => ({
      people: (members.data ?? []).map((m) => ({ id: m.user.id, name: m.user.name })),
      attachments: (attachments.data ?? []).map((a) => ({ id: a.id, name: a.name, kind: a.kind, url: a.url })),
    }),
    [members.data, attachments.data],
  )

  return (
    <AppDrawer
      open={!!taskId}
      onOpenChange={onOpenChange}
      size="lg"
      title={data?.title ?? t('common.loading')}
      description={data ? <TaskCode task={data} /> : undefined}
      footer={
        data && (
          <>
            {onOpenFull ? (
              <AppButton variant="secondary" leftIcon={<ExternalLink />} onClick={() => onOpenFull(data.id)}>
                {t('tasks.openPage')}
              </AppButton>
            ) : (
              <AppButton asChild variant="secondary" leftIcon={<ExternalLink />}>
                <Link to={`/tasks/${data.id}`}>{t('tasks.openPage')}</Link>
              </AppButton>
            )}
            {data.capabilities.edit && onEdit && (
              <AppButton leftIcon={<Pencil />} onClick={() => onEdit(data.id)}>
                {t('common.edit')}
              </AppButton>
            )}
          </>
        )
      }
    >
      {task.isPending && taskId ? (
        <div className="flex flex-col gap-3">
          <AppSkeleton className="h-8 w-1/2" />
          <AppSkeleton className="h-40" />
        </div>
      ) : task.isError ? (
        <AppErrorState onRetry={() => void task.refetch()} />
      ) : data ? (
        <div className="flex flex-col gap-6">
          {quickFields && <TaskQuickFields task={data} />}
          <div className="flex flex-wrap items-center gap-2">
            {!quickFields && <TaskStatusBadge status={data.status} className="text-sm" />}
            {!quickFields && <TaskPriorityBadge priority={data.priority} className="text-sm" />}
            {data.type && <span className="text-sm text-muted">{data.type.name}</span>}
            <TagList tags={data.tags} max={6} />
            <TaskIndicators task={data} />
          </div>
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">{t('tasks.fields.description')}</h3>
            {data.description ? (
              <AppMarkdown text={data.description} />
            ) : (
              <p className="text-sm text-subtle">{t('tasks.noDescription')}</p>
            )}
          </section>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">{t('tasks.typeFields', { name: data.type?.name ?? '' })}</h3>
            <TaskCustomValues task={data} references={references} />
          </section>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">{t('tasks.properties')}</h3>
            <TaskProperties task={data} />
          </section>
        </div>
      ) : null}
    </AppDrawer>
  )
}
