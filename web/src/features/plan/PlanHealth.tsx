import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, HeartPulse } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { cn } from '@/core/utils/cn'
import { formatNumber } from '@/domain/plan'
import type { PlanReport } from '@/domain/plan-management'
import { AppBadge, AppButton, AppErrorState } from '@/presentation/components'
import { ProgressBar } from './cells'
import { factorDetail, HEALTH_TONE } from './health-visuals'
import { managementLink } from './paths'
import { usePlanReport } from './queries'

/**
 * Saúde do projeto na visão geral (GP-4 — diretriz §16): o nível geral (o pior dos fatores, sempre com
 * cada fator e o seu valor) e o resumo de progresso, cronograma e esforço do quadro de gestão. Os
 * números vêm do servidor (backend/src/domain/plan-report.js), com "hoje" no fuso de quem consulta.
 * Só aparece quando o projeto tem quadro com elementos.
 */
export function ProjectHealth({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const report = usePlanReport(projectId)
  if (report.isPending) return null
  if (report.isError) {
    // sem acesso ao quadro: a visão geral segue sem o bloco
    if (isAppError(report.error) && (report.error.code === 'FORBIDDEN' || report.error.code === 'PROJECT_NOT_FOUND')) return null
    return <AppErrorState title={t('plan.report.loadError')} correlationId={isAppError(report.error) ? report.error.correlationId : undefined} onRetry={() => void report.refetch()} />
  }
  if (report.data.summary.total === 0) return null
  return <HealthCard data={report.data} projectId={projectId} />
}

function HealthCard({ data, projectId }: { data: PlanReport; projectId: string }) {
  const { t, i18n } = useTranslation()
  const { health, summary, schedule, effort } = data
  const num = (value: number | null) => formatNumber(value, i18n.language) ?? '—'
  const hours = (value: number | null) => (value === null ? '—' : t('plan.report.hours', { value: num(value) }))
  const deviation = effort.deviation
  return (
    <section aria-labelledby="plan-health" className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="plan-health" className="flex items-center gap-2 text-base font-semibold text-fg">
          <HeartPulse className="size-5 text-muted" aria-hidden /> {t('plan.report.health.title')}
        </h2>
        <AppBadge tone={HEALTH_TONE[health.level]} dot className="text-sm">
          {t(`plan.report.health.levels.${health.level}`)}
        </AppBadge>
        <p className="min-w-0 flex-1 basis-48 text-xs text-muted">{t('plan.report.health.hint')}</p>
        <AppButton asChild variant="ghost" size="sm">
          <Link to={managementLink(projectId)}>
            {t('management.open')} <ArrowRight aria-hidden />
          </Link>
        </AppButton>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
      <div className="mt-4 grid gap-4 border-t border-border pt-4 md:grid-cols-3">
        <Metrics id="plan-health-summary" title={t('plan.report.summary.title')}>
          <ProgressBar value={summary.progress} label={t('plan.columns.progress')} className="mb-1" />
          <Metric label={t('plan.report.summary.done')} value={`${summary.done}/${summary.total}`} />
          <Metric label={t('plan.report.summary.overdue')} value={summary.overdue} tone={summary.overdue ? 'danger' : undefined} />
          <Metric label={t('plan.report.summary.stuck')} value={summary.stuck} tone={summary.stuck ? 'warning' : undefined} />
        </Metrics>
        <Metrics id="plan-health-schedule" title={t('plan.report.schedule.title')}>
          <Metric label={t('plan.report.schedule.onTime')} value={schedule.onTime} />
          <Metric label={t('plan.report.schedule.overdue')} value={schedule.overdue} tone={schedule.overdue ? 'danger' : undefined} />
          <Metric label={t('plan.report.schedule.unscheduled')} value={schedule.unscheduled} />
        </Metrics>
        <Metrics id="plan-health-effort" title={t('plan.report.effort.title')}>
          <Metric label={t('plan.report.effort.estimated')} value={hours(effort.estimated)} />
          <Metric label={t('plan.report.effort.actual')} value={hours(effort.actual)} />
          <Metric label={t('plan.report.effort.remaining')} value={hours(effort.remaining)} />
          <Metric
            label={t('plan.report.effort.deviation')}
            value={deviation ? `${deviation.percent > 0 ? '+' : ''}${deviation.percent}%` : '—'}
            hint={deviation ? t('plan.report.effort.deviationHint', { hours: `${deviation.hours > 0 ? '+' : ''}${num(deviation.hours)}` }) : t('plan.report.effort.noDeviation')}
            tone={deviation && deviation.percent > 10 ? 'warning' : undefined}
          />
        </Metrics>
      </div>
    </section>
  )
}

function Metrics({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-1.5">
      <h3 id={id} className="text-xs font-medium uppercase tracking-wide text-muted">
        {title}
      </h3>
      <dl className="flex flex-col gap-1">{children}</dl>
    </section>
  )
}

const METRIC_TONES = { danger: 'text-danger', warning: 'text-warning' } as const

function Metric({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: keyof typeof METRIC_TONES }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm" title={hint}>
      <dt className="min-w-0 truncate text-muted">{label}</dt>
      <dd className={cn('shrink-0 font-medium tabular-nums text-fg', tone && METRIC_TONES[tone])}>{value}</dd>
    </div>
  )
}
