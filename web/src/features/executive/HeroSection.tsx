import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { deliverySeries, hasDeliveries, totalDeliveries, type ExecutiveDashboard } from '@/domain/executive'
import type { HealthLevel } from '@/domain/plan-management'
import { AppAnimatedNumber, AppDonut, AppMeter, AppMetric, AppSparkline } from '@/presentation/components'
import { HEALTH_TONE } from '@/features/plan/health-visuals'
import { HealthDot } from './executive-visuals'
import { useHealthLabel, usePartsText } from './use-executive-format'

const LEVELS: HealthLevel[] = ['ok', 'attention', 'critical', 'none']

export interface HeroSectionProps {
  summary: ExecutiveDashboard['summary']
  timeline: ExecutiveDashboard['timeline']
  /** Nível da saúde que filtra o portfólio (null = nenhum). */
  healthFilter: HealthLevel | null
  onHealthFilter: (level: HealthLevel) => void
  /** Ir para o detalhe de cada número (a página rola até a seção). */
  onGo: (target: 'portfolio' | 'attention' | 'deliveries') => void
}

/**
 * ① Faixa de destaque: a saúde do portfólio (rosca com os projetos ativos no centro) e só três números —
 * progresso médio, entregas no período (com a tendência) e atrasos (vermelho só quando há). Os números
 * contam até o valor; clicar num nível (na rosca ou na legenda) filtra o portfólio; clicar num número
 * leva à seção do detalhe.
 */
export function HeroSection({ summary, timeline, healthFilter, onHealthFilter, onGo }: HeroSectionProps) {
  const { t } = useTranslation()
  const healthLabel = useHealthLabel()
  const parts = usePartsText()
  const levels = LEVELS.filter((level) => level !== 'none' || summary.health.none > 0)
  const late = summary.overdue.tasks + summary.overdue.planItems
  const delivered = totalDeliveries(summary.deliveries)
  const total = summary.activeProjects

  return (
    <section aria-labelledby="executive-hero" className="overflow-hidden rounded-xl border border-border bg-surface shadow-card motion-safe:animate-rise print:break-inside-avoid print:shadow-none">
      <h2 id="executive-hero" className="sr-only">
        {t('executive.hero.title')}
      </h2>
      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,9fr)]">
        <div className="flex items-center gap-5 border-b border-border bg-subtle-gradient p-5 sm:gap-8 sm:p-6 lg:border-r lg:border-b-0 print:border-r-0 print:border-b">
          <AppDonut
            label={t('executive.hero.health')}
            segments={levels.map((level) => ({ key: level, label: healthLabel(level), value: summary.health[level], tone: HEALTH_TONE[level] }))}
            activeKey={healthFilter}
            onSegmentClick={(key) => onHealthFilter(key as HealthLevel)}
            className="size-32 sm:size-36"
          >
            <AppAnimatedNumber value={total} className="font-display text-4xl font-semibold leading-none tracking-tight text-fg" />
            <span className="mt-1 max-w-20 text-xs leading-tight text-muted">{t('executive.hero.activeProjects', { count: total })}</span>
          </AppDonut>
          <div className="flex min-w-0 max-w-xs flex-1 flex-col gap-2">
            <h3 className="text-sm font-medium text-muted">{t('executive.hero.health')}</h3>
            <ul className="-mx-2 flex flex-col" aria-label={t('executive.hero.filterHint')}>
              {levels.map((level) => {
                const active = healthFilter === level
                return (
                  <li key={level}>
                    <button
                      type="button"
                      aria-pressed={active}
                      disabled={summary.health[level] === 0 && !active}
                      onClick={() => onHealthFilter(level)}
                      className={cn(
                        'group flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-sm transition-colors',
                        'hover:bg-surface-3/70 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:hover:bg-transparent',
                        active && 'bg-surface-3',
                        healthFilter && !active && 'opacity-60',
                      )}
                    >
                      <span className="inline-flex min-w-0 items-center gap-2 text-fg">
                        <HealthDot level={level} className="size-2.5" />
                        <span className="truncate">{healthLabel(level)}</span>
                        {active && <X className="size-3.5 text-muted" aria-hidden />}
                      </span>
                      <span className={summary.health[level] ? 'font-semibold tabular-nums text-fg' : 'tabular-nums text-subtle'}>{summary.health[level]}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <AppMetric
            size="lg"
            className="p-5 sm:p-6"
            label={t('executive.hero.progress')}
            value={summary.progress === null ? '—' : <AppAnimatedNumber value={summary.progress} format={(n) => `${Math.round(n)}%`} />}
            hint={summary.progress === null ? t('executive.hero.noProgress') : t('executive.hero.progressHint')}
            onSelect={() => onGo('portfolio')}
            actionLabel={t('executive.hero.goPortfolio')}
          >
            {summary.progress !== null && <AppMeter value={summary.progress} label={t('executive.hero.progress')} size="md" />}
          </AppMetric>
          <AppMetric
            size="lg"
            className="p-5 sm:p-6"
            label={t('executive.hero.deliveries')}
            value={<AppAnimatedNumber value={delivered} />}
            tone={delivered ? 'success' : 'default'}
            hint={parts({ tasks: summary.deliveries.tasks, items: summary.deliveries.planItems, milestones: summary.deliveries.milestones }) ?? t('executive.hero.nothingDelivered')}
            onSelect={() => onGo('deliveries')}
            actionLabel={t('executive.hero.goDeliveries')}
          >
            {hasDeliveries(timeline.points) && <AppSparkline values={deliverySeries(timeline.points)} label={t('executive.hero.trend')} />}
          </AppMetric>
          <AppMetric
            size="lg"
            className="p-5 sm:p-6"
            label={t('executive.hero.overdue')}
            value={<AppAnimatedNumber value={late} />}
            tone={late ? 'danger' : 'default'}
            hint={parts({ tasks: summary.overdue.tasks, items: summary.overdue.planItems }) ?? t('executive.hero.noOverdue')}
            onSelect={() => onGo('attention')}
            actionLabel={t('executive.hero.goAttention')}
          />
        </div>
      </div>
    </section>
  )
}
