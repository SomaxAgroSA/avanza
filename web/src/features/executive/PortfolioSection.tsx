import { useMemo, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { portfolioByHealth, type PortfolioRow } from '@/domain/executive'
import type { HealthLevel } from '@/domain/plan-management'
import { AppDataTable, AppEmptyState, AppMeter, useDataTableState, type DataTableColumn } from '@/presentation/components'
import { useMediaQuery } from '@/presentation/common/use-media-query'
import { ProjectAvatar } from '@/features/projects/project-visuals'
import { ExecutiveSection, HealthDot, HealthStatus } from './executive-visuals'
import { useDayText, useHealthLabel, useHealthReason } from './use-executive-format'

/**
 * ③ Portfólio: um projeto ativo por linha, na ordem do servidor (críticos primeiro), em quatro colunas —
 * projeto, saúde (com o motivo), progresso e prazo (com o próximo marco). No celular, duas: o projeto
 * (com a saúde) e o progresso, para caber sem rolar para o lado.
 */
export function PortfolioSection({
  rows,
  id,
  delay,
  healthFilter,
  onClearFilter,
}: {
  rows: PortfolioRow[]
  id?: string
  delay?: number
  /** Saúde escolhida na faixa de destaque (null = todos). */
  healthFilter: HealthLevel | null
  onClearFilter: () => void
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const healthLabel = useHealthLabel()
  const shown = portfolioByHealth(rows, healthFilter)
  const table = useDataTableState('executive-portfolio', { sort: null })
  const day = useDayText()
  const reason = useHealthReason()
  const phone = useMediaQuery('(max-width: 639px)')

  const columns = useMemo<DataTableColumn<PortfolioRow>[]>(() => {
    const progress: DataTableColumn<PortfolioRow> = {
      id: 'progress',
      header: t('executive.portfolio.progress'),
      hideable: false,
      size: phone ? 110 : 140,
      cell: ({ project, progress }) =>
        progress ? (
          <span className="flex items-center gap-2.5">
            <AppMeter value={progress.value} label={t('executive.portfolio.progressOf', { name: project.name })} className="flex-1" />
            <span className="w-9 text-right text-sm font-medium tabular-nums text-fg">{progress.value}%</span>
          </span>
        ) : (
          <span className="text-xs text-subtle">{t('executive.portfolio.noProgress')}</span>
        ),
    }
    const projectCell = (row: PortfolioRow, second: ReactNode) => (
      <span className="flex min-w-0 items-center gap-3">
        <ProjectAvatar icon={row.project.icon} cover={row.project.cover} size="sm" />
        <span className="flex min-w-0 max-w-40 flex-col sm:max-w-56">
          <Link to={`/projects/${row.project.id}`} className="truncate font-medium text-fg hover:text-primary-text">
            <span className="font-mono text-xs text-muted">{row.project.key}</span> {row.project.name}
          </Link>
          {second}
        </span>
      </span>
    )
    if (phone)
      return [
        {
          id: 'project',
          header: t('executive.portfolio.project'),
          hideable: false,
          size: 210,
          cell: (row) => projectCell(row, <HealthStatus level={row.health.level} className="text-xs font-normal text-muted" />),
        },
        progress,
      ]
    return [
      {
        id: 'project',
        header: t('executive.portfolio.project'),
        hideable: false,
        pinned: true,
        size: 230,
        cell: (row) => projectCell(row, <span className="truncate text-xs text-muted">{row.project.owner?.name ?? t('executive.portfolio.noOwner')}</span>),
      },
      {
        id: 'health',
        header: t('executive.portfolio.health'),
        hideable: false,
        size: 170,
        cell: ({ health }) => {
          const text = reason(health)
          return (
            <span className="flex min-w-0 flex-col">
              <HealthStatus level={health.level} />
              {text && (
                <span className="max-w-44 truncate text-xs text-muted" title={text}>
                  {text}
                </span>
              )}
            </span>
          )
        },
      },
      progress,
      {
        id: 'due',
        header: t('executive.portfolio.dueDate'),
        hideable: false,
        size: 160,
        cell: ({ project, nextMilestone }) => {
          const milestone = nextMilestone ? `${t('executive.portfolio.nextMilestone')}: ${nextMilestone.name} · ${day(nextMilestone.dueDate)}` : null
          return (
            <span className="flex min-w-0 flex-col">
              <span className="tabular-nums text-fg">{day(project.dueDate)}</span>
              {milestone && (
                <span className="max-w-44 truncate text-xs text-muted" title={milestone}>
                  {milestone}
                </span>
              )}
            </span>
          )
        },
      },
    ]
    // day/reason dependem só do idioma
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, i18n.language, phone])

  return (
    <ExecutiveSection
      id={id}
      delay={delay}
      title={t('executive.portfolio.title')}
      meta={shown.length > 0 ? (healthFilter ? `${shown.length} / ${rows.length}` : shown.length) : undefined}
      flush
      className="kb-print-fit print:break-inside-auto"
      actions={
        healthFilter && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 py-0.5 pr-1 pl-2.5 text-xs font-medium text-fg motion-safe:animate-scale-in">
            <HealthDot level={healthFilter} />
            {t('executive.portfolio.filtering', { level: healthLabel(healthFilter) })}
            <button
              type="button"
              aria-label={t('executive.portfolio.clearFilter')}
              onClick={onClearFilter}
              className="grid size-5 place-items-center rounded-full text-muted transition-colors hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        )
      }
    >
      <AppDataTable
        caption={t('executive.portfolio.title')}
        columns={columns}
        data={shown}
        total={shown.length}
        getRowId={(row) => row.project.id}
        table={table}
        paginated={false}
        searchable={false}
        bordered={false}
        onRowClick={(row) => navigate(`/projects/${row.project.id}`)}
        emptyState={
          healthFilter ? (
            <AppEmptyState compact title={t('executive.portfolio.emptyFiltered')} description={t('executive.portfolio.emptyFilteredHint')} />
          ) : (
            <AppEmptyState compact title={t('executive.portfolio.empty')} description={t('executive.portfolio.emptyHint')} />
          )
        }
      />
    </ExecutiveSection>
  )
}
