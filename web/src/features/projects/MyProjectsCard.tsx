import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, FolderPlus } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatDay } from '@/core/utils/format'
import { isOverdue } from '@/domain/projects'
import { AppButton, AppCard, AppEmptyState, AppErrorState, AppSkeleton } from '@/presentation/components'
import { useCan } from '@/features/auth/session'
import { ProjectAvatar, ProjectStatusBadge } from './project-visuals'
import { useProjects } from './queries'

const QUERY = { view: 'mine' as const, page: 1, perPage: 5, sort: { id: 'name', direction: 'asc' as const }, search: '', filters: {} }

/** Dashboard: projetos em que o usuário participa (dados reais, sem métricas inventadas). */
export function MyProjectsCard({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const canCreate = useCan('projects.create')
  const projects = useProjects(QUERY)

  return (
    <AppCard
      className={className}
      title={t('dashboard.myProjects')}
      padded={false}
      actions={
        <Link to="/projects/mine" className="inline-flex items-center gap-1 text-sm text-primary-text hover:underline">
          {t('dashboard.seeAll')} <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      }
    >
      {projects.isPending ? (
        <div className="flex flex-col gap-2 p-4">
          <AppSkeleton className="h-12" />
          <AppSkeleton className="h-12" />
        </div>
      ) : projects.isError ? (
        <AppErrorState onRetry={() => void projects.refetch()} />
      ) : projects.data.items.length === 0 ? (
        <AppEmptyState
          compact
          icon={<FolderPlus />}
          title={t('projects.emptyMine')}
          description={t('projects.emptyDescription')}
          action={
            canCreate ? (
              <AppButton asChild size="sm">
                <Link to="/projects?new=1">{t('projects.create')}</Link>
              </AppButton>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col p-2">
          {projects.data.items.map((project) => (
            <li key={project.id}>
              <Link to={`/projects/${project.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2">
                <ProjectAvatar icon={project.icon} cover={project.cover} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{project.name}</span>
                  <span className="block font-mono text-xs text-muted">{project.key}</span>
                </span>
                <ProjectStatusBadge status={project.status} />
                <span className={cn('hidden w-28 text-right text-xs sm:block', isOverdue(project) ? 'font-medium text-danger' : 'text-subtle')}>
                  {project.dueDate ? formatDay(project.dueDate, i18n.language) : '—'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppCard>
  )
}
