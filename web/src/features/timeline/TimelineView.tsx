import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, CalendarOff, CalendarRange, Diamond, GripVertical } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { readJson, writeJson } from '@/core/storage/safe-storage'
import { EMPTY_FILTERS, matchesFilters, type BoardFilters, type BoardSelectFilter } from '@/domain/kanban'
import { isClosed, isOverdue, type TaskSummary } from '@/domain/tasks'
import {
  PX_PER_DAY,
  TIMELINE_GROUPS,
  TIMELINE_ZOOMS,
  dateFromDay,
  dayFromIso,
  dayOf,
  dropSpan,
  groupTimelineTasks,
  headerTiers,
  isConflict,
  isoFromDay,
  taskSpan,
  timelineRange,
  todayOf,
  type DaySpan,
  type HeaderSegment,
  type TimelineGroupBy,
  type TimelineZoom,
} from '@/domain/timeline'
import {
  AppBadge,
  AppButton,
  AppEmptyState,
  AppErrorState,
  AppFilterBar,
  AppSearch,
  AppSelect,
  AppSkeleton,
  AppSwitch,
  AppTimeline,
  SELECT_ALL,
  TIMELINE_DRAG_TYPE,
  notify,
  type AppTimelineBar,
  type AppTimelineGroup,
} from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useSession } from '@/features/auth/session'
import { useProjectMembers } from '@/features/projects/queries'
import { useTaskTypes } from '@/features/task-config/queries'
import { optionColor, optionText, optionTint } from '@/features/task-config/config-theme'
import { usePriorities } from '@/features/workflow/queries'
import { useTags } from '@/features/tags/queries'
import { TaskPreviewDrawer } from '@/features/tasks/TaskPreviewDrawer'
import { TaskCode, TaskStatusBadge } from '@/features/tasks/task-visuals'
import { MilestoneDialog, type MilestoneDialogState } from './MilestoneDialog'
import { ScheduleDialog } from './ScheduleDialog'
import { useMoveDates, useTimeline } from './queries'

const ZOOM_KEY = 'kamban.timeline.zoom'
const GROUP_KEY = 'kamban.timeline.group'
const HIDE_DONE_KEY = 'kamban.timeline.hideDone'

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => (list.includes(value as T) ? (value as T) : fallback)

/** Timeline do projeto: barras por tarefa (início planejado → prazo), dependências, sprints e marcos. */
export function TimelineView({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const errorMessage = useErrorMessage()
  const { current } = useSession()
  const timeline = useTimeline(projectId)
  const move = useMoveDates(projectId)
  const members = useProjectMembers(projectId)
  const types = useTaskTypes(false)
  const priorities = usePriorities(false)
  const tags = useTags()

  const [now] = useState(() => new Date())
  const today = todayOf(now)
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS)
  const [zoom, setZoomState] = useState<TimelineZoom>(() => oneOf(TIMELINE_ZOOMS, readJson(ZOOM_KEY, 'week'), 'week'))
  const [groupBy, setGroupByState] = useState<TimelineGroupBy>(() => oneOf(TIMELINE_GROUPS, readJson(GROUP_KEY, 'sprint'), 'sprint'))
  const [hideDone, setHideDoneState] = useState<boolean>(() => readJson<boolean>(HIDE_DONE_KEY, false) === true)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [scrollTo, setScrollTo] = useState({ day: today, nonce: 1 })
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [milestoneDialog, setMilestoneDialog] = useState<MilestoneDialogState>(null)
  const [scheduling, setScheduling] = useState<TaskSummary | null>(null)

  const setZoom = (value: TimelineZoom) => {
    setZoomState(value)
    writeJson(ZOOM_KEY, value)
  }
  const setGroupBy = (value: TimelineGroupBy) => {
    setGroupByState(value)
    writeJson(GROUP_KEY, value)
  }
  const setHideDone = (value: boolean) => {
    setHideDoneState(value)
    writeJson(HIDE_DONE_KEY, value)
  }

  const data = timeline.data
  const userId = current?.user.id
  const visible = useCallback((task: TaskSummary) => matchesFilters(task, filters, userId) && (!hideDone || !isClosed(task)), [filters, userId, hideDone])

  const dayFormat = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }), [locale])
  const formatSpan = useCallback(
    (span: DaySpan) => (span.start === span.end ? dayFormat.format(dateFromDay(span.start)) : t('timeline.period', { from: dayFormat.format(dateFromDay(span.start)), to: dayFormat.format(dateFromDay(span.end)) })),
    [dayFormat, t],
  )

  // escala estável: calculada com todas as tarefas (filtros não mudam o período)
  const range = useMemo(() => {
    if (!data) return { start: today - 7, end: today + 35 }
    const days: number[] = []
    data.tasks.forEach((task) => {
      const span = taskSpan(task)
      if (span) days.push(span.start, span.end)
    })
    data.milestones.forEach((m) => days.push(dayFromIso(m.dueDate)))
    data.sprints.forEach((s) => {
      if (s.startDate) days.push(dayFromIso(s.startDate))
      if (s.endDate) days.push(dayFromIso(s.endDate))
    })
    if (data.project.startDate) days.push(dayOf(data.project.startDate))
    if (data.project.dueDate) days.push(dayOf(data.project.dueDate))
    return timelineRange(days, today)
  }, [data, today])

  const pxPerDay = PX_PER_DAY[zoom]
  const tiers = useMemo(() => headerTiers(range, zoom), [range, zoom])
  const topFormat = useMemo(() => new Intl.DateTimeFormat(locale, zoom === 'day' || zoom === 'week' ? { month: 'long', year: 'numeric', timeZone: 'UTC' } : { year: 'numeric', timeZone: 'UTC' }), [locale, zoom])
  const bottomFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, zoom === 'day' ? { day: 'numeric', timeZone: 'UTC' } : zoom === 'week' ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { month: 'short', timeZone: 'UTC' }),
    [locale, zoom],
  )

  const tasks = useMemo(() => (data?.tasks ?? []).filter(visible), [data, visible])
  const scheduled = tasks.filter((task) => taskSpan(task))
  const unscheduled = tasks.filter((task) => !taskSpan(task))
  const spans = useMemo(() => new Map((data?.tasks ?? []).map((task) => [task.id, taskSpan(task)])), [data])
  const links = useMemo(
    () => (data?.dependencies ?? []).map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, conflict: isConflict(spans.get(edge.from) ?? null, spans.get(edge.to) ?? null) })),
    [data, spans],
  )
  const conflicted = useMemo(() => new Set(links.filter((l) => l.conflict).map((l) => l.to)), [links])

  const groupLabel = (key: string, sample: TaskSummary | undefined): string => {
    if (groupBy === 'sprint') return key === 'none' ? t('sprints.none') : (sample?.sprint?.name ?? '')
    if (groupBy === 'assignee') return key === 'none' ? t('tasks.unassigned') : (sample?.assignee?.name ?? '')
    if (groupBy === 'status') return sample?.status?.name ?? t('timeline.noValue')
    if (groupBy === 'type') return sample?.type?.name ?? t('timeline.noValue')
    return ''
  }

  const toBar = (task: TaskSummary): AppTimelineBar => {
    const span = taskSpan(task)
    const color = task.status?.color ?? 'gray'
    const progress = task.subtaskProgress.total ? task.subtaskProgress.done / task.subtaskProgress.total : task.checklistProgress.total ? task.checklistProgress.done / task.checklistProgress.total : undefined
    const overdue = isOverdue(task, now)
    const conflict = conflicted.has(task.id)
    const extra = [overdue ? t('timeline.overdue') : '', conflict ? t('timeline.conflictHint') : ''].filter(Boolean).join(', ')
    return {
      id: task.id,
      label: (
        <span className="flex min-w-0 flex-col">
          <span className="font-mono text-[11px] leading-4 text-muted">{task.code}</span>
          <span className={isClosed(task) ? 'truncate text-sm leading-5 text-muted line-through' : 'truncate text-sm leading-5 text-fg'}>{task.title}</span>
        </span>
      ),
      barText: task.title,
      ariaLabel: `${task.code} · ${task.title}${span ? `, ${formatSpan(span)}` : ''}${extra ? ` (${extra})` : ''}`,
      span,
      accent: optionColor(color),
      tint: optionTint(color),
      text: optionText(color),
      progress,
      danger: overdue,
      conflict,
      draggable: !!data?.capabilities.edit,
    }
  }

  const groups: AppTimelineGroup[] = groupTimelineTasks(scheduled, groupBy, data?.sprints ?? []).map((group) => ({
    key: group.key,
    label: (
      <span className="flex min-w-0 items-center gap-2">
        {groupBy === 'status' && group.tasks[0]?.status ? <TaskStatusBadge status={group.tasks[0].status} /> : <span className="truncate">{groupLabel(group.key, group.tasks[0])}</span>}
        <span className="shrink-0 text-xs font-normal text-muted">{group.tasks.length}</span>
      </span>
    ),
    collapsed: collapsed.has(group.key),
    bars: group.tasks.map(toBar),
  }))

  function saveDates(task: TaskSummary, span: DaySpan) {
    const startDate = isoFromDay(span.start)
    const dueDate = isoFromDay(span.end)
    move.mutate(
      { taskId: task.id, startDate, dueDate },
      {
        onSuccess: () => notify.success(t('timeline.moved', { code: task.code, period: formatSpan(span) })),
        onError: (error) => notify.error(isAppError(error) && error.fieldErrors().start_date ? t('validation.after_due_date') : errorMessage(error)),
      },
    )
  }
  const byId = (id: string) => data?.tasks.find((task) => task.id === id)

  const filterSelect = (key: BoardSelectFilter, label: string, options: Array<{ value: string; label: string }>) => (
    <AppSelect
      size="sm"
      className="w-full sm:w-44"
      aria-label={label}
      value={filters[key] || SELECT_ALL}
      onValueChange={(value) => setFilters((f) => ({ ...f, [key]: value === SELECT_ALL ? '' : value }))}
      options={[{ value: SELECT_ALL, label: t('kanban.filters.all', { name: label }) }, ...options]}
    />
  )

  if (timeline.isPending) return <AppSkeleton className="h-[28rem] rounded-xl" />
  if (timeline.isError || !data) return <AppErrorState correlationId={isAppError(timeline.error) ? timeline.error.correlationId : undefined} onRetry={() => void timeline.refetch()} />

  const activeFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS) || hideDone

  return (
    <div className="flex flex-col gap-4">
      <AppFilterBar
        search={<AppSearch value={filters.search} onSearch={(search) => setFilters((f) => ({ ...f, search }))} placeholder={t('kanban.searchPlaceholder')} />}
        hasActiveFilters={activeFilters}
        onReset={() => {
          setFilters(EMPTY_FILTERS)
          setHideDone(false)
        }}
        filters={
          <>
            {filterSelect('assignee', t('tasks.fields.assignee'), [
              { value: 'me', label: t('kanban.filters.me') },
              { value: 'none', label: t('tasks.unassigned') },
              ...(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name })),
            ])}
            {filterSelect('type', t('tasks.fields.type'), (types.data ?? []).map((x) => ({ value: x.id, label: x.name })))}
            {filterSelect('priority', t('tasks.fields.priority'), (priorities.data ?? []).map((x) => ({ value: x.id, label: x.name })))}
            {data.sprints.length > 0 && filterSelect('sprint', t('tasks.fields.sprint'), [{ value: 'none', label: t('sprints.none') }, ...data.sprints.map((s) => ({ value: s.id, label: s.name }))])}
            {filterSelect('tag', t('tasks.fields.tags'), (tags.data ?? []).map((x) => ({ value: x.id, label: x.name })))}
            <AppSwitch size="sm" checked={hideDone} onCheckedChange={setHideDone} label={<span className="text-xs">{t('timeline.hideDone')}</span>} />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <AppSelect
          size="sm"
          className="w-40"
          aria-label={t('timeline.zoom.label')}
          value={zoom}
          onValueChange={(value) => setZoom(value as TimelineZoom)}
          options={TIMELINE_ZOOMS.map((z) => ({ value: z, label: t(`timeline.zoom.${z}`) }))}
        />
        <AppSelect
          size="sm"
          className="w-48"
          aria-label={t('timeline.groupBy.label')}
          value={groupBy}
          onValueChange={(value) => setGroupBy(value as TimelineGroupBy)}
          options={TIMELINE_GROUPS.map((g) => ({ value: g, label: t(`timeline.groupBy.${g}`) }))}
        />
        <AppButton variant="secondary" size="sm" leftIcon={<CalendarDays />} onClick={() => setScrollTo((s) => ({ day: today, nonce: s.nonce + 1 }))}>
          {t('timeline.today')}
        </AppButton>
        {data.capabilities.manageMilestones && (
          <AppButton variant="secondary" size="sm" leftIcon={<Diamond />} onClick={() => setMilestoneDialog({ mode: 'create' })}>
            {t('timeline.milestones.create')}
          </AppButton>
        )}
        {!data.capabilities.edit && <AppBadge>{t('kanban.readOnly')}</AppBadge>}
        <p className="ml-auto text-xs text-muted" aria-live="polite">
          {t('timeline.summary', { count: scheduled.length })} · {t('timeline.unscheduledCount', { count: unscheduled.length })}
          {conflicted.size > 0 && <span className="font-medium text-danger"> · {t('timeline.conflicts', { count: conflicted.size })}</span>}
        </p>
      </div>
      {data.truncated && (
        <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-xs font-medium text-warning-soft-fg">
          {t('timeline.truncated')}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        {data.tasks.length === 0 && data.milestones.length === 0 ? (
          <AppEmptyState icon={<CalendarRange />} title={t('timeline.empty')} description={t('timeline.emptyHint')} />
        ) : (
          <AppTimeline
            label={t('timeline.label', { name: data.project.name })}
            groups={groups}
            showGroupHeaders={groupBy !== 'none'}
            range={range}
            pxPerDay={pxPerDay}
            today={today}
            tiers={tiers}
            formatTop={(seg: HeaderSegment) => topFormat.format(dateFromDay(seg.start))}
            formatBottom={(seg: HeaderSegment) => bottomFormat.format(dateFromDay(seg.start))}
            formatSpan={formatSpan}
            leftHeader={t('tasks.fields.task')}
            todayLabel={t('timeline.today')}
            keyboardHint={t('timeline.keyboardHint')}
            markers={data.milestones.map((m) => ({
              id: m.id,
              day: dayFromIso(m.dueDate),
              label: m.name,
              ariaLabel: t('timeline.milestones.aria', { name: m.name, date: dayFormat.format(dateFromDay(dayFromIso(m.dueDate))), state: t(`timeline.milestones.states.${m.state}`) }),
              done: m.state === 'done',
            }))}
            bands={data.sprints.filter((s) => s.startDate && s.endDate).map((s) => ({ id: s.id, start: dayFromIso(s.startDate as string), end: dayFromIso(s.endDate as string), label: s.name }))}
            links={links}
            shadeWeekends={zoom === 'day' || zoom === 'week'}
            scrollTo={scrollTo}
            onToggleGroup={(key) =>
              setCollapsed((set) => {
                const next = new Set(set)
                if (next.has(key)) next.delete(key)
                else next.add(key)
                return next
              })
            }
            onOpen={setPreviewId}
            onChange={(id, span) => {
              const task = byId(id)
              if (task) saveDates(task, span)
            }}
            onMarkerClick={
              data.capabilities.manageMilestones
                ? (id) => {
                    const milestone = data.milestones.find((m) => m.id === id)
                    if (milestone) setMilestoneDialog({ mode: 'edit', milestone })
                  }
                : undefined
            }
            onDropExternal={
              data.capabilities.edit
                ? (id, day) => {
                    const task = byId(id)
                    if (task) saveDates(task, dropSpan(day, task.estimatedHours))
                  }
                : undefined
            }
          />
        )}

        <section aria-labelledby="timeline-unscheduled" className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-card xl:max-h-[calc(100dvh-17rem)] xl:overflow-y-auto">
          <h2 id="timeline-unscheduled" className="flex items-center gap-2 text-sm font-semibold text-fg">
            <CalendarOff className="size-4 text-muted" aria-hidden /> {t('timeline.unscheduled')}
            <span className="text-xs font-normal text-muted">{unscheduled.length}</span>
          </h2>
          <p className="text-xs text-muted">{data.capabilities.edit ? t('timeline.unscheduledHint') : t('timeline.unscheduledReadOnly')}</p>
          {unscheduled.length === 0 ? (
            <p className="py-4 text-center text-xs text-subtle">{t('timeline.allScheduled')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {unscheduled.map((task) => (
                <li
                  key={task.id}
                  draggable={data.capabilities.edit}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(TIMELINE_DRAG_TYPE, task.id)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  data-testid={`timeline-unscheduled-${task.id}`}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5"
                >
                  {data.capabilities.edit && <GripVertical className="size-4 shrink-0 cursor-grab text-subtle" aria-hidden />}
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setPreviewId(task.id)}>
                    <TaskCode task={task} className="text-[11px]" />
                    <span className="block truncate text-sm text-fg">{task.title}</span>
                  </button>
                  {data.capabilities.edit && (
                    <AppButton variant="ghost" size="sm" onClick={() => setScheduling(task)} aria-label={t('timeline.schedule.action', { code: task.code })}>
                      {t('timeline.schedule.short')}
                    </AppButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <TaskPreviewDrawer taskId={previewId} onOpenChange={(open) => !open && setPreviewId(null)} />
      <MilestoneDialog projectId={projectId} state={milestoneDialog} onClose={() => setMilestoneDialog(null)} />
      <ScheduleDialog
        task={scheduling}
        initial={(() => {
          const span = scheduling ? dropSpan(today, scheduling.estimatedHours) : { start: today, end: today }
          return { startDate: isoFromDay(span.start), dueDate: isoFromDay(span.end) }
        })()}
        onClose={() => setScheduling(null)}
        onSave={(task, dates) => saveDates(task, { start: dayFromIso(dates.startDate), end: dayFromIso(dates.dueDate) })}
      />
    </div>
  )
}
