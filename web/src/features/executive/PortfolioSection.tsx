import { useMemo } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { PortfolioRow } from '@/domain/executive'
import { AppDataTable, AppEmptyState, useDataTableState, type DataTableColumn } from '@/presentation/components'
import { ProjectAvatar } from '@/features/projects/project-visuals'
import { ProgressBar } from '@/features/plan/cells'
import { ExecutiveSection, HealthBadge } from './executive-visuals'
import { useDayText, useHealthReason } from './use-executive-format'

/** ② Portfólio: um projeto ativo por linha, na ordem do servidor (críticos primeiro). */
export function PortfolioSection({ rows }: { rows: PortfolioRow[] }) {
  const { t, i18n } = useTranslation()
  const table = useDataTableState('executive-portfolio', { sort: null })
  const day = useDayText()
  const reason = useHealthReason()

  const columns = useMemo<DataTableColumn<PortfolioRow>[]>(
    () => [
      {
        id: 'project',
        header: t('executive.portfolio.project'),
        hideable: false,
        pinned: true,
        size: 220,
        cell: ({ project }) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <ProjectAvatar icon={project.icon} cover={project.cover} size="sm" />
            <span className="flex min-w-0 flex-col">
              <Link to={`/projects/${project.id}`} className="truncate font-medium text-fg hover:text-primary-text">
                <span className="font-mono text-xs text-muted">{project.key}</span> {project.name}
              </Link>
              <span className="truncate text-xs text-muted">{project.owner?.name ?? t('executive.portfolio.noOwner')}</span>
            </span>
          </span>
        ),
      },
      {
        id: 'health',
        header: t('executive.portfolio.health'),
        hideable: false,
        size: 190,
        cell: ({ health }) => {
          const text = reason(health)
          return (
            <span className="flex min-w-0 flex-col items-start gap-1">
              <HealthBadge level={health.level} />
              {text && <span className="max-w-full truncate text-xs text-muted">{text}</span>}
            </span>
          )
        },
      },
      {
        id: 'progress',
        header: t('executive.portfolio.progress'),
        hideable: false,
        size: 150,
        cell: ({ project, progress }) =>
          progress ? (
            <span className="flex flex-col gap-0.5">
              <ProgressBar value={progress.value} label={t('executive.portfolio.progressOf', { name: project.name })} />
              <span className="text-xs text-subtle">{t(`executive.portfolio.source.${progress.source}`)}</span>
            </span>
          ) : (
            <span className="text-xs text-subtle">{t('executive.portfolio.noProgress')}</span>
          ),
      },
      {
        id: 'due',
        header: t('executive.portfolio.dueAndMilestone'),
        hideable: false,
        size: 170,
        cell: ({ project, nextMilestone }) => (
          <span className="flex min-w-0 flex-col">
            <span className="text-fg">{day(project.dueDate)}</span>
            {nextMilestone && (
              <span className="truncate text-xs text-muted" title={nextMilestone.name}>
                {t('executive.portfolio.nextMilestone')}: {nextMilestone.name} · {day(nextMilestone.dueDate)}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'tasks',
        header: t('executive.portfolio.tasks'),
        hideable: false,
        size: 120,
        cell: ({ tasks }) => (
          <span className="flex flex-col">
            <span>{t('executive.portfolio.tasksOpen', { count: tasks.open })}</span>
            {tasks.overdue > 0 && <span className="text-xs font-medium text-danger">{t('executive.portfolio.tasksOverdue', { count: tasks.overdue })}</span>}
          </span>
        ),
      },
      {
        id: 'issues',
        header: t('executive.portfolio.issues'),
        hideable: false,
        size: 90,
        align: 'end',
        cell: ({ openIssues }) => <span className={openIssues > 0 ? 'font-medium text-warning-soft-fg' : undefined}>{openIssues}</span>,
      },
    ],
    // day/reason dependem só do idioma
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, i18n.language],
  )

  return (
    <ExecutiveSection title={t('executive.portfolio.title')} description={t('executive.portfolio.description')} className="kb-print-fit print:break-inside-auto">
      <AppDataTable
        caption={t('executive.portfolio.title')}
        columns={columns}
        data={rows}
        total={rows.length}
        getRowId={(row) => row.project.id}
        table={table}
        paginated={false}
        searchable={false}
        emptyState={<AppEmptyState compact title={t('executive.portfolio.empty')} description={t('executive.portfolio.emptyHint')} />}
      />
    </ExecutiveSection>
  )
}
