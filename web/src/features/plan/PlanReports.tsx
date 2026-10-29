import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CalendarCheck, CalendarOff, CalendarX, CheckCircle2, Clock, Gauge, HeartPulse, Hourglass, ListChecks, PauseCircle, Sigma, TrendingUp } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatNumber, type Plan } from '@/domain/plan'
import type { PlanReport } from '@/domain/plan-management'
import { AppBadge, AppBarList, AppCard, AppDataTable, AppEmptyState, AppErrorState, AppSkeleton, AppStatCard, useDataTableState, type DataTableColumn } from '@/presentation/components'
import { optionColor, optionText } from '@/features/task-config/config-theme'
import type { OptionColor } from '@/domain/task-config'
import { ProgressBar } from './cells'
import { factorDetail, HEALTH_TONE } from './health-visuals'
import { usePlanReport } from './queries'

type GroupRow = PlanReport['groups'][number]

/**
 * Relatórios do quadro (GP-4 — diretriz §16): saúde do projeto (o pior dos fatores, sempre com cada
 * fator e o seu valor), resumo, cronograma, esforço, recursos e grupos. Os números vêm do servidor
 * (backend/src/domain/plan-report.js), com "hoje" no fuso de quem consulta.
 */
export function PlanReports({ plan }: { plan: Plan }) {
  const { t } = useTranslation()
  const report = usePlanReport(plan.project.id)
  if (report.isPending)
    return (
      <div className="grid gap-4 md:grid-cols-3" aria-busy="true" aria-label={t('common.loading')}>
        <AppSkeleton className="h-40 md:col-span-3" />
        <AppSkeleton className="h-28" />
        <AppSkeleton className="h-28" />
        <AppSkeleton className="h-28" />
      </div>
    )
  if (report.isError) return <AppErrorState title={t('plan.report.loadError')} correlationId={isAppError(report.error) ? report.error.correlationId : undefined} onRetry={() => void report.refetch()} />
  return <ReportView data={report.data} />
}

function ReportView({ data }: { data: PlanReport }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const num = (value: number | null) => formatNumber(value, locale) ?? '—'
  const hours = (value: number | null) => (value === null ? '—' : t('plan.report.hours', { value: num(value) }))
  const table = useDataTableState('plan-report-groups', { sort: null })

  const groupColumns = useMemo<DataTableColumn<GroupRow>[]>(
    () => [
      {
        id: 'group',
        header: t('plan.report.groups.group'),
        hideable: false,
        size: 280,
        cell: (g) => (
          <span className="font-medium" style={{ color: optionText(g.color as OptionColor) }}>
            {g.number ? `${g.number} ${g.name}` : g.name}
          </span>
        ),
      },
      { id: 'items', header: t('plan.report.groups.items'), size: 110, align: 'end', cell: (g) => `${g.done}/${g.items}` },
      { id: 'progress', header: t('plan.columns.progress'), size: 200, cell: (g) => <ProgressBar value={g.progress} label={t('plan.groupProgress', { name: g.name })} /> },
      { id: 'estimated', header: t('plan.columns.estimated'), size: 150, align: 'end', cell: (g) => hours(g.estimated) },
      { id: 'actual', header: t('plan.report.effort.actual'), size: 150, align: 'end', cell: (g) => hours(g.actual) },
      { id: 'overdue', header: t('plan.report.summary.overdue'), size: 120, align: 'end', cell: (g) => (g.overdue > 0 ? <span className="font-medium text-danger">{g.overdue}</span> : '0') },
    ],
    // hours/num dependem só do idioma
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale],
  )

  const { summary, schedule, effort } = data
  const deviation = effort.deviation
  return (
    <div className="flex flex-col gap-6">
      <HealthCard data={data} />

      <section aria-labelledby="plan-report-summary" className="flex flex-col gap-3">
        <h2 id="plan-report-summary" className="text-base font-semibold text-fg">
          {t('plan.report.summary.title')}
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <AppStatCard label={t('plan.report.summary.total')} value={summary.total} icon={<Sigma />} hint={summary.canceled ? t('plan.report.summary.canceled', { count: summary.canceled }) : undefined} />
          <AppStatCard label={t('plan.report.summary.done')} value={summary.done} icon={<CheckCircle2 />} tone="success" />
          <AppStatCard label={t('plan.report.summary.open')} value={summary.open} icon={<ListChecks />} />
          <AppStatCard label={t('plan.report.summary.overdue')} value={summary.overdue} icon={<CalendarX />} tone={summary.overdue ? 'danger' : 'default'} />
          <AppStatCard label={t('plan.report.summary.stuck')} value={summary.stuck} icon={<PauseCircle />} tone={summary.stuck ? 'warning' : 'default'} />
          <AppStatCard label={t('plan.columns.progress')} value={`${summary.progress}%`} icon={<TrendingUp />} />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="plan-report-schedule" className="flex flex-col gap-3">
          <h2 id="plan-report-schedule" className="text-base font-semibold text-fg">
            {t('plan.report.schedule.title')}
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <AppStatCard label={t('plan.report.schedule.onTime')} value={schedule.onTime} icon={<CalendarCheck />} tone="success" />
            <AppStatCard label={t('plan.report.schedule.overdue')} value={schedule.overdue} icon={<CalendarX />} tone={schedule.overdue ? 'danger' : 'default'} />
            <AppStatCard label={t('plan.report.schedule.unscheduled')} value={schedule.unscheduled} icon={<CalendarOff />} />
          </div>
        </section>
        <section aria-labelledby="plan-report-effort" className="flex flex-col gap-3">
          <h2 id="plan-report-effort" className="text-base font-semibold text-fg">
            {t('plan.report.effort.title')}
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <AppStatCard label={t('plan.report.effort.estimated')} value={hours(effort.estimated)} icon={<Clock />} />
            <AppStatCard label={t('plan.report.effort.actual')} value={hours(effort.actual)} icon={<Hourglass />} />
            <AppStatCard label={t('plan.report.effort.remaining')} value={hours(effort.remaining)} icon={<Gauge />} />
            <AppStatCard
              label={t('plan.report.effort.deviation')}
              value={deviation ? `${deviation.percent > 0 ? '+' : ''}${deviation.percent}%` : '—'}
              hint={deviation ? t('plan.report.effort.deviationHint', { hours: `${deviation.hours > 0 ? '+' : ''}${num(deviation.hours)}` }) : t('plan.report.effort.noDeviation')}
              icon={<AlertTriangle />}
              tone={deviation && deviation.percent > 10 ? 'warning' : 'default'}
            />
          </div>
        </section>
      </div>

      <section aria-labelledby="plan-report-resources" className="flex flex-col gap-3">
        <h2 id="plan-report-resources" className="text-base font-semibold text-fg">
          {t('plan.report.resources.title')}
        </h2>
        <AppCard className="p-4">
          <AppBarList
            label={t('plan.report.resources.title')}
            items={data.resources.map((r) => ({
              key: r.resourceId ?? 'none',
              label: (
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-surface-3" style={r.color ? { backgroundColor: optionColor(r.color as OptionColor) } : undefined} />
                  <span className="truncate">{r.name ?? t('plan.filters.noResource')}</span>
                </span>
              ),
              detail: t('plan.report.resources.detail', { open: r.open, hours: hours(r.estimated) }),
              value: r.items,
            }))}
            formatValue={(value) => t('plan.report.resources.items', { count: value })}
            empty={t('plan.report.resources.empty')}
          />
        </AppCard>
      </section>

      <section aria-labelledby="plan-report-groups" className="flex flex-col gap-3">
        <h2 id="plan-report-groups" className="text-base font-semibold text-fg">
          {t('plan.report.groups.title')}
        </h2>
        <AppDataTable
          caption={t('plan.report.groups.title')}
          columns={groupColumns}
          data={data.groups}
          total={data.groups.length}
          getRowId={(g) => g.groupId}
          table={table}
          paginated={false}
          searchable={false}
          emptyState={<AppEmptyState compact title={t('plan.report.groups.empty')} />}
        />
      </section>
    </div>
  )
}

/** Saúde do projeto: o nível geral e cada fator com o seu valor (nunca só a nota). */
function HealthCard({ data }: { data: PlanReport }) {
  const { t } = useTranslation()
  const { health } = data
  return (
    <section aria-labelledby="plan-health" className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="plan-health" className="flex items-center gap-2 text-base font-semibold text-fg">
          <HeartPulse className="size-5 text-muted" aria-hidden /> {t('plan.report.health.title')}
        </h2>
        <AppBadge tone={HEALTH_TONE[health.level]} dot className="text-sm">
          {t(`plan.report.health.levels.${health.level}`)}
        </AppBadge>
        <p className="text-xs text-muted">{t('plan.report.health.hint')}</p>
      </div>
      <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {health.factors.map((factor) => (
          <li key={factor.key} className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2 p-3">
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-fg">{t(`plan.report.health.factors.${factor.key}`)}</span>
              <AppBadge tone={HEALTH_TONE[factor.level]}>{t(`plan.report.health.levels.${factor.level}`)}</AppBadge>
            </span>
            <span className="text-xs text-muted">{factorDetail(t, factor)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
