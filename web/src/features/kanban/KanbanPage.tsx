import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Archive, KanbanSquare, Plus } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { readJson, safeStorage, writeJson } from '@/core/storage/safe-storage'
import { buildLanes, EMPTY_FILTERS, matchesFilters, SWIMLANES, wipState, type BoardCard, type BoardFilters, type Swimlane } from '@/domain/kanban'
import { AppBadge, AppButton, AppEmptyState, AppErrorState, AppFilterBar, AppSearch, AppSelect, AppSkeleton, notify } from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useLiveProject } from '@/presentation/common/use-live'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useSession } from '@/features/auth/session'
import { useProjectMembers } from '@/features/projects/queries'
import { ProjectSwitcher } from '@/features/projects/ProjectSwitcher'
import { FilterSelect } from '@/presentation/components/data-table/TableFilters'
import { useUrgencyFilterOptions } from '@/features/tasks/urgency-options'
import { useAreaFilterOptions } from '@/features/workflow/area-options'
import { useSprints } from '@/features/backlog/queries'
import { useTaskTypes } from '@/features/task-config/queries'
import { useAreas, usePriorities } from '@/features/workflow/queries'
import { useTags } from '@/features/tags/queries'
import { TaskEditDialog } from '@/features/tasks/TaskEditDialog'
import { TaskFormDialog, type TaskFormInitial } from '@/features/tasks/TaskFormDialog'
import { TaskPreviewDrawer } from '@/features/tasks/TaskPreviewDrawer'
import { KanbanBoard, type KanbanDrop } from './KanbanBoard'
import { QuickAddDialog } from './QuickAddDialog'
import { useBoard, useMoveCard } from './queries'
import { RequiredFieldsDialog, type RequiredFieldsRequest } from '@/features/tasks/RequiredFieldsDialog'
import { missingForStatus } from '@/features/tasks/required-fields'

const LAST_PROJECT_KEY = 'kamban.kanban.project'
const SWIMLANE_KEY = 'kamban.kanban.swimlane'

/** `/kanban` abre o último quadro usado; `/kanban/:projectId` mostra o quadro do projeto. */
export function KanbanPage() {
  const { projectId } = useParams()
  if (!projectId) {
    const last = safeStorage.get(LAST_PROJECT_KEY)
    return last ? <Navigate to={`/kanban/${encodeURIComponent(last)}`} replace /> : <KanbanShell />
  }
  return <KanbanShell key={projectId} projectId={projectId} />
}

function KanbanShell({ projectId }: { projectId?: string }) {
  const { t } = useTranslation()
  useLiveProject(projectId)
  useDocumentTitle(t('kanban.title'))
  if (!projectId) {
    return (
      <>
        <PageHeader title={t('kanban.title')} description={t('kanban.description')} />
        <AppEmptyState icon={<KanbanSquare />} title={t('kanban.pickTitle')} description={t('kanban.pickHint')} action={<ProjectSwitcher basePath="/kanban" />} />
      </>
    )
  }
  return <ProjectBoard projectId={projectId} />
}

function ProjectBoard({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { current } = useSession()
  const [dragging, setDragging] = useState(false)
  const board = useBoard(projectId, dragging)
  const move = useMoveCard(projectId)
  const members = useProjectMembers(projectId)
  const types = useTaskTypes(false)
  const priorities = usePriorities(false)
  const tags = useTags()
  const sprints = useSprints(projectId)

  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS)
  const urgencyOptions = useUrgencyFilterOptions()
  const areas = useAreas(false)
  const areaOptions = useAreaFilterOptions(areas.data)
  const [swimlane, setSwimlaneState] = useState<Swimlane>(() => {
    const saved = readJson<string>(SWIMLANE_KEY, 'none')
    return (SWIMLANES as readonly string[]).includes(saved) ? (saved as Swimlane) : 'none'
  })
  const setSwimlane = (value: Swimlane) => {
    setSwimlaneState(value)
    writeJson(SWIMLANE_KEY, value)
  }
  const [openId, setOpenId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [quickAdd, setQuickAdd] = useState<string | null>(null)
  const [fullForm, setFullForm] = useState<TaskFormInitial | null>(null)

  const data = board.data
  useDocumentTitle(data ? `${t('kanban.title')} · ${data.project.name}` : t('kanban.title'))
  // lembra o último quadro aberto com sucesso
  useEffect(() => {
    if (data) safeStorage.set(LAST_PROJECT_KEY, data.project.id)
  }, [data])
  const notFound = board.isError && isAppError(board.error) && (board.error.code === 'PROJECT_NOT_FOUND' || board.error.code === 'FORBIDDEN')
  useEffect(() => {
    if (notFound && safeStorage.get(LAST_PROJECT_KEY) === projectId) safeStorage.remove(LAST_PROJECT_KEY)
  }, [notFound, projectId])

  const userId = current?.user.id
  const visible = useCallback((card: BoardCard) => matchesFilters(card, filters, userId), [filters, userId])
  const lanes = useMemo(() => {
    const cards = (data?.columns ?? []).flatMap((c) => c.cards).filter(visible)
    return buildLanes(cards, swimlane, (priorities.data ?? []).map((p) => p.id))
  }, [data, visible, swimlane, priorities.data])
  const references = useMemo(() => ({ people: (members.data ?? []).map((m) => ({ id: m.user.id, name: m.user.name })) }), [members.data])
  const activeFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)
  const visibleCount = (data?.columns ?? []).reduce((sum, c) => sum + c.cards.filter(visible).length, 0)

  const [required, setRequired] = useState<RequiredFieldsRequest | null>(null)

  function onMove({ card, from, to, prevId, nextId }: KanbanDrop) {
    const changed = from.status.id !== to.status.id
    const input = { taskId: card.id, statusId: to.status.id, prevId, nextId }
    move.mutate(input, {
      onSuccess: () => {
        if (!changed) return
        notify.success(t('kanban.moved', { code: card.code, name: to.status.name }))
        // limite WIP é um alerta (não bloqueia): o time decide
        if (wipState({ wipLimit: to.wipLimit, total: to.total + 1 }) === 'over') notify.warning(t('kanban.wipExceeded', { name: to.status.name, limit: to.wipLimit }))
      },
      onError: (error) => {
        // a coluna exige campos que a tarefa não tem: abre o preenchimento e move em seguida
        const missing = missingForStatus(error)
        if (missing) {
          setRequired({ taskId: card.id, code: card.code, status: missing.status ?? { id: to.status.id, name: to.status.name }, fieldNames: missing.fieldNames, retry: () => move.mutateAsync(input) })
          return
        }
        notify.error(errorMessage(error))
      },
    })
  }

  // mesmo filtro das listagens: parado mostra só o nome; ativo fica verde com "Nome: valor"
  const filterSelect = (key: keyof Omit<BoardFilters, 'search'>, label: string, options: Array<{ value: string; label: string }>) => (
    <FilterSelect key={key} filter={{ id: key, label, options }} value={filters[key] || undefined} onChange={(value) => setFilters((f) => ({ ...f, [key]: value ?? '' }))} />
  )

  const defaultStatus = data?.columns.find((c) => c.status.isDefault) ?? data?.columns[0]

  return (
    <>
      <PageHeader
        title={t('kanban.title')}
        description={data ? data.project.name : t('kanban.description')}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <ProjectSwitcher projectId={projectId} basePath="/kanban" />
            {data?.capabilities.create && defaultStatus && (
              <AppButton leftIcon={<Plus />} onClick={() => setQuickAdd(defaultStatus.status.id)}>
                {t('tasks.create')}
              </AppButton>
            )}
          </div>
        }
      />

      {board.isPending ? (
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <AppSkeleton key={i} className="h-96 w-72 shrink-0 rounded-xl" />
          ))}
        </div>
      ) : notFound ? (
        <AppEmptyState icon={<KanbanSquare />} title={t('kanban.notFound')} description={t('kanban.pickHint')} />
      ) : board.isError ? (
        <AppErrorState onRetry={() => void board.refetch()} />
      ) : data ? (
        <div className="flex flex-col gap-4">
          <AppFilterBar
            search={<AppSearch value={filters.search} onSearch={(search) => setFilters((f) => ({ ...f, search }))} placeholder={t('kanban.searchPlaceholder')} />}
            hasActiveFilters={activeFilters}
            onReset={() => setFilters(EMPTY_FILTERS)}
            filters={
              <>
                {filterSelect('assignee', t('tasks.fields.assignee'), [
                  { value: 'me', label: t('kanban.filters.me') },
                  { value: 'none', label: t('tasks.unassigned') },
                  ...(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name })),
                ])}
                {filterSelect(
                  'type',
                  t('tasks.fields.type'),
                  (types.data ?? []).map((x) => ({ value: x.id, label: x.name })),
                )}
                {filterSelect(
                  'priority',
                  t('tasks.fields.priority'),
                  (priorities.data ?? []).map((x) => ({ value: x.id, label: x.name })),
                )}
                {filterSelect('urgency', t('tasks.fields.urgency'), urgencyOptions)}
                {filterSelect('area', t('tasks.fields.area'), areaOptions)}
                {(sprints.data?.length ?? 0) > 0 &&
                  filterSelect('sprint', t('tasks.fields.sprint'), [
                    { value: 'none', label: t('sprints.none') },
                    ...(sprints.data ?? []).map((c) => ({ value: c.id, label: c.name })),
                  ])}
                {filterSelect(
                  'tag',
                  t('tasks.fields.tags'),
                  (tags.data ?? []).map((x) => ({ value: x.id, label: x.name })),
                )}
                <AppSelect
                  size="sm"
                  className="w-full sm:w-48"
                  aria-label={t('kanban.swimlanes.label')}
                  value={swimlane}
                  onValueChange={(value) => setSwimlane(value as Swimlane)}
                  options={SWIMLANES.map((s) => ({ value: s, label: t(`kanban.swimlanes.${s}`) }))}
                />
              </>
            }
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted" aria-live="polite">
            {data.project.archived && (
              <AppBadge tone="warning">
                <Archive /> {t('kanban.archived')}
              </AppBadge>
            )}
            {!data.project.archived && !data.capabilities.move && <AppBadge>{t('kanban.readOnly')}</AppBadge>}
            {activeFilters && <span>{t('kanban.showing', { count: visibleCount })}</span>}
          </div>
          <KanbanBoard
            board={data}
            swimlane={swimlane}
            lanes={lanes}
            visible={visible}
            references={references}
            onOpen={setOpenId}
            onQuickAdd={data.capabilities.create ? setQuickAdd : undefined}
            onMove={onMove}
            onBlocked={(from, to) => notify.warning(t('kanban.transitionBlocked', { from: from.status.name, to: to.status.name }))}
            onDraggingChange={setDragging}
          />
        </div>
      ) : null}

      <TaskPreviewDrawer
        taskId={openId}
        quickFields
        onOpenChange={(open) => !open && setOpenId(null)}
        onEdit={(id) => {
          setOpenId(null)
          setEditId(id)
        }}
      />
      <TaskEditDialog taskId={editId} onOpenChange={(open) => !open && setEditId(null)} />
      <QuickAddDialog
        statusId={quickAdd}
        statusName={data?.columns.find((c) => c.status.id === quickAdd)?.status.name}
        projectId={projectId}
        onOpenChange={(open) => !open && setQuickAdd(null)}
        onContinue={(initial) => {
          setQuickAdd(null)
          setFullForm(initial)
        }}
      />
      <TaskFormDialog open={!!fullForm} onOpenChange={(open) => !open && setFullForm(null)} projectId={projectId} initial={fullForm ?? undefined} />
      <RequiredFieldsDialog request={required} onClose={() => setRequired(null)} />
    </>
  )
}
