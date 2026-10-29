import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AlarmClock, Bug, CalendarCheck, CalendarOff, CalendarX, CheckCircle2, Clock, Gauge, Hourglass, Lock, PlusCircle, Timer } from 'lucide-react'
import { FUNNEL_CATEGORIES, type ExecutiveKanbanSection, type ExecutivePlanSection } from '@/domain/executive'
import { AppBadge, AppBarList, AppEmptyState, AppStatCard } from '@/presentation/components'
import { managementLink } from '@/features/plan/paths'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { ExecutiveSection, SubTitle } from './executive-visuals'
import { useAverageTimeText, useDayText, useHoursText } from './use-executive-format'

const ISSUE_TONE = { in_progress: 'info', pending: 'warning', resolved: 'success' } as const

/** Lista curta (top 5) de um bloco: cada linha com link, detalhe e um selo à direita. */
function ShortList({ label, empty, children }: { label: string; empty: string; children: ReactNode[] }) {
  if (children.length === 0) return <p className="text-sm text-subtle">{empty}</p>
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-border">
      {children}
    </ul>
  )
}

function ShortItem({ to, title, detail, aside }: { to: string; title: ReactNode; detail: ReactNode; aside?: ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <span className="flex min-w-0 flex-col">
        <Link to={to} className="truncate text-sm font-medium text-fg hover:text-primary-text">
          {title}
        </Link>
        <span className="truncate text-xs text-muted">{detail}</span>
      </span>
      {aside && <span className="shrink-0">{aside}</span>}
    </li>
  )
}

/** ③ Gestão de projetos: elementos dos quadros de gestão dos projetos ativos. */
export function PlanSection({ plan }: { plan: ExecutivePlanSection | null }) {
  const { t } = useTranslation()
  const day = useDayText()
  const hours = useHoursText()
  const title = t('executive.plan.title')
  if (!plan || plan.items.total === 0)
    return (
      <ExecutiveSection title={title} description={t('executive.plan.description')}>
        <AppEmptyState compact title={t('executive.plan.empty')} description={t('executive.plan.emptyHint')} />
      </ExecutiveSection>
    )
  const { schedule, effort } = plan
  return (
    <ExecutiveSection title={title} description={t('executive.plan.description')}>
      <div className="flex flex-col gap-2">
        <SubTitle>{t('executive.plan.byStatus')}</SubTitle>
        <AppBarList
          label={t('executive.plan.byStatus')}
          items={plan.statusDistribution.map((d) => ({
            key: d.category,
            label: d.category === 'none' ? t('executive.plan.noStatus') : t(`plan.categories.${d.category}`),
            value: d.count,
          }))}
          formatValue={(value) => t('executive.plan.total', { count: value })}
          empty={t('executive.plan.empty')}
        />
      </div>

      <div className="flex flex-col gap-2">
        <SubTitle>{t('executive.plan.schedule')}</SubTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
          <AppStatCard label={t('plan.report.schedule.onTime')} value={schedule.onTime} icon={<CalendarCheck />} />
          <AppStatCard label={t('plan.report.schedule.overdue')} value={schedule.overdue} icon={<CalendarX />} tone={schedule.overdue ? 'danger' : 'default'} />
          <AppStatCard label={t('plan.report.schedule.unscheduled')} value={schedule.unscheduled} icon={<CalendarOff />} />
          <AppStatCard label={t('executive.plan.done')} value={schedule.done} icon={<CheckCircle2 />} tone="success" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SubTitle>{t('executive.plan.effort')}</SubTitle>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
          <AppStatCard label={t('plan.report.effort.estimated')} value={hours(effort.estimated)} icon={<Clock />} />
          <AppStatCard label={t('plan.report.effort.actual')} value={hours(effort.actual)} icon={<Hourglass />} />
          <AppStatCard label={t('plan.report.effort.remaining')} value={hours(effort.remaining)} icon={<Gauge />} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <SubTitle>{t('executive.plan.issues')}</SubTitle>
          {plan.openIssuesTotal > plan.issues.length && <span className="text-xs text-muted">{t('executive.plan.issuesShown', { shown: plan.issues.length, total: plan.openIssuesTotal })}</span>}
        </div>
        <ShortList label={t('executive.plan.issues')} empty={t('executive.plan.noIssues')}>
          {plan.issues.map((issue) => (
            <ShortItem
              key={issue.id}
              to={managementLink(issue.project.id, { view: 'management' })}
              title={
                <>
                  <span className="text-muted">#{issue.number}</span> {issue.description}
                </>
              }
              detail={[issue.project.key, issue.openedOn ? t('executive.plan.openedOn', { date: day(issue.openedOn) }) : null].filter(Boolean).join(' · ')}
              aside={<AppBadge tone={ISSUE_TONE[issue.state]}>{t(`plan.management.issues.states.${issue.state}`)}</AppBadge>}
            />
          ))}
        </ShortList>
      </div>

      <div className="flex flex-col gap-2">
        <SubTitle>{t('executive.plan.milestones')}</SubTitle>
        <ShortList label={t('executive.plan.milestones')} empty={t('executive.plan.noMilestones')}>
          {plan.upcomingMilestones.map((milestone) => (
            <ShortItem
              key={milestone.id}
              to={`/timeline/${milestone.project.id}`}
              title={milestone.name}
              detail={`${milestone.project.key} · ${milestone.project.name}`}
              aside={<span className="text-xs tabular-nums text-muted">{day(milestone.dueDate)}</span>}
            />
          ))}
        </ShortList>
      </div>
    </ExecutiveSection>
  )
}

/** ④ Kanban de atividades: tarefas dos projetos ativos. */
export function KanbanSection({ kanban }: { kanban: ExecutiveKanbanSection }) {
  const { t } = useTranslation()
  const day = useDayText()
  const time = useAverageTimeText()
  const title = t('executive.kanban.title')
  const total = FUNNEL_CATEGORIES.reduce((sum, category) => sum + kanban.funnel[category], 0)
  if (total === 0 && kanban.created === 0 && kanban.completed === 0)
    return (
      <ExecutiveSection title={title} description={t('executive.kanban.description')}>
        <AppEmptyState compact title={t('executive.kanban.empty')} description={t('executive.kanban.emptyHint')} />
      </ExecutiveSection>
    )
  const sample = (count: number) => (count ? t('reports.sample', { count }) : t('reports.noSample'))
  return (
    <ExecutiveSection title={title} description={t('executive.kanban.description')}>
      <div className="flex flex-col gap-2">
        <SubTitle>{t('executive.kanban.funnel')}</SubTitle>
        <AppBarList
          label={t('executive.kanban.funnel')}
          items={FUNNEL_CATEGORIES.map((category) => ({ key: category, label: t(`workflow.categories.${category}`), value: kanban.funnel[category] }))}
          formatValue={(value) => t('executive.kanban.tasks', { count: value })}
          empty={t('executive.kanban.empty')}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <AppStatCard label={t('executive.kanban.created')} value={kanban.created} icon={<PlusCircle />} />
        <AppStatCard label={t('executive.kanban.completed')} value={kanban.completed} icon={<CheckCircle2 />} tone="success" />
        <AppStatCard label={t('reports.indicators.leadTime')} value={time(kanban.leadTime.hours)} icon={<Timer />} hint={sample(kanban.leadTime.count)} />
        <AppStatCard label={t('reports.indicators.cycleTime')} value={time(kanban.cycleTime.hours)} icon={<Timer />} hint={sample(kanban.cycleTime.count)} />
      </div>

      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
        <AppStatCard label={t('reports.indicators.overdue')} value={kanban.overdue} icon={<AlarmClock />} tone={kanban.overdue ? 'danger' : 'default'} />
        <AppStatCard label={t('reports.indicators.blocked')} value={kanban.blocked} icon={<Lock />} tone={kanban.blocked ? 'danger' : 'default'} />
        <AppStatCard label={t('reports.indicators.criticalBugs')} value={kanban.criticalBugs} icon={<Bug />} tone={kanban.criticalBugs ? 'warning' : 'default'} />
      </div>

      <div className="flex flex-col gap-2">
        <SubTitle>{t('executive.kanban.overdueTasks')}</SubTitle>
        <ShortList label={t('executive.kanban.overdueTasks')} empty={t('executive.kanban.noOverdue')}>
          {kanban.overdueTasks.map((task) => (
            <ShortItem
              key={task.id}
              to={`/tasks/${task.id}`}
              title={
                <>
                  {task.code && <span className="font-mono text-xs text-muted">{task.code}</span>} {task.title}
                </>
              }
              detail={
                <>
                  {task.project.name} · <span className="text-danger">{t('executive.kanban.dueOn', { date: day(task.dueDate) })}</span>
                </>
              }
              aside={<LookupBadge item={task.status} />}
            />
          ))}
        </ShortList>
      </div>
    </ExecutiveSection>
  )
}
