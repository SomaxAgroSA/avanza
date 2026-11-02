import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Archive, ChevronDown, KanbanSquare, Minimize2, Plus } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { cn } from '@/core/utils/cn'
import { readJson, writeJson } from '@/core/storage/safe-storage'
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
import { AppBadge, AppButton, AppDropdown, AppEmptyState, AppErrorState, AppFilterBar, AppSearch, AppSelect, AppSkeleton, notify } from '@/presentation/components'
import { FilterSelect } from '@/presentation/components/data-table/TableFilters'
import { filterTriggerClass } from '@/presentation/components/data-table/filter-styles'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { SectionHeader } from '@/presentation/layouts/SectionHeader'
import { useLiveProjects } from '@/presentation/common/use-live'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useSession } from '@/features/auth/session'
import { useProjectMembers } from '@/features/projects/queries'
import { ProjectFilterSettingsButton } from '@/features/projects/ProjectFilterSettings'
import { ProjectTaskViewsNav } from '@/features/projects/ProjectTaskViewsNav'
import { useScreenProjects } from '@/features/projects/use-project-filter'
import { allowedByProjectFilter, isDefaultProjectFilter, scopedProjectIds, toProjectFilterSubject } from '@/domain/project-filter'
import { useSprints } from '@/features/backlog/queries'
import { useTaskTypes } from '@/features/task-config/queries'
import { useAreas, usePriorities } from '@/features/workflow/queries'
import { useAreaFilterOptions } from '@/features/workflow/area-options'
import { useTags } from '@/features/tags/queries'
import { TaskEditDialog } from '@/features/tasks/TaskEditDialog'
import { TaskFormDialog, type TaskFormInitial } from '@/features/tasks/TaskFormDialog'
import { TaskPreviewDrawer } from '@/features/tasks/TaskPreviewDrawer'
import { useUrgencyFilterOptions } from '@/features/tasks/urgency-options'
import { TaskDetailDialog } from '@/features/tasks/TaskDetailDialog'
import { KanbanBoard, type KanbanDrop } from './KanbanBoard'
import { QuickAddDialog } from './QuickAddDialog'
import { boardKeys, useAllBoard, useBoard, useMoveCard } from './queries'
import { RequiredFieldsDialog, type RequiredFieldsRequest } from '@/features/tasks/RequiredFieldsDialog'
import { missingForStatus } from '@/features/tasks/required-fields'

const SWIMLANE_KEY = 'kamban.kanban.swimlane'
const VIEW_KEY = 'kamban.kanban.view'

/**
 * Kanban de todos os projetos (`/kanban`, `/kanban/all`): item do menu lateral, com o filtro de projetos
 * e o configurador dele. O quadro de um projeto fica na aba Tarefas do projeto (ProjectKanbanPage).
 */
export function KanbanPage() {
  return <BoardScreen projectId={null} />
}

/** Visão Kanban da aba Tarefas do projeto (`/projects/:projectId/kanban`): o cabeçalho do projeto é o contexto. */
export function ProjectKanbanPage() {
  const { projectId = '' } = useParams()
  return <BoardScreen key={projectId} projectId={projectId} nav={<ProjectTaskViewsNav projectId={projectId} current="kanban" />} />
}

/** Quadro de um projeto (com a sub-navegação da aba) ou, com `projectId` nulo, de todos os projetos que a pessoa vê. */
function BoardScreen({ projectId, nav }: { projectId: string | null; nav?: ReactNode }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { current } = useSession()
  const all = projectId === null
  const [dragging, setDragging] = useState(false)
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS)
  // configurador do filtro de projetos (por pessoa): no quadro de todos, pede só os projetos permitidos
  // (e os já escolhidos no filtro); `undefined` = esperando a configuração ou a lista de projetos
  const screenProjects = useScreenProjects('kanban', filters.projects)
  const { settings: filterSettings, ready: filterReady } = screenProjects.filter
  const scopeIds = useMemo(() => {
    if (!all || !filterReady) return undefined
    if (isDefaultProjectFilter(filterSettings)) return null
    return screenProjects.all ? scopedProjectIds(screenProjects.all.map(toProjectFilterSubject), filterSettings, filters.projects) : undefined
  }, [all, filterReady, filterSettings, screenProjects.all, filters.projects])
  const noScopedProjects = all && scopeIds?.length === 0
  const projectBoard = useBoard(projectId ?? undefined, dragging)
  const allBoard = useAllBoard(all && scopeIds !== undefined && !noScopedProjects, dragging, scopeIds ?? null)
  const board = all ? allBoard : projectBoard
  const move = useMoveCard(projectId === null ? boardKeys.scoped(scopeIds ?? null) : boardKeys.detail(projectId))
  const members = useProjectMembers(projectId ?? undefined)
  const types = useTaskTypes(false)
  const priorities = usePriorities(false)
  const tags = useTags()
  const urgencyOptions = useUrgencyFilterOptions()
  const areas = useAreas(false)
  const areaOptions = useAreaFilterOptions(areas.data)
  // sprints são do projeto: no quadro de todos os projetos o filtro não aparece
  const sprints = useSprints(projectId ?? undefined)

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
  // tarefa completa numa janela sobre o quadro (não sai do Kanban)
  const [fullId, setFullId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [quickAdd, setQuickAdd] = useState<string | null>(null)
  const [fullForm, setFullForm] = useState<TaskFormInitial | null>(null)

  // filtro "Etapas": o quadro mostra só as colunas escolhidas
  const data = useMemo(() => (board.data ? { ...board.data, columns: visibleColumns(board.data.columns, filters.statuses) } : undefined), [board.data, filters.statuses])
  // tempo real: o projeto do quadro ou, no de todos, os projetos que cabem nas assinaturas da aba
  const liveIds = useMemo(() => (all && data ? liveProjectIds(data, MAX_LIVE_PROJECTS).ids : []), [all, data])
  // o quadro do projeto atualiza pela página do projeto (que assina o projeto)
  useLiveProjects(liveIds)

  const notFound = board.isError && isAppError(board.error) && (board.error.code === 'PROJECT_NOT_FOUND' || board.error.code === 'FORBIDDEN')

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
  const projectOptions = useMemo(() => {
    if (!all || !data) return []
    // o quadro já vem restrito; a lista geral confirma status e participação (projeto fora dela fica)
    const known = new Map((screenProjects.all ?? []).map((p) => [p.id, toProjectFilterSubject(p)]))
    return projectFilterOptions(data, filters.projects).filter((p) => {
      const subject = known.get(p.id)
      return !subject || filters.projects.includes(p.id) || allowedByProjectFilter(subject, filterSettings)
    })
  }, [all, data, filters.projects, screenProjects.all, filterSettings])
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

  // mesmo filtro das listagens: parado mostra só o nome; ativo fica verde com "Nome: valor"
  const filterSelect = (key: BoardSelectFilter, label: string, options: Array<{ value: string; label: string }>) => (
    <FilterSelect key={key} filter={{ id: key, label, options }} value={filters[key] || undefined} onChange={(value) => setFilters((f) => ({ ...f, [key]: value ?? '' }))} />
  )

  const defaultStatus = data?.columns.find((c) => c.status.isDefault) ?? data?.columns[0]
  // criar: no quadro do projeto, a criação rápida na coluna padrão; no de todos, o formulário completo
  // (a pessoa escolhe o projeto lá)
  const onCreate = data?.capabilities.create ? (all ? () => setFullForm({}) : defaultStatus ? () => setQuickAdd(defaultStatus.status.id) : null) : null

  const createButton = onCreate && (
    <AppButton leftIcon={<Plus />} onClick={onCreate}>
      {t('tasks.create')}
    </AppButton>
  )

  return (
    <>
      {all ? <PageHeader title={t('kanban.title')} description={t('kanban.allDescription')} actions={createButton} /> : <SectionHeader nav={nav} actions={createButton} />}

      {noScopedProjects ? (
        // a barra de filtros não aparece: a engrenagem fica no aviso para desfazer a configuração
        <AppEmptyState icon={<KanbanSquare />} title={t('projects.filterSettings.emptyTitle')} description={t('projects.filterSettings.emptyHint')} action={<ProjectFilterSettingsButton screen="kanban" />} />
      ) : board.isPending ? (
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
                  // o configurador do filtro de projetos (engrenagem) fica ao lado dele
                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    <CheckFilter
                      label={t('kanban.filters.project')}
                      testId="kanban-project-filter"
                      className="min-w-0 flex-1 sm:w-auto sm:flex-none"
                      options={projectOptions.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}`, short: p.key }))}
                      value={filters.projects}
                      countLabel={(count) => t('kanban.filters.projectCount', { count })}
                      onChange={(projects) => setFilters((f) => ({ ...f, projects }))}
                    />
                    <ProjectFilterSettingsButton screen="kanban" />
                  </div>
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
                {filterSelect('urgency', t('tasks.fields.urgency'), urgencyOptions)}
                {filterSelect('area', t('tasks.fields.area'), areaOptions)}
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
                  className="w-full sm:w-48"
                  aria-label={t('kanban.swimlanes.label')}
                  value={swimlane}
                  onValueChange={(value) => setSwimlane(value as Swimlane)}
                  options={SWIMLANES.map((s) => ({ value: s, label: t(`kanban.swimlanes.${s}`) }))}
                />
                <AppButton
                  variant={view.compact ? 'soft' : 'secondary'}
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
        onOpenFull={(id) => {
          setOpenId(null)
          setFullId(id)
        }}
      />
      <TaskDetailDialog taskId={fullId} onOpenChange={(open) => !open && setFullId(null)} />
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
  className = 'w-full sm:w-auto',
}: {
  label: string
  options: Array<{ value: string; label: string; short: string }>
  value: string[]
  countLabel: (count: number) => string
  onChange: (value: string[]) => void
  testId?: string
  className?: string
}) {
  const { t } = useTranslation()
  const chosen = options.filter((o) => value.includes(o.value))
  // como os filtros das listagens: parado mostra só o nome; com escolha, fica verde com "Nome: valor"
  const summary = chosen.length === 0 ? label : t('kanban.filters.selected', { name: label, value: chosen.length === 1 ? chosen[0]?.short : countLabel(chosen.length) })
  return (
    <AppDropdown
      align="start"
      className="max-h-80 overflow-auto"
      trigger={
        <AppButton variant="secondary" className={cn('justify-between', filterTriggerClass(chosen.length > 0), className)} rightIcon={<ChevronDown />} data-testid={testId}>
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
