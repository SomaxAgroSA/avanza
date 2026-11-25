import { useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FolderKanban, Printer } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import type { ExecutiveDashboard, ExecutiveQuery, PortfolioRow } from '@/domain/executive'
import {
  DEFAULT_TRACKING_PERIOD,
  DELIVERY_ONLY_STATUSES,
  TRACKED_STATUSES,
  TRACKING_PERIODS,
  isTrackingPeriod,
  panoramaKpis,
  panoramaOptions,
  panoramaRows,
  panoramaSynthesis,
  todayOf,
  trackingPeriodRange,
  type PanoramaFilter,
  type PanoramaScope,
  type TrackingPeriod,
} from '@/domain/tracking'
import { AppButton, AppDatePicker, AppEmptyState, AppErrorState, AppIconButton, AppLoading, AppSegmentedControl, AppSelect } from '@/presentation/components'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { SESSION_QUERY_KEY, useCan, useSession } from '@/features/auth/session'
import { useScreens } from '@/features/auth/use-screens'
import { cn } from '@/core/utils/cn'
import { panoramaOffPath } from '@/presentation/navigation/home-page'
import { useExecutiveDashboard } from '@/features/executive/queries'
import { AttentionTable, ExecutionCard, HealthCard, KpiRow, MilestonesList, ProjectSummaryDrawer, SynthesisCard } from './panorama-sections'
import { scrollToTable } from './panorama-scroll'

/**
 * Entrada do menu: a gerência (executive.view) vê o Panorama; quem só tem reports.view, os Relatórios.
 * Com o Panorama desligado na plataforma (§26.2), o endereço leva todos a Tarefas.
 */
export function TrackingEntry() {
  const { current } = useSession()
  const canView = useCan('executive.view')
  // sem a sessão ainda não dá para decidir (no app, RequireAuth já espera por ela)
  if (!current) return null
  if (!current.platform.panoramaEnabled) return <PanoramaOff />
  return canView ? <TrackingPage /> : <Navigate to="/reports" replace />
}

/** Panorama desligado (§26.2): vai para Tarefas (sem a Lista de tarefas, para os projetos) e relê a sessão (o menu acompanha). */
function PanoramaOff() {
  const { current } = useSession()
  const queryClient = useQueryClient()
  const disabledInSession = !!current && !current.platform.panoramaEnabled
  useEffect(() => {
    // desligado com a tela aberta: a sessão ainda dizia ligado
    if (!disabledInSession) void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
  }, [disabledInSession, queryClient])
  return <Navigate to={panoramaOffPath(current?.permissions ?? [])} replace />
}

/**
 * Panorama executivo (regras de negócio §26.1): filtros (área, responsável, projeto e período) que
 * valem para tudo — a leitura já vem recortada do servidor —, síntese para a direção, cinco
 * indicadores, saúde do portfólio, execução × planejamento, projetos que requerem atenção (com o
 * resumo de cada um) e os próximos marcos.
 */
export function TrackingPage() {
  const { t, i18n } = useTranslation()
  useDocumentTitle(t('tracking.title'))
  const [params, setParams] = useSearchParams()
  const [now] = useState(() => new Date())
  const today = todayOf(now)
  const [filter, setFilter] = useState<PanoramaFilter>('attention')
  const [opened, setOpened] = useState<PortfolioRow | null>(null)

  const set = (patch: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        Object.entries(patch).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)))
        return next
      },
      { replace: true },
    )
  const scope: PanoramaScope = { areaId: params.get('area') ?? '', ownerId: params.get('owner') ?? '', projectId: params.get('project') ?? '' }
  const rawPeriod = params.get('period') ?? ''
  const period: TrackingPeriod = isTrackingPeriod(rawPeriod) ? rawPeriod : DEFAULT_TRACKING_PERIOD
  const range = trackingPeriodRange(period, now, { from: params.get('from'), to: params.get('to') })

  // uma leitura só, já recortada: os filtros valem para todos os blocos (e para as entregas do período)
  const query: ExecutiveQuery = {
    projectIds: scope.projectId ? [scope.projectId] : [],
    statuses: [...TRACKED_STATUSES],
    deliveryStatuses: [...DELIVERY_ONLY_STATUSES],
    areaIds: scope.areaId ? [scope.areaId] : [],
    ownerIds: scope.ownerId ? [scope.ownerId] : [],
    from: range.from,
    to: range.to,
    tzOffset: now.getTimezoneOffset(),
  }
  const dashboard = useExecutiveDashboard(query)
  const data = dashboard.data
  // enquanto a leitura nova não chega, os números antigos (de outro filtro) não aparecem
  const fresh = data && !dashboard.isPlaceholderData ? data : undefined

  const options = useMemo(() => panoramaOptions(data?.projects ?? [], { areaId: scope.areaId, ownerId: scope.ownerId }), [data, scope.areaId, scope.ownerId])
  const filtered = !!(scope.areaId || scope.ownerId || scope.projectId)
  const changeScope = (patch: Partial<PanoramaScope>) => {
    const next = { ...scope, ...patch }
    // o projeto escolhido sai quando deixa de pertencer à área/responsável
    if (next.projectId && (patch.areaId !== undefined || patch.ownerId !== undefined) && !panoramaOptions(data?.projects ?? [], next).projects.some((p) => p.id === next.projectId)) next.projectId = ''
    setFilter('attention')
    set({ area: next.areaId, owner: next.ownerId, project: next.projectId })
  }
  const changePeriod = (value: TrackingPeriod) => {
    if (value === 'custom') set({ period: 'custom', from: range.from, to: range.to })
    else set({ period: value === DEFAULT_TRACKING_PERIOD ? '' : value, from: '', to: '' })
  }
  const changeDay = (key: 'from' | 'to', value: string) => {
    if (!value) return
    // o período nunca fica invertido: a outra ponta acompanha
    if (key === 'from') set({ from: value, to: value > range.to ? value : range.to })
    else set({ to: value, from: value < range.from ? value : range.from })
  }

  if (dashboard.isError && !data) {
    if (isAppError(dashboard.error) && dashboard.error.code === 'PANORAMA_DISABLED') return <PanoramaOff />
    return <AppErrorState title={t('tracking.loadError')} correlationId={isAppError(dashboard.error) ? dashboard.error.correlationId : undefined} onRetry={() => void dashboard.refetch()} />
  }
  if (!data) return <AppLoading label={t('tracking.loading')} />

  const allLabel = (key: 'allAreas' | 'allOwners' | 'allProjects') => t(`tracking.filters.${key}`)
  const areaOptions = [
    { value: 'all', label: allLabel('allAreas') },
    ...options.areas.map((a) => ({ value: a.id, label: a.name })),
    ...(options.withoutArea ? [{ value: 'none', label: t('tracking.filters.noArea') }] : []),
  ]
  const ownerOptions = [{ value: 'all', label: allLabel('allOwners') }, ...options.owners.map((o) => ({ value: o.id, label: o.name }))]
  const projectOptions = [{ value: 'all', label: allLabel('allProjects') }, ...options.projects.map((p) => ({ value: p.id, label: p.name }))]
  const cutoff = `${new Intl.DateTimeFormat(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(data.generatedAt)} ${new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(data.generatedAt)}`
  const supervisedAny = data.projects.some((p) => !p.archived && !!p.status && (TRACKED_STATUSES as readonly string[]).includes(p.status))

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 pb-10">
      <header className="flex items-start justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{t('tracking.heading')}</h1>
        <AppIconButton variant="secondary" label={t('tracking.print')} icon={<Printer />} onClick={() => window.print()} className="print:hidden" />
      </header>

      <div role="group" aria-label={t('tracking.filters.group')} className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-fg print:hidden">{t('tracking.filters.label')}</span>
        <div className="contents print:hidden">
          <AppSelect size="sm" aria-label={t('tracking.filters.area')} value={scope.areaId || 'all'} onValueChange={(v) => changeScope({ areaId: v === 'all' ? '' : v })} options={areaOptions} triggerClassName="min-w-40" />
          <AppSelect size="sm" aria-label={t('tracking.filters.owner')} value={scope.ownerId || 'all'} onValueChange={(v) => changeScope({ ownerId: v === 'all' ? '' : v })} options={ownerOptions} triggerClassName="min-w-40" />
          <AppSelect
            size="sm"
            aria-label={t('tracking.filters.project')}
            value={scope.projectId || 'all'}
            onValueChange={(v) => changeScope({ projectId: v === 'all' ? '' : v })}
            options={projectOptions}
            triggerClassName="min-w-40 max-w-64"
            searchable={projectOptions.length > 12}
          />
          <AppSegmentedControl size="sm" label={t('tracking.period.label')} value={period} onValueChange={changePeriod} options={TRACKING_PERIODS.map((p) => ({ value: p, label: t(`tracking.period.${p}`) }))} />
          {period === 'custom' && (
            <span className="flex flex-wrap items-center gap-2">
              <AppDatePicker aria-label={t('tracking.filters.from')} placeholder={t('tracking.filters.from')} value={range.from} max={range.to} onValueChange={(v) => changeDay('from', v)} clearable={false} fieldClassName="w-36" />
              <AppDatePicker aria-label={t('tracking.filters.to')} placeholder={t('tracking.filters.to')} value={range.to} min={range.from} onValueChange={(v) => changeDay('to', v)} clearable={false} fieldClassName="w-36" />
            </span>
          )}
        </div>
        <span className="text-xs text-muted sm:ml-auto">{t('tracking.cutoff', { time: cutoff })}</span>
      </div>

      {!supervisedAny ? (
        <AppEmptyState icon={<FolderKanban />} title={t('tracking.empty')} description={t('tracking.emptyHint')} />
      ) : !fresh ? (
        <AppLoading label={t('tracking.updating')} />
      ) : fresh.portfolio.length === 0 ? (
        <AppEmptyState
          icon={<FolderKanban />}
          title={t('tracking.emptyFiltered')}
          description={t('tracking.emptyFilteredHint')}
          action={
            filtered ? (
              <AppButton variant="secondary" onClick={() => changeScope({ areaId: '', ownerId: '', projectId: '' })}>
                {t('tracking.filters.clear')}
              </AppButton>
            ) : undefined
          }
        />
      ) : (
        <PanoramaContent data={fresh} today={today} filter={filter} onFilter={setFilter} onOpen={setOpened} />
      )}

      <ProjectSummaryDrawer row={opened} plan={fresh?.plan} today={today} onClose={() => setOpened(null)} />
    </div>
  )
}

function PanoramaContent({
  data,
  today,
  filter,
  onFilter,
  onOpen,
}: {
  data: ExecutiveDashboard
  today: string
  filter: PanoramaFilter
  onFilter: (filter: PanoramaFilter) => void
  onOpen: (row: PortfolioRow) => void
}) {
  const rows = data.portfolio
  const kpis = panoramaKpis(rows, today)
  const synthesis = panoramaSynthesis(kpis, data.summary.deliveries.tasks)
  // indicador clicado: filtra a tabela e leva até ela; o mesmo de novo volta ao padrão
  const pick = (next: PanoramaFilter) => {
    onFilter(filter === next ? 'attention' : next)
    scrollToTable()
  }
  // blocos que o perfil mostra ("O que aparece" §48, `tracking.blocks.*`)
  const { shows } = useScreens()
  const health = shows('tracking.blocks.health')
  const execution = shows('tracking.blocks.execution')
  return (
    <>
      {shows('tracking.blocks.synthesis') && <SynthesisCard synthesis={synthesis} />}
      {shows('tracking.blocks.kpis') && <KpiRow kpis={kpis} filter={filter} onFilter={pick} />}
      {(health || execution) && (
        <div className={cn('grid grid-cols-1 gap-3', health && execution && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]')}>
          {health && <HealthCard kpis={kpis} filter={filter} onFilter={onFilter} />}
          {execution && <ExecutionCard kpis={kpis} data={data} />}
        </div>
      )}
      {shows('tracking.blocks.attention') && <AttentionTable rows={panoramaRows(rows, today, filter)} filter={filter} today={today} onClear={() => onFilter('attention')} onOpen={onOpen} />}
      {shows('tracking.blocks.milestones') && <MilestonesList data={data} rows={rows} today={today} />}
    </>
  )
}
