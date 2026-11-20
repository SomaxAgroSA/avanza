import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isAppError } from '@/core/errors/app-error'
import { isPeriodMetric, isTimeMetric, type Report, type ReportMetric, type ReportQuery, type ReportTask } from '@/domain/reports'
import { AppDataTable, AppDrawer, useDataTableState, type DataTableColumn } from '@/presentation/components'
import { TaskPreviewDrawer } from '@/features/tasks/TaskPreviewDrawer'
import { DueDate, PersonCell, TaskCode, TaskIndicators, TaskPriorityBadge, TaskStatusBadge } from '@/features/tasks/task-visuals'
import { useReportTasks } from './queries'
import { useMetricText } from './report-metrics'
import { PeriodLine } from './report-visuals'
import { useDurationText } from './use-duration-text'

const EMPTY: ReportTask[] = []

export interface IndicatorTasksDrawerProps {
  /** Consulta do relatório em tela (período, fuso e filtros): o detalhamento usa a mesma. */
  query: ReportQuery | null
  report: Report | undefined
  metric: ReportMetric | null
  onOpenChange: (open: boolean) => void
}

/** Detalhamento de um indicador: as tarefas por trás do número (o total bate com o card). */
export function IndicatorTasksDrawer({ query, report, metric, onOpenChange }: IndicatorTasksDrawerProps) {
  const { t } = useTranslation()
  const text = useMetricText()
  const open = !!metric && !!report && !!query
  return (
    <AppDrawer
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={metric ? text.label(metric) : ''}
      description={metric && report ? text.help(metric, report) : undefined}
    >
      {open && metric && report && query && (
        // key: trocar de indicador recomeça na primeira página
        <IndicatorTasks key={metric} query={query} report={report} metric={metric} caption={t('reports.drill.caption', { name: text.label(metric) })} />
      )}
    </AppDrawer>
  )
}

function IndicatorTasks({ query, report, metric, caption }: { query: ReportQuery; report: Report; metric: ReportMetric; caption: string }) {
  const { t } = useTranslation()
  const table = useDataTableState('report-indicator-tasks')
  const tasks = useReportTasks(query, metric, { page: table.state.page, perPage: table.state.perPage })
  const [previewId, setPreviewId] = useState<string | null>(null)
  const total = tasks.data?.total ?? 0

  const columns = useMemo<DataTableColumn<ReportTask>[]>(
    () => [
      {
        id: 'code',
        header: t('tasks.fields.task'),
        hideable: false,
        pinned: true,
        size: 320,
        minSize: 220,
        cell: (task) => (
          <div className="min-w-0">
            <TaskCode task={task} />
            <p className="truncate font-medium text-fg">{task.title}</p>
            <TaskIndicators task={task} />
          </div>
        ),
      },
      ...(isTimeMetric(metric)
        ? [
            {
              id: 'duration',
              header: t('reports.drill.duration'),
              size: 120,
              align: 'end',
              cell: (task: ReportTask) => <DurationCell hours={task.metricHours} />,
            } satisfies DataTableColumn<ReportTask>,
          ]
        : []),
      { id: 'status', header: t('tasks.fields.status'), size: 170, cell: (task) => <TaskStatusBadge status={task.status} /> },
      { id: 'priority', header: t('tasks.fields.priority'), size: 130, cell: (task) => <TaskPriorityBadge priority={task.priority} /> },
      { id: 'assignee', header: t('tasks.fields.assignee'), size: 180, cell: (task) => <PersonCell person={task.assignee} /> },
      { id: 'due', header: t('tasks.fields.dueDate'), size: 130, cell: (task) => <DueDate task={task} /> },
      { id: 'project', header: t('tasks.fields.project'), size: 160, cell: (task) => <span className="truncate text-muted">{task.project?.name ?? (task.demand ? t('demands.internalProject') : '—')}</span> },
    ],
    [t, metric],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-fg" aria-live="polite">
          {tasks.data ? t('reports.drill.count', { count: total }) : ' '}
        </p>
        {isPeriodMetric(metric) ? <PeriodLine report={report} className="text-xs text-muted" /> : <p className="text-xs text-muted">{t('reports.drill.now')}</p>}
      </div>
      <AppDataTable
        caption={caption}
        columns={columns}
        data={tasks.data?.items ?? EMPTY}
        total={total}
        getRowId={(task) => task.id}
        table={table}
        loading={tasks.isPending}
        fetching={tasks.isFetching}
        error={tasks.isError ? { correlationId: isAppError(tasks.error) ? tasks.error.correlationId : undefined } : null}
        onRetry={() => void tasks.refetch()}
        searchable={false}
        actions={{ onView: (task) => setPreviewId(task.id) }}
        emptyState={<p className="p-6 text-center text-sm text-subtle">{t('reports.drill.empty')}</p>}
      />
      <TaskPreviewDrawer taskId={previewId} onOpenChange={(value) => !value && setPreviewId(null)} />
    </div>
  )
}

/** Duração da própria tarefa (indicadores de tempo). */
function DurationCell({ hours }: { hours: number | null }) {
  const duration = useDurationText()
  return <span className="tabular-nums text-fg">{duration({ hours, count: 1 })}</span>
}
