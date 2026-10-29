import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Printer } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDate } from '@/core/utils/format'
import {
  DEFAULT_EXECUTIVE_PERIOD,
  EXECUTIVE_PERIODS,
  executivePeriodRange,
  isExecutivePeriod,
  type ExecutiveDashboard,
  type ExecutiveProjectOption,
  type ExecutiveQuery,
} from '@/domain/executive'
import { AppButton, AppDatePicker, AppErrorState, AppMultiSelect, AppSelect, AppSkeleton } from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { cn } from '@/core/utils/cn'
import { useExecutiveDashboard } from './queries'
import { SummarySection } from './SummarySection'
import { PortfolioSection } from './PortfolioSection'
import { KanbanSection, PlanSection } from './ModuleSections'
import { AchievementsSection, TimelineSection } from './DeliverySections'

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
  return { period, projectIds, from: params.get('from') ?? '', to: params.get('to') ?? '', set }
}

/**
 * Painel executivo: visão consolidada da Gestão de projetos e do Kanban de atividades para a diretoria
 * (resumo, portfólio com a saúde, os dois módulos, entregas no tempo e o que já foi feito). Os números
 * vêm prontos da API (GET /executive); sem números por pessoa. "Imprimir / PDF" usa a impressão do
 * navegador (sem menu, barra superior e filtros; cores claras — styles/index.css).
 */
export function ExecutivePage() {
  const { t, i18n } = useTranslation()
  const { period, projectIds, from, to, set } = useExecutiveParams()
  const [now] = useState(() => new Date())
  const range = executivePeriodRange(period, now, { from, to })
  const query: ExecutiveQuery | null = range ? { projectIds, from: range.from, to: range.to, tzOffset: now.getTimezoneOffset() } : null
  const dashboard = useExecutiveDashboard(query)
  const data = dashboard.data
  const time = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' })

  return (
    <>
      <PageHeader
        title={t('executive.title')}
        description={t('executive.description')}
        actions={
          <>
            {data && <span className="text-sm text-muted">{t('executive.updatedAt', { time: time.format(data.generatedAt) })}</span>}
            <AppButton variant="secondary" size="sm" leftIcon={<Printer />} onClick={() => window.print()} className="print:hidden">
              {t('executive.print')}
            </AppButton>
          </>
        }
      />
      <div className="flex flex-col gap-6">
        <Filters
          projects={data?.projects ?? []}
          projectIds={projectIds}
          period={period}
          from={from}
          to={to}
          onProjects={(ids) => set({ projects: ids.join(',') })}
          onPeriod={(value) => set({ period: value === DEFAULT_EXECUTIVE_PERIOD ? '' : value, ...(value === 'custom' ? {} : { from: '', to: '' }) })}
          onDates={(patch) => set(patch)}
        />

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
        ) : (
          <div className={cn('flex flex-col gap-6 transition-opacity', dashboard.isPlaceholderData && 'opacity-60')} aria-busy={dashboard.isPlaceholderData || undefined}>
            <ScopeLine data={data} projectIds={projectIds} period={period} />
            <SummarySection summary={data.summary} />
            <PortfolioSection rows={data.portfolio} />
            <div className="grid items-start gap-6 xl:grid-cols-2">
              <PlanSection plan={data.plan} />
              <KanbanSection kanban={data.kanban} />
            </div>
            <TimelineSection timeline={data.timeline} />
            <AchievementsSection achievements={data.achievements} />
          </div>
        )}
      </div>
    </>
  )
}

function Filters({
  projects,
  projectIds,
  period,
  from,
  to,
  onProjects,
  onPeriod,
  onDates,
}: {
  projects: ExecutiveProjectOption[]
  projectIds: string[]
  period: (typeof EXECUTIVE_PERIODS)[number]
  from: string
  to: string
  onProjects: (ids: string[]) => void
  onPeriod: (period: string) => void
  onDates: (patch: { from?: string; to?: string }) => void
}) {
  const { t } = useTranslation()
  const options = projects.map((p) => {
    const label = `${p.key} · ${p.name}`
    return { value: p.id, label: p.archived ? t('executive.filters.archived', { name: label }) : label }
  })
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end print:hidden">
      <AppMultiSelect
        label={t('executive.filters.projects')}
        placeholder={t('executive.filters.allProjects')}
        value={projectIds}
        onValueChange={onProjects}
        options={options}
        className="w-full sm:w-96"
      />
      {projectIds.length > 0 && (
        <AppButton variant="ghost" size="sm" className="self-start sm:mb-0.5 sm:self-auto" onClick={() => onProjects([])}>
          {t('executive.filters.allProjects')}
        </AppButton>
      )}
      <AppSelect
        label={t('executive.filters.period')}
        className="w-full sm:w-52"
        value={period}
        onValueChange={onPeriod}
        options={EXECUTIVE_PERIODS.map((p) => ({ value: p, label: t(`executive.periods.${p}`) }))}
      />
      {period === 'custom' && (
        <>
          <AppDatePicker label={t('executive.filters.from')} value={from} max={to || undefined} onValueChange={(value) => onDates({ from: value })} fieldClassName="w-full sm:w-44" />
          <AppDatePicker label={t('executive.filters.to')} value={to} min={from || undefined} onValueChange={(value) => onDates({ to: value })} fieldClassName="w-full sm:w-44" />
        </>
      )}
    </div>
  )
}

/** Escopo do painel (período e projetos) — fica visível também na impressão, onde os filtros somem. */
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
    <p className="text-sm text-muted">
      {when} · {which}
    </p>
  )
}

function LoadingSkeleton() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label={t('common.loading')}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <AppSkeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <AppSkeleton className="h-72 rounded-xl" />
      <div className="grid gap-6 xl:grid-cols-2">
        <AppSkeleton className="h-96 rounded-xl" />
        <AppSkeleton className="h-96 rounded-xl" />
      </div>
      <AppSkeleton className="h-56 rounded-xl" />
    </div>
  )
}
