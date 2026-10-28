import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Archive, ChevronDown, KanbanSquare, Minimize2, Plus } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { readJson, safeStorage, writeJson } from '@/core/storage/safe-storage'
import {
  boardPeople,
  boardPersonReferences,
  boardWipLimit,
  buildLanes,
  EMPTY_FILTERS,
  liveProjectIds,
  matchesFilters,
  neighborsInProject,
  projectFilterOptions,
  parseBoardView,
  SWIMLANES,
  toggleCollapsed,
  visibleColumns,
  wipState,
  type BoardView,
  type BoardCard,
  type BoardFilters,
  type BoardSelectFilter,
  type Swimlane,
} from '@/domain/kanban'
import { MAX_LIVE_PROJECTS } from '@/domain/realtime'
import { AppBadge, AppButton, AppDropdown, AppEmptyState, AppErrorState, AppFilterBar, AppSearch, AppSelect, AppSkeleton, notify, SELECT_ALL } from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useLiveProject, useLiveProjects } from '@/presentation/common/use-live'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useSession } from '@/features/auth/session'
import { useProjectMembers } from '@/features/projects/queries'
import { ALL_PROJECTS, ProjectSwitcher } from '@/features/projects/ProjectSwitcher'
import { useSprints } from '@/features/backlog/queries'
import { useTaskTypes } from '@/features/task-config/queries'
import { usePriorities } from '@/features/workflow/queries'
import { useTags } from '@/features/tags/queries'
import { TaskEditDialog } from '@/features/tasks/TaskEditDialog'
import { TaskFormDialog, type TaskFormInitial } from '@/features/tasks/TaskFormDialog'
import { TaskPreviewDrawer } from '@/features/tasks/TaskPreviewDrawer'
import { KanbanBoard, type KanbanDrop } from './KanbanBoard'
import { QuickAddDialog } from './QuickAddDialog'
import { boardKeys, useAllBoard, useBoard, useMoveCard } from './queries'
import { RequiredFieldsDialog, type RequiredFieldsRequest } from '@/features/tasks/RequiredFieldsDialog'
import { missingForStatus } from '@/features/tasks/required-fields'

const LAST_PROJECT_KEY = 'kamban.kanban.project'
const SWIMLANE_KEY = 'kamban.kanban.swimlane'
const VIEW_KEY = 'kamban.kanban.view'

/**
 * `/kanban` abre a última escolha (um projeto ou "Todos os projetos"); sem escolha, todos os projetos.
 * `/kanban/all` = quadro de todos os projetos; `/kanban/:projectId` = quadro do projeto.
 */
export function KanbanPage() {
  const { projectId } = useParams()
  if (!projectId) {
    const last = safeStorage.get(LAST_PROJECT_KEY) || ALL_PROJECTS
    return <Navigate to={`/kanban/${encodeURIComponent(last)}`} replace />
  }
  return <BoardScreen key={projectId} projectId={projectId === ALL_PROJECTS ? null : projectId} />
}

/** Quadro de um projeto ou, com `projectId` nulo, de todos os projetos que a pessoa vê. */
function BoardScreen({ projectId }: { projectId: string | null }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { current } = useSession()
  const all = projectId === null
  const [dragging, setDragging] = useState(false)
  const projectBoard = useBoard(projectId ?? undefined, dragging)
  const allBoard = useAllBoard(all, dragging)
  const board = all ? allBoard : projectBoard
  const move = useMoveCard(projectId === null ? boardKeys.all() : boardKeys.detail(projectId))
  const members = useProjectMembers(projectId ?? undefined)
  const types = useTaskTypes(false)
  const priorities = usePriorities(false)
  const tags = useTags()
  // sprints são do projeto: no quadro de todos os projetos o filtro não aparece
  const sprints = useSprints(projectId ?? undefined)

  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS)
  const [swimlane, setSwimlaneState] = useState<Swimlane>(() => {
    const saved = readJson<string>(SWIMLANE_KEY, 'none')
    return (SWIMLANES as readonly string[]).includes(saved) ? (saved as Swimlane) : 'none'
  })
  const setSwimlane = (value: Swimlane) => {
    setSwimlaneState(value)
    writeJson(SWIMLANE_KEY, value)
  }
  // colunas recolhidas e modo compacto: valem para todos os quadros (os status são os mesmos)
  const [view, setViewState] = useState<BoardView>(() => parseBoardView(readJson<unknown>(VIEW_KEY, null)))
  const setView = (next: BoardView) => {
    setViewState(next)
    writeJson(VIEW_KEY, next)
  }
  const [openId, setOpenId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [quickAdd, setQuickAdd] = useState<string | null>(null)
  const [fullForm, setFullForm] = useState<TaskFormInitial | null>(null)

  // filtro "Etapas": o quadro mostra só as colunas escolhidas
  const data = useMemo(() => (board.data ? { ...board.data, columns: visibleColumns(board.data.columns, filters.statuses) } : undefined), [board.data, filters.statuses])
  // tempo real: o projeto do quadro ou, no de todos, os projetos que cabem nas assinaturas da aba
  const liveIds = useMemo(() => (all && data ? liveProjectIds(data, MAX_LIVE_PROJECTS).ids : []), [all, data])
  useLiveProject(projectId)
  useLiveProjects(liveIds)

  const scopeName = all ? t('projects.allProjects') : data?.project?.name
  useDocumentTitle(scopeName ? `${t('kanban.title')} · ${scopeName}` : t('kanban.title'))
  // lembra a última escolha aberta com sucesso
  useEffect(() => {
    if (data) safeStorage.set(LAST_PROJECT_KEY, data.project?.id ?? ALL_PROJECTS)
  }, [data])
  const notFound = board.isError && isAppError(board.error) && (board.error.code === 'PROJECT_NOT_FOUND' || board.error.code === 'FORBIDDEN')
  useEffect(() => {
    if (notFound && projectId && safeStorage.get(LAST_PROJECT_KEY) === projectId) safeStorage.remove(LAST_PROJECT_KEY)
  }, [notFound, projectId])

  const userId = current?.user.id
  const visible = useCallback((card: BoardCard) => matchesFilters(card, filters, userId), [filters, userId])
  const lanes = useMemo(() => {
    const cards = (data?.columns ?? []).flatMap((c) => c.cards).filter(visible)
    return buildLanes(cards, swimlane, (priorities.data ?? []).map((p) => p.id))
  }, [data, visible, swimlane, priorities.data])
  // pessoas: no quadro do projeto, os membros; no de todos, as que aparecem nos cards
  const people = useMemo(
    () => (all ? (data ? boardPeople(data) : []) : (members.data ?? []).map((m) => m.user)).map((p) => ({ id: p.id, name: p.name })),
    [all, data, members.data],
  )
  const references = useMemo(
    () => (all && data ? { people: boardPersonReferences(data), projects: data.projects } : { people }),
    [all, data, people],
  )
  const projectOptions = useMemo(() => (all && data ? projectFilterOptions(data, filters.projects) : []), [all, data, filters.projects])
  const projectOfCard = useMemo(() => {
    const map = new Map<string, string>()
    data?.columns.forEach((column) => column.cards.forEach((card) => card.project && map.set(card.id, card.project.id)))
    return map
  }, [data])
  const activeFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)
  const visibleCount = (data?.columns ?? []).reduce((sum, c) => sum + c.cards.filter(visible).length, 0)

  const [required, setRequired] = useState<RequiredFieldsRequest | null>(null)

  function onMove({ card, from, to, prevId, nextId, order }: KanbanDrop) {
    const changed = from.status.id !== to.status.id
    // a posição é de cada projeto: no quadro de todos, os vizinhos para o servidor são os do mesmo projeto
    const server = all ? neighborsInProject(order, card.id, (id) => projectOfCard.get(id)) : { prevId, nextId }
    const input = { taskId: card.id, statusId: to.status.id, ...server, screenPrevId: prevId }
    move.mutate(input, {
      onSuccess: () => {
        if (!changed || !data) return
        notify.success(t('kanban.moved', { code: card.code, name: to.status.name }))
        // limite WIP é um alerta (não bloqueia): o time decide
        const wipLimit = boardWipLimit(data, to)
        if (wipState({ wipLimit, total: to.total + 1 }) === 'over') notify.warning(t('kanban.wipExceeded', { name: to.status.name, limit: wipLimit }))
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

  const filterSelect = (key: BoardSelectFilter, label: string, options: Array<{ value: string; label: ReactNode }>) => (
    <AppSelect
      size="sm"
      className="w-full sm:w-44"
      aria-label={label}
      value={filters[key] || SELECT_ALL}
      onValueChange={(value) => setFilters((f) => ({ ...f, [key]: value === SELECT_ALL ? '' : value }))}
      options={[{ value: SELECT_ALL, label: t('kanban.filters.all', { name: label }) }, ...options]}
    />
  )

  const defaultStatus = data?.columns.find((c) => c.status.isDefault) ?? data?.columns[0]
  // criar: no quadro do projeto, a criação rápida na coluna padrão; no de todos, o formulário completo
  // (a pessoa escolhe o projeto lá)
  const onCreate = data?.capabilities.create ? (all ? () => setFullForm({}) : defaultStatus ? () => setQuickAdd(defaultStatus.status.id) : null) : null

  return (
    <>
      <PageHeader
        title={t('kanban.title')}
        description={all ? t('kanban.allDescription') : (data?.project?.name ?? t('kanban.description'))}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <ProjectSwitcher projectId={projectId ?? ALL_PROJECTS} basePath="/kanban" allOption />
            {onCreate && (
              <AppButton leftIcon={<Plus />} onClick={onCreate}>
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
      ) : data && all && data.projects.length === 0 ? (
        <AppEmptyState icon={<KanbanSquare />} title={t('kanban.noProjects')} description={t('kanban.pickHint')} />
      ) : data ? (
        <div className="flex flex-col gap-4">
          <AppFilterBar
            search={<AppSearch value={filters.search} onSearch={(search) => setFilters((f) => ({ ...f, search }))} placeholder={t('kanban.searchPlaceholder')} />}
            hasActiveFilters={activeFilters}
            onReset={() => setFilters(EMPTY_FILTERS)}
            filters={
              <>
                <CheckFilter
                  label={t('kanban.filters.stages')}
                  testId="kanban-stage-filter"
                  options={(board.data?.columns ?? []).map((c) => ({ value: c.status.id, label: c.status.name, short: c.status.name }))}
                  value={filters.statuses}
                  countLabel={(count) => t('kanban.filters.stageCount', { count })}
                  onChange={(statuses) => setFilters((f) => ({ ...f, statuses }))}
                />
                {all && (
                  <CheckFilter
                    label={t('kanban.filters.project')}
                    testId="kanban-project-filter"
                    options={projectOptions.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}`, short: p.key }))}
                    value={filters.projects}
                    countLabel={(count) => t('kanban.filters.projectCount', { count })}
                    onChange={(projects) => setFilters((f) => ({ ...f, projects }))}
                  />
                )}
                {filterSelect('assignee', t('tasks.fields.assignee'), [
                  { value: 'me', label: t('kanban.filters.me') },
                  { value: 'none', label: t('tasks.unassigned') },
                  ...people.map((p) => ({ value: p.id, label: p.name })),
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
                {!all &&
                  (sprints.data?.length ?? 0) > 0 &&
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
                <AppButton
                  variant={view.compact ? 'soft' : 'secondary'}
                  size="sm"
                  leftIcon={<Minimize2 />}
                  aria-pressed={view.compact}
                  title={t('kanban.compactHint')}
                  onClick={() => setView({ ...view, compact: !view.compact })}
                >
                  {t('kanban.compact')}
                </AppButton>
              </>
            }
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted" aria-live="polite">
            {data.project?.archived && (
              <AppBadge tone="warning">
                <Archive /> {t('kanban.archived')}
              </AppBadge>
            )}
            {!data.project?.archived && !data.capabilities.move && <AppBadge>{t('kanban.readOnly')}</AppBadge>}
            {activeFilters && <span>{t('kanban.showing', { count: visibleCount })}</span>}
          </div>
          <KanbanBoard
            board={data}
            swimlane={swimlane}
            lanes={lanes}
            visible={visible}
            references={references}
            onOpen={setOpenId}
            onQuickAdd={!all && data.capabilities.create ? setQuickAdd : undefined}
            onMove={onMove}
            onBlocked={(from, to) => notify.warning(t('kanban.transitionBlocked', { from: from.status.name, to: to.status.name }))}
            onDraggingChange={setDragging}
            view={view}
            onToggleCollapse={(statusId) => setView(toggleCollapsed(view, statusId))}
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
      {projectId && (
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
      )}
      <TaskFormDialog open={!!fullForm} onOpenChange={(open) => !open && setFullForm(null)} projectId={projectId ?? undefined} initial={fullForm ?? undefined} />
      <RequiredFieldsDialog request={required} onClose={() => setRequired(null)} />
    </>
  )
}

/** Filtro de escolha múltipla da barra (etapas; projetos no quadro de todos): vazio = todos. */
function CheckFilter({
  label,
  options,
  value,
  countLabel,
  onChange,
  testId,
}: {
  label: string
  options: Array<{ value: string; label: string; short: string }>
  value: string[]
  countLabel: (count: number) => string
  onChange: (value: string[]) => void
  testId?: string
}) {
  const { t } = useTranslation()
  const chosen = options.filter((o) => value.includes(o.value))
  const summary =
    chosen.length === 0 ? t('kanban.filters.all', { name: label }) : t('kanban.filters.selected', { name: label, value: chosen.length === 1 ? chosen[0]?.short : countLabel(chosen.length) })
  return (
    <AppDropdown
      align="start"
      className="max-h-80 overflow-auto"
      trigger={
        <AppButton variant="secondary" size="sm" className="w-full justify-between sm:w-44" rightIcon={<ChevronDown />} data-testid={testId}>
          <span className="truncate">{summary}</span>
        </AppButton>
      }
      items={options.map((option) => ({
        type: 'checkbox' as const,
        key: option.value,
        label: option.label,
        checked: value.includes(option.value),
        onCheckedChange: (checked: boolean) => onChange(checked ? [...value, option.value] : value.filter((id) => id !== option.value)),
      }))}
    />
  )
}
