import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Archive, Flag } from 'lucide-react'
import { formatDate } from '@/core/utils/format'
import type { ExecutiveAchievement, ExecutiveCompletion, ExecutiveDashboard } from '@/domain/executive'
import { AppBadge, AppEmptyState, AppTrendChart } from '@/presentation/components'
import { managementLink } from '@/features/plan/paths'
import { ExecutiveSection, SubTitle } from './executive-visuals'
import { useDayText } from './use-executive-format'

/** ⑤ Entregas ao longo do tempo (semana ou mês, conforme o período). */
export function TimelineSection({ timeline }: { timeline: ExecutiveDashboard['timeline'] }) {
  const { t, i18n } = useTranslation()
  const title = t('executive.timeline.title')
  const label = new Intl.DateTimeFormat(i18n.language, timeline.bucket === 'month' ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
  const empty = timeline.points.every((p) => p.tasksCompleted + p.planItemsCompleted + p.tasksCreated === 0)
  const bucket = t(timeline.bucket === 'month' ? 'executive.timeline.monthly' : 'executive.timeline.weekly')
  return (
    <ExecutiveSection title={title} description={bucket}>
      {empty ? (
        <AppEmptyState compact title={t('executive.timeline.empty')} />
      ) : (
        <AppTrendChart
          title={`${title} — ${bucket}`}
          seriesA={t('executive.timeline.tasksCompleted')}
          seriesB={t('executive.timeline.planItemsCompleted')}
          seriesC={t('executive.timeline.tasksCreated')}
          points={timeline.points.map((p) => ({
            key: p.start,
            label: label.format(new Date(`${p.start}T00:00:00Z`)),
            a: p.tasksCompleted,
            b: p.planItemsCompleted,
            c: p.tasksCreated,
          }))}
        />
      )}
    </ExecutiveSection>
  )
}

/** ⑥ O que já foi feito: por projeto (arquivados inclusive), com as conclusões mais recentes. */
export function AchievementsSection({ achievements }: { achievements: ExecutiveAchievement[] }) {
  const { t } = useTranslation()
  return (
    <ExecutiveSection title={t('executive.achievements.title')} description={t('executive.achievements.description')} className="print:break-inside-auto">
      {achievements.length === 0 ? (
        <AppEmptyState compact title={t('executive.achievements.empty')} description={t('executive.achievements.emptyHint')} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {achievements.map((achievement) => (
            <AchievementCard key={achievement.project.id} achievement={achievement} />
          ))}
        </ul>
      )}
    </ExecutiveSection>
  )
}

function AchievementCard({ achievement }: { achievement: ExecutiveAchievement }) {
  const { t } = useTranslation()
  const day = useDayText()
  const { project } = achievement
  return (
    <li aria-label={`${project.key} · ${project.name}`} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4 print:break-inside-avoid">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/projects/${project.id}`} className="min-w-0 truncate font-medium text-fg hover:text-primary-text">
          <span className="font-mono text-xs text-muted">{project.key}</span> {project.name}
        </Link>
        {project.archived && (
          <AppBadge>
            <Archive aria-hidden />
            {t('executive.achievements.archived')}
          </AppBadge>
        )}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-fg">
        <span>{t('executive.achievements.tasksDone', { count: achievement.tasksDone })}</span>
        <span>{t('executive.achievements.planItemsDone', { count: achievement.planItemsDone })}</span>
        <span>{t('executive.achievements.milestonesDone', { count: achievement.milestonesDone.length })}</span>
      </p>
      {achievement.milestonesDone.length > 0 && (
        <div className="flex flex-col gap-1">
          <SubTitle>{t('executive.achievements.milestones')}</SubTitle>
          <ul className="flex flex-col gap-1">
            {achievement.milestonesDone.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Flag className="size-3.5 shrink-0 text-success" aria-hidden />
                  <span className="truncate">{m.name}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">{day(m.dueDate)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {achievement.recent.length > 0 && (
        <div className="flex flex-col gap-1">
          <SubTitle>{t('executive.achievements.recent')}</SubTitle>
          <ul className="flex flex-col gap-1">
            {achievement.recent.map((item) => (
              <CompletionItem key={`${item.kind}-${item.id}`} item={item} projectId={project.id} />
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}

function CompletionItem({ item, projectId }: { item: ExecutiveCompletion; projectId: string }) {
  const { t, i18n } = useTranslation()
  const to = item.kind === 'task' ? `/tasks/${item.id}` : managementLink(projectId, { item: item.id })
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <Link to={to} className="min-w-0 truncate text-fg hover:text-primary-text">
        <span className="font-mono text-xs text-muted">{item.kind === 'task' ? item.code : t('executive.achievements.element')}</span> {item.title}
      </Link>
      <span className="shrink-0 text-xs tabular-nums text-muted">{formatDate(item.completedAt, i18n.language)}</span>
    </li>
  )
}
