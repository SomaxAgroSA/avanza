import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Link2, ListChecks, Plus, Unlink } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { ListQuery } from '@/domain/pagination'
import type { Plan, PlanItem } from '@/domain/plan'
import { linkableTasks, linkedTasks, tasksPercent } from '@/domain/plan-tasks'
import { isClosed, type TaskSummary } from '@/domain/tasks'
import { AppButton, AppEmptyState, AppIconButton, AppSearch, AppSkeleton, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCan } from '@/features/auth/session'
import { useProject } from '@/features/projects/queries'
import { TaskFormDialog } from '@/features/tasks/TaskFormDialog'
import { useTaskMutations, useTasksList } from '@/features/tasks/queries'
import { PersonCell, TaskCode, TaskStatusBadge } from '@/features/tasks/task-visuals'
import { ProgressBar } from './cells'

/** Tarefas vinculadas: até 100 (o máximo por página da API), na ordem do fluxo. */
const LINKED: ListQuery = { page: 1, perPage: 100, sort: { id: 'status', direction: 'asc' }, search: '', filters: {} }

/**
 * Aba Tarefas do painel do elemento: a execução do elemento (a Gestão é o plano macro). Lista as
 * tarefas vinculadas com o andamento ("3 de 5 concluídas"); quem edita tarefas vincula uma existente
 * do projeto, cria uma nova já vinculada ou desvincula. Vincular é editar o `planItemId` da tarefa.
 */
export function ItemTasks({ plan, item }: { plan: Plan; item: PlanItem }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const projectId = plan.project.id
  const project = useProject(projectId)
  // o vínculo é da tarefa: editar tarefas no projeto (leitor do projeto e projeto arquivado só veem)
  const writable = !plan.project.archived && !!project.data && project.data.myRole !== 'viewer'
  const canLink = useCan('tasks.edit') && writable
  const canCreate = useCan('tasks.create') && writable
  const linked = useTasksList(LINKED, { projectId, planItemId: item.id })
  const { update } = useTaskMutations()
  const [linking, setLinking] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const count = linkedTasks(item)
  const tasks = linked.data?.items ?? []

  async function setLink(task: TaskSummary, planItemId: string | null) {
    setBusy(task.id)
    try {
      await update.mutateAsync({ id: task.id, data: { planItemId } })
      notify.success(planItemId ? t('plan.itemTasks.linked', { code: task.code, name: item.name }) : t('plan.itemTasks.unlinked', { code: task.code }))
    } catch (error) {
      notify.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label={t('plan.itemTasks.title')}>
      {/* no celular: andamento numa linha e as ações embaixo */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {count.total > 0 && (
          <div className="flex min-w-0 flex-col gap-1 sm:flex-1">
            <p className="text-sm text-fg" title={t('plan.itemTasks.progressHint')}>
              {t('plan.itemTasks.progress', { done: count.done, total: count.total })}
            </p>
            <ProgressBar value={tasksPercent(count)} label={t('plan.itemTasks.progressOf', { name: item.name })} className="sm:max-w-64" />
          </div>
        )}
        {(canLink || canCreate) && (
          <div className="flex shrink-0 flex-wrap gap-2 sm:ml-auto">
            {canLink && (
              <AppButton variant="secondary" size="sm" leftIcon={<Link2 />} aria-expanded={linking} onClick={() => setLinking((open) => !open)}>
                {t('plan.itemTasks.link')}
              </AppButton>
            )}
            {canCreate && (
              <AppButton size="sm" leftIcon={<Plus />} onClick={() => setCreating(true)}>
                {t('plan.itemTasks.create')}
              </AppButton>
            )}
          </div>
        )}
      </div>

      {linking && <LinkSearch projectId={projectId} item={item} busy={busy} onPick={(task) => void setLink(task, item.id)} onClose={() => setLinking(false)} />}

      {linked.isPending ? (
        <AppSkeleton className="h-24" />
      ) : tasks.length === 0 ? (
        <AppEmptyState compact icon={<ListChecks />} title={t('plan.itemTasks.empty')} description={t('plan.itemTasks.emptyHint')} />
      ) : (
        <ul aria-label={t('plan.itemTasks.listLabel', { name: item.name })} className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <TaskCode task={task} className="shrink-0" />
                <Link
                  to={`/tasks/${task.id}`}
                  className={cn('min-w-0 truncate text-sm font-medium hover:text-primary-text', isClosed(task) ? 'text-muted line-through decoration-subtle' : 'text-fg')}
                >
                  {task.title}
                </Link>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm">
                <TaskStatusBadge status={task.status} />
                <span className="w-32 min-w-0 truncate">
                  <PersonCell person={task.assignee} />
                </span>
                {canLink && (
                  <AppIconButton
                    size="sm"
                    label={t('plan.itemTasks.unlink', { code: task.code })}
                    icon={<Unlink />}
                    disabled={busy === task.id}
                    onClick={() => void setLink(task, null)}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {(linked.data?.total ?? 0) > tasks.length && <p className="text-xs text-muted">{t('plan.itemTasks.more', { shown: tasks.length, total: linked.data?.total ?? 0 })}</p>}

      <TaskFormDialog open={creating} onOpenChange={setCreating} projectId={projectId} initial={{ planItemId: item.id }} />
    </section>
  )
}

/** Busca as tarefas do projeto para vincular (as deste elemento ficam de fora; as de outro elemento mudam para cá). */
function LinkSearch({ projectId, item, busy, onPick, onClose }: { projectId: string; item: PlanItem; busy: string | null; onPick: (task: TaskSummary) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const results = useTasksList({ page: 1, perPage: 10, sort: { id: 'updated_at', direction: 'desc' }, search, filters: {} }, { projectId })
  const candidates = linkableTasks(results.data?.items ?? [], item.id)
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3">
      <AppSearch value={search} onSearch={setSearch} placeholder={t('plan.itemTasks.searchPlaceholder')} aria-label={t('plan.itemTasks.searchLabel')} />
      {results.isPending ? (
        <AppSkeleton className="h-16" />
      ) : candidates.length === 0 ? (
        <p className="px-2 py-4 text-center text-sm text-subtle">{t('plan.itemTasks.noResults')}</p>
      ) : (
        <ul aria-label={t('plan.itemTasks.results')} className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {candidates.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                disabled={busy === task.id}
                onClick={() => onPick(task)}
                aria-label={t('plan.itemTasks.linkTask', { code: task.code, title: task.title })}
                className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left text-sm outline-none hover:bg-surface focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <TaskCode task={task} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-fg">{task.title}</span>
                  {task.planItem && <span className="block truncate text-xs text-muted">{t('plan.itemTasks.linkedElsewhere', { name: task.planItem.name })}</span>}
                </span>
                <TaskStatusBadge status={task.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <AppButton variant="ghost" size="sm" className="self-end" onClick={onClose}>
        {t('common.close')}
      </AppButton>
    </div>
  )
}
