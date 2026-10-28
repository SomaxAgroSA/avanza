import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { GitFork, Link2, ListTree, Plus, Unlink } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { groupRelations, type LinkOption } from '@/domain/relations'
import type { TaskDetail, TaskSummary } from '@/domain/tasks'
import { AppAvatar, AppButton, AppCard, AppEmptyState, AppErrorState, AppIconButton, AppSkeleton, AppTextField, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useRelationMutations, useTaskMutations, useTaskRelations } from './queries'
import { TaskFormDialog, type TaskFormInitial } from './TaskFormDialog'
import { LinkTaskDialog } from './LinkTaskDialog'
import { TaskCode, TaskIndicators, TaskStatusBadge } from './task-visuals'

/** Aba "Relações" do detalhe: subtarefas, pai, relações entre tarefas e fork (diretriz §12 e §13). */
export function TaskRelationsPanel({ task }: { task: TaskDetail }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const relations = useTaskRelations(task.id)
  const { remove } = useRelationMutations(task.id)
  const { create, update } = useTaskMutations()
  const [linking, setLinking] = useState<LinkOption | 'any' | null>(null)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [fullForm, setFullForm] = useState<TaskFormInitial | null>(null)

  if (relations.isPending) return <AppSkeleton className="h-48 rounded-2xl" />
  if (relations.isError || !relations.data) return <AppErrorState onRetry={() => void relations.refetch()} />
  const data = relations.data
  const caps = data.capabilities
  const groups = groupRelations(data.relations)
  const progress = data.subtaskProgress
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  function unlinkParent(child: TaskSummary, parentCode: string) {
    update.mutate(
      { id: child.id, data: { parentTaskId: null } },
      { onSuccess: () => notify.success(t('relations.unlinked', { code: child.code, other: parentCode })), onError: (e) => notify.error(errorMessage(e)) },
    )
  }

  function addSubtask() {
    const title = subtaskTitle.trim()
    if (!title || !task.project || !task.type) return
    create.mutate(
      { projectId: task.project.id, taskTypeId: task.type.id, title, parentTaskId: task.id },
      {
        onSuccess: (created) => {
          setSubtaskTitle('')
          notify.success(t('relations.subtaskCreated', { code: created.code }))
        },
        onError: (e) => {
          // tipo com campo obrigatório: continua no formulário completo
          if (isAppError(e) && e.code === 'VALIDATION_ERROR' && Object.keys(e.fieldErrors()).some((k) => k.startsWith('custom_values.'))) {
            setFullForm({ title, typeId: task.type?.id, parentTaskId: task.id })
            return
          }
          notify.error(errorMessage(e))
        },
      },
    )
  }

  const empty = !data.parent && data.children.length === 0 && data.relations.length === 0 && !data.forkedFrom && data.forks.length === 0

  return (
    <div className="flex flex-col gap-4">
      {(caps.link || caps.edit) && (
        <div className="flex flex-wrap justify-end gap-2">
          <AppButton variant="secondary" leftIcon={<Link2 />} onClick={() => setLinking('any')}>
            {t('relations.add')}
          </AppButton>
        </div>
      )}

      <AppCard
        title={t('relations.subtasks')}
        actions={progress.total > 0 ? <span className="text-xs text-muted tabular-nums">{t('relations.subtasksOf', { done: progress.done, total: progress.total })}</span> : undefined}
      >
        {progress.total > 0 && (
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={t('relations.subtasks')}>
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        )}
        {data.children.length === 0 ? (
          <p className="text-sm text-subtle">{t('relations.noSubtasks')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.children.map((child) => (
              <RelatedRow
                key={child.id}
                task={child}
                action={
                  caps.edit && (
                    <AppIconButton size="sm" variant="ghost" icon={<Unlink />} label={t('relations.unlinkSubtask', { code: child.code })} onClick={() => unlinkParent(child, task.code)} />
                  )
                }
              />
            ))}
          </ul>
        )}
        {caps.createSubtask && (
          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault()
              addSubtask()
            }}
          >
            <AppTextField
              aria-label={t('relations.newSubtask')}
              placeholder={t('relations.newSubtaskPlaceholder')}
              value={subtaskTitle}
              maxLength={200}
              onChange={(event) => setSubtaskTitle(event.target.value)}
              fieldClassName="min-w-0 flex-1"
            />
            <AppButton type="submit" variant="secondary" leftIcon={<Plus />} loading={create.isPending} disabled={!subtaskTitle.trim()}>
              {t('relations.addSubtask')}
            </AppButton>
            {caps.edit && (
              <AppButton type="button" variant="ghost" leftIcon={<ListTree />} onClick={() => setLinking('child')}>
                {t('relations.linkExistingSubtask')}
              </AppButton>
            )}
          </form>
        )}
      </AppCard>

      {data.parent && (
        <AppCard title={t('relations.parent')}>
          <ul>
            <RelatedRow
              task={data.parent}
              action={
                caps.edit && (
                  <AppIconButton size="sm" variant="ghost" icon={<Unlink />} label={t('relations.unlinkParent', { code: data.parent.code })} onClick={() => unlinkParent(task, data.parent?.code ?? '')} />
                )
              }
            />
          </ul>
        </AppCard>
      )}

      {groups.length > 0 && (
        <AppCard title={t('relations.title')}>
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <section key={group.type} aria-label={t(`relations.types.${group.type}`)}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">{t(`relations.types.${group.type}`)}</h3>
                <ul className="flex flex-col divide-y divide-border">
                  {group.items.map((rel) => (
                    <RelatedRow
                      key={rel.id}
                      task={rel.task}
                      action={
                        rel.capabilities.delete && (
                          <AppIconButton
                            size="sm"
                            variant="ghost"
                            icon={<Unlink />}
                            label={t('relations.remove', { code: rel.task.code })}
                            onClick={() =>
                              remove.mutate(rel.id, {
                                onSuccess: () => notify.success(t('relations.unlinked', { code: task.code, other: rel.task.code })),
                                onError: (e) => notify.error(errorMessage(e)),
                              })
                            }
                          />
                        )
                      }
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </AppCard>
      )}

      {(data.forkedFrom || data.forks.length > 0) && (
        <AppCard title={t('relations.forks')}>
          <div className="flex flex-col gap-4">
            {data.forkedFrom && (
              <section aria-label={t('relations.forkOf')}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">{t('relations.forkOf')}</h3>
                <ul>
                  <RelatedRow task={data.forkedFrom} />
                </ul>
              </section>
            )}
            {data.forks.length > 0 && (
              <section aria-label={t('relations.forkedInto')}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">{t('relations.forkedInto')}</h3>
                <ul className="flex flex-col divide-y divide-border">
                  {data.forks.map((f) => (
                    <RelatedRow key={f.id} task={f} icon={<GitFork className="size-3.5 text-muted" aria-hidden />} />
                  ))}
                </ul>
              </section>
            )}
          </div>
        </AppCard>
      )}

      {empty && !caps.createSubtask && <AppEmptyState compact icon={<Link2 />} title={t('relations.empty')} description={t('relations.emptyHint')} />}

      <LinkTaskDialog
        task={task}
        open={linking !== null}
        initialType={linking && linking !== 'any' ? linking : undefined}
        onOpenChange={(open) => !open && setLinking(null)}
        canLink={caps.link}
        canEdit={caps.edit}
      />
      <TaskFormDialog open={!!fullForm} onOpenChange={(open) => !open && setFullForm(null)} projectId={task.project?.id} initial={fullForm ?? undefined} />
    </div>
  )
}

/** Linha de tarefa relacionada: código, título (link), status, indicadores e responsável. */
function RelatedRow({ task, action, icon }: { task: TaskSummary; action?: ReactNode; icon?: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2">
      {icon}
      <TaskCode task={task} className="shrink-0" />
      <Link to={`/tasks/${task.id}`} className="min-w-0 flex-1 basis-40 truncate text-sm font-medium text-fg hover:text-primary-text">
        {task.title}
      </Link>
      <span className="flex shrink-0 items-center gap-3">
        <TaskIndicators task={task} />
        <TaskStatusBadge status={task.status} />
        {task.assignee && (
          <span title={task.assignee.name}>
            <AppAvatar name={task.assignee.name} src={task.assignee.avatarUrl} size="xs" />
          </span>
        )}
        {action}
      </span>
    </li>
  )
}
