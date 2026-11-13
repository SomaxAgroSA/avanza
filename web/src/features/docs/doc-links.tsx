import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Link2, Plus, X } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { TaskSummary } from '@/domain/tasks'
import { AppBadge, AppButton, AppCheckbox, AppDialog, AppSearch, AppSelect, AppSkeleton, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useProjects } from '@/features/projects/queries'
import { useTasksList } from '@/features/tasks/queries'
import { useIsMine } from '@/features/tasks/use-mine-first'
import { taskPath } from './docs-paths'
import { useDocLinkMutations, usePageTasks } from './queries'

/** Tarefas em aberto (o que ainda se trabalha): a lista para vincular não traz as concluídas/canceladas. */
const OPEN_CATEGORIES = 'backlog,todo,in_progress'
const PROJECT_QUERY = { view: 'all' as const, page: 1, perPage: 100, sort: { id: 'name', direction: 'asc' as const }, search: '', filters: {} }

type SpaceProject = { id: string; key: string; name: string } | null

/**
 * Faixa "Tarefas vinculadas" no topo da página: cada tarefa abre com um clique; quem edita o espaço
 * vincula mais (as tarefas abertas do projeto do espaço) e tira o vínculo no "x".
 */
export function PageTasksBar({ pageId, project, canEdit }: { pageId: string; project: SpaceProject; canEdit: boolean }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const tasks = usePageTasks(pageId)
  const { unlink } = useDocLinkMutations()
  const [open, setOpen] = useState(false)
  const list = tasks.data ?? []
  if (!canEdit && list.length === 0) return null
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm" data-testid="page-tasks">
      <span className="flex items-center gap-1.5 text-muted">
        <Link2 aria-hidden className="size-4" />
        {list.length ? t('docs.links.linkedTasks') : t('docs.links.noTasks')}
      </span>
      {list.map((task) => (
        <span key={task.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/25 bg-primary-soft py-0.5 pl-2.5 pr-1 text-xs text-primary-soft-fg">
          <Link to={taskPath(task.id)} className="truncate hover:underline" title={task.title}>
            <span className="font-mono font-semibold">{task.code}</span> · {task.title}
          </Link>
          {canEdit && (
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-primary/15"
              aria-label={t('docs.links.unlink', { code: task.code })}
              onClick={() => unlink.mutate({ pageId, taskId: task.id }, { onSuccess: () => notify.success(t('docs.links.unlinked', { code: task.code })), onError: (error) => notify.error(errorMessage(error)) })}
            >
              <X aria-hidden className="size-3" />
            </button>
          )}
        </span>
      ))}
      {canEdit && (
        <AppButton size="sm" variant="ghost" leftIcon={<Plus />} onClick={() => setOpen(true)}>
          {t('docs.links.link')}
        </AppButton>
      )}
      {canEdit && <LinkTasksDialog open={open} onOpenChange={setOpen} pageId={pageId} project={project} linkedIds={list.map((task) => task.id)} />}
    </div>
  )
}

/**
 * Escolher tarefas abertas para vincular à página. O projeto já vem do espaço; espaço sem projeto pede
 * o projeto antes. As tarefas da pessoa vêm primeiro (marcadas "Tuya"); as já vinculadas aparecem marcadas.
 */
export function LinkTasksDialog({
  open,
  onOpenChange,
  pageId,
  project,
  linkedIds,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pageId: string
  project: SpaceProject
  linkedIds: string[]
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { link } = useDocLinkMutations()
  const [projectId, setProjectId] = useState(project?.id ?? '')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  // ao fechar, volta ao começo (a próxima abertura começa limpa)
  const change = (next: boolean) => {
    if (!next) {
      setProjectId(project?.id ?? '')
      setSearch('')
      setSelected([])
    }
    onOpenChange(next)
  }

  const projects = useProjects(PROJECT_QUERY, open && !project)
  const tasks = useTasksList({ page: 1, perPage: 100, sort: { id: 'code', direction: 'asc' }, search, filters: { category: OPEN_CATEGORIES } }, { projectId, mineFirst: true }, open && !!projectId)
  const items = useMemo(() => (tasks.data?.items ?? []).slice().sort((a, b) => a.number - b.number), [tasks.data])
  const projectName = project ?? (projects.data?.items ?? []).find((p) => p.id === projectId) ?? null

  const toggle = (id: string, value: boolean) => setSelected((current) => (value ? [...current, id] : current.filter((x) => x !== id)))
  const submit = () =>
    link.mutate(
      { pageId, taskIds: selected },
      {
        onSuccess: () => {
          notify.success(t('docs.links.linked', { count: selected.length }))
          change(false)
        },
        onError: (error) => notify.error(errorMessage(error)),
      },
    )

  return (
    <AppDialog
      open={open}
      onOpenChange={change}
      size="md"
      tall
      title={t('docs.links.dialogTitle')}
      description={projectName ? t('docs.links.dialogDescription', { project: `${projectName.key} · ${projectName.name}` }) : t('docs.links.chooseProject')}
      footer={
        <>
          <span className="mr-auto text-xs text-muted">{t('docs.links.selected', { count: selected.length })}</span>
          <AppButton variant="secondary" onClick={() => change(false)} disabled={link.isPending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} disabled={selected.length === 0} loading={link.isPending}>
            {t('docs.links.confirm')}
          </AppButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {!project && (
          <AppSelect
            label={t('docs.links.project')}
            value={projectId || undefined}
            onValueChange={(value) => {
              setProjectId(value)
              setSelected([])
            }}
            searchable
            options={(projects.data?.items ?? []).filter((p) => !p.archivedAt).map((p) => ({ value: p.id, label: `${p.key} · ${p.name}`, textValue: `${p.key} · ${p.name}` }))}
            placeholder={t('docs.links.chooseProject')}
          />
        )}
        {projectId && (
          <>
            <AppSearch value={search} onSearch={setSearch} placeholder={t('docs.links.search')} aria-label={t('docs.links.search')} />
            {tasks.isPending ? (
              <div className="space-y-2">
                <AppSkeleton className="h-9" />
                <AppSkeleton className="h-9" />
                <AppSkeleton className="h-9" />
              </div>
            ) : items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted">{t('docs.links.noOpenTasks')}</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border" data-testid="link-tasks-list">
                {items.map((task) => (
                  <TaskOption key={task.id} task={task} linked={linkedIds.includes(task.id)} checked={selected.includes(task.id)} onChange={(value) => toggle(task.id, value)} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </AppDialog>
  )
}

function TaskOption({ task, linked, checked, onChange }: { task: TaskSummary; linked: boolean; checked: boolean; onChange: (value: boolean) => void }) {
  const { t } = useTranslation()
  const mine = useIsMine(task.assignee?.id)
  return (
    <li className={cn('flex items-center gap-3 px-3 py-2 text-sm', mine && 'border-l-4 border-l-primary', linked && 'bg-surface-2/60')}>
      <AppCheckbox
        checked={linked || checked}
        disabled={linked}
        onCheckedChange={onChange}
        aria-label={`${task.code} · ${task.title}`}
        label={
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-mono text-xs text-muted">{task.code}</span>
            <span className="truncate text-fg">{task.title}</span>
          </span>
        }
        className="min-w-0 flex-1"
      />
      {linked ? <span className="shrink-0 text-xs text-muted">{t('docs.links.alreadyLinked')}</span> : mine && <AppBadge tone="primary">{t('tasks.mine.badge')}</AppBadge>}
    </li>
  )
}
