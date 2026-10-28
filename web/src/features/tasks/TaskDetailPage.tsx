import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, GitFork, Lock, Pencil, SearchX, Trash2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import type { TaskDetail } from '@/domain/tasks'
import { relationCount } from '@/domain/relations'
import {
  AppBadge,
  AppButton,
  AppCard,
  AppConfirmDialog,
  AppEmptyState,
  AppErrorState,
  AppMarkdown,
  AppSkeleton,
  AppTabs,
  notify,
} from '@/presentation/components'
import { useLiveProject } from '@/presentation/common/use-live'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { AuditTimeline } from '@/features/audit/AuditTimeline'
import { useProjectMembers } from '@/features/projects/queries'
import { TaskQuickFields } from './TaskQuickFields'
import { useTask, useTaskAttachments, useTaskHistory, useTaskMutations, useTaskRelations } from './queries'
import { TaskRelationsPanel } from './TaskRelationsPanel'
import { ForkTaskDialog } from './ForkTaskDialog'
import { TaskFormDialog } from './TaskFormDialog'
import { TaskCustomValues, TaskProperties } from './TaskProperties'
import { TaskCode } from './task-visuals'
import { TaskChecklist } from './TaskChecklist'
import { TaskComments } from './TaskComments'
import { TaskAttachments } from './TaskAttachments'
import { TagList } from '@/features/tags/tag-visuals'

export function TaskDetailPage() {
  const { taskId } = useParams()
  const { t } = useTranslation()
  const task = useTask(taskId)
  useDocumentTitle(task.data ? `${task.data.code} · ${task.data.title}` : t('tasks.title'))
  useLiveProject(task.data?.project?.id)

  if (task.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <AppSkeleton className="h-28 rounded-2xl" />
        <AppSkeleton className="h-96 rounded-2xl" />
      </div>
    )
  }
  if (task.isError) {
    if (isAppError(task.error) && task.error.code === 'TASK_NOT_FOUND') {
      return (
        <AppEmptyState
          icon={<SearchX />}
          title={t('tasks.notFound')}
          description={t('tasks.notFoundHint')}
          action={
            <AppButton asChild variant="secondary">
              <Link to="/tasks">{t('tasks.backToList')}</Link>
            </AppButton>
          }
        />
      )
    }
    return <AppErrorState onRetry={() => void task.refetch()} />
  }
  return <TaskDetailView task={task.data} />
}

/** Abas do detalhe; `?tab=comments` abre direto nos comentários (ex.: vindo de uma notificação). */
const TASK_TABS = ['details', 'comments', 'attachments', 'relations', 'history']

/**
 * Detalhe completo da tarefa: cabeçalho com ações, campos rápidos, abas e propriedades. Na página, a aba fica
 * no endereço; `embedded` (janela sobre o Kanban, TaskDetailDialog) guarda a aba só na janela, não mostra
 * o "voltar" nem repete o título (que fica no cabeçalho da janela), e excluir chama `onDeleted`.
 */
export function TaskDetailView({ task, embedded = false, onDeleted }: { task: TaskDetail; embedded?: boolean; onDeleted?: () => void }) {
  const [params, setParams] = useSearchParams()
  const [localTab, setLocalTab] = useState('details')
  const tab = embedded ? localTab : (params.get('tab') ?? 'details')
  const setTab = (value: string) => (embedded ? setLocalTab(value) : setParams(value === 'details' ? {} : { tab: value }, { replace: true }))
  const { t } = useTranslation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const { remove } = useTaskMutations()
  const members = useProjectMembers(task.project?.id)
  const history = useTaskHistory(task.id)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [forking, setForking] = useState(false)
  const relations = useTaskRelations(task.id)

  const attachments = useTaskAttachments(task.id)
  const references = useMemo(
    () => ({
      people: (members.data ?? []).map((m) => ({ id: m.user.id, name: m.user.name })),
      attachments: (attachments.data ?? []).map((a) => ({ id: a.id, name: a.name, kind: a.kind, url: a.url })),
    }),
    [members.data, attachments.data],
  )

  return (
    <>
      {!embedded && (
        <Link to="/tasks" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden /> {t('tasks.backToList')}
        </Link>
      )}

      <section className="mb-6 flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {!embedded && (
              <>
                <TaskCode task={task} />
                <h1 className="mt-1 text-xl font-semibold tracking-tight break-words text-fg">{task.title}</h1>
              </>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {task.blocked && (
                <AppBadge tone="danger" title={t('relations.blockedHint')}>
                  <Lock aria-hidden /> {t('relations.blocked')}
                </AppBadge>
              )}
              <TagList tags={task.tags} max={8} />
            </div>
            {task.project && (
              <Link to={`/projects/${task.project.id}`} className="text-sm text-muted hover:text-primary-text">
                {task.project.name}
              </Link>
            )}
            {(task.parent || task.forkedFrom) && (
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                {task.parent && (
                  <span>
                    {t('relations.subtaskOf')}{' '}
                    <Link to={`/tasks/${task.parent.id}`} className="font-medium text-fg hover:text-primary-text">
                      {task.parent.code} · {task.parent.title}
                    </Link>
                  </span>
                )}
                {task.forkedFrom && (
                  <span className="inline-flex items-center gap-1">
                    <GitFork className="size-3.5" aria-hidden />
                    {t('relations.forkOf')}{' '}
                    <Link to={`/tasks/${task.forkedFrom.id}`} className="font-medium text-fg hover:text-primary-text">
                      {task.forkedFrom.code}
                    </Link>
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {task.capabilities.edit && (
              <AppButton variant="secondary" leftIcon={<Pencil />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </AppButton>
            )}
            {task.capabilities.fork && (
              <AppButton variant="secondary" leftIcon={<GitFork />} onClick={() => setForking(true)}>
                {t('relations.fork')}
              </AppButton>
            )}
            {task.capabilities.delete && (
              <AppButton variant="danger" leftIcon={<Trash2 />} onClick={() => setDeleting(true)}>
                {t('common.delete')}
              </AppButton>
            )}
          </div>
        </div>
        <TaskQuickFields task={task} />
      </section>

      {/* minmax(0,1fr): a coluna não cresce além da tela por causa das abas no celular */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <AppTabs
          aria-label={task.code}
          value={TASK_TABS.includes(tab) ? tab : 'details'}
          onValueChange={setTab}
          tabs={[
            {
              value: 'details',
              label: t('tasks.tabs.details'),
              content: (
                <div className="flex flex-col gap-4">
                  <AppCard title={t('tasks.fields.description')}>
                    {task.description ? (
                      <AppMarkdown text={task.description} />
                    ) : (
                      <p className="text-sm text-subtle">{t('tasks.noDescription')}</p>
                    )}
                  </AppCard>
                  <AppCard title={t('checklist.title')}>
                    <TaskChecklist task={task} />
                  </AppCard>
                  <AppCard title={t('tasks.typeFields', { name: task.type?.name ?? '' })}>
                    <TaskCustomValues task={task} references={references} />
                  </AppCard>
                </div>
              ),
            },
            {
              value: 'comments',
              label: t('tasks.tabs.comments', { count: task.commentCount }),
              content: <TaskComments task={task} />,
            },
            {
              value: 'attachments',
              label: t('tasks.tabs.attachments', { count: task.attachmentCount }),
              content: <TaskAttachments task={task} />,
            },
            {
              value: 'relations',
              label: t('tasks.tabs.relations', { count: relations.data ? relationCount(relations.data) : 0 }),
              content: <TaskRelationsPanel task={task} />,
            },
            {
              value: 'history',
              label: t('tasks.tabs.history'),
              content: history.isPending ? <AppSkeleton className="h-24" /> : <AuditTimeline entries={history.data?.items ?? []} />,
            },
          ]}
        />
        <AppCard title={t('tasks.properties')} className="self-start">
          <TaskProperties task={task} />
        </AppCard>
      </div>

      <TaskFormDialog open={editing} onOpenChange={setEditing} task={task} />
      <ForkTaskDialog task={task} open={forking} onOpenChange={setForking} />
      <AppConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('tasks.deleteTitle', { code: task.code })}
        description={t('tasks.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(task.id, {
            onSuccess: () => {
              notify.success(t('tasks.deleted', { code: task.code }))
              if (embedded) onDeleted?.()
              else void navigate('/tasks')
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </>
  )
}
