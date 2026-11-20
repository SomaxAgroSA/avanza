import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlarmClock, Bug, CheckCircle2, CircleDot, Hourglass, Inbox, Lock, PlusCircle, Timer, XCircle } from 'lucide-react'
import { formatDateTime, formatDay } from '@/core/utils/format'
import type { BreakdownLabel, Duration, Report, ReportMetric } from '@/domain/reports'
import { AppAvatar, AppStatCard, AppTrendChart } from '@/presentation/components'
import { TaskTypeIconBadge } from '@/features/task-config/config-visuals'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { useDurationText } from './use-duration-text'
import { useMetricText } from './report-metrics'

/** Período considerado — a diretriz exige que fique sempre visível. */
export function PeriodLine({ report, className }: { report: Report; className?: string }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const day = (d: Date) => formatDay(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), lang)
  return (
    <p className={className ?? 'text-sm text-muted'}>
      {t('reports.period', { from: day(report.period.from), to: day(report.period.to) })}
      <span className="text-subtle"> · {t('reports.generatedAt', { at: formatDateTime(report.generatedAt, lang) })}</span>
    </p>
  )
}

/** Rótulo do grupo do recorte (status/prioridade com cor, tipo com ícone, pessoa com avatar). */
export function BreakdownLabelView({ label, emptyKey }: { label: BreakdownLabel | null; emptyKey: string }) {
  const { t } = useTranslation()
  if (!label) return <span className="text-muted">{t(emptyKey)}</span>
  if (label.kind === 'status') return <LookupBadge item={label} />
  if (label.kind === 'priority') return <LookupBadge item={label} />
  if (label.kind === 'type')
    return (
      <span className="inline-flex min-w-0 items-center gap-2">
        <TaskTypeIconBadge icon={label.icon} color={label.color} size="sm" />
        <span className="truncate">{label.name}</span>
      </span>
    )
  if (label.kind === 'assignee')
    return (
      <span className="inline-flex min-w-0 items-center gap-2">
        <AppAvatar name={label.user.name} src={label.user.avatarUrl} size="xs" />
        <span className="truncate">{label.user.name}</span>
      </span>
    )
  // a caixa das demandas internas (§45): só "Demandas internas"
  if (label.demands) return <span className="truncate">{t('demands.internalProject')}</span>
  return (
    <span className="truncate">
      {label.key} · {label.name}
    </span>
  )
}

/** Com `onSelect`, cada card abre as tarefas por trás do número; a dica explica o que entra na conta. */
export type IndicatorSelect = (metric: ReportMetric) => void

function useCardInteraction(report: Report, onSelect?: IndicatorSelect) {
  const { t } = useTranslation()
  const text = useMetricText()
  return (metric: ReportMetric) =>
    onSelect ? { onSelect: () => onSelect(metric), actionLabel: t('reports.drill.action'), tooltip: text.help(metric, report) } : {}
}

/** Indicadores "agora" (situação atual). */
export function CurrentIndicators({ report, compact = false, onSelect }: { report: Report; compact?: boolean; onSelect?: IndicatorSelect }) {
  const { t } = useTranslation()
  const interaction = useCardInteraction(report, onSelect)
  const i = report.indicators
  const critical = report.definitions.criticalPriority?.name ?? '—'
  const cards: Array<{ key: ReportMetric; label: string; value: number; icon: ReactNode; tone?: 'danger' | 'warning'; hint?: string }> = [
    { key: 'open', label: t('reports.indicators.open'), value: i.open, icon: <CircleDot />, hint: t('reports.indicators.openHint', { backlog: i.backlog, todo: i.todo }) },
    { key: 'in_progress', label: t('reports.indicators.inProgress'), value: i.inProgress, icon: <Hourglass /> },
    { key: 'blocked', label: t('reports.indicators.blocked'), value: i.blocked, icon: <Lock />, tone: i.blocked ? ('danger' as const) : undefined },
    { key: 'overdue', label: t('reports.indicators.overdue'), value: i.overdue, icon: <AlarmClock />, tone: i.overdue ? ('danger' as const) : undefined },
    {
      key: 'critical_bugs',
      label: t('reports.indicators.criticalBugs'),
      value: i.criticalBugs,
      icon: <Bug />,
      tone: i.criticalBugs ? ('warning' as const) : undefined,
      hint: t('reports.indicators.criticalBugsHint', { priority: critical }),
    },
    ...(compact ? [] : [{ key: 'backlog' as const, label: t('reports.indicators.backlog'), value: i.backlog, icon: <Inbox /> }]),
  ]
  return (
    // a grade acompanha a quantidade de cards (5 no dashboard, 6 nos relatórios): sem sobras
    <div className={compact ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5' : 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6'}>
      {cards.map((c) => (
        <AppStatCard key={c.key} label={c.label} value={c.value} icon={c.icon} tone={c.tone} hint={c.hint ?? t('reports.now')} {...interaction(c.key)} />
      ))}
    </div>
  )
}

/** Indicadores do período (criadas, concluídas, tempos médios). */
export function PeriodIndicators({ report, onSelect }: { report: Report; onSelect?: IndicatorSelect }) {
  const { t } = useTranslation()
  const duration = useDurationText()
  const interaction = useCardInteraction(report, onSelect)
  const i = report.indicators
  const sample = (d: Duration) => (d.count ? t('reports.sample', { count: d.count }) : t('reports.noSample'))
  const cards: Array<{ key: ReportMetric; label: string; value: ReactNode; icon: ReactNode; tone?: 'success'; hint: string }> = [
    { key: 'created', label: t('reports.indicators.created'), value: i.created, icon: <PlusCircle />, hint: t('reports.inPeriod') },
    { key: 'completed', label: t('reports.indicators.completed'), value: i.completed, icon: <CheckCircle2 />, tone: 'success' as const, hint: t('reports.inPeriod') },
    { key: 'cancelled', label: t('reports.indicators.cancelled'), value: i.cancelled, icon: <XCircle />, hint: t('reports.inPeriod') },
    { key: 'lead_time', label: t('reports.indicators.leadTime'), value: duration(i.leadTime), icon: <Timer />, hint: sample(i.leadTime) },
    { key: 'cycle_time', label: t('reports.indicators.cycleTime'), value: duration(i.cycleTime), icon: <Timer />, hint: sample(i.cycleTime) },
    { key: 'bug_resolution', label: t('reports.indicators.bugResolution'), value: duration(i.bugResolution), icon: <Bug />, hint: sample(i.bugResolution) },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {cards.map((c) => (
        <AppStatCard key={c.key} label={c.label} value={c.value} icon={c.icon} tone={c.tone} hint={c.hint} {...interaction(c.key)} />
      ))}
    </div>
  )
}

/** Criadas × concluídas ao longo do período. */
export function TrendChart({ report }: { report: Report }) {
  const { t, i18n } = useTranslation()
  const short = new Intl.DateTimeFormat(i18n.language, { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
  const points = report.series.points.map((p) => ({ key: p.date, label: short.format(new Date(`${p.date}T00:00:00Z`)), a: p.created, b: p.completed }))
  return (
    <AppTrendChart
      points={points}
      seriesA={t('reports.indicators.created')}
      seriesB={t('reports.indicators.completed')}
      title={t(report.series.bucket === 'week' ? 'reports.trendWeekly' : 'reports.trendDaily')}
    />
  )
}
