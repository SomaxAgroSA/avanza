import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Plus, Users } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatRelative } from '@/core/utils/format'
import type { Project, ProjectTaskCount, TeamActivity, TeamActivityProject, TeamActivityState } from '@/domain/projects'
import { AppAvatar, AppBadge, AppButton, AppDrawer, AppEmptyState, AppErrorState, AppSkeleton } from '@/presentation/components'
import { ProjectAvatar, ProjectStatusBadge } from '../project-visuals'
import { teamMetric } from '../team-activity-data'
import { percentOf, recentTasksOf, workersOf } from './direction-data'
import { TaskBar } from './TaskBar'

const GROUPS: Array<{ key: TeamActivityState; label: string; tone: string }> = [
  { key: 'working', label: 'team.groups.working', tone: 'text-success-soft-fg' },
  { key: 'active', label: 'team.groups.active', tone: 'text-info-soft-fg' },
  { key: 'idle', label: 'direction.team.idle', tone: 'text-warning-soft-fg' },
]

export interface DirectionTeamProps {
  /** O Equipo ahora já recortado pelo filtro do painel. */
  team: TeamActivity | undefined
  /** Todos os projetos (para o estado no painel lateral). */
  projects: Project[]
  counts: ProjectTaskCount[] | undefined
  pending: boolean
  error: boolean
  onRetry: () => void
}

/** "Equipo ahora" da vista de Direção: um cartão por pessoa, lado a lado; o "+" abre o painel do projeto. */
export function DirectionTeam({ team, projects, counts, pending, error, onRetry }: DirectionTeamProps) {
  const { t } = useTranslation()
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <section aria-label={t('team.title')} className="mb-6">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 px-0.5">
        <h2 className="text-base font-semibold tracking-tight text-fg">{t('team.title')}</h2>
        <p className="text-xs text-muted">{t('team.description', { days: team?.windowDays ?? 7 })}</p>
      </div>
      {pending ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <AppSkeleton className="h-40" />
          <AppSkeleton className="h-40" />
          <AppSkeleton className="h-40" />
        </div>
      ) : error || !team ? (
        <AppErrorState onRetry={onRetry} />
      ) : team.people.length === 0 ? (
        <AppEmptyState compact icon={<Users />} title={t('team.emptyTitle')} description={t('team.emptyHint')} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-3" data-testid="direction-team">
          {team.people.map((person) => (
            <PersonCard key={person.user.id} user={person.user} projects={person.projects} onOpen={setOpenId} />
          ))}
        </div>
      )}
      <ProjectDrawer projectId={openId} projects={projects} team={team} counts={counts} onClose={() => setOpenId(null)} />
    </section>
  )
}

function PersonCard({ user, projects, onOpen }: { user: TeamActivity['people'][number]['user']; projects: TeamActivityProject[]; onOpen: (projectId: string) => void }) {
  const { t, i18n } = useTranslation()
  const working = projects.filter((p) => p.state === 'working').length
  const active = projects.filter((p) => p.state === 'active').length
  return (
    <article aria-labelledby={`dir-team-${user.id}`} className="min-w-0 rounded-xl border border-border bg-surface px-4 pb-2.5 pt-4">
      <header className="mb-3 flex items-center gap-3">
        <AppAvatar name={user.name} src={user.avatarUrl} />
        <div className="min-w-0">
          <h3 id={`dir-team-${user.id}`} className="truncate text-base font-semibold text-fg">
            {user.name}
          </h3>
          <p className="text-[12.5px] text-muted">{t('team.summary', { working, active })}</p>
        </div>
      </header>
      {GROUPS.map(({ key, label, tone }) => {
        const rows = projects.filter((p) => p.state === key)
        if (rows.length === 0) return null
        return (
          <div key={key} className="mt-2.5">
            <p className={cn('mb-0.5 text-xs font-extrabold uppercase tracking-wide', tone)}>{t(label)}</p>
            <ul>
              {rows.map((row) => (
                <li key={row.project.id} className="grid grid-cols-[22px_24px_minmax(0,1fr)_auto] items-center gap-2.5 py-1.5 text-[13.5px]">
                  <button
                    type="button"
                    onClick={() => onOpen(row.project.id)}
                    aria-haspopup="dialog"
                    aria-label={t('direction.team.detail', { project: row.project.name, name: user.name })}
                    className="flex size-[22px] items-center justify-center rounded-md border border-border-strong text-muted hover:border-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Plus aria-hidden className="size-3" />
                  </button>
                  <ProjectAvatar icon={row.project.icon} cover={row.project.cover} size="sm" className="size-6 rounded-md [&_svg]:size-3.5" />
                  <Link to={`/projects/${row.project.id}`} className="truncate text-fg hover:text-primary-text hover:underline">
                    {row.project.name}
                  </Link>
                  <span className={cn('whitespace-nowrap text-xs', row.stale ? 'text-warning-soft-fg' : 'text-muted')}>{teamMetric(t, row, i18n.language)}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </article>
  )
}

/** Painel lateral do projeto: tarefas (números e barra), tarefas recentes e quem está trabalhando. */
function ProjectDrawer({ projectId, projects, team, counts, onClose }: { projectId: string | null; projects: Project[]; team: TeamActivity | undefined; counts: ProjectTaskCount[] | undefined; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const workers = useMemo(() => (projectId ? workersOf(team, projectId) : []), [team, projectId])
  const tasks = useMemo(() => recentTasksOf(workers), [workers])
  const project = projects.find((p) => p.id === projectId)
  const ref = workers[0]?.row.project
  const name = project?.name ?? ref?.name ?? ''
  const count = counts?.find((c) => c.projectId === projectId)
  const total = count ? count.done + count.open : 0
  return (
    <AppDrawer
      open={!!projectId}
      onOpenChange={(open) => !open && onClose()}
      title={name}
      description={t('direction.drawer.title')}
      footer={
        projectId ? (
          <AppButton asChild rightIcon={<ArrowRight />} className="w-full justify-center">
            <Link to={`/projects/${projectId}`}>{t('direction.drawer.openProject')}</Link>
          </AppButton>
        ) : undefined
      }
    >
      {projectId && (
        <div className="flex flex-col gap-5">
          {project && <ProjectStatusBadge status={project.status} />}

          {count && total > 0 ? (
            <section aria-label={t('direction.drawer.tasks')}>
              <h4 className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-muted">{t('direction.drawer.tasks')}</h4>
              <dl className="mb-2 grid grid-cols-3 gap-2">
                {[
                  [count.done, t('direction.drawer.done')],
                  [count.open, t('direction.drawer.open')],
                  [`${percentOf(count.done, total)} %`, t('direction.drawer.progress')],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-xl bg-surface-2 px-3 py-2.5">
                    <dd className="text-2xl font-bold tabular-nums text-fg">{value}</dd>
                    <dt className="text-xs text-muted">{label}</dt>
                  </div>
                ))}
              </dl>
              <TaskBar done={count.done} open={count.open} size="md" />
            </section>
          ) : (
            <p className="text-sm text-muted">{t('direction.drawer.noTasks')}</p>
          )}

          <section aria-label={t('direction.drawer.recent')} className="border-t border-border pt-4">
            <h4 className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-muted">{t('direction.drawer.recent')}</h4>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted">{t('direction.drawer.noRecent')}</p>
            ) : (
              <ul>
                {tasks.map((task) => (
                  <li key={task.id} className="grid grid-cols-[minmax(0,1fr)_auto_74px] items-start gap-2 border-b border-border py-1.5 last:border-b-0">
                    <Link to={`/tasks/${task.id}`} className="text-[12.5px] leading-snug text-fg hover:text-primary-text hover:underline">
                      {task.title}
                    </Link>
                    <AppBadge tone={task.inProgress ? 'success' : 'neutral'}>{task.status.name}</AppBadge>
                    <span className="text-right text-[11.5px] text-muted">{formatRelative(task.updatedAt, i18n.language)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label={t('direction.drawer.who')} className="border-t border-border pt-4">
            <h4 className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-muted">{t('direction.drawer.who')}</h4>
            {workers.length === 0 ? (
              <p className="text-sm text-muted">{t('direction.drawer.nobody')}</p>
            ) : (
              <ul>
                {workers.map(({ user, row }) => {
                  const group = GROUPS.find((g) => g.key === row.state)!
                  return (
                    <li key={user.id} className="grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 py-1.5">
                      <AppAvatar name={user.name} src={user.avatarUrl} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-fg">{user.name}</p>
                        <p className={cn('text-[11px] font-extrabold uppercase tracking-wide', group.tone)}>{t(group.label)}</p>
                      </div>
                      <span className="whitespace-nowrap text-xs text-muted">{teamMetric(t, row, i18n.language)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </AppDrawer>
  )
}
