import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Minus, Plus, Users } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatRelative } from '@/core/utils/format'
import type { TeamActivityProject, TeamActivityState, UserSummary } from '@/domain/projects'
import { AppAvatar, AppBadge, AppDrawer, AppEmptyState, AppErrorState, AppSkeleton } from '@/presentation/components'
import { ProjectAvatar } from './project-visuals'
import { useTeamActivity } from './queries'

const firstName = (name: string) => name.split(' ')[0] ?? name

/** Marca de uma pessoa no projeto: verde (trabalhando), âmbar (em curso, mas parado) ou azul (ativo na semana). */
export function ActivityChip({ user, row }: { user: UserSummary; row: TeamActivityProject }) {
  const { t, i18n } = useTranslation()
  const when = formatRelative(row.lastActivity, i18n.language)
  const name = firstName(user.name)
  if (row.state === 'working')
    return (
      <span title={t('team.chip.workingTitle', { name: user.name, count: row.inProgress, when })} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-success-soft px-2 py-0.5 text-xs text-success-soft-fg" data-state="working">
        <span aria-hidden className="size-1.5 rounded-full bg-success ring-2 ring-success/30" />
        {t('team.chip.working', { name, count: row.inProgress })}
      </span>
    )
  if (row.stale)
    return (
      <span title={t('team.chip.staleTitle', { name: user.name, count: row.inProgress, when })} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning-soft-fg" data-state="stale">
        ⚠ {t('team.chip.stale', { name, count: row.inProgress, when })}
      </span>
    )
  return (
    <span title={t('team.chip.activeTitle', { name: user.name, count: row.recent, when })} className="inline-flex items-center whitespace-nowrap rounded-full bg-info-soft px-2 py-0.5 text-xs text-info-soft-fg" data-state="active">
      {t('team.chip.active', { name, when })}
    </span>
  )
}

/** Coluna "Trabajando" da lista de projetos. */
export function ActivityCell({ entries }: { entries: Array<{ user: UserSummary; row: TeamActivityProject }> | undefined }) {
  const { t } = useTranslation()
  if (!entries || entries.length === 0) return <span className="text-xs text-subtle">{t('team.noActivity')}</span>
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map((entry) => (
        <ActivityChip key={entry.user.id} user={entry.user} row={entry.row} />
      ))}
    </div>
  )
}

const GROUPS: Array<{ key: TeamActivityState; tone: string }> = [
  { key: 'working', tone: 'text-success-soft-fg' },
  { key: 'active', tone: 'text-info-soft-fg' },
  { key: 'idle', tone: 'text-warning-soft-fg' },
]

/** Painel "Equipo ahora": por pessoa, os projetos em que está trabalhando; o "+" abre as tarefas. */
export function TeamActivityDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const activity = useTeamActivity(open)
  return (
    <AppDrawer open={open} onOpenChange={onOpenChange} title={t('team.title')} description={t('team.description', { days: activity.data?.windowDays ?? 7 })} size="lg">
      {activity.isPending ? (
        <div className="space-y-3">
          <AppSkeleton className="h-24" />
          <AppSkeleton className="h-24" />
        </div>
      ) : activity.isError ? (
        <AppErrorState onRetry={() => void activity.refetch()} />
      ) : activity.data.people.length === 0 ? (
        <AppEmptyState icon={<Users />} title={t('team.emptyTitle')} description={t('team.emptyHint')} />
      ) : (
        <div className="divide-y divide-border" data-testid="team-activity">
          {activity.data.people.map((person) => (
            <PersonBlock key={person.user.id} user={person.user} projects={person.projects} />
          ))}
        </div>
      )}
    </AppDrawer>
  )
}

function PersonBlock({ user, projects }: { user: UserSummary; projects: TeamActivityProject[] }) {
  const { t } = useTranslation()
  const working = projects.filter((p) => p.state === 'working').length
  const active = projects.filter((p) => p.state === 'active').length
  return (
    <section className="py-4 first:pt-0" aria-labelledby={`team-${user.id}`}>
      <header className="mb-2 flex items-center gap-3">
        <AppAvatar name={user.name} src={user.avatarUrl} size="sm" />
        <div className="min-w-0">
          <h3 id={`team-${user.id}`} className="font-semibold text-fg">
            {user.name}
          </h3>
          <p className="text-xs text-muted">{t('team.summary', { working, active })}</p>
        </div>
      </header>
      {GROUPS.map(({ key, tone }) => {
        const rows = projects.filter((p) => p.state === key)
        if (rows.length === 0) return null
        return (
          <div key={key} className="mt-2">
            <p className={cn('mb-1 text-[11px] font-bold uppercase tracking-wide', tone)}>{t(`team.groups.${key}`)}</p>
            <ul className="flex flex-col">
              {rows.map((row) => (
                <ProjectRow key={row.project.id} row={row} userName={user.name} />
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}

function ProjectRow({ row, userName }: { row: TeamActivityProject; userName: string }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const when = formatRelative(row.lastActivity, i18n.language)
  const metric =
    row.state === 'working'
      ? t('team.metric.working', { count: row.inProgress })
      : row.state === 'active'
        ? t('team.metric.active', { count: row.recent, when })
        : row.stale
          ? t('team.metric.stale', { count: row.inProgress, when })
          : t('team.metric.idle', { count: row.open, when })
  const panelId = `team-tasks-${row.project.id}-${userName.replace(/\W+/g, '')}`
  return (
    <li className="py-1">
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={t(open ? 'team.hideTasks' : 'team.showTasks', { project: row.project.name, name: userName })}
          className="flex size-5 shrink-0 items-center justify-center rounded border border-border text-muted hover:border-primary hover:text-primary-text"
        >
          {open ? <Minus aria-hidden className="size-3" /> : <Plus aria-hidden className="size-3" />}
        </button>
        <ProjectAvatar icon={row.project.icon} cover={row.project.cover} size="sm" className="size-5 rounded [&_svg]:size-3" />
        <Link to={`/projects/${row.project.id}`} className="min-w-0 flex-1 truncate text-fg hover:text-primary-text hover:underline">
          {row.project.name}
        </Link>
        <span className={cn('shrink-0 text-xs', row.stale ? 'text-warning-soft-fg' : 'text-muted')}>{metric}</span>
      </div>
      {open && (
        <ul id={panelId} className="ml-7 mt-1 flex flex-col gap-1 border-l border-border pl-3" aria-label={t('team.tasksOf', { project: row.project.name, name: userName })}>
          {row.tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2 text-xs">
              <span className="shrink-0 font-mono text-muted">{task.code}</span>
              <Link to={`/tasks/${task.id}`} className="min-w-0 flex-1 truncate text-fg hover:text-primary-text hover:underline">
                {task.title}
              </Link>
              <AppBadge tone={task.inProgress ? 'success' : 'neutral'}>{task.status.name}</AppBadge>
              <span className="shrink-0 text-subtle">{formatRelative(task.updatedAt, i18n.language)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
