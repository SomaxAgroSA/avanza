import { useTranslation } from 'react-i18next'
import { averageDelivery, kanbanFlow, FUNNEL_CATEGORIES, type ExecutiveKanbanSection, type ExecutivePlanSection } from '@/domain/executive'
import type { PlanStatusCategory } from '@/domain/plan'
import { formatNumber } from '@/core/utils/format'
import { AppAnimatedNumber, AppEmptyState, AppMeter, AppMetric, AppStackedBar, type AppChartTone } from '@/presentation/components'
import { ExecutiveSection } from './executive-visuals'
import { useHoursText } from './use-executive-format'

/** Situação do elemento → tom: a rampa do verde mede o avanço; bloqueado é o único alerta. */
const PLAN_TONE: Record<PlanStatusCategory | 'none', AppChartTone> = {
  todo: 'primary-faint',
  in_progress: 'accent',
  review: 'primary-soft',
  blocked: 'danger',
  done: 'primary',
  canceled: 'neutral',
  none: 'neutral',
}

/** Etapa do Kanban → tom (do backlog, neutro, até concluída, no verde da marca). */
const FLOW_TONE = { backlog: 'neutral', todo: 'primary-faint', in_progress: 'accent', done: 'primary' } as const satisfies Record<string, AppChartTone>

/** ④ Gestão de projetos: um visual (elementos por situação) e três números; o esforço numa linha. */
export function PlanSection({ plan, delay }: { plan: ExecutivePlanSection | null; delay?: number }) {
  const { t } = useTranslation()
  const hours = useHoursText()
  const title = t('executive.plan.title')
  if (!plan || plan.items.total === 0)
    return (
      <ExecutiveSection title={title} delay={delay}>
        <AppEmptyState compact title={t('executive.plan.empty')} description={t('executive.plan.emptyHint')} />
      </ExecutiveSection>
    )
  const { schedule, effort } = plan
  // esforço só quando há estimativa e algo apontado (sem apontamento, "0 h de N h" não informa nada)
  const estimated = effort.estimated ?? 0
  const actual = effort.actual ?? 0
  const showEffort = estimated > 0 && actual > 0
  return (
    <ExecutiveSection title={title} delay={delay} meta={t('executive.plan.count', { count: plan.items.total })}>
      <AppStackedBar
        label={t('executive.plan.byStatus')}
        segments={plan.statusDistribution.map((d) => ({
          key: d.category,
          label: d.category === 'none' ? t('executive.plan.noStatus') : t(`plan.categories.${d.category}`),
          value: d.count,
          tone: PLAN_TONE[d.category],
        }))}
      />
      <div className="mt-6 grid grid-cols-3 gap-4 border-t border-border pt-5">
        <AppMetric label={t('executive.plan.onTime')} value={<AppAnimatedNumber value={schedule.onTime} />} />
        <AppMetric label={t('executive.plan.overdue')} value={<AppAnimatedNumber value={schedule.overdue} />} tone={schedule.overdue ? 'danger' : 'default'} />
        <AppMetric label={t('executive.plan.done')} value={<AppAnimatedNumber value={schedule.done} />} />
      </div>
      {showEffort && (
        <div className="mt-5 flex flex-col gap-2 border-t border-border pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="text-muted">{t('executive.plan.effort')}</span>
            <span className="tabular-nums text-fg">{t('executive.plan.effortOf', { actual: hours(actual), estimated: hours(estimated) })}</span>
          </div>
          <AppMeter value={(actual / estimated) * 100} label={t('executive.plan.effort')} tone={actual > estimated ? 'danger' : 'primary'} />
        </div>
      )}
    </ExecutiveSection>
  )
}

/** ⑤ Kanban de atividades: o fluxo numa barra e três números (o tempo médio só com amostra). */
export function KanbanSection({ kanban, delay }: { kanban: ExecutiveKanbanSection; delay?: number }) {
  const { t, i18n } = useTranslation()
  const title = t('executive.kanban.title')
  const total = FUNNEL_CATEGORIES.reduce((sum, category) => sum + kanban.funnel[category], 0)
  if (total === 0 && kanban.completed === 0)
    return (
      <ExecutiveSection title={title} delay={delay}>
        <AppEmptyState compact title={t('executive.kanban.empty')} description={t('executive.kanban.emptyHint')} />
      </ExecutiveSection>
    )
  const lead = averageDelivery(kanban.leadTime)
  return (
    <ExecutiveSection title={title} delay={delay} meta={t('executive.kanban.count', { count: total })}>
      <AppStackedBar
        label={t('executive.kanban.flow')}
        segments={kanbanFlow(kanban.funnel).map(({ category, count }) => ({ key: category, label: t(`workflow.categories.${category}`), value: count, tone: FLOW_TONE[category] }))}
      />
      <div className="mt-6 grid grid-cols-3 gap-4 border-t border-border pt-5">
        <AppMetric label={t('executive.kanban.inProgress')} value={<AppAnimatedNumber value={kanban.funnel.in_progress} />} />
        <AppMetric label={t('executive.kanban.completed')} value={<AppAnimatedNumber value={kanban.completed} />} />
        {lead && <AppMetric label={t('executive.kanban.leadTime')} value={t(`reports.units.${lead.unit}`, { value: formatNumber(lead.value, i18n.language) })} />}
      </div>
    </ExecutiveSection>
  )
}
