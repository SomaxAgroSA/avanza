import { PROJECT_STATUSES, type ProjectStatus } from '@/domain/projects'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CalendarRange, FolderKanban, Printer } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDate } from '@/core/utils/format'
import { cn } from '@/core/utils/cn'
import {
  attentionItems,
  hasDeliveries,
  DEFAULT_EXECUTIVE_PERIOD,
  EXECUTIVE_PERIODS,
  executivePeriodRange,
  isExecutivePeriod,
  type ExecutiveDashboard,
  type ExecutivePeriod,
  type ExecutiveProjectOption,
  type ExecutiveQuery,
} from '@/domain/executive'
import type { HealthLevel } from '@/domain/plan-management'
import {
  AppButton,
  AppEmptyState,
  AppLoadingBar,
  AppErrorState,
  AppIconButton,
  AppMultiSelect,
  AppPopover,
  AppRangeCalendar,
  AppSegmentedControl,
  AppSelect,
  AppSkeleton,
} from '@/presentation/components'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useMediaQuery } from '@/presentation/common/use-media-query'
import { scrollToElement } from '@/presentation/common/motion'
import { useExecutiveDashboard } from './queries'
import { HeroSection } from './HeroSection'
import { AttentionSection } from './AttentionSection'
import { PortfolioSection } from './PortfolioSection'
import { KanbanSection, PlanSection } from './ModuleSections'
import { AchievementsSection, TimelineSection } from './DeliverySections'
import { useDayText } from './use-executive-format'

/** Âncoras das seções (as métricas do topo rolam até elas). */
const SECTION = { attention: 'executive-attention', portfolio: 'executive-portfolio', timeline: 'executive-timeline', achievements: 'executive-achievements' }

/** Filtros na URL (o link do painel filtrado pode ser compartilhado). */
function useExecutiveParams() {
  const [params, setParams] = useSearchParams()
  const set = (patch: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        Object.entries(patch).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)))
        return next
      },
      { replace: true },
    )
  const raw = params.get('period') ?? ''
  const period = isExecutivePeriod(raw) ? raw : DEFAULT_EXECUTIVE_PERIOD
  const projectIds = (params.get('projects') ?? '').split(',').filter(Boolean)
  const statuses = (params.get('status') ?? '').split(',').filter((s): s is ProjectStatus => (PROJECT_STATUSES as readonly string[]).includes(s))
  return { period, projectIds, statuses, from: params.get('from') ?? '', to: params.get('to') ?? '', set }
}

/**
 * Painel executivo para a diretoria — o estado primeiro, as exceções depois, o detalhe por último:
 * ① saúde do portfólio e três números; ② o que precisa de atenção; ③ portfólio; ④⑤ os dois módulos
 * (Gestão de projetos e Kanban de atividades); ⑥ entregas no tempo; ⑦ o que já foi feito. Os números vêm
 * prontos da API (GET /executive) e a priorização das exceções de domain/executive.ts; sem números por
 * pessoa. A impressão (PDF) sai em A4 claro, sem menu, barra superior e filtros (styles/index.css).
 */
export function ExecutivePage() {
  const { t, i18n } = useTranslation()
  useDocumentTitle(t('executive.title'))
  const { period, projectIds, statuses, from, to, set } = useExecutiveParams()
  const [now] = useState(() => new Date())
  const range = executivePeriodRange(period, now, { from, to })
  const query: ExecutiveQuery | null = range ? { projectIds, statuses, from: range.from, to: range.to, tzOffset: now.getTimezoneOffset() } : null
  const dashboard = useExecutiveDashboard(query)
  const data = dashboard.data
  const time = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' })
  // filtro de saúde do portfólio (escolhido na rosca/legenda ou em "Ver críticos"): só na tela, não na URL
  const [healthFilter, setHealthFilter] = useState<HealthLevel | null>(null)
  const go = (target: 'portfolio' | 'attention' | 'deliveries') => {
    const deliveries = data && hasDeliveries(data.timeline.points) ? SECTION.timeline : SECTION.achievements
    scrollToElement(document.getElementById(target === 'portfolio' ? SECTION.portfolio : target === 'attention' ? SECTION.attention : deliveries))
  }
  const filterHealth = (level: HealthLevel) => {
    setHealthFilter((current) => (current === level ? null : level))
    if (healthFilter !== level) go('portfolio')
  }

  return (
    <>
      <header className="mb-6 flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{t('executive.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('executive.description')}</p>
          {data && <p className="mt-0.5 text-xs text-subtle print:hidden">{t('executive.updatedAt', { time: time.format(data.generatedAt) })}</p>}
          {data && <ScopeLine data={data} projectIds={projectIds} period={period} />}
        </div>
        <Filters
          projects={data?.projects ?? []}
          projectIds={projectIds}
          statuses={statuses}
          period={period}
          from={from}
          to={to}
          onProjects={(ids) => set({ projects: ids.join(',') })}
          onStatuses={(list) => set({ status: list.join(',') })}
          onPeriod={(value) => set({ period: value === DEFAULT_EXECUTIVE_PERIOD ? '' : value, ...(value === 'custom' ? {} : { from: '', to: '' }) })}
          onDates={(patch) => set(patch)}
        />
      </header>

      {!range ? (
        <p role="alert" className="text-sm text-danger">
          {t('executive.filters.invalidPeriod')}
        </p>
      ) : dashboard.isPending ? (
        <LoadingSkeleton />
      ) : dashboard.isError || !data ? (
        <AppErrorState
          title={t('executive.loadError')}
          correlationId={isAppError(dashboard.error) ? dashboard.error.correlationId : undefined}
          onRetry={() => void dashboard.refetch()}
        />
      ) : data.projects.length === 0 ? (
        <AppEmptyState icon={<FolderKanban />} title={t('executive.noProjects')} description={t('executive.noProjectsHint')} />
      ) : (
        // ao trocar o filtro, o painel anterior fica na tela (com o fio de carregamento) e os números
        // animam até os novos valores quando chegam — sem voltar ao esqueleto
        <div className="relative">
          {dashboard.isPlaceholderData && <AppLoadingBar label={t('executive.updating')} className="sticky -top-2 -mt-0.5 rounded-full print:hidden" />}
          <div className={cn('flex flex-col gap-6 transition-opacity duration-300', dashboard.isPlaceholderData && 'opacity-80')} aria-busy={dashboard.isPlaceholderData || undefined}>
            <HeroSection summary={data.summary} timeline={data.timeline} healthFilter={healthFilter} onHealthFilter={filterHealth} onGo={go} />
            <div className="grid gap-6 2xl:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
              <AttentionSection id={SECTION.attention} delay={60} items={attentionItems(data)} onSeeCritical={() => filterHealth('critical')} />
              <PortfolioSection id={SECTION.portfolio} delay={120} rows={data.portfolio} healthFilter={healthFilter} onClearFilter={() => setHealthFilter(null)} />
            </div>
            <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2">
              <PlanSection plan={data.plan} delay={180} />
              <KanbanSection kanban={data.kanban} delay={240} />
            </div>
            <TimelineSection id={SECTION.timeline} delay={300} timeline={data.timeline} />
            <AchievementsSection id={SECTION.achievements} delay={360} achievements={data.achievements} projects={data.projects} />
          </div>
        </div>
      )}
    </>
  )
}

function Filters({
  projects,
  projectIds,
  statuses,
  period,
  from,
  to,
  onProjects,
  onStatuses,
  onPeriod,
  onDates,
}: {
  projects: ExecutiveProjectOption[]
  projectIds: string[]
  statuses: ProjectStatus[]
  period: ExecutivePeriod
  from: string
  to: string
  onProjects: (ids: string[]) => void
  onStatuses: (statuses: ProjectStatus[]) => void
  onPeriod: (period: ExecutivePeriod) => void
  onDates: (patch: { from: string; to: string }) => void
}) {
  const { t } = useTranslation()
  const day = useDayText()
  const phone = useMediaQuery('(max-width: 639px)')
  const [rangeOpen, setRangeOpen] = useState(false)
  // com status escolhidos, a lista de projetos mostra só os desses status (e os já escolhidos)
  const visible = statuses.length ? projects.filter((p) => (p.status && statuses.includes(p.status)) || projectIds.includes(p.id)) : projects
  const statusOptions = PROJECT_STATUSES.map((s) => ({ value: s, label: t(`projects.status.${s}`) }))
  const options = visible.map((p) => {
    const label = `${p.key} · ${p.name}`
    return { value: p.id, label: p.archived ? t('executive.filters.archived', { name: label }) : label }
  })
  const periods = EXECUTIVE_PERIODS.map((p) => ({ value: p, label: t(`executive.periods.${p}`) }))
  const choose = (value: string) => {
    if (!isExecutivePeriod(value)) return
    onPeriod(value)
    if (value === 'custom') setRangeOpen(true)
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center 2xl:shrink-0 2xl:flex-nowrap 2xl:justify-end print:hidden">
      <AppMultiSelect
        label={<span className="sr-only">{t('executive.filters.projects')}</span>}
        display="summary"
        allOptionLabel={t('executive.filters.allProjects')}
        summary={(count) => t('executive.filters.selectedProjects', { count })}
        value={projectIds}
        onValueChange={onProjects}
        options={options}
        className="w-full gap-0 sm:w-60"
      />
      <AppMultiSelect
        label={<span className="sr-only">{t('executive.filters.statuses')}</span>}
        display="summary"
        allOptionLabel={t('executive.filters.allStatuses')}
        summary={(count) => t('executive.filters.selectedStatuses', { count })}
        value={statuses}
        onValueChange={(list) => onStatuses(list.filter((s): s is ProjectStatus => (PROJECT_STATUSES as readonly string[]).includes(s)))}
        options={statusOptions}
        className="w-full gap-0 sm:w-48"
      />
      <div className="flex items-center gap-2">
        {phone ? (
          <AppSelect aria-label={t('executive.filters.period')} className="flex-1" value={period} onValueChange={choose} options={periods} />
        ) : (
          <AppSegmentedControl label={t('executive.filters.period')} value={period} onValueChange={choose} options={periods} />
        )}
        <AppIconButton variant="secondary" label={t('executive.print')} icon={<Printer />} onClick={() => window.print()} />
      </div>
      {period === 'custom' && (
        <AppPopover
          label={t('executive.filters.period')}
          open={rangeOpen}
          onOpenChange={setRangeOpen}
          align="end"
          trigger={
            <AppButton variant="secondary" size="sm" leftIcon={<CalendarRange />} className="self-start sm:self-auto">
              {from && to ? t('executive.filters.range', { from: day(from), to: day(to) }) : t('executive.filters.pickDates')}
            </AppButton>
          }
        >
          <AppRangeCalendar value={{ start: from, end: to }} onChange={(next) => onDates({ from: next.start, to: next.end })} focusOnMount />
        </AppPopover>
      )}
    </div>
  )
}

/** Escopo do painel (período e projetos) — só na impressão, onde os filtros somem. */
function ScopeLine({ data, projectIds, period }: { data: ExecutiveDashboard; projectIds: string[]; period: string }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const when =
    period === 'all' || !data.period.from
      ? t('executive.scope.sinceStart', { to: formatDate(data.period.to, lang) })
      : t('executive.scope.range', { from: formatDate(data.period.from, lang), to: formatDate(data.period.to, lang) })
  const selected = data.projects.filter((p) => projectIds.includes(p.id))
  const which =
    projectIds.length === 0
      ? t('executive.scope.allProjects')
      : selected.length > 0 && selected.length <= 3
        ? selected.map((p) => p.key).join(', ')
        : t('executive.scope.someProjects', { count: projectIds.length })
  return (
    <p className="mt-1 hidden text-sm text-muted print:block">
      {when} · {which}
    </p>
  )
}

/** Esqueleto no formato do painel (faixa de destaque, atenção + portfólio, módulos, entregas). */
function LoadingSkeleton() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label={t('common.loading')}>
      <div className="grid overflow-hidden rounded-xl border border-border bg-surface lg:grid-cols-[minmax(0,5fr)_minmax(0,9fr)]">
        <div className="flex items-center gap-6 p-6">
          <AppSkeleton className="size-36 rounded-full" />
          <div className="flex flex-1 flex-col gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <AppSkeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
        <div className="grid gap-6 p-6 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <AppSkeleton className="h-4 w-24" />
              <AppSkeleton className="h-9 w-20" />
              <AppSkeleton className="mt-auto h-2 w-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
        <AppSkeleton className="h-80 rounded-xl" />
        <AppSkeleton className="h-80 rounded-xl" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <AppSkeleton className="h-64 rounded-xl" />
        <AppSkeleton className="h-64 rounded-xl" />
      </div>
      <AppSkeleton className="h-56 rounded-xl" />
    </div>
  )
}
