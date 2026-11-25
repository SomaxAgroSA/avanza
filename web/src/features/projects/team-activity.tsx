import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Minus, Plus, Users } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatRelative } from '@/core/utils/format'
import type { TeamActivityActedTask, TeamActivityProject, TeamActivityState, UserSummary } from '@/domain/projects'
import { projectDisplayName } from '@/domain/demands'
import { AppAvatar, AppBadge, AppDrawer, AppEmptyState, AppErrorState, AppSkeleton } from '@/presentation/components'
import { ProjectAvatar } from './project-visuals'
import { useTeamActivity } from './queries'
import { ACTED_PREVIEW, actedCount, actionDetail, actionText, firstName, teamMetric } from './team-activity-data'

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
    <AppDrawer open={open} onOpenChange={onOpenChange} title={t('team.title')} size="lg">
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
  const acted = actedCount(projects)
  return (
    <section className="py-4 first:pt-0" aria-labelledby={`team-${user.id}`}>
      <header className="mb-2 flex items-center gap-3">
        <AppAvatar name={user.name} src={user.avatarUrl} size="sm" />
        <div className="min-w-0">
          <h3 id={`team-${user.id}`} className="font-semibold text-fg">
            {user.name}
          </h3>
          <p className="text-xs text-muted">{acted > 0 ? t('team.acted', { count: acted }) : t('team.actedNone')}</p>
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
  const metric = teamMetric(t, row, i18n.language)
  const panelId = `team-tasks-${row.project.id}-${userName.replace(/\W+/g, '')}`
  // a caixa das demandas internas (§45) leva para a tela Demandas
  const name = projectDisplayName(t, row.project)
  return (
    <li className="py-1">
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={t(open ? 'team.hideTasks' : 'team.showTasks', { project: name, name: userName })}
          className="flex size-5 shrink-0 items-center justify-center rounded border border-border text-muted hover:border-primary hover:text-primary-text"
        >
          {open ? <Minus aria-hidden className="size-3" /> : <Plus aria-hidden className="size-3" />}
        </button>
        <ProjectAvatar icon={row.project.icon} cover={row.project.cover} size="sm" className="size-5 rounded [&_svg]:size-3" />
        <Link to={row.project.demands ? '/tasks/demands' : `/projects/${row.project.id}`} className="min-w-0 flex-1 truncate text-fg hover:text-primary-text hover:underline">
          {name}
        </Link>
        <span className={cn('shrink-0 text-xs', row.stale ? 'text-warning-soft-fg' : 'text-muted')}>{metric}</span>
      </div>
      {!open && <ActedPreview row={row} userName={userName} onMore={() => setOpen(true)} className="ml-7 mt-1" />}
      {open &&
        (row.actedTasks.length > 0 ? (
          <ActedTaskList id={panelId} tasks={row.actedTasks} label={t('team.tasksOf', { project: name, name: userName })} className="ml-7 mt-1 border-l border-border pl-3" />
        ) : (
          <ul id={panelId} className="ml-7 mt-1 flex flex-col gap-1 border-l border-border pl-3" aria-label={t('team.tasksOf', { project: name, name: userName })}>
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
        ))}
    </li>
  )
}

/**
 * Até 3 tarefas em que a pessoa agiu, embaixo do projeto: o título, a ação ("pasó a Prueba", "comentó") e quando.
 * Com mais, "+N más" abre a lista inteira.
 */
export function ActedPreview({ row, userName, onMore, className }: { row: TeamActivityProject; userName: string; onMore: () => void; className?: string }) {
  const { t, i18n } = useTranslation()
  if (row.actedTasks.length === 0) return null
  const shown = row.actedTasks.slice(0, ACTED_PREVIEW)
  const rest = Math.max(row.recent, row.actedTasks.length) - shown.length
  const project = projectDisplayName(t, row.project)
  return (
    <ul aria-label={t('team.actedOf', { name: userName, project })} className={cn('flex min-w-0 flex-col', className)}>
      {shown.map((task) => (
        <li key={task.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 border-l-2 border-border py-0.5 pl-2.5 text-[12.5px]">
          <Link to={`/tasks/${task.id}`} title={task.title} className="truncate text-fg hover:text-primary-text hover:underline">
            {task.title}
          </Link>
          <span className="whitespace-nowrap text-muted">
            <span className="font-semibold text-primary-text">{actionText(t, task.action)}</span> · {formatRelative(task.action.at, i18n.language)}
          </span>
        </li>
      ))}
      {rest > 0 && (
        <li className="border-l-2 border-border py-0.5 pl-2.5">
          <button
            type="button"
            onClick={onMore}
            aria-label={t('team.moreAria', { name: userName, project })}
            className="rounded text-[12.5px] font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t('team.more', { count: rest })}
          </button>
        </li>
      )}
    </ul>
  )
}

/** Tarefas em que a pessoa agiu, por extenso: título, a ação com o detalhe ("Pasó de Desarrollo a Prueba") e quando, e o status. */
export function ActedTaskList({ tasks, label, id, className }: { tasks: TeamActivityActedTask[]; label: string; id?: string; className?: string }) {
  const { t, i18n } = useTranslation()
  return (
    <ul id={id} aria-label={label} className={cn('flex flex-col', className)}>
      {tasks.map((task) => (
        <li key={task.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5 border-b border-border py-2 last:border-b-0">
          <div className="min-w-0">
            <Link to={`/tasks/${task.id}`} className="text-[13px] font-semibold leading-snug text-fg hover:text-primary-text hover:underline">
              {task.title}
            </Link>
            <p className="mt-0.5 text-xs text-muted">
              {actionDetail(t, task.action)} · {formatRelative(task.action.at, i18n.language)}
            </p>
          </div>
          <AppBadge tone={task.inProgress ? 'success' : 'neutral'}>{task.status.name}</AppBadge>
        </li>
      ))}
    </ul>
  )
}
