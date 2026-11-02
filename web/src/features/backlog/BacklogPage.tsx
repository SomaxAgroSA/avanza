import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Archive, ArrowDown, ArrowRight, ArrowUp, CalendarRange, ChevronDown, ChevronRight, ExternalLink, ListTodo, MoreHorizontal, Pencil, Play, Plus, Square, Trash2, Undo2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDay, formatNumber } from '@/core/utils/format'
import { readJson, safeStorage, writeJson } from '@/core/storage/safe-storage'
import { BACKLOG_SORTS, moveTargets, groupBacklog, NO_SPRINT, type BacklogGroup, type BacklogSort } from '@/domain/backlog'
import type { Sprint, SprintRef } from '@/domain/sprints'
import { EMPTY_FILTERS, matchesFilters, type BoardFilters } from '@/domain/kanban'
import type { TaskSummary } from '@/domain/tasks'
import {
  AppBadge,
  AppButton,
  AppConfirmDialog,
  AppDropdown,
  AppEmptyState,
  AppErrorState,
  AppFilterBar,
  AppIconButton,
  AppSearch,
  AppSelect,
  AppSkeleton,
  notify,
  type AppDropdownItem,
} from '@/presentation/components'
import { SectionHeader } from '@/presentation/layouts/SectionHeader'
import { FilterSelect } from '@/presentation/components/data-table/TableFilters'
import { useUrgencyFilterOptions } from '@/features/tasks/urgency-options'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useSession } from '@/features/auth/session'
import { useProjectMembers } from '@/features/projects/queries'
import { ProjectTaskViewsNav } from '@/features/projects/ProjectTaskViewsNav'
import { useTaskTypes } from '@/features/task-config/queries'
import { usePriorities, useStatuses } from '@/features/workflow/queries'
import { useTags } from '@/features/tags/queries'
import { TaskEditDialog } from '@/features/tasks/TaskEditDialog'
import { TaskFormDialog, type TaskFormInitial } from '@/features/tasks/TaskFormDialog'
import { TaskPreviewDrawer } from '@/features/tasks/TaskPreviewDrawer'
import { QuickAddDialog } from '@/features/kanban/QuickAddDialog'
import { BacklogList, type BacklogRankEvent } from './BacklogList'
import { SprintFormDialog } from './SprintFormDialog'
import { useActivateTask, useBacklog, useSprintMutations, useRankTask } from './queries'
import { RequiredFieldsDialog, type RequiredFieldsRequest } from '@/features/tasks/RequiredFieldsDialog'
import { missingForStatus } from '@/features/tasks/required-fields'

const SORT_KEY = 'kamban.backlog.sort'

/**
 * Visão Planejamento (backlog e sprints) da aba Tarefas do projeto (`/projects/:projectId/planning`).
 * O cabeçalho do projeto é o contexto (sem título próprio nem seletor de projeto); o tempo real vem da
 * página do projeto.
 */
export function ProjectPlanningPage() {
  const { projectId = '' } = useParams()
  return <ProjectBacklog key={projectId} projectId={projectId} />
}

const refOf = (sprint: Sprint): SprintRef => ({ id: sprint.id, name: sprint.name, state: sprint.state })

function ProjectBacklog({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const { current } = useSession()
  const backlog = useBacklog(projectId)
  const rank = useRankTask(projectId)
  const activate = useActivateTask()
  const sprintMutations = useSprintMutations(projectId)
  const statuses = useStatuses(false)
  const priorities = usePriorities(false)
  const members = useProjectMembers(projectId)
  const types = useTaskTypes(false)
  const tags = useTags()
  const urgencyOptions = useUrgencyFilterOptions()

  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS)
  const [sort, setSortState] = useState<BacklogSort>(() => {
    const saved = safeStorage.get(SORT_KEY)
    return (BACKLOG_SORTS as readonly string[]).includes(saved ?? '') ? (saved as BacklogSort) : 'manual'
  })
  const setSort = (value: BacklogSort) => {
    setSortState(value)
    safeStorage.set(SORT_KEY, value)
  }
  const [statusFilter, setStatusFilter] = useState('')
  const collapsedKey = `kamban.backlog.collapsed.${projectId}`
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(readJson<string[]>(collapsedKey, [])))
  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeJson(collapsedKey, [...next])
      return next
    })
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [quickAdd, setQuickAdd] = useState<{ statusId: string; sprintId?: string } | null>(null)
  const [fullForm, setFullForm] = useState<TaskFormInitial | null>(null)
  const [sprintForm, setSprintForm] = useState<Sprint | null | undefined>(undefined)
  const [confirm, setConfirm] = useState<{ kind: 'close' | 'delete'; sprint: Sprint } | null>(null)

  const data = backlog.data
  const notFound = backlog.isError && isAppError(backlog.error) && (backlog.error.code === 'PROJECT_NOT_FOUND' || backlog.error.code === 'FORBIDDEN')

  const userId = current?.user.id
  const visible = useCallback(
    (item: TaskSummary) => matchesFilters(item, filters, userId) && (!statusFilter || item.status?.id === statusFilter),
    [filters, userId, statusFilter],
  )
  const priorityOrder = useMemo(() => (priorities.data ?? []).map((p) => p.id), [priorities.data])
  const groups = useMemo(() => (data ? groupBacklog(data, visible, sort, priorityOrder) : []), [data, visible, sort, priorityOrder])
  const activeFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS) || !!statusFilter
  const shown = groups.reduce((sum, g) => sum + g.items.length, 0)
  const estimate = groups.reduce((sum, g) => sum + g.estimate, 0)
  const selectedItems = (data?.items ?? []).filter((item) => selected.has(item.id))
  const caps = data?.capabilities
  const defaultStatus = data?.statuses.find((s) => s.isDefault) ?? data?.statuses[0]
  const hours = (value: number) => formatNumber(Math.round(value * 100) / 100, i18n.language)
  const targetsFor = (item: TaskSummary) => moveTargets(statuses.data ?? [], item.status?.id)

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const [required, setRequired] = useState<RequiredFieldsRequest | null>(null)

  /** Move em sequência; itens em que o fluxo não permite o destino são pulados (e avisados). */
  async function moveItems(items: TaskSummary[], statusId: string) {
    let done = 0
    const allowed = items.filter((item) => targetsFor(item).some((s) => s.id === statusId))
    const name = statuses.data?.find((s) => s.id === statusId)?.name ?? ''
    for (const item of allowed) {
      try {
        await activate.mutateAsync({ taskId: item.id, statusId })
        done += 1
      } catch (error) {
        const missing = missingForStatus(error)
        if (missing && allowed.length === 1) {
          // uma tarefa: abre o preenchimento e move em seguida
          setRequired({ taskId: item.id, code: item.code, status: missing.status ?? { id: statusId, name }, fieldNames: missing.fieldNames, retry: () => activate.mutateAsync({ taskId: item.id, statusId }) })
        } else if (missing) {
          notify.error(`${item.code}: ${t('tasks.requiredFor.message', { count: missing.fieldNames.length, status: missing.status?.name ?? name, fields: missing.fieldNames.join(', ') })}`)
        } else notify.error(`${item.code}: ${errorMessage(error)}`)
      }
    }
    setSelected(new Set())
    const skipped = items.length - allowed.length
    if (skipped > 0) notify.warning(t('backlog.skipped', { count: skipped, name }))
    if (done === 0) return
    const single = items.length === 1 ? items[0] : undefined
    notify.success(
      single ? t('backlog.movedOne', { code: single.code, name }) : t('backlog.moved', { count: done, name }),
      single && single.status
        ? {
            undo: {
              label: t('common.undo'),
              onClick: () => activate.mutate({ taskId: single.id, statusId: single.status?.id ?? '' }, { onError: (error) => notify.error(errorMessage(error)) }),
            },
          }
        : undefined,
    )
  }

  /** Planeja na sprint (vai para o fim do grupo). */
  async function planItems(items: TaskSummary[], sprint: SprintRef | null) {
    let done = 0
    for (const item of items) {
      if ((item.sprint?.id ?? null) === (sprint?.id ?? null)) continue
      try {
        await rank.mutateAsync({ taskId: item.id, sprint })
        done += 1
      } catch (error) {
        notify.error(`${item.code}: ${errorMessage(error)}`)
      }
    }
    setSelected(new Set())
    if (done > 0) notify.success(t('backlog.planned', { count: done, name: sprint?.name ?? t('backlog.noSprintGroup') }))
  }

  function onRank({ item, prevId, nextId, sprint }: BacklogRankEvent) {
    rank.mutate(
      { taskId: item.id, prevId, nextId, sprint },
      {
        onSuccess: () => {
          if (sprint !== undefined) notify.success(t('backlog.movedTo', { code: item.code, name: sprint?.name ?? t('backlog.noSprintGroup') }))
        },
        onError: (error) => notify.error(errorMessage(error)),
      },
    )
  }

  function setSprintState(sprint: Sprint, state: Sprint['state']) {
    sprintMutations.update.mutate(
      { id: sprint.id, data: { state } },
      {
        onSuccess: (saved) => {
          if (state === 'closed') notify.success(t('sprints.closed', { name: sprint.name, count: saved.returnedCount ?? 0 }))
          else notify.success(t(state === 'active' ? 'sprints.started' : 'sprints.replanned', { name: sprint.name }))
          setConfirm(null)
        },
        onError: (error) => notify.error(errorMessage(error)),
      },
    )
  }

  /** Sobe/desce a sprint uma posição (a ordem vale para todo o time). */
  function moveSprint(sprint: Sprint, delta: -1 | 1) {
    const ids = (data?.sprints ?? []).map((x) => x.id)
    const from = ids.indexOf(sprint.id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= ids.length) return
    ids.splice(to, 0, ...ids.splice(from, 1))
    sprintMutations.reorder.mutate(ids, {
      onSuccess: () => notify.success(t('sprints.reordered')),
      onError: (error) => notify.error(errorMessage(error)),
    })
  }

  function removeSprint(sprint: Sprint) {
    sprintMutations.remove.mutate(sprint.id, {
      onSuccess: () => {
        notify.success(t('sprints.deleted', { name: sprint.name }))
        setConfirm(null)
      },
      onError: (error) => notify.error(errorMessage(error)),
    })
  }

  function itemActions(item: TaskSummary): AppDropdownItem[] {
    const open: AppDropdownItem = { key: 'open', label: t('tasks.openPage'), icon: <ExternalLink />, onSelect: () => void navigate(`/tasks/${item.id}`) }
    if (!caps?.rank) return [open]
    const targets = targetsFor(item)
    const sprints = (data?.sprints ?? []).filter((c) => c.id !== item.sprint?.id)
    return [
      { type: 'label', key: 'move', label: t('backlog.moveTo') },
      ...(targets.length
        ? targets.map((s) => ({ key: `a-${s.id}`, label: s.name, icon: <ArrowRight />, onSelect: () => void moveItems([item], s.id) }))
        : [{ key: 'a-none', label: t('backlog.noTargets'), onSelect: () => {}, disabled: true }]),
      { type: 'separator', key: 's1' },
      { type: 'label', key: 'plan', label: t('backlog.planIn') },
      ...sprints.map((c) => ({ key: `c-${c.id}`, label: c.name, icon: <CalendarRange />, onSelect: () => void planItems([item], refOf(c)) })),
      ...(item.sprint ? [{ key: 'c-none', label: t('backlog.removeFromSprint'), icon: <Undo2 />, onSelect: () => void planItems([item], null) }] : []),
      ...(sprints.length === 0 && !item.sprint ? [{ key: 'c-empty', label: t('backlog.noSprints'), onSelect: () => {}, disabled: true }] : []),
      { type: 'separator', key: 's2' },
      open,
    ]
  }

  function renderHeader(group: BacklogGroup): ReactNode {
    const sprint = group.sprint
    const period =
      sprint && (sprint.startDate || sprint.endDate)
        ? [sprint.startDate, sprint.endDate].map((d) => (d ? formatDay(new Date(`${d}T00:00:00Z`), i18n.language) : '…')).join(' – ')
        : null
    const index = sprint ? (data?.sprints ?? []).findIndex((x) => x.id === sprint.id) : -1
    const count = data?.sprints.length ?? 0
    const sprintItems: AppDropdownItem[] = sprint
      ? [
          { key: 'edit', label: t('common.edit'), icon: <Pencil />, onSelect: () => setSprintForm(sprint) },
          { key: 'up', label: t('sprints.moveUp'), icon: <ArrowUp />, disabled: index <= 0, onSelect: () => moveSprint(sprint, -1) },
          { key: 'down', label: t('sprints.moveDown'), icon: <ArrowDown />, disabled: index < 0 || index >= count - 1, onSelect: () => moveSprint(sprint, 1) },
          { type: 'separator', key: 's0' },
          sprint.state === 'planned'
            ? { key: 'start', label: t('sprints.start'), icon: <Play />, onSelect: () => setSprintState(sprint, 'active') }
            : { key: 'replan', label: t('sprints.replan'), icon: <Undo2 />, onSelect: () => setSprintState(sprint, 'planned') },
          { key: 'close', label: t('sprints.close'), icon: <Square />, onSelect: () => setConfirm({ kind: 'close', sprint }) },
          { type: 'separator', key: 's' },
          { key: 'delete', label: t('common.delete'), icon: <Trash2 />, tone: 'danger', onSelect: () => setConfirm({ kind: 'delete', sprint }) },
        ]
      : []
    const name = sprint?.name ?? t('backlog.noSprintGroup')
    const isCollapsed = collapsed.has(group.id)
    return (
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <AppIconButton
          size="sm"
          variant="ghost"
          icon={isCollapsed ? <ChevronRight /> : <ChevronDown />}
          label={t(isCollapsed ? 'backlog.expand' : 'backlog.collapse', { name })}
          aria-expanded={!isCollapsed}
          onClick={() => toggleCollapsed(group.id)}
        />
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">{name}</h2>
            {sprint && (
              <AppBadge tone={sprint.state === 'active' ? 'success' : 'neutral'} dot>
                {t(`sprints.states.${sprint.state}`)}
              </AppBadge>
            )}
            {period && <span className="text-xs text-muted">{period}</span>}
          </div>
          {sprint?.goal && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{sprint.goal}</p>}
        </div>
        <span className="text-xs text-muted tabular-nums">
          {t('backlog.groupSummary', { count: group.items.length, hours: hours(group.estimate) })}
          {group.unestimated > 0 && ` · ${t('backlog.unestimated', { count: group.unestimated })}`}
        </span>
        {caps?.create && defaultStatus && (
          <AppIconButton
            size="sm"
            variant="ghost"
            icon={<Plus />}
            label={t('backlog.addTo', { name })}
            onClick={() => setQuickAdd({ statusId: defaultStatus.id, sprintId: sprint?.id })}
          />
        )}
        {caps?.manageSprints && sprintItems.length > 0 && (
          <AppDropdown trigger={<AppIconButton size="sm" variant="ghost" icon={<MoreHorizontal />} label={t('sprints.actionsFor', { name })} />} items={sprintItems} />
        )}
      </header>
    )
  }

  // mesmo filtro das listagens: parado mostra só o nome; ativo fica verde com "Nome: valor"
  const filterSelect = (key: 'assignee' | 'type' | 'priority' | 'urgency' | 'tag', label: string, options: Array<{ value: string; label: string }>) => (
    <FilterSelect key={key} filter={{ id: key, label, options }} value={filters[key] || undefined} onChange={(value) => setFilters((f) => ({ ...f, [key]: value ?? '' }))} />
  )

  return (
    <>
      <SectionHeader
        nav={<ProjectTaskViewsNav projectId={projectId} current="planning" />}
        actions={
          (caps?.manageSprints || (caps?.create && defaultStatus)) && (
            <>
              {caps?.manageSprints && (
                <AppButton variant="secondary" leftIcon={<CalendarRange />} onClick={() => setSprintForm(null)}>
                  {t('sprints.create')}
                </AppButton>
              )}
              {caps?.create && defaultStatus && (
                <AppButton leftIcon={<Plus />} onClick={() => setQuickAdd({ statusId: defaultStatus.id })}>
                  {t('tasks.create')}
                </AppButton>
              )}
            </>
          )
        }
      />

      {backlog.isPending ? (
        <div className="flex flex-col gap-3">
          <AppSkeleton className="h-10 rounded-xl" />
          <AppSkeleton className="h-64 rounded-2xl" />
        </div>
      ) : notFound ? (
        <AppEmptyState icon={<ListTodo />} title={t('backlog.notFound')} description={t('backlog.pickHint')} />
      ) : backlog.isError ? (
        <AppErrorState onRetry={() => void backlog.refetch()} />
      ) : data ? (
        <div className="flex flex-col gap-4">
          <AppFilterBar
            search={<AppSearch value={filters.search} onSearch={(search) => setFilters((f) => ({ ...f, search }))} placeholder={t('kanban.searchPlaceholder')} />}
            hasActiveFilters={activeFilters}
            onReset={() => {
              setFilters(EMPTY_FILTERS)
              setStatusFilter('')
            }}
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
                {filterSelect(
                  'tag',
                  t('tasks.fields.tags'),
                  (tags.data ?? []).map((x) => ({ value: x.id, label: x.name })),
                )}
                <FilterSelect
                  filter={{ id: 'status', label: t('tasks.fields.status'), options: data.statuses.map((s) => ({ value: s.id, label: s.name })) }}
                  value={statusFilter || undefined}
                  onChange={(value) => setStatusFilter(value ?? '')}
                />
                <AppSelect
                  className="w-full sm:w-52"
                  aria-label={t('backlog.sort.label')}
                  value={sort}
                  onValueChange={(value) => setSort(value as BacklogSort)}
                  options={BACKLOG_SORTS.map((s) => ({ value: s, label: t(`backlog.sort.${s}`) }))}
                />
              </>
            }
          />

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted" aria-live="polite">
            <span>{t('backlog.summary', { count: shown, hours: hours(estimate) })}</span>
            {data.project.archived && (
              <AppBadge tone="warning">
                <Archive /> {t('kanban.archived')}
              </AppBadge>
            )}
            {!data.project.archived && !caps?.rank && <AppBadge>{t('kanban.readOnly')}</AppBadge>}
            {caps?.rank && sort !== 'manual' && <span>· {t('backlog.sortedHint')}</span>}
            {data.truncated && <span>· {t('backlog.truncated')}</span>}
          </div>

          {selectedItems.length > 0 && caps?.rank && (
            <div
              role="region"
              aria-label={t('backlog.bulkLabel')}
              className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary bg-primary-soft px-3 py-2 text-sm text-primary-soft-fg"
            >
              <span className="font-medium">{t('backlog.selected', { count: selectedItems.length })}</span>
              <AppDropdown
                align="start"
                trigger={
                  <AppButton size="sm" leftIcon={<ArrowRight />} loading={activate.isPending}>
                    {t('backlog.moveTo')}
                  </AppButton>
                }
                items={(statuses.data ?? [])
                  .filter((s) => s.isActive && s.category && s.category !== 'done' && s.category !== 'cancelled')
                  .map((s) => ({ key: s.id, label: s.name, onSelect: () => void moveItems(selectedItems, s.id) }))}
              />
              <AppDropdown
                align="start"
                trigger={
                  <AppButton size="sm" variant="secondary" leftIcon={<CalendarRange />}>
                    {t('backlog.planIn')}
                  </AppButton>
                }
                items={[
                  ...data.sprints.map((c) => ({ key: c.id, label: c.name, onSelect: () => void planItems(selectedItems, refOf(c)) })),
                  { key: NO_SPRINT, label: t('backlog.noSprintGroup'), onSelect: () => void planItems(selectedItems, null) },
                ]}
              />
              <AppButton size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                {t('backlog.clearSelection')}
              </AppButton>
            </div>
          )}

          <BacklogList
            groups={groups}
            sortable={!!caps?.rank && sort === 'manual'}
            selected={selected}
            collapsed={collapsed}
            onToggle={toggle}
            onOpen={setOpenId}
            onRank={onRank}
            itemActions={itemActions}
            renderHeader={renderHeader}
            emptyLabel={(group) => (activeFilters ? t('backlog.noMatches') : group.sprint ? t('backlog.emptySprint') : t('backlog.empty'))}
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
        statusId={quickAdd?.statusId ?? null}
        statusName={data?.statuses.find((s) => s.id === quickAdd?.statusId)?.name}
        sprintName={data?.sprints.find((c) => c.id === quickAdd?.sprintId)?.name}
        sprintId={quickAdd?.sprintId}
        projectId={projectId}
        onOpenChange={(open) => !open && setQuickAdd(null)}
        onContinue={(initial) => {
          setQuickAdd(null)
          setFullForm(initial)
        }}
      />
      <TaskFormDialog open={!!fullForm} onOpenChange={(open) => !open && setFullForm(null)} projectId={projectId} initial={fullForm ?? undefined} />
      <SprintFormDialog projectId={projectId} sprint={sprintForm} onOpenChange={(open) => !open && setSprintForm(undefined)} />
      <AppConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm ? t(confirm.kind === 'close' ? 'sprints.closeTitle' : 'sprints.deleteTitle', { name: confirm.sprint.name }) : ''}
        description={confirm ? t(confirm.kind === 'close' ? 'sprints.closeDescription' : 'sprints.deleteDescription') : ''}
        confirmLabel={confirm?.kind === 'close' ? t('sprints.close') : t('common.delete')}
        tone={confirm?.kind === 'delete' ? 'danger' : 'primary'}
        loading={sprintMutations.update.isPending || sprintMutations.remove.isPending}
        onConfirm={() => {
          if (!confirm) return
          if (confirm.kind === 'close') setSprintState(confirm.sprint, 'closed')
          else removeSprint(confirm.sprint)
        }}
      />
      <RequiredFieldsDialog request={required} onClose={() => setRequired(null)} />
    </>
  )
}
