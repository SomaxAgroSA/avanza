import { useId, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, FolderKanban, Printer } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { isAppError } from '@/core/errors/app-error'
import type { ExecutiveQuery, PortfolioRow } from '@/domain/executive'
import {
  DEFAULT_TRACKING_PERIOD,
  TRACKED_STATUSES,
  TRACKING_GROUPS,
  TRACKING_PERIODS,
  applyTrackingFilter,
  decisionItems,
  groupPortfolio,
  isTrackingPeriod,
  lateDays,
  scopeOptions,
  scopeRows,
  situationOf,
  todayOf,
  trackingPeriodRange,
  trackingSummary,
  upcomingDeliveries,
  type DecisionReason,
  type TrackingFilter,
  type TrackingGroup,
  type TrackingSituation,
} from '@/domain/tracking'
import {
  AppDrawer,
  AppEmptyState,
  AppErrorState,
  AppIconButton,
  AppLineChart,
  AppLoading,
  AppSegmentedControl,
  AppSelect,
  AppTrendChart,
} from '@/presentation/components'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useCan } from '@/features/auth/session'
import { useDurationText } from '@/features/reports/use-duration-text'
import { useExecutiveDashboard } from '@/features/executive/queries'
import { ProjectKey } from '@/features/executive/executive-visuals'
import { useDayText, useHealthReason } from '@/features/executive/use-executive-format'

/** Entrada do menu: a gerência (executive.view) vê o Seguimento; quem só tem reports.view, os Relatórios. */
export function TrackingEntry() {
  return useCan('executive.view') ? <TrackingPage /> : <Navigate to="/reports" replace />
}

/**
 * Seguimento de projetos (junta o Painel executivo e os Relatórios): uma coluna, de cima para baixo, na
 * ordem das perguntas da gerência — como está a carteira hoje, o que pede decisão, o que se entrega nos
 * próximos 30 dias, a carteira agrupável e, separado no fim, o trabalho da equipe no período.
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
  const rawPeriod = params.get('period') ?? ''
  const period = isTrackingPeriod(rawPeriod) ? rawPeriod : DEFAULT_TRACKING_PERIOD
  const [filter, setFilter] = useState<TrackingFilter | null>(null)
  const [opened, setOpened] = useState<PortfolioRow | null>(null)

  // todos os projetos acompanhados: base dos blocos de hoje e das opções dos filtros
  const range = trackingPeriodRange(period, now)
  const baseQuery: ExecutiveQuery = { projectIds: [], statuses: [...TRACKED_STATUSES], from: range.from, to: range.to, tzOffset: now.getTimezoneOffset() }
  const base = useExecutiveDashboard(baseQuery)
  const data = base.data
  const allRows = useMemo(() => data?.portfolio ?? [], [data])
  const rows = useMemo(() => scopeRows(allRows, { areaId, ownerId }), [allRows, areaId, ownerId])
  const scoped = !!(areaId || ownerId)
  // o bloco do período segue o departamento/responsável escolhido (outra leitura só quando há filtro)
  const scopedQuery: ExecutiveQuery | null = scoped && rows.length ? { ...baseQuery, projectIds: rows.map((r) => r.project.id) } : null
  const scopedData = useExecutiveDashboard(scopedQuery)
  const periodData = scoped ? scopedData.data : data

  if (base.isError) {
    return <AppErrorState title={t('tracking.loadError')} correlationId={isAppError(base.error) ? base.error.correlationId : undefined} onRetry={() => void base.refetch()} />
  }
  if (!data) return <AppLoading label={t('tracking.loading')} />

  const summary = trackingSummary(rows, today)
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' })
  const areaOptions = [{ value: 'all', label: t('tracking.filters.allAreas') }, ...scopeOptions(allRows, 'area').map((o) => ({ value: o.id, label: o.name })), { value: 'none', label: t('tracking.noArea') }]
  const ownerOptions = [{ value: 'all', label: t('tracking.filters.allOwners') }, ...scopeOptions(allRows, 'owner').map((o) => ({ value: o.id, label: o.name }))]
  const pickFilter = (next: TrackingFilter | null) => {
    setFilter(next)
    document.getElementById('tracking-portfolio')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 pb-10">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{t('tracking.title')}</h1>
          <p className="mt-1 text-sm text-muted">
            {t('tracking.asOf', { time: time.format(data.generatedAt) })} · {scoped ? t('tracking.scope.filtered', { count: rows.length }) : t('tracking.scope.all')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <AppSelect size="sm" aria-label={t('tracking.filters.area')} value={areaId || 'all'} onValueChange={(v) => set('area', v === 'all' ? '' : v)} options={areaOptions} triggerClassName="min-w-44" />
          <AppSelect size="sm" aria-label={t('tracking.filters.owner')} value={ownerId || 'all'} onValueChange={(v) => set('owner', v === 'all' ? '' : v)} options={ownerOptions} triggerClassName="min-w-44" />
          <AppIconButton variant="secondary" label={t('tracking.print')} icon={<Printer />} onClick={() => window.print()} />
        </div>
      </header>

      {allRows.length === 0 ? (
        <AppEmptyState icon={<FolderKanban />} title={t('tracking.empty')} description={t('tracking.emptyHint')} />
      ) : (
        <>
          {/* 1 · hoje */}
          <Section title={t('tracking.sections.today')}>
            <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border lg:grid-cols-4">
              <Kpi value={summary.active} label={t('tracking.kpi.active')} active={filter === null} onClick={() => pickFilter(null)} />
              <Kpi value={summary.late} label={t('tracking.kpi.late')} alert active={filter === 'late'} onClick={() => pickFilter('late')} />
              <Kpi value={summary.blocked} label={t('tracking.kpi.blocked')} alert active={filter === 'blocked'} onClick={() => pickFilter('blocked')} />
              <Kpi value={summary.risk} label={t('tracking.kpi.risk')} alert active={filter === 'risk'} onClick={() => pickFilter('risk')} />
            </div>
            <p className="mt-2 text-xs text-muted">{t('tracking.kpi.help')}</p>
          </Section>

          {/* 2 · decisão */}
          <Section title={t('tracking.sections.decision')}>
            <DecisionTable rows={rows} today={today} onOpen={setOpened} />
          </Section>

          {/* 3 · próximas entregas */}
          <Section title={t('tracking.sections.upcoming')}>
            <UpcomingTable data={data} rows={rows} today={today} onOpen={setOpened} />
          </Section>

          {/* 4 · carteira */}
          <Section
            id="tracking-portfolio"
            title={t('tracking.sections.portfolio')}
            actions={
              <AppSegmentedControl
                size="sm"
                label={t('tracking.groupBy')}
                value={group}
                onValueChange={(v) => set('group', v === 'priority' ? '' : v)}
                options={TRACKING_GROUPS.map((g) => ({ value: g, label: t(`tracking.groups.${g}`) }))}
              />
            }
          >
            {filter && (
              <p className="mb-2 text-sm text-muted">
                {t(`tracking.filtered.${filter}`)}{' '}
                <button type="button" className="font-medium text-primary-text hover:underline" onClick={() => setFilter(null)}>
                  {t('tracking.filtered.clear')}
                </button>
              </p>
            )}
            <PortfolioTable rows={applyTrackingFilter(rows, filter, today)} group={group} today={today} onOpen={setOpened} />
          </Section>

          {/* 5 · período */}
          <section aria-labelledby="tracking-period" className="flex flex-col gap-5 border-t-4 border-double border-border pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="tracking-period" className="text-base font-semibold text-fg">
                {t('tracking.sections.period')}
              </h2>
              <AppSegmentedControl
                size="sm"
                label={t('tracking.period.label')}
                value={period}
                onValueChange={(v) => set('period', v === DEFAULT_TRACKING_PERIOD ? '' : v)}
                options={TRACKING_PERIODS.map((p) => ({ value: p, label: t(`tracking.period.${p}`) }))}
              />
            </div>
            {periodData ? <PeriodBlock data={periodData} /> : <AppLoading label={t('tracking.loading')} />}
            <div className="flex flex-col gap-2 text-sm">
              <Link to="/reports" className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline print:hidden">
                {t('tracking.teamReport')} <ArrowRight className="size-4" aria-hidden />
              </Link>
              <p className="text-xs text-muted">{t('tracking.soon')}</p>
            </div>
          </section>
        </>
      )}

      <ProjectDrawer row={opened} today={today} onClose={() => setOpened(null)} />
    </div>
  )
}

/* ------------------------------------------------------------------ peças */

function Section({ id, title, actions, children }: { id?: string; title: string; actions?: ReactNode; children: ReactNode }) {
  const headingId = useId()
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-base font-semibold text-fg">
          {title}
        </h2>
        {actions && <div className="print:hidden">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

function Kpi({ value, label, alert, active, onClick }: { value: number; label: string; alert?: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex flex-col gap-0.5 border-border px-5 py-4 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        'border-b even:border-l lg:border-b-0 lg:border-l lg:first:border-l-0 [&:nth-child(n+3)]:border-b-0',
        active && 'bg-primary-soft/60',
      )}
    >
      <span className={cn('text-3xl font-bold tabular-nums', alert && value > 0 ? 'text-danger' : 'text-fg')}>{value}</span>
      <span className="text-sm text-muted">{label}</span>
    </button>
  )
}

const TH = 'whitespace-nowrap border-b border-border-strong px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted'
const TD = 'border-b border-border px-3 py-2 align-middle'

function ProjectName({ row }: { row: PortfolioRow }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <ProjectKey value={row.project.key} />
      <span className="truncate text-fg">{row.project.name}</span>
    </span>
  )
}

function DecisionTable({ rows, today, onOpen }: { rows: PortfolioRow[]; today: string; onOpen: (row: PortfolioRow) => void }) {
  const { t } = useTranslation()
  const reasonText = useReasonText()
  const items = decisionItems(rows, today)
  if (!items.length) return <p className="rounded-lg border border-border px-4 py-3 text-sm text-muted">{t('tracking.decision.none')}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr>
            <th className={TH}>{t('tracking.columns.priority')}</th>
            <th className={TH}>{t('tracking.columns.project')}</th>
            <th className={TH}>{t('tracking.columns.area')}</th>
            <th className={TH}>{t('tracking.columns.owner')}</th>
            <th className={TH}>{t('tracking.columns.reason')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ row, reasons }) => (
            <tr key={row.project.id} className="cursor-pointer hover:bg-surface-2" onClick={() => onOpen(row)}>
              <td className={cn(TD, 'whitespace-nowrap')}>
                <Priority value={row.project.priority} />
              </td>
              <td className={TD}>
                <ProjectName row={row} />
              </td>
              <td className={cn(TD, 'text-muted')}>{row.project.area?.name ?? t('tracking.noArea')}</td>
              <td className={cn(TD, 'text-muted')}>{row.project.owner?.name ?? '—'}</td>
              <td className={TD}>{reasons.map((r) => reasonText(r, row)).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function Priority({ value }: { value: PortfolioRow['project']['priority'] }) {
  const { t } = useTranslation()
  return <span className={cn(value === 'critical' || value === 'high' ? 'font-semibold text-fg' : 'text-fg')}>{t(`projects.priority.${value}`)}</span>
}

const SITUATION_TONE: Record<TrackingSituation, string> = { risk: 'text-danger', watch: 'text-warning', ok: 'text-fg', none: 'text-muted' }
const SITUATION_DOT: Record<TrackingSituation, string> = { risk: 'bg-danger', watch: 'bg-warning', ok: 'border border-border-strong', none: 'border border-dashed border-border-strong' }

function Situation({ row }: { row: PortfolioRow }) {
  const { t } = useTranslation()
  const reason = useHealthReason()
  const situation = situationOf(row)
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', SITUATION_TONE[situation])} title={reason(row.health) ?? undefined}>
      <span aria-hidden className={cn('size-2 rounded-full', SITUATION_DOT[situation])} />
      {t(`tracking.situation.${situation}`)}
    </span>
  )
}

function PortfolioTable({ rows, group, today, onOpen }: { rows: PortfolioRow[]; group: TrackingGroup; today: string; onOpen: (row: PortfolioRow) => void }) {
  const { t } = useTranslation()
  const day = useDayText()
  const groups = groupPortfolio(rows, group, today)
  if (!rows.length) return <p className="rounded-lg border border-border px-4 py-3 text-sm text-muted">{t('tracking.portfolio.none')}</p>
  const groupLabel = (key: string, name: string) =>
    group === 'priority' ? t(`projects.priority.${key}`) : group === 'status' ? t(`projects.status.${key}`) : key === 'none' ? t(group === 'area' ? 'tracking.noArea' : 'tracking.noOwner') : name
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse text-sm">
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
                  <td className={cn(TD, 'max-w-72')}>
                    <ProjectName row={row} />
                  </td>
                  {group !== 'area' && <td className={cn(TD, 'text-muted')}>{row.project.area?.name ?? t('tracking.noArea')}</td>}
                  {group !== 'owner' && <td className={cn(TD, 'whitespace-nowrap text-muted')}>{row.project.owner?.name ?? '—'}</td>}
                  {group !== 'status' && <td className={cn(TD, 'whitespace-nowrap')}>{t(`projects.status.${row.project.status}`)}</td>}
                  {group !== 'priority' && (
                    <td className={cn(TD, 'whitespace-nowrap')}>
                      <Priority value={row.project.priority} />
                    </td>
                  )}
                  <td className={TD}>
                    <Situation row={row} />
                  </td>
                  <td className={cn(TD, 'text-right whitespace-nowrap tabular-nums')}>{row.progress ? `${row.progress.value} %` : '—'}</td>
                  <td className={cn(TD, 'whitespace-nowrap tabular-nums', late > 0 && 'font-semibold text-danger')}>
                    {row.project.dueDate ? day(row.project.dueDate) : t('tracking.noDate')}
                    {late > 0 && ` · ${t('tracking.lateShort', { count: late })}`}
                  </td>
                  <td className={cn(TD, 'max-w-56 truncate')}>{row.nextMilestone ? `${row.nextMilestone.name} · ${day(row.nextMilestone.dueDate)}` : '—'}</td>
                  <td className={cn(TD, 'text-right whitespace-nowrap tabular-nums')}>
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

function PeriodBlock({ data }: { data: NonNullable<ReturnType<typeof useExecutiveDashboard>['data']> }) {
  const { t } = useTranslation()
  const duration = useDurationText()
  const label = (start: string) => `${start.slice(8, 10)}/${start.slice(5, 7)}`
  const points = data.timeline.points
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted">{t('tracking.periodNumbers.done')}</dt>
          <dd className="text-lg font-semibold tabular-nums text-fg">{data.kanban.completed}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t('tracking.periodNumbers.milestones')}</dt>
          <dd className="text-lg font-semibold tabular-nums text-fg">{data.summary.deliveries.milestones}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t('tracking.periodNumbers.work')}</dt>
          <dd className="text-lg font-semibold tabular-nums text-fg">{duration(data.kanban.cycleTime)}</dd>
        </div>
      </dl>
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-fg">{t('tracking.charts.flowTitle')}</h3>
        <p className="mb-3 text-xs text-muted">{t('tracking.charts.flowHint')}</p>
        <AppTrendChart
          title={t('tracking.charts.flowTitle')}
          seriesA={t('tracking.charts.created')}
          seriesB={t('tracking.charts.done')}
          points={points.map((p) => ({ key: p.start, label: label(p.start), a: p.tasksCreated, b: p.tasksCompleted }))}
        />
      </div>
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-fg">{t('tracking.charts.stockTitle')}</h3>
        <p className="mb-3 text-xs text-muted">{t('tracking.charts.stockHint')}</p>
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
    </div>
  )
}

function ProjectDrawer({ row, today, onClose }: { row: PortfolioRow | null; today: string; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const day = useDayText()
  const reason = useHealthReason()
  if (!row) return <AppDrawer open={false} onOpenChange={() => onClose()} title="">{null}</AppDrawer>
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
      description={row.project.key}
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
