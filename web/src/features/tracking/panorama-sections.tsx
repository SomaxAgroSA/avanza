/**
 * Blocos do Panorama executivo (regras de negócio §26.1): síntese para a direção, indicadores, saúde
 * do portfólio, execução × planejamento, projetos que requerem atenção, próximos marcos e o resumo
 * do projeto. Todos recebem os números já recortados pelos mesmos filtros (domain/tracking.ts).
 */
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AlertCircle, AlertTriangle, ArrowRight, Ban, CalendarClock, CheckCircle2, CircleDashed, FolderKanban, TrendingUp } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { ExecutiveDashboard, PortfolioRow } from '@/domain/executive'
import {
  causesOf,
  deliveryBuckets,
  isLateProject,
  lateDays,
  panoramaMilestones,
  planProgress,
  situationOf,
  type PanoramaFilter,
  type PanoramaKpis,
  type PanoramaSynthesis,
  type TrackingSituation,
} from '@/domain/tracking'
import { AppButton, AppChartTooltip, AppDonut, AppDrawer, chartToneBg, type AppChartTone } from '@/presentation/components'
import { ProjectKey } from '@/features/executive/executive-visuals'
import { useDayText, useHealthReason } from '@/features/executive/use-executive-format'
import { TABLE_ID, scrollToTable } from './panorama-scroll'


const MINUS = '−'
const dayCount = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000)
const signed = (value: number) => (value > 0 ? `+${value}` : value < 0 ? `${MINUS}${Math.abs(value)}` : '0')

/* ------------------------------------------------------------------ situação (sempre com texto e ícone) */

const SITUATION_TONE: Record<TrackingSituation, AppChartTone> = { risk: 'danger', watch: 'warning', ok: 'success', none: 'neutral' }
const SITUATION_PILL: Record<TrackingSituation, string> = {
  risk: 'bg-danger-soft text-danger-soft-fg',
  watch: 'bg-warning-soft text-warning-soft-fg',
  ok: 'bg-success-soft text-success-soft-fg',
  none: 'bg-surface-3 text-muted',
}
const SITUATION_ICON: Record<TrackingSituation, typeof AlertTriangle> = { risk: AlertTriangle, watch: AlertCircle, ok: CheckCircle2, none: CircleDashed }
const SITUATIONS: TrackingSituation[] = ['ok', 'watch', 'risk', 'none']

export function SituationPill({ situation }: { situation: TrackingSituation }) {
  const { t } = useTranslation()
  const Icon = SITUATION_ICON[situation]
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', SITUATION_PILL[situation])}>
      <Icon className="size-3.5" aria-hidden />
      {t(`tracking.situation.${situation}`)}
    </span>
  )
}

/** Causa em uma linha: o motivo da saúde, a data vencida, bloqueios, vencidas, pausado. */
function useCauseText() {
  const { t } = useTranslation()
  const healthReason = useHealthReason()
  return (row: PortfolioRow, today: string): string => {
    const parts = causesOf(row, today).map((cause) => {
      if (cause.kind === 'health') return healthReason(row.health) ?? t(`tracking.situation.${cause.level === 'critical' ? 'risk' : 'watch'}`)
      if (cause.kind === 'late') return t('tracking.causes.late', { count: cause.days })
      if (cause.kind === 'blocked') return t('tracking.causes.blocked', { count: cause.count })
      if (cause.kind === 'overdueTasks') return t('tracking.causes.overdueTasks', { count: cause.count })
      return t('tracking.causes.paused')
    })
    if (!parts.length) return row.health.level === 'none' ? t('tracking.causes.noPlan') : t('tracking.causes.fine')
    return parts.slice(0, 3).join(' · ')
  }
}

/** Real × planejado: barra com o real e a marca do planejado. */
function ProgressBar({ real, planned, className }: { real: number; planned: number; className?: string }) {
  const clamp = (v: number) => Math.max(0, Math.min(100, v))
  return (
    <span aria-hidden className={cn('relative block h-1.5 flex-1 rounded-full bg-surface-3', className)}>
      <span className="block h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${clamp(real)}%` }} />
      <span className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-fg" style={{ left: `calc(${clamp(planned)}% - 1px)` }} />
    </span>
  )
}

/* ------------------------------------------------------------------ síntese */

const SYNTHESIS_BG = 'radial-gradient(120% 140% at 85% 20%, oklch(0.36 0.08 158), oklch(0.39 0.1 153) 45%, oklch(0.32 0.075 156))'

export function SynthesisCard({ synthesis }: { synthesis: PanoramaSynthesis }) {
  const { t } = useTranslation()
  const facts = synthesis.headline.map((fact) => t(`tracking.synthesis.facts.${fact.kind}`, { count: fact.count }))
  const title =
    facts.length === 0
      ? t('tracking.synthesis.allGood')
      : facts.length === 1
        ? t('tracking.synthesis.one', { first: facts[0] })
        : t('tracking.synthesis.two', { first: facts[0], second: facts[1] })
  const support = [
    t('tracking.synthesis.ok', { ok: synthesis.ok, count: synthesis.total }),
    synthesis.overdueTasks ? t('tracking.synthesis.overdueTasks', { count: synthesis.overdueTasks }) : null,
    t('tracking.synthesis.deliveries', { count: synthesis.deliveries }),
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <section aria-labelledby="panorama-synthesis" className="rounded-3xl px-6 py-7 text-on-cover shadow-card sm:px-8" style={{ background: SYNTHESIS_BG }}>
      <span className="inline-block rounded-full border border-on-cover/40 px-3 py-0.5 text-xs font-semibold uppercase tracking-wider">{t('tracking.synthesis.eyebrow')}</span>
      <h2 id="panorama-synthesis" className="mt-3 max-w-4xl font-display text-2xl font-semibold leading-tight sm:text-3xl">
        {title}
      </h2>
      <p className="mt-2 max-w-4xl text-base text-on-cover-muted">
        {support}.{' '}
        {synthesis.priority && <strong className="font-semibold text-on-cover">{t('tracking.synthesis.priority', { text: t(`tracking.synthesis.priorities.${synthesis.priority}`) })}</strong>}
      </p>
      <button
        type="button"
        onClick={scrollToTable}
        className="mt-4 inline-flex items-center gap-1 border-b-2 border-on-cover pb-0.5 text-sm font-semibold text-on-cover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-on-cover print:hidden"
      >
        {t('tracking.synthesis.link')} <ArrowRight className="size-4" aria-hidden />
      </button>
    </section>
  )
}

/* ------------------------------------------------------------------ indicadores */

function KpiCard({
  icon,
  title,
  value,
  valueClassName,
  sub,
  how,
  onSelect,
  active,
}: {
  icon: ReactNode
  title: string
  value: ReactNode
  valueClassName?: string
  sub: ReactNode
  how: string
  onSelect?: () => void
  active?: boolean
}) {
  const { t } = useTranslation()
  const body = (
    <>
      <span className="flex items-start justify-between gap-2 text-sm font-medium text-muted">
        {title}
        <span className="shrink-0 text-subtle [&_svg]:size-4" aria-hidden>
          {icon}
        </span>
      </span>
      <span className={cn('font-display text-3xl font-semibold leading-tight tabular-nums text-fg', valueClassName)}>{value}</span>
      <span className="text-sm text-muted">{sub}</span>
      <span className="mt-auto border-t border-dashed border-border pt-2 text-xs text-subtle">{how}</span>
      {onSelect && (
        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-primary-text opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none print:hidden">
          {t('tracking.kpi.action')} <ArrowRight className="size-3.5" aria-hidden />
        </span>
      )}
    </>
  )
  const base = 'flex min-w-0 flex-col gap-1.5 rounded-2xl border bg-surface p-4 text-left shadow-card'
  if (!onSelect) return <div className={cn(base, 'border-border')}>{body}</div>
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        base,
        'group cursor-pointer transition-colors hover:border-primary/40 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none',
        active ? 'border-primary' : 'border-border',
      )}
    >
      {body}
    </button>
  )
}

export function KpiRow({ kpis, filter, onFilter }: { kpis: PanoramaKpis; filter: PanoramaFilter; onFilter: (filter: PanoramaFilter) => void }) {
  const { t } = useTranslation()
  const progress = kpis.progress
  return (
    <section aria-label={t('tracking.kpi.label')} className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
      <KpiCard
        icon={<FolderKanban />}
        title={t('tracking.kpi.supervised.title')}
        value={kpis.supervised.total}
        sub={kpis.supervised.byStatus.map((s) => `${t(`projects.status.${s.status}`)} ${s.count}`).join(' · ')}
        how={t('tracking.kpi.supervised.how')}
        onSelect={() => onFilter('all')}
        active={filter === 'all'}
      />
      <KpiCard
        icon={<TrendingUp />}
        title={t('tracking.kpi.progress.title')}
        value={progress.real === null ? t('tracking.kpi.progress.noData') : `${progress.real} %`}
        valueClassName={progress.real === null ? 'text-xl text-muted' : undefined}
        sub={
          progress.planned !== null && progress.gap !== null ? (
            <>
              {t('tracking.kpi.progress.planned', { value: progress.planned })} ·{' '}
              <strong className={cn('font-semibold', progress.gap < 0 ? 'text-danger-soft-fg' : 'text-success-soft-fg')}>{t('tracking.kpi.progress.gap', { value: signed(progress.gap) })}</strong>
            </>
          ) : (
            '—'
          )
        }
        how={t('tracking.kpi.progress.how', { withPlan: progress.withPlan, count: progress.total })}
      />
      <KpiCard
        icon={<AlertTriangle />}
        title={t('tracking.kpi.risk.title')}
        value={kpis.risk.critical}
        valueClassName={kpis.risk.critical ? 'text-danger' : undefined}
        sub={
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full bg-warning" />
            {t('tracking.kpi.risk.attention', { count: kpis.risk.attention })}
          </span>
        }
        how={t('tracking.kpi.risk.how')}
        onSelect={() => onFilter('risk')}
        active={filter === 'risk'}
      />
      <KpiCard
        icon={<Ban />}
        title={t('tracking.kpi.blocked.title')}
        value={kpis.blocked.projects}
        valueClassName={kpis.blocked.projects ? 'text-warning-soft-fg' : undefined}
        sub={t('tracking.kpi.blocked.tasks', { count: kpis.blocked.tasks })}
        how={t('tracking.kpi.blocked.how')}
        onSelect={() => onFilter('blocked')}
        active={filter === 'blocked'}
      />
      <KpiCard
        icon={<CalendarClock />}
        title={t('tracking.kpi.overdue.title')}
        value={kpis.overdue.tasks}
        sub={t('tracking.kpi.overdue.late', { count: kpis.overdue.lateProjects })}
        how={t('tracking.kpi.overdue.how')}
        onSelect={() => onFilter('overdue')}
        active={filter === 'overdue'}
      />
    </section>
  )
}

/* ------------------------------------------------------------------ saúde do portfólio */

export function HealthCard({ kpis, filter, onFilter }: { kpis: PanoramaKpis; filter: PanoramaFilter; onFilter: (filter: PanoramaFilter) => void }) {
  const { t } = useTranslation()
  const counts: Record<TrackingSituation, number> = { ok: kpis.health.ok, watch: kpis.health.attention, risk: kpis.health.critical, none: kpis.health.none }
  const segments = SITUATIONS.map((s) => ({ key: s, label: t(`tracking.situation.${s}`), value: counts[s], tone: SITUATION_TONE[s] }))
  const active = (SITUATIONS as string[]).includes(filter) ? filter : null
  const toggle = (situation: TrackingSituation) => {
    onFilter(filter === situation ? 'attention' : situation)
    scrollToTable()
  }
  return (
    <section aria-labelledby="panorama-health" className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="panorama-health" className="font-display text-lg font-semibold text-fg">
          {t('tracking.health.title')}
        </h2>
        <button
          type="button"
          className="text-sm font-semibold text-primary-text hover:underline print:hidden"
          onClick={() => {
            onFilter('all')
            scrollToTable()
          }}
        >
          {t('tracking.health.all')}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-5">
        <AppDonut className="size-36" label={t('tracking.health.title')} segments={segments} thickness={14} activeKey={active} onSegmentClick={(key) => toggle(key as TrackingSituation)}>
          <span className="font-display text-3xl font-semibold leading-none tabular-nums text-fg">{kpis.supervised.total}</span>
          <span className="mt-1 text-xs text-muted">{t('tracking.health.center', { count: kpis.supervised.total })}</span>
        </AppDonut>
        <ul className="flex min-w-44 flex-1 flex-col gap-0.5">
          {segments.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                aria-pressed={active === s.key}
                aria-label={t('tracking.health.filter', { label: s.label, count: s.value })}
                onClick={() => toggle(s.key)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-fg transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none',
                  active === s.key && 'bg-surface-2 font-semibold',
                )}
              >
                <span aria-hidden className={cn('size-2.5 rounded-full', chartToneBg(s.tone))} />
                {s.label}
                <span className="ml-auto font-semibold tabular-nums">{s.value}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ execução × planejamento */

export function ExecutionCard({ kpis, data }: { kpis: PanoramaKpis; data: ExecutiveDashboard }) {
  const { t, i18n } = useTranslation()
  const progress = kpis.progress
  const buckets = deliveryBuckets(data.timeline.points, data.achievements)
  const withMilestones = buckets.some((b) => b.milestones > 0)
  const tasks = buckets.reduce((sum, b) => sum + b.tasks, 0)
  const milestones = buckets.reduce((sum, b) => sum + b.milestones, 0)
  const max = Math.max(1, ...buckets.map((b) => b.tasks))
  const monthly = data.timeline.bucket === 'month'
  const short = new Intl.DateTimeFormat(i18n.language, monthly ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const label = (start: string) => short.format(new Date(`${start}T00:00:00Z`))
  const bucketTitle = (start: string) => (monthly ? t('tracking.execution.monthOf', { date: label(start) }) : t('tracking.execution.weekOf', { date: label(start) }))
  return (
    <section aria-labelledby="panorama-execution" className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="panorama-execution" className="font-display text-lg font-semibold text-fg">
          {t('tracking.execution.title')}
        </h2>
        {progress.gap !== null && (
          <span className={cn('whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', progress.gap < 0 ? 'bg-danger-soft text-danger-soft-fg' : 'bg-success-soft text-success-soft-fg')}>
            {t('tracking.execution.gap')} {t('tracking.execution.gapValue', { value: signed(progress.gap) })}
          </span>
        )}
      </div>
      {progress.real === null || progress.planned === null ? (
        <p className="mb-2 text-sm text-muted">{t('tracking.execution.noPlan')}</p>
      ) : (
        <>
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">{t('tracking.execution.real')}</dt>
            <dd className="flex items-center">
              <ProgressBar real={progress.real} planned={progress.planned} className="h-2.5" />
            </dd>
            <dd className="text-right font-semibold tabular-nums text-fg">{progress.real} %</dd>
            <dt className="text-muted">{t('tracking.execution.planned')}</dt>
            <dd className="flex items-center">
              <span aria-hidden className="block h-2.5 flex-1 rounded-full bg-surface-3">
                <span className="block h-full rounded-full bg-border-strong" style={{ width: `${Math.max(0, Math.min(100, progress.planned))}%` }} />
              </span>
            </dd>
            <dd className="text-right font-semibold tabular-nums text-fg">{progress.planned} %</dd>
          </dl>
        </>
      )}

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{monthly ? t('tracking.execution.month') : t('tracking.execution.week')}</h3>
        <span className="text-xs text-muted">
          {t('tracking.execution.tasks', { count: tasks })}
          {withMilestones && ` · ◆ ${t('tracking.execution.milestones', { count: milestones })}`}
        </span>
      </div>
      {tasks === 0 && !withMilestones ? (
        <p className="text-sm text-muted">{t('tracking.execution.noDeliveries')}</p>
      ) : (
        <figure className="relative mt-2">
          <div className={cn('flex h-28 items-end gap-1 border-b border-border', withMilestones && 'pt-4')} aria-hidden>
            {buckets.map((b, i) => (
              <div key={b.start} className="group relative flex h-full min-w-1.5 flex-1 items-end justify-center">
                <span
                  className="w-full max-w-7 rounded-t bg-primary transition-[height,background-color] duration-500 group-hover:bg-primary-hover motion-reduce:transition-none"
                  style={{ height: `${(b.tasks / max) * 100}%`, minHeight: b.tasks ? 2 : 0 }}
                />
                {withMilestones && b.milestones > 0 && <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[10px] leading-none text-fg">◆</span>}
                <AppChartTooltip
                  className={cn('-top-2 hidden -translate-y-full group-hover:flex', i < buckets.length / 3 ? 'left-0' : i > (buckets.length * 2) / 3 ? 'right-0' : 'left-1/2 -translate-x-1/2')}
                  title={bucketTitle(b.start)}
                  rows={[
                    { key: 'tasks', label: t('tracking.execution.tasksLabel'), value: b.tasks, tone: 'primary' as const },
                    ...(withMilestones ? [{ key: 'milestones', label: t('tracking.execution.milestonesLabel'), value: b.milestones }] : []),
                  ]}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-subtle" aria-hidden>
            <span>{buckets[0] ? label(buckets[0].start) : ''}</span>
            <span>{buckets.length > 1 ? label(buckets[buckets.length - 1]!.start) : ''}</span>
          </div>
          <div className="sr-only">
            <table>
              <caption>{t('tracking.execution.chart')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('tracking.execution.period')}</th>
                  <th scope="col">{t('tracking.execution.tasksLabel')}</th>
                  {withMilestones && <th scope="col">{t('tracking.execution.milestonesLabel')}</th>}
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.start}>
                    <th scope="row">{bucketTitle(b.start)}</th>
                    <td>{b.tasks}</td>
                    {withMilestones && <td>{b.milestones}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </figure>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ projetos que requerem atenção */

const TH = 'whitespace-nowrap border-b border-border px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted'
const TD = 'border-b border-border px-3 py-3 align-middle'

export function AttentionTable({
  rows,
  filter,
  today,
  onClear,
  onOpen,
}: {
  rows: PortfolioRow[]
  filter: PanoramaFilter
  today: string
  onClear: () => void
  onOpen: (row: PortfolioRow) => void
}) {
  const { t } = useTranslation()
  const day = useDayText()
  const cause = useCauseText()
  return (
    <section aria-labelledby="panorama-table-title" id={TABLE_ID} className="scroll-mt-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="panorama-table-title" className="font-display text-lg font-semibold text-fg">
          {t('tracking.table.title')}
        </h2>
        <p className="text-xs text-muted" aria-live="polite">
          {filter === 'attention' ? t('tracking.table.order') : t(`tracking.table.filtered.${filter}`)} · {t('tracking.table.count', { count: rows.length })}
          {filter !== 'attention' && (
            <>
              {' · '}
              <button type="button" className="font-semibold text-primary-text hover:underline print:hidden" onClick={onClear}>
                {t('tracking.table.clear')}
              </button>
            </>
          )}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface px-4 py-4 text-sm text-muted">{filter === 'attention' ? t('tracking.table.none') : t('tracking.table.noneFiltered')}</p>
      ) : (
        // relative: o rótulo sr-only do cabeçalho fica preso aqui (senão alarga a página no celular)
        <div className="relative overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className={TH}>{t('tracking.table.columns.project')}</th>
                <th className={TH}>{t('tracking.table.columns.owner')}</th>
                <th className={TH}>{t('tracking.table.columns.situation')}</th>
                <th className={TH}>{t('tracking.table.columns.progress')}</th>
                <th className={cn(TH, 'text-right')}>{t('tracking.table.columns.blocked')}</th>
                <th className={TH}>{t('tracking.table.columns.due')}</th>
                <th className={TH}>
                  <span className="sr-only">{t('tracking.table.open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const plan = planProgress(row)
                const late = isLateProject(row, today) ? lateDays(row, today) : 0
                return (
                  <tr key={row.project.id} className="transition-colors last:[&>td]:border-b-0 hover:bg-surface-2 motion-reduce:transition-none">
                    <td className={cn(TD, 'max-w-80')}>
                      <span className="flex items-center gap-2">
                        <ProjectKey value={row.project.key} />
                        <span className="truncate font-semibold text-fg" title={row.project.name}>
                          {row.project.name}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{cause(row, today)}</span>
                    </td>
                    <td className={cn(TD, 'text-fg')}>{row.project.owner?.name ?? '—'}</td>
                    <td className={TD}>
                      <SituationPill situation={situationOf(row)} />
                    </td>
                    <td className={TD}>
                      {plan ? (
                        <span className="flex min-w-36 items-center gap-2" role="img" aria-label={t('tracking.table.progressLabel', { real: plan.real, planned: plan.planned })}>
                          <span className="w-9 text-right tabular-nums text-fg">{plan.real}%</span>
                          <ProgressBar real={plan.real} planned={plan.planned} />
                          <span className="w-9 tabular-nums text-muted">{plan.planned}%</span>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className={cn(TD, 'text-right tabular-nums')}>{row.tasks.blocked || '—'}</td>
                    <td className={cn(TD, 'whitespace-nowrap tabular-nums', late > 0 ? 'font-semibold text-danger-soft-fg' : 'text-fg')}>
                      {row.project.dueDate ? day(row.project.dueDate) : <span className="text-muted">{t('tracking.table.noDate')}</span>}
                      {late > 0 && <span className="block text-xs font-normal">{t('tracking.table.lateDue', { count: late })}</span>}
                    </td>
                    <td className={cn(TD, 'text-right')}>
                      <AppButton variant="secondary" size="sm" rightIcon={<ArrowRight />} aria-label={t('tracking.table.openLabel', { name: row.project.name })} onClick={() => onOpen(row)} className="print:hidden">
                        {t('tracking.table.open')}
                      </AppButton>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ próximos marcos */

const MILESTONE_PILL = { overdue: 'bg-danger-soft text-danger-soft-fg', soon: 'bg-warning-soft text-warning-soft-fg', planned: 'bg-success-soft text-success-soft-fg' } as const

export function MilestonesList({ data, rows, today }: { data: ExecutiveDashboard; rows: PortfolioRow[]; today: string }) {
  const { t } = useTranslation()
  const day = useDayText()
  const list = panoramaMilestones(data.plan, rows, today)
  const hidden = data.plan ? data.plan.overdueMilestonesTotal - data.plan.overdueMilestones.length : 0
  const status = (state: keyof typeof MILESTONE_PILL, days: number) =>
    state === 'overdue' ? t('tracking.milestones.overdue', { count: days }) : state === 'soon' ? (days === 0 ? t('tracking.milestones.today') : t('tracking.milestones.soon', { count: days })) : t('tracking.milestones.planned')
  return (
    <section aria-labelledby="panorama-milestones">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="panorama-milestones" className="font-display text-lg font-semibold text-fg">
          {t('tracking.milestones.title')}
        </h2>
      </div>
      {list.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface px-4 py-4 text-sm text-muted">{t('tracking.milestones.none')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface shadow-card">
          {list.map((m) => (
            <li key={m.id} className="grid grid-cols-1 items-center gap-1 px-4 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] sm:gap-4">
              <span className={cn('font-semibold tabular-nums', m.state === 'overdue' ? 'text-danger-soft-fg' : 'text-fg')}>{day(m.date)}</span>
              <span className="min-w-0">
                <span className="block truncate font-semibold text-fg">{m.name}</span>
                <span className="block truncate text-xs text-muted">
                  {m.project.name} · {m.owner ? t('tracking.milestones.owner', { name: m.owner.name }) : t('tracking.milestones.noOwner')}
                </span>
              </span>
              <span className={cn('justify-self-start rounded-full px-2.5 py-0.5 text-xs font-semibold sm:justify-self-end', MILESTONE_PILL[m.state])}>{status(m.state, m.days)}</span>
            </li>
          ))}
          {hidden > 0 && <li className="px-4 py-2.5 text-xs text-muted">{t('tracking.milestones.more', { count: hidden })}</li>}
        </ul>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ resumo do projeto */

/** `plan`: os marcos vencidos da leitura (o próximo marco do projeto começa pelo pendente já vencido). */
export function ProjectSummaryDrawer({ row, plan: section, today, onClose }: { row: PortfolioRow | null; plan: ExecutiveDashboard['plan'] | undefined; today: string; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const day = useDayText()
  const cause = useCauseText()
  if (!row)
    return (
      <AppDrawer open={false} onOpenChange={() => onClose()} title="">
        {null}
      </AppDrawer>
    )
  const plan = planProgress(row)
  const late = isLateProject(row, today) ? lateDays(row, today) : 0
  const overdueMilestone = section?.overdueMilestones.find((m) => m.project.id === row.project.id) ?? null
  const milestone = overdueMilestone
    ? `${overdueMilestone.name} · ${day(overdueMilestone.dueDate)} · ${t('tracking.milestones.overdue', { count: dayCount(today) - dayCount(overdueMilestone.dueDate) })}`
    : row.nextMilestone
      ? `${row.nextMilestone.name} · ${day(row.nextMilestone.dueDate)}`
      : t('tracking.drawer.none')
  const pending = [
    t('tracking.drawer.blocked', { count: row.tasks.blocked }),
    t('tracking.drawer.overdue', { count: row.tasks.overdue }),
    t('tracking.drawer.issues', { count: row.openIssues }),
  ].join(' · ')
  const updated = row.project.updatedAt ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(row.project.updatedAt) : '—'
  const items: Array<[string, ReactNode]> = [
    [t('tracking.drawer.objective'), row.project.objective ? <span className="whitespace-pre-line">{row.project.objective}</span> : <span className="text-muted">{t('tracking.drawer.noObjective')}</span>],
    [
      t('tracking.drawer.status'),
      <span key="status" className="flex flex-wrap items-center gap-2">
        {t(`projects.status.${row.project.status}`)}
        <SituationPill situation={situationOf(row)} />
      </span>,
    ],
    [
      t('tracking.drawer.progress'),
      plan ? (
        <span className="flex flex-col gap-1.5">
          {t('tracking.drawer.progressValue', { real: plan.real, planned: plan.planned })}
          <ProgressBar real={plan.real} planned={plan.planned} className="w-full max-w-64 flex-none" />
        </span>
      ) : (
        <span className="text-muted">{t('tracking.drawer.noPlan')}</span>
      ),
    ],
    [
      t('tracking.drawer.due'),
      <span key="due" className={cn(late > 0 && 'font-semibold text-danger-soft-fg')}>
        {row.project.dueDate ? day(row.project.dueDate) : t('tracking.table.noDate')}
        {late > 0 && ` · ${t('tracking.table.lateDue', { count: late })}`}
      </span>,
    ],
    [t('tracking.drawer.risks'), pending],
    [t('tracking.drawer.nextMilestone'), <span key="milestone" className={cn(overdueMilestone && 'font-semibold text-danger-soft-fg')}>{milestone}</span>],
    [t('tracking.drawer.owner'), row.project.owner?.name ?? '—'],
    [t('tracking.drawer.updated'), updated],
  ]
  return (
    <AppDrawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={row.project.name}
      description={`${row.project.key} · ${cause(row, today)}`}
      footer={
        <AppButton rightIcon={<ArrowRight />} onClick={() => navigate(`/projects/${row.project.id}`)}>
          {t('tracking.drawer.openProject')}
        </AppButton>
      }
    >
      <dl className="flex flex-col gap-4 text-sm">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
            <dd className="mt-1 text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </AppDrawer>
  )
}
