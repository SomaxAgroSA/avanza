import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, ChevronRight, HeartPulse } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { cn } from '@/core/utils/cn'
import { formatNumber } from '@/domain/plan'
import type { HealthFactorKey, PlanReport, PlanReportItem, PlanReportScope } from '@/domain/plan-management'
import { AppBadge, AppButton, AppErrorState, AppSegmentedControl } from '@/presentation/components'
import { ProgressBar } from './cells'
import { factorDetail, factorShort, HEALTH_TONE } from './health-visuals'
import { managementLink } from './paths'
import { usePlanReport } from './queries'

/**
 * Saúde do projeto na visão geral (GP-4 — diretriz §16): o nível geral (o pior dos fatores, sempre com
 * cada fator e o seu valor) e o resumo de progresso, cronograma e esforço do quadro de gestão. Os
 * números vêm do servidor (backend/src/domain/plan-report.js), com "hoje" no fuso de quem consulta.
 * Só aparece quando o projeto tem quadro com elementos. Projeto principal com subprojetos (`family`): por
 * padrão soma os subprojetos que a pessoa vê, com a opção "Só este projeto". Cada fator é um botão que abre
 * a lista do que está por trás do número (com o enlace para o elemento na Gestão do seu projeto).
 */
export function ProjectHealth({ projectId, family = false }: { projectId: string; family?: boolean }) {
  const { t } = useTranslation()
  const [scope, setScope] = useState<PlanReportScope>(family ? 'family' : 'project')
  const report = usePlanReport(projectId, family ? scope : 'project')
  if (report.isPending) return null
  if (report.isError) {
    // sem acesso ao quadro: a visão geral segue sem o bloco
    if (isAppError(report.error) && (report.error.code === 'FORBIDDEN' || report.error.code === 'PROJECT_NOT_FOUND')) return null
    return <AppErrorState title={t('plan.report.loadError')} correlationId={isAppError(report.error) ? report.error.correlationId : undefined} onRetry={() => void report.refetch()} />
  }
  if (report.data.summary.total === 0 && report.data.scope.mode !== 'family') return null
  return <HealthCard data={report.data} projectId={projectId} family={family} scope={scope} onScopeChange={setScope} />
}

/** Lista que cada fator abre (as chaves de `details`). */
const FACTOR_DETAILS: Record<HealthFactorKey, 'overdue' | 'behind' | 'stuck' | 'overEffort' | 'issues'> = {
  schedule: 'overdue',
  progress: 'behind',
  stuck: 'stuck',
  effort: 'overEffort',
  issues: 'issues',
}

function HealthCard({
  data,
  projectId,
  family,
  scope,
  onScopeChange,
}: {
  data: PlanReport
  projectId: string
  family: boolean
  scope: PlanReportScope
  onScopeChange: (scope: PlanReportScope) => void
}) {
  const { t, i18n } = useTranslation()
  const { health, summary, schedule, effort } = data
  const [open, setOpen] = useState<HealthFactorKey | null>(null)
  const countOf = (key: HealthFactorKey) => data.details[FACTOR_DETAILS[key]].length
  const num = (value: number | null) => formatNumber(value, i18n.language) ?? '—'
  const hours = (value: number | null) => (value === null ? '—' : t('plan.report.hours', { value: num(value) }))
  const deviation = effort.deviation
  return (
    <section aria-labelledby="plan-health" className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="plan-health" className="flex items-center gap-2 text-base font-semibold text-fg">
          <HeartPulse className="size-5 text-muted" aria-hidden /> {t('plan.report.health.title')}
        </h2>
        <AppBadge tone={HEALTH_TONE[health.level]} dot className="text-sm" title={t('plan.report.health.hint')}>
          {t(`plan.report.health.levels.${health.level}`)}
        </AppBadge>
        {family && (
          <AppSegmentedControl
            size="sm"
            label={t('plan.report.scope.label')}
            value={scope}
            onValueChange={(value) => onScopeChange(value)}
            options={[
              { value: 'family', label: t('plan.report.scope.family', { count: data.scope.mode === 'family' ? data.scope.projects.length : undefined }) },
              { value: 'project', label: t('plan.report.scope.project') },
            ]}
          />
        )}
        <span className="flex-1" />
        <AppButton asChild variant="ghost" size="sm">
          <Link to={managementLink(projectId)}>
            {t('management.open')} <ArrowRight aria-hidden />
          </Link>
        </AppButton>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {health.factors.map((factor) => {
          const count = countOf(factor.key)
          const selected = open === factor.key
          return (
            <li key={factor.key} className="flex">
              {/* o fator é um botão: abre a lista do que está por trás do número */}
              <button
                type="button"
                aria-expanded={selected}
                aria-controls="plan-health-details"
                disabled={count === 0}
                title={factorDetail(t, factor)}
                onClick={() => setOpen(selected ? null : factor.key)}
                data-testid={`health-factor-${factor.key}`}
                className={cn(
                  'flex w-full flex-col gap-1 rounded-lg border border-border bg-surface-2 p-3 text-left transition',
                  count > 0 && 'hover:-translate-y-px hover:border-primary hover:bg-surface hover:shadow-card focus-visible:outline-2 focus-visible:outline-primary',
                  selected && 'border-primary bg-surface shadow-card',
                  count === 0 && 'cursor-default',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-fg">{t(`plan.report.health.factors.${factor.key}`)}</span>
                  <AppBadge tone={HEALTH_TONE[factor.level]}>{t(`plan.report.health.levels.${factor.level}`)}</AppBadge>
                </span>
                <span className="text-sm font-semibold tabular-nums text-fg">{factorShort(t, factor)}</span>
                <span className={cn('mt-auto flex items-center gap-1 pt-1 text-xs font-medium', count > 0 ? 'text-primary-text' : 'text-subtle')}>
                  {count > 0 ? t(`plan.report.details.open.${factor.key}`, { count }) : t('plan.report.details.nothing')}
                  {count > 0 && <ChevronRight className={cn('size-3.5 transition-transform', selected && 'rotate-90')} aria-hidden />}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {open && <FactorDetails factor={open} data={data} />}
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
      {data.scope.mode === 'family' && data.scope.projects.length > 1 && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted" data-testid="health-scope">
          {t('plan.report.scope.includes')}
          {data.scope.projects.map((p) => (
            <span key={p.id} className="rounded-full border border-border bg-surface px-2 py-0.5 text-fg" title={p.name}>
              <span className="font-mono">{p.key}</span> · {t('plan.report.scope.items', { count: p.items })}
            </span>
          ))}
        </p>
      )}
    </section>
  )
}

/** O que está por trás de um fator: elementos (com o projeto de cada um) ou problemas em aberto. */
function FactorDetails({ factor, data }: { factor: HealthFactorKey; data: PlanReport }) {
  const { t, i18n } = useTranslation()
  const day = (value: string | null) => (value ? new Date(`${value}T12:00:00Z`).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
  const key = FACTOR_DETAILS[factor]
  return (
    <section id="plan-health-details" aria-live="polite" className="mt-3 rounded-lg border border-primary bg-surface p-3 shadow-card" data-testid="health-details">
      <h3 className="text-sm font-semibold text-fg">{t(`plan.report.details.title.${factor}`, { count: data.details[key].length })}</h3>
      <ul className="mt-2 divide-y divide-border">
        {key === 'issues'
          ? data.details.issues.map((issue) => (
              <li key={issue.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="shrink-0 rounded bg-surface-2 px-1.5 font-mono text-xs text-muted">{issue.project.key}</span>
                <span className="min-w-0 flex-1 truncate text-fg">#{issue.number} · {issue.description}</span>
                <span className="shrink-0 text-xs text-muted">{t(`plan.management.issues.states.${issue.state}`, { defaultValue: issue.state })}</span>
                <Link to={managementLink(issue.project.id, { view: 'management' })} className="shrink-0 text-xs font-medium text-primary-text hover:underline">
                  {t('plan.report.details.openItem')}
                </Link>
              </li>
            ))
          : data.details[key].map((item: PlanReportItem) => (
              <li key={item.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="shrink-0 rounded bg-surface-2 px-1.5 font-mono text-xs text-muted" title={item.project.name}>
                  {item.project.key}
                </span>
                <span className="min-w-0 flex-1 truncate text-fg">{item.name}</span>
                {item.status && <span className="hidden shrink-0 text-xs text-muted sm:inline">{item.status.name}</span>}
                <span className="shrink-0 text-xs tabular-nums text-muted">{factor === 'progress' ? `${item.progress}%` : day(item.endDate)}</span>
                <Link to={managementLink(item.project.id, { item: item.id })} className="shrink-0 text-xs font-medium text-primary-text hover:underline">
                  {t('plan.report.details.openItem')}
                </Link>
              </li>
            ))}
      </ul>
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
