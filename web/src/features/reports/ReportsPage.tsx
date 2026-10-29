import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { isAppError } from '@/core/errors/app-error'
import { PERIOD_PRESETS, periodRange, REPORT_DIMENSIONS, type BreakdownRow, type PeriodPreset, type ReportDimension, type ReportMetric, type ReportQuery } from '@/domain/reports'
import type { TaskSummary } from '@/domain/tasks'
import {
  AppBarList,
  AppCard,
  AppDataTable,
  AppDatePicker,
  AppErrorState,
  AppFilterBar,
  AppSelect,
  AppSkeleton,
  SELECT_ALL,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useProjectMembers } from '@/features/projects/queries'
import { ProjectFilterSettingsButton } from '@/features/projects/ProjectFilterSettings'
import { useScreenProjects } from '@/features/projects/use-project-filter'
import { useTaskTypes } from '@/features/task-config/queries'
import { usePriorities, useStatuses } from '@/features/workflow/queries'
import { TaskPreviewDrawer } from '@/features/tasks/TaskPreviewDrawer'
import { DueDate, PersonCell, TaskCode } from '@/features/tasks/task-visuals'
import { useReport } from './queries'
import { IndicatorTasksDrawer } from './IndicatorTasksDrawer'
import { BreakdownLabelView, CurrentIndicators, PeriodIndicators, PeriodLine, TrendChart } from './report-visuals'
import { useDurationText } from './use-duration-text'

const EMPTY_LABEL: Record<ReportDimension, string> = {
  status: 'reports.none',
  priority: 'reports.none',
  type: 'reports.none',
  assignee: 'tasks.unassigned',
  project: 'reports.none',
}

/** Estado dos filtros na URL (dá para compartilhar o link do relatório). */
function useReportParams() {
  const [params, setParams] = useSearchParams()
  const get = (key: string) => params.get(key) ?? ''
  const set = (patch: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
        return next
      },
      { replace: true },
    )
  const preset = (PERIOD_PRESETS as readonly string[]).includes(get('period')) ? (get('period') as PeriodPreset) : '30d'
  const groupBy = (REPORT_DIMENSIONS as readonly string[]).includes(get('group')) ? (get('group') as ReportDimension) : 'status'
  return { get, set, preset, groupBy }
}

export function ReportsPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('reports.title'))
  const { get, set, preset, groupBy } = useReportParams()
  // configurador do filtro de projetos (por pessoa): restringe as opções; o projeto escolhido não some
  const projects = useScreenProjects('reports', get('project') ? [get('project')] : [])
  const members = useProjectMembers(get('project') || undefined)
  const types = useTaskTypes(false)
  const priorities = usePriorities(false)
  const statuses = useStatuses(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [metric, setMetric] = useState<ReportMetric | null>(null)

  const [now] = useState(() => new Date())
  const range = periodRange(preset, now, { from: get('from'), to: get('to') })
  const query: ReportQuery | null = range
    ? {
        ...range,
        tzOffset: now.getTimezoneOffset(),
        groupBy,
        projectId: get('project') || undefined,
        assigneeId: get('assignee') || undefined,
        typeId: get('type') || undefined,
        priorityId: get('priority') || undefined,
        statusId: get('status') || undefined,
      }
    : null
  const report = useReport(query)
  const data = report.data

  const select = (key: string, label: string, options: Array<{ value: string; label: string }>, extra?: Record<string, string>, className = 'w-full sm:w-44') => (
    <AppSelect
      size="sm"
      className={className}
      aria-label={label}
      value={get(key) || SELECT_ALL}
      onValueChange={(value) => set({ [key]: value === SELECT_ALL ? '' : value, ...extra })}
      options={[{ value: SELECT_ALL, label: t('kanban.filters.all', { name: label }) }, ...options]}
    />
  )
  const activeFilters = ['project', 'assignee', 'type', 'priority', 'status'].some((k) => !!get(k))

  return (
    <>
      <PageHeader title={t('reports.title')} description={t('reports.description')} />
      <div className="flex flex-col gap-4">
        <AppFilterBar
          hasActiveFilters={activeFilters}
          onReset={() => set({ project: '', assignee: '', type: '', priority: '', status: '' })}
          filters={
            <>
              <AppSelect
                size="sm"
                className="w-full sm:w-48"
                aria-label={t('reports.periodLabel')}
                value={preset}
                onValueChange={(value) => set({ period: value === '30d' ? '' : value })}
                options={PERIOD_PRESETS.map((p) => ({ value: p, label: t(`reports.presets.${p}`) }))}
              />
              {preset === 'custom' && (
                <>
                  <AppDatePicker aria-label={t('reports.from')} value={get('from')} onValueChange={(v) => set({ from: v })} fieldClassName="w-full sm:w-44" />
                  <AppDatePicker aria-label={t('reports.to')} value={get('to')} min={get('from') || undefined} onValueChange={(v) => set({ to: v })} fieldClassName="w-full sm:w-44" />
                </>
              )}
              <div className="flex w-full items-center gap-2 sm:w-auto">
                {select(
                  'project',
                  t('tasks.fields.project'),
                  projects.items.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` })),
                  { assignee: '' },
                  'min-w-0 flex-1 sm:w-44 sm:flex-none',
                )}
                <ProjectFilterSettingsButton screen="reports" size="sm" />
              </div>
              {select('assignee', t('tasks.fields.assignee'), [
                { value: 'me', label: t('kanban.filters.me') },
                { value: 'none', label: t('tasks.unassigned') },
                ...(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name })),
              ])}
              {select('type', t('tasks.fields.type'), (types.data ?? []).map((x) => ({ value: x.id, label: x.name })))}
              {select('priority', t('tasks.fields.priority'), (priorities.data ?? []).map((x) => ({ value: x.id, label: x.name })))}
              {select('status', t('tasks.fields.status'), (statuses.data ?? []).map((x) => ({ value: x.id, label: x.name })))}
            </>
          }
        />

        {!range ? (
          <p role="alert" className="text-sm text-danger">
            {t('reports.invalidPeriod')}
          </p>
        ) : report.isPending ? (
          <div className="flex flex-col gap-3">
            <AppSkeleton className="h-24 rounded-2xl" />
            <AppSkeleton className="h-64 rounded-2xl" />
          </div>
        ) : report.isError || !data ? (
          <AppErrorState
            correlationId={isAppError(report.error) ? report.error.correlationId : undefined}
            onRetry={() => void report.refetch()}
          />
        ) : (
          <>
            <PeriodLine report={data} />
            <section aria-labelledby="now-title" className="flex flex-col gap-2">
              <h2 id="now-title" className="text-sm font-semibold text-fg">
                {t('reports.nowTitle')}
              </h2>
              <CurrentIndicators report={data} onSelect={setMetric} />
            </section>
            <section aria-labelledby="period-title" className="flex flex-col gap-2">
              <h2 id="period-title" className="text-sm font-semibold text-fg">
                {t('reports.periodTitle')}
              </h2>
              <PeriodIndicators report={data} onSelect={setMetric} />
            </section>
            <AppCard title={t(data.series.bucket === 'week' ? 'reports.trendWeekly' : 'reports.trendDaily')}>
              <TrendChart report={data} />
            </AppCard>
            <BreakdownCard rows={data.breakdown.rows} dimension={data.breakdown.dimension} onGroupBy={(g) => set({ group: g === 'status' ? '' : g })} />
            <OverdueCard tasks={data.overdueTasks} onView={setPreviewId} />
          </>
        )}
      </div>
      <TaskPreviewDrawer taskId={previewId} onOpenChange={(open) => !open && setPreviewId(null)} />
      <IndicatorTasksDrawer query={query} report={data} metric={metric} onOpenChange={(open) => !open && setMetric(null)} />
    </>
  )
}

function BreakdownCard({ rows, dimension, onGroupBy }: { rows: BreakdownRow[]; dimension: ReportDimension; onGroupBy: (dimension: ReportDimension) => void }) {
  const { t } = useTranslation()
  const duration = useDurationText()
  const table = useDataTableState('report-breakdown', { sort: { id: 'open', direction: 'desc' } })
  const sorted = useMemo(() => {
    const sort = table.state.sort
    if (!sort || sort.id === 'group') return rows
    const factor = sort.direction === 'asc' ? 1 : -1
    const value = (r: BreakdownRow) => (sort.id === 'lead' ? (r.leadTime.hours ?? -1) : ((r as unknown as Record<string, number>)[sort.id] ?? 0))
    return [...rows].sort((a, b) => (value(a) - value(b)) * factor)
  }, [rows, table.state.sort])

  const num = (id: keyof BreakdownRow & string, header: string, tone?: string): DataTableColumn<BreakdownRow> => ({
    id,
    header,
    sortable: true,
    align: 'end',
    size: 120,
    cell: (row) => <span className={(row[id] as number) > 0 ? tone : undefined}>{row[id] as number}</span>,
  })
  const columns: DataTableColumn<BreakdownRow>[] = [
    { id: 'group', header: t(`reports.dimensions.${dimension}`), hideable: false, pinned: true, size: 240, cell: (row) => <BreakdownLabelView label={row.label} emptyKey={EMPTY_LABEL[dimension]} /> },
    num('total', t('reports.columns.total')),
    num('open', t('reports.columns.open')),
    num('overdue', t('reports.columns.overdue'), 'text-danger'),
    num('blocked', t('reports.columns.blocked'), 'text-danger'),
    num('created', t('reports.columns.created')),
    num('completed', t('reports.columns.completed'), 'text-success'),
    { id: 'lead', header: t('reports.columns.leadTime'), sortable: true, align: 'end', size: 150, cell: (row) => duration(row.leadTime) },
  ]
  return (
    <AppCard
      title={t('reports.breakdownTitle')}
      description={t('reports.breakdownHint')}
      actions={
        <AppSelect
          size="sm"
          className="w-44"
          aria-label={t('reports.groupBy')}
          value={dimension}
          onValueChange={(value) => onGroupBy(value as ReportDimension)}
          options={REPORT_DIMENSIONS.map((d) => ({ value: d, label: t(`reports.dimensions.${d}`) }))}
        />
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <AppBarList
          label={t('reports.openBy', { dimension: t(`reports.dimensions.${dimension}`) })}
          items={rows.filter((r) => r.open > 0).map((r) => ({ key: r.key || 'none', label: <BreakdownLabelView label={r.label} emptyKey={EMPTY_LABEL[dimension]} />, value: r.open }))}
          empty={t('reports.noOpen')}
        />
        <AppDataTable
          caption={t('reports.breakdownTitle')}
          columns={columns}
          data={sorted}
          total={sorted.length}
          getRowId={(row) => row.key || 'none'}
          table={table}
          paginated={false}
          searchable={false}
          emptyState={<p className="p-6 text-center text-sm text-subtle">{t('reports.noData')}</p>}
        />
      </div>
    </AppCard>
  )
}

function OverdueCard({ tasks, onView }: { tasks: TaskSummary[]; onView: (id: string) => void }) {
  const { t } = useTranslation()
  const table = useDataTableState('report-overdue')
  const columns: DataTableColumn<TaskSummary>[] = [
    { id: 'code', header: t('tasks.fields.task'), hideable: false, pinned: true, size: 130, cell: (task) => <TaskCode task={task} /> },
    { id: 'title', header: t('tasks.fields.title'), hideable: false, size: 320, cell: (task) => <span className="font-medium text-fg">{task.title}</span> },
    { id: 'project', header: t('tasks.fields.project'), size: 180, cell: (task) => task.project?.name ?? '—' },
    { id: 'due', header: t('tasks.fields.dueDate'), size: 150, cell: (task) => <DueDate task={task} /> },
    { id: 'assignee', header: t('tasks.fields.assignee'), size: 200, cell: (task) => <PersonCell person={task.assignee} /> },
  ]
  return (
    <AppCard title={t('reports.overdueTitle', { count: tasks.length })} description={t('reports.overdueHint')}>
      <AppDataTable
        caption={t('reports.overdueTitle', { count: tasks.length })}
        columns={columns}
        data={tasks}
        total={tasks.length}
        getRowId={(task) => task.id}
        table={table}
        paginated={false}
        searchable={false}
        actions={{ onView: (task) => onView(task.id) }}
        emptyState={<p className="p-6 text-center text-sm text-subtle">{t('reports.noOverdue')}</p>}
      />
    </AppCard>
  )
}

