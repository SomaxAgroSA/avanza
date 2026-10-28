import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { periodRange, type ReportMetric, type ReportQuery } from '@/domain/reports'
import { AppCard, AppErrorState, AppSkeleton, AppStatCard } from '@/presentation/components'
import { useReport } from './queries'
import { CurrentIndicators, PeriodLine, TrendChart } from './report-visuals'
import { IndicatorTasksDrawer } from './IndicatorTasksDrawer'
import { useMetricText } from './report-metrics'
import { useDurationText } from './use-duration-text'

/** Indicadores do dashboard: situação atual + últimos 30 dias (período sempre visível). */
export function DashboardIndicators() {
  const { t } = useTranslation()
  const duration = useDurationText()
  const [now] = useState(() => new Date())
  const [query] = useState<ReportQuery | null>(() => {
    const range = periodRange('30d', now)
    return range ? { ...range, tzOffset: now.getTimezoneOffset(), groupBy: 'status' } : null
  })
  const report = useReport(query)
  const data = report.data
  const [metric, setMetric] = useState<ReportMetric | null>(null)
  const text = useMetricText()
  // cards do período: clicáveis como os da situação atual
  const drill = (key: ReportMetric) => (data ? { onSelect: () => setMetric(key), actionLabel: t('reports.drill.action'), tooltip: text.help(key, data) } : {})

  return (
    <AppCard
      title={t('dashboard.indicators')}
      actions={
        <Link to="/reports" className="inline-flex items-center gap-1 text-sm text-primary-text hover:underline">
          {t('dashboard.seeReports')} <ArrowRight className="size-4" aria-hidden />
        </Link>
      }
    >
      {report.isPending ? (
        <AppSkeleton className="h-40" />
      ) : report.isError || !data ? (
        <AppErrorState correlationId={isAppError(report.error) ? report.error.correlationId : undefined} onRetry={() => void report.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <PeriodLine report={data} className="text-xs text-muted" />
          <CurrentIndicators report={data} compact onSelect={setMetric} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <AppStatCard label={t('reports.indicators.created')} value={data.indicators.created} hint={t('reports.last30')} {...drill('created')} />
            <AppStatCard label={t('reports.indicators.completed')} value={data.indicators.completed} tone="success" hint={t('reports.last30')} {...drill('completed')} />
            <AppStatCard
              label={t('reports.indicators.leadTime')}
              value={duration(data.indicators.leadTime)}
              hint={data.indicators.leadTime.count ? t('reports.sample', { count: data.indicators.leadTime.count }) : t('reports.noSample')}
              {...drill('lead_time')}
            />
          </div>
          <TrendChart report={data} />
        </div>
      )}
      <IndicatorTasksDrawer query={query} report={data} metric={metric} onOpenChange={(open) => !open && setMetric(null)} />
    </AppCard>
  )
}
