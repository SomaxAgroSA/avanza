import { useId, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Archive, ChevronDown, Flag } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { hasDeliveries, type ExecutiveAchievement, type ExecutiveDashboard, type ExecutiveProjectOption } from '@/domain/executive'
import { AppBadge, AppEmptyState, AppIconButton, AppTrendChart } from '@/presentation/components'
import { managementLink } from '@/features/plan/paths'
import { ProjectAvatar } from '@/features/projects/project-visuals'
import { ExecutiveSection, ProjectKey } from './executive-visuals'
import { useDayText, usePartsText } from './use-executive-format'

/** ⑥ Entregas ao longo do tempo: tarefas e elementos concluídos, empilhados (some sem entregas). */
export function TimelineSection({ timeline }: { timeline: ExecutiveDashboard['timeline'] }) {
  const { t, i18n } = useTranslation()
  if (!hasDeliveries(timeline.points)) return null
  const title = t('executive.timeline.title')
  const label = new Intl.DateTimeFormat(i18n.language, timeline.bucket === 'month' ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
  const bucket = t(timeline.bucket === 'month' ? 'executive.timeline.monthly' : 'executive.timeline.weekly')
  return (
    <ExecutiveSection title={title} meta={bucket}>
      <AppTrendChart
        stacked
        height={180}
        title={`${title} — ${bucket}`}
        seriesA={t('executive.timeline.tasksCompleted')}
        seriesB={t('executive.timeline.planItemsCompleted')}
        points={timeline.points.map((p) => ({ key: p.start, label: label.format(new Date(`${p.start}T00:00:00Z`)), a: p.tasksCompleted, b: p.planItemsCompleted }))}
      />
    </ExecutiveSection>
  )
}

/** ⑦ O que já foi feito: uma linha por projeto (arquivados inclusive); as últimas conclusões abrem sob a linha. */
export function AchievementsSection({ achievements, projects }: { achievements: ExecutiveAchievement[]; projects: ExecutiveProjectOption[] }) {
  const { t } = useTranslation()
  const byId = new Map(projects.map((p) => [p.id, p]))
  return (
    <ExecutiveSection title={t('executive.achievements.title')} meta={t('executive.achievements.description')} className="print:break-inside-auto">
      {achievements.length === 0 ? (
        <AppEmptyState compact title={t('executive.achievements.empty')} description={t('executive.achievements.emptyHint')} />
      ) : (
        <ul className="-my-3 divide-y divide-border">
          {achievements.map((achievement) => (
            <AchievementRow key={achievement.project.id} achievement={achievement} option={byId.get(achievement.project.id)} />
          ))}
        </ul>
      )}
    </ExecutiveSection>
  )
}

function AchievementRow({ achievement, option }: { achievement: ExecutiveAchievement; option: ExecutiveProjectOption | undefined }) {
  const { t, i18n } = useTranslation()
  const day = useDayText()
  const parts = usePartsText()
  const [open, setOpen] = useState(false)
  const listId = useId()
  const { project } = achievement
  const detail = parts({ tasks: achievement.tasksDone, items: achievement.planItemsDone, milestones: achievement.milestonesDone.length })
  const expandable = achievement.recent.length > 0 || achievement.milestonesDone.length > 0
  const date = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' })
  return (
    <li aria-label={`${project.key} · ${project.name}`} className="py-3 print:break-inside-avoid">
      <div className="flex items-center gap-3">
        {option ? <ProjectAvatar icon={option.icon} cover={option.cover} size="sm" /> : <ProjectKey value={project.key} />}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link to={`/projects/${project.id}`} className="truncate text-sm font-medium text-fg hover:text-primary-text">
              {project.name}
            </Link>
            <ProjectKey value={project.key} className={cn(!option && 'hidden')} />
            {project.archived && (
              <AppBadge>
                <Archive aria-hidden />
                {t('executive.achievements.archived')}
              </AppBadge>
            )}
          </div>
          {detail && <p className="mt-0.5 text-xs text-muted">{detail}</p>}
        </div>
        {expandable && (
          <AppIconButton
            label={t('executive.achievements.recent', { name: project.name })}
            icon={<ChevronDown className={cn('transition-transform', open && 'rotate-180')} />}
            size="sm"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
            className="print:hidden"
          />
        )}
      </div>
      {open && (
        <ul id={listId} aria-label={t('executive.achievements.recent', { name: project.name })} className="mt-3 ml-10 flex flex-col gap-2 border-l border-border pl-4 motion-safe:animate-fade-in">
          {achievement.milestonesDone.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-fg">
                <Flag className="size-3.5 shrink-0 text-primary-text" aria-hidden />
                <span className="sr-only">{t('executive.achievements.milestone')}: </span>
                <span className="truncate">{m.name}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted">{day(m.dueDate)}</span>
            </li>
          ))}
          {achievement.recent.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-3 text-sm">
              <Link to={item.kind === 'task' ? `/tasks/${item.id}` : managementLink(project.id, { item: item.id })} className="min-w-0 truncate text-fg hover:text-primary-text">
                <span className="font-mono text-xs text-muted">{item.kind === 'task' ? item.code : t('executive.achievements.element')}</span> {item.title}
              </Link>
              <span className="shrink-0 text-xs tabular-nums text-muted">{item.completedAt ? date.format(item.completedAt) : '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
