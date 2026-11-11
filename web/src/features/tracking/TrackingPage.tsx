import { useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, FolderKanban, Printer } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { isAppError } from '@/core/errors/app-error'
import type { ExecutiveDashboard, ExecutiveQuery, PortfolioRow } from '@/domain/executive'
import {
  DEFAULT_TRACKING_PERIOD,
  TRACKED_STATUSES,
  TRACKING_GROUPS,
  TRACKING_PERIODS,
  applyTrackingFilter,
  averageProgress,
  groupPortfolio,
  isBlocked,
  isTrackingPeriod,
  lateDays,
  panoramaAttention,
  scopeOptions,
  scopeRows,
  situationCounts,
  situationOf,
  todayOf,
  trackingPeriodRange,
  trackingSummary,
  upcomingDeliveries,
  type AttentionKind,
  type DecisionReason,
  type TrackingFilter,
  type TrackingGroup,
  type TrackingSituation,
} from '@/domain/tracking'
import {
  AppDonut,
  AppDrawer,
  AppEmptyState,
  AppErrorState,
  AppIconButton,
  AppLineChart,
  AppLoading,
  AppMeter,
  AppSegmentedControl,
  AppSelect,
  AppSparkline,
  AppTabs,
  AppTrendChart,
  chartToneBg,
  type AppChartTone,
} from '@/presentation/components'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useCan } from '@/features/auth/session'
import { useDurationText } from '@/features/reports/use-duration-text'
import { useExecutiveDashboard } from '@/features/executive/queries'
import { ProjectKey } from '@/features/executive/executive-visuals'
import { useDayText, useHealthReason } from '@/features/executive/use-executive-format'

/** Entrada do menu: a gerência (executive.view) vê o Panorama; quem só tem reports.view, os Relatórios. */
export function TrackingEntry() {
  return useCan('executive.view') ? <TrackingPage /> : <Navigate to="/reports" replace />
}

const TABS = ['portfolio', 'team', 'deliveries'] as const
type PanoramaTab = (typeof TABS)[number]

/**
 * Panorama (junta o Painel executivo e os Relatórios): faixa de destaque (hoje · no período), o que
 * requer atenção e três abas — Portfólio (a carteira agrupável), Equipe e tarefas (o trabalho no
 * período, com os dois gráficos) e Entregas (próximos 30 dias e o que já foi feito).
 */
export function TrackingPage() {
  const { t, i18n } = useTranslation()
  useDocumentTitle(t('tracking.title'))
  const [params, setParams] = useSearchParams()
  const [now] = useState(() => new Date())
  const today = todayOf(now)

  const set = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  const areaId = params.get('area') ?? ''
  const ownerId = params.get('owner') ?? ''
  const group: TrackingGroup = (TRACKING_GROUPS as readonly string[]).includes(params.get('group') ?? '') ? (params.get('group') as TrackingGroup) : 'priority'
  const tab: PanoramaTab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as PanoramaTab) : 'portfolio'
  const rawPeriod = params.get('period') ?? ''
  const period = isTrackingPeriod(rawPeriod) ? rawPeriod : DEFAULT_TRACKING_PERIOD
  const [filter, setFilter] = useState<TrackingFilter | null>(null)
  const [opened, setOpened] = useState<PortfolioRow | null>(null)

  // todos os projetos acompanhados: base da faixa, da atenção e das opções dos filtros
  const range = trackingPeriodRange(period, now)
  const baseQuery: ExecutiveQuery = { projectIds: [], statuses: [...TRACKED_STATUSES], from: range.from, to: range.to, tzOffset: now.getTimezoneOffset() }
  const base = useExecutiveDashboard(baseQuery)
  const data = base.data
  const allRows = useMemo(() => data?.portfolio ?? [], [data])
  const rows = useMemo(() => scopeRows(allRows, { areaId, ownerId }), [allRows, areaId, ownerId])
  const scoped = !!(areaId || ownerId)
  // os números do período seguem o departamento/responsável escolhido (outra leitura só com filtro)
  const scopedQuery: ExecutiveQuery | null = scoped && rows.length ? { ...baseQuery, projectIds: rows.map((r) => r.project.id) } : null
  const scopedData = useExecutiveDashboard(scopedQuery)
  const periodData = scoped ? scopedData.data : data

  if (base.isError) {
    return <AppErrorState title={t('tracking.loadError')} correlationId={isAppError(base.error) ? base.error.correlationId : undefined} onRetry={() => void base.refetch()} />
  }
  if (!data) return <AppLoading label={t('tracking.loading')} />

  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
  const areaOptions = [{ value: 'all', label: t('tracking.filters.allAreas') }, ...scopeOptions(allRows, 'area').map((o) => ({ value: o.id, label: o.name })), { value: 'none', label: t('tracking.noArea') }]
  const ownerOptions = [{ value: 'all', label: t('tracking.filters.allOwners') }, ...scopeOptions(allRows, 'owner').map((o) => ({ value: o.id, label: o.name }))]
  const showPortfolio = (next: TrackingFilter | null) => {
    setFilter(next)
    set('tab', '')
    window.requestAnimationFrame(() => document.getElementById('panorama-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-10">
      {/* cabeçalho e filtros */}
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">{t('tracking.title')}</h1>
            <p className="mt-1 text-sm text-muted">
              {t('tracking.periodLine', { from: dayLabel(range.from, i18n.language), to: dayLabel(range.to, i18n.language) })} · {t('tracking.asOf', { time: time.format(data.generatedAt) })}
            </p>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <span className="inline-flex items-center rounded-full bg-primary-soft px-3 py-1 text-sm font-medium text-primary-soft-fg">
              {scoped ? t('tracking.scope.filtered', { count: rows.length }) : t('tracking.scope.all')}
            </span>
            <AppIconButton variant="secondary" label={t('tracking.print')} icon={<Printer />} onClick={() => window.print()} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <AppSelect size="sm" aria-label={t('tracking.filters.area')} value={areaId || 'all'} onValueChange={(v) => set('area', v === 'all' ? '' : v)} options={areaOptions} triggerClassName="min-w-48" />
          <AppSelect size="sm" aria-label={t('tracking.filters.owner')} value={ownerId || 'all'} onValueChange={(v) => set('owner', v === 'all' ? '' : v)} options={ownerOptions} triggerClassName="min-w-48" />
          <AppSegmentedControl
            size="sm"
            label={t('tracking.period.label')}
            value={period}
            onValueChange={(v) => set('period', v === DEFAULT_TRACKING_PERIOD ? '' : v)}
            options={TRACKING_PERIODS.map((p) => ({ value: p, label: t(`tracking.period.${p}`) }))}
          />
        </div>
      </header>

      {allRows.length === 0 ? (
        <AppEmptyState icon={<FolderKanban />} title={t('tracking.empty')} description={t('tracking.emptyHint')} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
          <Hero rows={rows} today={today} periodData={periodData} filter={filter} onFilter={showPortfolio} />
          <Attention data={data} rows={rows} today={today} onOpen={setOpened} />
          <div id="panorama-tabs" className="scroll-mt-4 px-5 pb-6 sm:px-6">
            <AppTabs
              aria-label={t('tracking.tabs.label')}
              value={tab}
              onValueChange={(v) => set('tab', v === 'portfolio' ? '' : v)}
              tabs={[
                {
                  value: 'portfolio',
                  label: <TabLabel title={t('tracking.tabs.portfolio')} hint={t('tracking.tabs.portfolioHint')} />,
                  content: (
                    <div className="flex flex-col gap-3 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        {filter ? (
                          <p className="text-sm text-muted">
                            {t(`tracking.filtered.${filter}`)}{' '}
                            <button type="button" className="font-medium text-primary-text hover:underline" onClick={() => setFilter(null)}>
                              {t('tracking.filtered.clear')}
                            </button>
                          </p>
                        ) : (
                          <span />
                        )}
                        <AppSegmentedControl
                          size="sm"
                          label={t('tracking.groupBy')}
                          value={group}
                          onValueChange={(v) => set('group', v === 'priority' ? '' : v)}
                          options={TRACKING_GROUPS.map((g) => ({ value: g, label: t(`tracking.groups.${g}`) }))}
                        />
                      </div>
                      <PortfolioTable rows={applyTrackingFilter(rows, filter, today)} group={group} today={today} onOpen={setOpened} />
                    </div>
                  ),
                },
                {
                  value: 'team',
                  label: <TabLabel title={t('tracking.tabs.team')} hint={t('tracking.tabs.teamHint')} />,
                  content: <div className="pt-4">{periodData ? <PeriodBlock data={periodData} /> : <AppLoading label={t('tracking.loading')} />}</div>,
                },
                {
                  value: 'deliveries',
                  label: <TabLabel title={t('tracking.tabs.deliveries')} hint={t('tracking.tabs.deliveriesHint')} />,
                  content: (
                    <div className="flex flex-col gap-6 pt-4">
                      <div>
                        <h3 className="mb-2 text-sm font-semibold text-fg">{t('tracking.sections.upcoming')}</h3>
                        <UpcomingTable data={data} rows={rows} today={today} onOpen={setOpened} />
                      </div>
                      <div>
                        <h3 className="mb-2 text-sm font-semibold text-fg">{t('tracking.done.title')}</h3>
                        <AchievementsList data={periodData ?? data} rows={rows} />
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}

      <ProjectDrawer row={opened} today={today} onClose={() => setOpened(null)} />
    </div>
  )
}

const dayLabel = (day: string, locale: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))

function TabLabel({ title, hint }: { title: string; hint: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {title}
      <span className="text-xs font-normal text-muted">{hint}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ faixa de destaque */

const SITUATION_CHART: Record<TrackingSituation, AppChartTone> = { ok: 'success', watch: 'warning', risk: 'danger', none: 'neutral' }

function Hero({
  rows,
  today,
  periodData,
  filter,
  onFilter,
}: {
  rows: PortfolioRow[]
  today: string
  periodData: ExecutiveDashboard | undefined
  filter: TrackingFilter | null
  onFilter: (filter: TrackingFilter | null) => void
}) {
  const { t } = useTranslation()
  const summary = trackingSummary(rows, today)
  const counts = situationCounts(rows)
  const progress = averageProgress(rows)
  const overdueTasks = rows.reduce((sum, r) => sum + r.tasks.overdue, 0)
  const blockedTasks = rows.reduce((sum, r) => sum + r.tasks.blocked, 0)
  const weekly = periodData?.timeline.points.map((p) => p.tasksCompleted) ?? []
  const segments = (['ok', 'watch', 'risk', 'none'] as const).map((s) => ({ key: s, label: t(`tracking.situation.${s}`), value: counts[s], tone: SITUATION_CHART[s] }))
  return (
    <section aria-label={t('tracking.hero.label')} className="border-b border-border">
      {/* rótulos alinhados com as colunas: as quatro de hoje e a do período */}
      <div className="hidden grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.15fr)] lg:grid" aria-hidden>
        <span className="col-span-4 px-6 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('tracking.hero.today')}</span>
        <span className="border-l border-border px-6 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('tracking.hero.period')}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.15fr)]">
        <HeroCell label={t('tracking.hero.health')}>
          <div className="flex items-center gap-4">
            <AppDonut className="size-16 shrink-0" label={t('tracking.hero.health')} segments={segments} thickness={16} activeKey={filter === 'risk' ? 'risk' : null} onSegmentClick={(key) => key === 'risk' && onFilter('risk')} />
            <ul className="flex flex-col gap-0.5 text-sm">
              {segments
                .filter((s) => s.value > 0 || s.key !== 'none')
                .map((s) => (
                  <li key={s.key} className="inline-flex items-center gap-1.5 text-fg">
                    <span aria-hidden className={cn('size-2 rounded-full', chartToneBg(s.tone))} />
                    {s.label}
                    <span className="font-semibold tabular-nums">{s.value}</span>
                  </li>
                ))}
            </ul>
          </div>
        </HeroCell>
        <HeroCell label={t('tracking.hero.progress')}>
          {progress === null ? (
            <p className="text-sm text-muted">{t('tracking.hero.noProgress')}</p>
          ) : (
            <>
              <span className="text-3xl font-bold tabular-nums text-fg">{progress} %</span>
              <AppMeter value={progress} label={t('tracking.hero.progress')} size="md" className="mt-2" />
            </>
          )}
        </HeroCell>
        <HeroCell label={t('tracking.hero.late')} onClick={() => onFilter(filter === 'late' ? null : 'late')} active={filter === 'late'}>
          <span className={cn('text-3xl font-bold tabular-nums', summary.late ? 'text-danger' : 'text-fg')}>{summary.late}</span>
          <span className="text-sm text-muted">{t('tracking.hero.lateHint', { count: overdueTasks })}</span>
        </HeroCell>
        <HeroCell label={t('tracking.hero.blocked')} onClick={() => onFilter(filter === 'blocked' ? null : 'blocked')} active={filter === 'blocked'}>
          <span className={cn('text-3xl font-bold tabular-nums', summary.blocked ? 'text-danger' : 'text-fg')}>{summary.blocked}</span>
          <span className="text-sm text-muted">{t('tracking.hero.blockedHint', { count: blockedTasks })}</span>
        </HeroCell>
        <HeroCell label={t('tracking.hero.deliveries')} period>
          <div className="flex items-end justify-between gap-3">
            <span className="text-3xl font-bold tabular-nums text-fg">{periodData ? periodData.kanban.completed : '…'}</span>
            <AppSparkline className="h-8 w-24" label={t('tracking.charts.done')} values={weekly} />
          </div>
          <span className="text-sm text-muted">{t('tracking.hero.deliveriesHint', { count: periodData?.summary.deliveries.milestones ?? 0 })}</span>
        </HeroCell>
      </div>
    </section>
  )
}

function HeroCell({ label, children, onClick, active, period }: { label: string; children: ReactNode; onClick?: () => void; active?: boolean; period?: boolean }) {
  const body = (
    <>
      <span className="text-sm text-muted">{label}</span>
      {children}
    </>
  )
  const base = cn(
    'flex min-w-0 flex-col gap-1 border-t border-border px-6 py-5 sm:[&:nth-child(-n+2)]:border-t-0 lg:border-t-0 lg:[&:not(:first-child)]:border-l',
    period && 'bg-primary-soft/40',
  )
  if (!onClick) return <div className={base}>{body}</div>
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(base, 'text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', active && 'bg-surface-2')}
    >
      {body}
    </button>
  )
}

/* ------------------------------------------------------------------ requer atenção */

const ATTENTION_PILL: Record<AttentionKind, string> = {
  risk: 'bg-danger-soft text-danger-soft-fg',
  late: 'bg-danger-soft text-danger-soft-fg',
  paused: 'bg-warning-soft text-warning-soft-fg',
  blocked: 'bg-warning-soft text-warning-soft-fg',
  soon: 'bg-info-soft text-info-soft-fg',
}
const VISIBLE_ATTENTION = 6

function Attention({ data, rows, today, onOpen }: { data: ExecutiveDashboard; rows: PortfolioRow[]; today: string; onOpen: (row: PortfolioRow) => void }) {
  const { t } = useTranslation()
  const reasonText = useReasonText()
  const day = useDayText()
  const [all, setAll] = useState(false)
  const items = panoramaAttention(data, rows, today)
  const shown = all ? items : items.slice(0, VISIBLE_ATTENTION)
  return (
    <section aria-labelledby="panorama-attention" className="flex flex-col gap-3 border-b border-border px-5 py-5 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="panorama-attention" className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          {t('tracking.attention.title')}
        </h2>
        {items.length > VISIBLE_ATTENTION && (
          <button type="button" className="text-sm font-medium text-primary-text hover:underline print:hidden" onClick={() => setAll((v) => !v)}>
            {all ? t('tracking.attention.less') : t('tracking.attention.more', { count: items.length - VISIBLE_ATTENTION })}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-3 text-sm text-muted">{t('tracking.attention.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((item) => (
            <li key={`${item.kind}-${item.row.project.id}-${item.soon?.date ?? ''}`}>
              <button
                type="button"
                onClick={() => onOpen(item.row)}
                className="grid w-full grid-cols-1 items-center gap-2 rounded-xl border border-border px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:gap-4"
              >
                <span className={cn('justify-self-start rounded-full px-2.5 py-0.5 text-xs font-semibold', ATTENTION_PILL[item.kind])}>
                  {item.kind === 'soon'
                    ? item.soon?.days === 0
                      ? t('tracking.attention.kinds.soonToday')
                      : t('tracking.attention.kinds.soon', { count: item.soon?.days ?? 0 })
                    : t(`tracking.attention.kinds.${item.kind}`)}
                </span>
                <span className="min-w-0 text-sm">
                  <span className="font-medium text-fg">{item.row.project.name}</span>
                  <span className="text-muted">
                    {' · '}
                    {item.kind === 'soon'
                      ? `${item.soon?.kind === 'milestone' ? item.soon.name : t('tracking.upcoming.projectDue')} · ${day(item.soon?.date)}`
                      : // o motivo que já é a etiqueta não se repete no texto (ex.: "Pausado")
                        item.reasons
                          .filter((r) => !(r.kind === 'paused' && item.kind === 'paused'))
                          .map((r) => reasonText(r, item.row))
                          .join(' · ')}
                  </span>
                </span>
                <ArrowRight aria-hidden className="hidden size-4 text-primary-text sm:block" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function useReasonText() {
  const { t } = useTranslation()
  const healthReason = useHealthReason()
  return (reason: DecisionReason, row: PortfolioRow) => {
    if (reason.kind === 'late') return t('tracking.reasons.late', { count: reason.days })
    if (reason.kind === 'paused') return t('tracking.reasons.paused')
    if (reason.kind === 'blockedTasks') return t('tracking.reasons.blockedTasks', { count: reason.count })
    return healthReason(row.health) ?? t('tracking.situation.risk')
  }
}

/* ------------------------------------------------------------------ tabelas */

const TH = 'truncate whitespace-nowrap border-b border-border-strong px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted'
const TD = 'border-b border-border px-3 py-2 align-middle'

function ProjectName({ row }: { row: PortfolioRow }) {
  return (
    // a chave ocupa sempre a mesma largura: os nomes começam todos na mesma linha vertical
    <span className="grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-2">
      <ProjectKey value={row.project.key} className="justify-self-start" />
      <span className="truncate text-fg" title={row.project.name}>
        {row.project.name}
      </span>
    </span>
  )
}

function UpcomingTable({ data, rows, today, onOpen }: { data: Parameters<typeof upcomingDeliveries>[0]; rows: PortfolioRow[]; today: string; onOpen: (row: PortfolioRow) => void }) {
  const { t } = useTranslation()
  const day = useDayText()
  const list = upcomingDeliveries(data, rows, today)
  if (!list.length) return <p className="rounded-lg border border-border px-4 py-3 text-sm text-muted">{t('tracking.upcoming.none')}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr>
            <th className={TH}>{t('tracking.columns.date')}</th>
            <th className={TH}>{t('tracking.columns.delivery')}</th>
            <th className={TH}>{t('tracking.columns.project')}</th>
            <th className={TH}>{t('tracking.columns.owner')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((d) => (
            <tr key={`${d.kind}-${d.row.project.id}-${d.name}-${d.date}`} className="cursor-pointer hover:bg-surface-2" onClick={() => onOpen(d.row)}>
              <td className={cn(TD, 'whitespace-nowrap tabular-nums')}>{day(d.date)}</td>
              <td className={TD}>{d.kind === 'milestone' ? d.name : t('tracking.upcoming.projectDue')}</td>
              <td className={TD}>
                <ProjectName row={d.row} />
              </td>
              <td className={cn(TD, 'text-muted')}>{d.row.project.owner?.name ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AchievementsList({ data, rows }: { data: ExecutiveDashboard; rows: PortfolioRow[] }) {
  const { t } = useTranslation()
  const ids = new Set(rows.map((r) => r.project.id))
  const list = data.achievements.filter((a) => ids.has(a.project.id) || a.project.archived)
  if (!list.length) return <p className="rounded-lg border border-border px-4 py-3 text-sm text-muted">{t('tracking.done.none')}</p>
  return (
    <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
      {list.map((a) => (
        <li key={a.project.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <span className="flex items-center gap-2">
            <ProjectKey value={a.project.key} />
            <span className="text-fg">{a.project.name}</span>
          </span>
          <span className="text-muted tabular-nums">{t('tracking.done.row', { tasks: a.tasksDone + a.planItemsDone, milestones: a.milestonesDone.length })}</span>
        </li>
      ))}
    </ul>
  )
}

function Priority({ value }: { value: PortfolioRow['project']['priority'] }) {
  const { t } = useTranslation()
  return <span className={cn(value === 'critical' || value === 'high' ? 'font-semibold text-fg' : 'text-fg')}>{t(`projects.priority.${value}`)}</span>
}

const SITUATION_TONE: Record<TrackingSituation, string> = { risk: 'text-danger', watch: 'text-warning', ok: 'text-fg', none: 'text-muted' }
const SITUATION_DOT: Record<TrackingSituation, string> = { risk: 'bg-danger', watch: 'bg-warning', ok: 'bg-success', none: 'border border-dashed border-border-strong' }

function Situation({ row }: { row: PortfolioRow }) {
  const { t } = useTranslation()
  const reason = useHealthReason()
  const situation = situationOf(row)
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5 whitespace-nowrap', SITUATION_TONE[situation])} title={reason(row.health) ?? undefined}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', SITUATION_DOT[situation])} />
      <span className="truncate">{t(`tracking.situation.${situation}`)}</span>
    </span>
  )
}

/** Peso de cada coluna da carteira (largura proporcional, tabela fixa). */
const COLUMN_WEIGHT = { project: 22, area: 12, owner: 12.5, status: 10, priority: 7, situation: 11, progress: 6.5, due: 11.5, milestone: 9.5, tasks: 6.5 } as const
/** Célula da carteira: uma linha só (o texto longo corta com "…" e aparece inteiro ao passar o mouse). */
const CELL = 'h-11 truncate whitespace-nowrap border-b border-border px-2.5 align-middle'

function PortfolioTable({ rows, group, today, onOpen }: { rows: PortfolioRow[]; group: TrackingGroup; today: string; onOpen: (row: PortfolioRow) => void }) {
  const { t } = useTranslation()
  const day = useDayText()
  const groups = groupPortfolio(rows, group, today)
  if (!rows.length) return <p className="rounded-lg border border-border px-4 py-3 text-sm text-muted">{t('tracking.portfolio.none')}</p>
  const groupLabel = (key: string, name: string) =>
    group === 'priority' ? t(`projects.priority.${key}`) : group === 'status' ? t(`projects.status.${key}`) : key === 'none' ? t(group === 'area' ? 'tracking.noArea' : 'tracking.noOwner') : name
  // larguras fixas (proporcionais) para todas as linhas e grupos ficarem alinhados; a coluna que vira
  // grupo some e as outras dividem o espaço
  const columns = (['project', 'area', 'owner', 'status', 'priority', 'situation', 'progress', 'due', 'milestone', 'tasks'] as const).filter(
    (c) => !(c === 'area' && group === 'area') && !(c === 'owner' && group === 'owner') && !(c === 'status' && group === 'status') && !(c === 'priority' && group === 'priority'),
  )
  const total = columns.reduce((sum, c) => sum + COLUMN_WEIGHT[c], 0)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] table-fixed border-collapse text-sm">
        <colgroup>
          {columns.map((c) => (
            <col key={c} style={{ width: `${(COLUMN_WEIGHT[c] / total) * 100}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={TH}>{t('tracking.columns.project')}</th>
            {group !== 'area' && <th className={TH}>{t('tracking.columns.area')}</th>}
            {group !== 'owner' && <th className={TH}>{t('tracking.columns.owner')}</th>}
            {group !== 'status' && <th className={TH}>{t('tracking.columns.status')}</th>}
            {group !== 'priority' && <th className={TH}>{t('tracking.columns.priority')}</th>}
            <th className={TH}>{t('tracking.columns.situation')}</th>
            <th className={cn(TH, 'text-right')}>{t('tracking.columns.progress')}</th>
            <th className={TH}>{t('tracking.columns.due')}</th>
            <th className={TH}>{t('tracking.columns.nextMilestone')}</th>
            <th className={cn(TH, 'text-right')} title={t('tracking.columns.tasksHint')}>
              {t('tracking.columns.tasks')}
            </th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            <tr>
              <th colSpan={10} scope="colgroup" className="border-b border-border-strong bg-surface-2 px-3 py-2 text-left text-sm font-semibold text-fg">
                {groupLabel(g.key, g.name)}
                <span className="ml-2 font-normal text-muted">
                  {t('tracking.portfolio.count', { count: g.rows.length })}
                  {g.late > 0 && ` · ${t('tracking.portfolio.late', { count: g.late })}`}
                </span>
              </th>
            </tr>
            {g.rows.map((row) => {
              const late = lateDays(row, today)
              return (
                <tr key={row.project.id} className="cursor-pointer hover:bg-surface-2" onClick={() => onOpen(row)}>
                  <td className={CELL}>
                    <ProjectName row={row} />
                  </td>
                  {group !== 'area' && (
                    <td className={cn(CELL, 'text-muted')} title={row.project.area?.name}>
                      {row.project.area?.name ?? t('tracking.noArea')}
                    </td>
                  )}
                  {group !== 'owner' && (
                    <td className={cn(CELL, 'text-muted')} title={row.project.owner?.name}>
                      {row.project.owner?.name ?? '—'}
                    </td>
                  )}
                  {group !== 'status' && <td className={CELL}>{t(`projects.status.${row.project.status}`)}</td>}
                  {group !== 'priority' && (
                    <td className={CELL}>
                      <Priority value={row.project.priority} />
                    </td>
                  )}
                  <td className={CELL}>
                    <Situation row={row} />
                  </td>
                  <td className={cn(CELL, 'text-right tabular-nums')}>{row.progress ? `${row.progress.value} %` : '—'}</td>
                  <td className={cn(CELL, 'tabular-nums', late > 0 && 'font-semibold text-danger')}>
                    {row.project.dueDate ? day(row.project.dueDate) : t('tracking.noDate')}
                    {late > 0 && ` · ${t('tracking.lateShort', { count: late })}`}
                  </td>
                  <td className={CELL} title={row.nextMilestone?.name}>
                    {row.nextMilestone ? `${row.nextMilestone.name} · ${day(row.nextMilestone.dueDate)}` : '—'}
                  </td>
                  <td className={cn(CELL, 'text-right tabular-nums')} title={t('tracking.columns.tasksHint')}>
                    {row.tasks.open} · {row.tasks.inProgress}
                  </td>
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ equipe e tarefas */

function PeriodBlock({ data }: { data: ExecutiveDashboard }) {
  const { t } = useTranslation()
  const duration = useDurationText()
  const points = data.timeline.points
  // a última semana ainda está em curso: o rótulo leva "*" e a nota explica (evita ler a queda como problema)
  const lastStart = points.at(-1)?.start ?? ''
  const ongoing = !!lastStart && Date.parse(`${lastStart}T00:00:00Z`) + 7 * 86_400_000 > data.generatedAt.getTime()
  const label = (start: string) => `${start.slice(8, 10)}/${start.slice(5, 7)}${ongoing && start === lastStart ? '*' : ''}`
  return (
    <div className="flex flex-col gap-5">
      {/* tarefas concluídas e marcos já estão na faixa de cima ("Entregas"); aqui só o que é novo */}
      <dl>
        <dt className="text-sm text-muted">{t('tracking.periodNumbers.work')}</dt>
        <dd className="text-lg font-semibold tabular-nums text-fg">{duration(data.kanban.cycleTime)}</dd>
      </dl>
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-fg">{t('tracking.charts.flowTitle')}</h3>
        <p className="mb-3 text-xs text-muted">
          {t('tracking.charts.flowHint')} {ongoing && t('tracking.charts.ongoingWeek')}
        </p>
        <AppTrendChart
          title={t('tracking.charts.flowTitle')}
          seriesA={t('tracking.charts.created')}
          seriesB={t('tracking.charts.done')}
          points={points.map((p) => ({ key: p.start, label: label(p.start), a: p.tasksCreated, b: p.tasksCompleted }))}
        />
      </div>
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-fg">{t('tracking.charts.stockTitle')}</h3>
        <p className="mb-3 text-xs text-muted">
          {t('tracking.charts.stockHint')} {ongoing && t('tracking.charts.ongoingWeek')}
        </p>
        <AppLineChart
          title={t('tracking.charts.stockTitle')}
          series={[
            { label: t('tracking.charts.done'), tone: 'accent' },
            { label: t('tracking.charts.inProgress'), tone: 'info' },
            { label: t('tracking.charts.overdue'), tone: 'danger' },
          ]}
          points={points.map((p) => ({ key: p.start, label: label(p.start), values: [p.tasksCompleted, p.tasksInProgress, p.tasksOverdue] }))}
        />
      </div>
      <Link to="/reports" className="inline-flex items-center gap-1 text-sm font-medium text-primary-text hover:underline print:hidden">
        {t('tracking.teamReport')} <ArrowRight className="size-4" aria-hidden />
      </Link>
      <p className="text-xs text-muted">{t('tracking.soon')}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ painel do projeto */

function ProjectDrawer({ row, today, onClose }: { row: PortfolioRow | null; today: string; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const day = useDayText()
  const reason = useHealthReason()
  if (!row)
    return (
      <AppDrawer open={false} onOpenChange={() => onClose()} title="">
        {null}
      </AppDrawer>
    )
  const late = lateDays(row, today)
  const items: Array<[string, ReactNode]> = [
    [t('tracking.columns.status'), t(`projects.status.${row.project.status}`)],
    [t('tracking.columns.priority'), t(`projects.priority.${row.project.priority}`)],
    [t('tracking.columns.area'), row.project.area?.name ?? t('tracking.noArea')],
    [t('tracking.columns.owner'), row.project.owner?.name ?? '—'],
    [t('tracking.columns.situation'), [t(`tracking.situation.${situationOf(row)}`), reason(row.health)].filter(Boolean).join(' — ')],
    [t('tracking.drawer.start'), row.project.startDate ? day(row.project.startDate) : '—'],
    [t('tracking.columns.due'), row.project.dueDate ? `${day(row.project.dueDate)}${late > 0 ? ` · ${t('tracking.reasons.late', { count: late })}` : ''}` : t('tracking.noDate')],
    [t('tracking.columns.progress'), row.progress ? `${row.progress.value} %` : '—'],
    [t('tracking.columns.nextMilestone'), row.nextMilestone ? `${row.nextMilestone.name} · ${day(row.nextMilestone.dueDate)}` : '—'],
    [t('tracking.drawer.open'), row.tasks.open],
    [t('tracking.drawer.inProgress'), row.tasks.inProgress],
    [t('tracking.drawer.blocked'), row.tasks.blocked],
    [t('tracking.drawer.overdue'), row.tasks.overdue],
    [t('tracking.drawer.issues'), row.openIssues],
  ]
  return (
    <AppDrawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={row.project.name}
      description={`${row.project.key}${isBlocked(row) ? ` · ${t('tracking.kpi.blocked')}` : ''}`}
      footer={
        <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-primary-text hover:underline" onClick={() => navigate(`/projects/${row.project.id}`)}>
          {t('tracking.drawer.openProject')} <ArrowRight className="size-4" aria-hidden />
        </button>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {items.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="text-fg tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </AppDrawer>
  )
}
