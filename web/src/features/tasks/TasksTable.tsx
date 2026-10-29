import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDateTime, formatRelative } from '@/core/utils/format'
import { isClosed, type TaskSummary } from '@/domain/tasks'
import {
  AppConfirmDialog,
  AppDataTable,
  notify,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCan } from '@/features/auth/session'
import { ProjectFilterSettingsButton } from '@/features/projects/ProjectFilterSettings'
import { useScreenProjects } from '@/features/projects/use-project-filter'
import { useTaskTypes } from '@/features/task-config/queries'
import { usePriorities, useStatuses } from '@/features/workflow/queries'
import { useTaskMutations, useTasksList } from './queries'
import { TaskEditDialog } from './TaskEditDialog'
import { TaskPreviewDrawer } from './TaskPreviewDrawer'
import { DueDate, PersonCell, TaskCode, TaskIndicators, TaskPriorityBadge, TaskStatusBadge } from './task-visuals'
import { useTags } from '@/features/tags/queries'
import { TagList } from '@/features/tags/tag-visuals'

const EMPTY: TaskSummary[] = []
const OPEN = 'backlog,todo,in_progress'
const CLOSED = 'done,cancelled'

export interface TasksTableProps {
  /** Chave do estado persistido da tabela. */
  tableId: string
  /** Lista só as tarefas deste projeto (a coluna/filtro de projeto some). */
  projectId?: string
  /** Busca aplicada de fora (ex.: /tasks?search=… da command palette). */
  search?: string | null
  onSearchApplied?: () => void
}

/** Listagem padrão de tarefas (página Tarefas e aba do projeto). */
export function TasksTable({ tableId, projectId, search, onSearchApplied }: TasksTableProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const canEdit = useCan('tasks.edit')
  const canDelete = useCan('tasks.delete')

  const table = useDataTableState(tableId, { sort: { id: 'updated_at', direction: 'desc' }, filters: { category: OPEN }, columnVisibility: { category: false, tags: false } })
  // busca vinda de fora (command palette): aplica uma vez e avisa para limpar o endereço
  const { setSearch } = table
  useEffect(() => {
    if (search === null || search === undefined) return
    setSearch(search)
    onSearchApplied?.()
  }, [search, setSearch, onSearchApplied])
  const tasks = useTasksList(table.query, projectId ? { projectId } : undefined)
  const statuses = useStatuses(true)
  const priorities = usePriorities(true)
  const types = useTaskTypes(true)
  const tags = useTags()
  // configurador do filtro de projetos (por pessoa): restringe as opções; o projeto escolhido não some
  const chosenProject = table.state.filters.project
  const projects = useScreenProjects('tasks', chosenProject ? [chosenProject] : [], !projectId)
  const { remove } = useTaskMutations()

  const [viewing, setViewing] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<TaskSummary | null>(null)

  const columns = useMemo<DataTableColumn<TaskSummary>[]>(
    () => [
      {
        id: 'code',
        header: t('tasks.fields.task'),
        sortable: true,
        hideable: false,
        pinned: true,
        size: 360,
        minSize: 240,
        cell: (task) => (
          <div className="min-w-0">
            <TaskCode task={task} />
            <p className={isClosed(task) ? 'truncate font-medium text-muted line-through decoration-subtle' : 'truncate font-medium text-fg'}>{task.title}</p>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <TagList tags={task.tags} max={3} className="mt-0.5" />
              <TaskIndicators task={task} />
            </span>
          </div>
        ),
      },
      {
        id: 'status',
        header: t('tasks.fields.status'),
        sortable: true,
        size: 170,
        cell: (task) => <TaskStatusBadge status={task.status} />,
        filter: { label: t('tasks.fields.status'), options: (statuses.data ?? []).map((s) => ({ value: s.id, label: s.name })) },
      },
      {
        id: 'priority',
        header: t('tasks.fields.priority'),
        sortable: true,
        size: 140,
        cell: (task) => <TaskPriorityBadge priority={task.priority} />,
        filter: { label: t('tasks.fields.priority'), options: (priorities.data ?? []).map((p) => ({ value: p.id, label: p.name })) },
      },
      {
        id: 'assignee',
        header: t('tasks.fields.assignee'),
        size: 180,
        cell: (task) => <PersonCell person={task.assignee} />,
        filter: { label: t('tasks.fields.assignee'), options: [{ value: 'me', label: t('tasks.assignedToMe') }] },
      },
      {
        id: 'type',
        header: t('tasks.fields.type'),
        size: 160,
        cell: (task) => <span className="truncate text-muted">{task.type?.name ?? '—'}</span>,
        filter: { label: t('tasks.fields.type'), options: (types.data ?? []).map((x) => ({ value: x.id, label: x.name })) },
      },
      ...(projectId
        ? []
        : [
            {
              id: 'project',
              header: t('tasks.fields.project'),
              size: 170,
              cell: (task: TaskSummary) => <span className="truncate text-muted">{task.project?.name ?? '—'}</span>,
              filter: {
                label: t('tasks.fields.project'),
                options: projects.items.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` })),
                addon: <ProjectFilterSettingsButton screen="tasks" size="sm" />,
              },
            } satisfies DataTableColumn<TaskSummary>,
          ]),
      {
        id: 'due_date',
        header: t('tasks.fields.dueDate'),
        sortable: true,
        size: 130,
        cell: (task) => <DueDate task={task} />,
      },
      {
        id: 'tags',
        header: t('tasks.fields.tags'),
        size: 200,
        cell: (task) => (task.tags.length ? <TagList tags={task.tags} max={2} /> : <span className="text-subtle">—</span>),
        filter: { label: t('tasks.fields.tags'), options: (tags.data ?? []).map((tag) => ({ value: tag.id, label: tag.name })) },
      },
      {
        id: 'category',
        header: t('tasks.fields.situation'),
        size: 120,
        cell: (task) => <span className="text-muted">{isClosed(task) ? t('tasks.closed') : t('tasks.open')}</span>,
        filter: {
          label: t('tasks.fields.situation'),
          options: [
            { value: OPEN, label: t('tasks.open') },
            { value: CLOSED, label: t('tasks.closed') },
          ],
        },
      },
      {
        id: 'updated_at',
        header: t('tasks.fields.updatedAt'),
        sortable: true,
        size: 150,
        cell: (task) => (
          <time className="text-muted" dateTime={task.updatedAt?.toISOString()} title={formatDateTime(task.updatedAt, locale)}>
            {formatRelative(task.updatedAt, locale)}
          </time>
        ),
      },
    ],
    [t, locale, statuses.data, priorities.data, types.data, tags.data, projects.items, projectId],
  )

  return (
    <>
      <AppDataTable
        caption={t('tasks.title')}
        columns={columns}
        data={tasks.data?.items ?? EMPTY}
        total={tasks.data?.total ?? 0}
        getRowId={(task) => task.id}
        table={table}
        loading={tasks.isPending}
        fetching={tasks.isFetching}
        error={tasks.isError ? { correlationId: isAppError(tasks.error) ? tasks.error.correlationId : undefined } : null}
        onRetry={() => void tasks.refetch()}
        searchPlaceholder={t('tasks.searchPlaceholder')}
        actions={{
          onView: (task) => setViewing(task.id),
          onOpen: (task) => void navigate(`/tasks/${task.id}`),
          onEdit: (task) => setEditing(task.id),
          canEdit: () => canEdit,
          onDelete: setDeleting,
          canDelete: () => canDelete,
          more: (task) => [{ key: 'open', label: t('tasks.openPage'), icon: <ExternalLink />, onSelect: () => void navigate(`/tasks/${task.id}`) }],
        }}
      />

      <TaskPreviewDrawer
        taskId={viewing}
        onOpenChange={(open) => !open && setViewing(null)}
        onEdit={(id) => {
          setViewing(null)
          setEditing(id)
        }}
      />
      <TaskEditDialog taskId={editing} onOpenChange={(open) => !open && setEditing(null)} />
      <AppConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('tasks.deleteTitle', { code: deleting?.code ?? '' })}
        description={t('tasks.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              notify.success(t('tasks.deleted', { code: deleting.code }))
              setDeleting(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </>
  )
}
