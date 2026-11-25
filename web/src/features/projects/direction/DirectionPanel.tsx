import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatDay } from '@/core/utils/format'
import type { Project, ProjectStatus, ProjectTaskCount, TeamActivity } from '@/domain/projects'
import type { Dependencies } from '@/domain/dependencies'
import type { ScreenKey } from '@/domain/screens'
import { AppTooltip } from '@/presentation/components'
import {
  DEFAULT_PANEL,
  KPI_IDS,
  NO_AREA,
  STATUS_COLORS,
  departmentScope,
  departmentSlices,
  ganttModel,
  isPanelFiltered,
  kpiOf,
  kpiStats,
  panelScope,
  statusScope,
  statusSlices,
  teamInScope,
  type KpiId,
  type PanelFilter,
} from './direction-data'
import { DirectionTeam } from './DirectionTeam'
import { PieChart } from './PieChart'
import { DepDrawer, DepFlag, DepStrip } from './Dependencies'
import { depAffected, depInScope } from './dependency-data'

/** Sem o bloco Dependências (§48): a linha do tempo fica sem o ⚠. */
const NO_DEPS = new Set<string>()

/** Cor da marca de cada estado; o nome vai sempre ao lado (a cor nunca fica sozinha). */
const dot = (color: string) => <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} />

export interface DirectionPanelProps {
  /** Todos os projetos não arquivados que a pessoa vê (a base dos percentuais). */
  projects: Project[]
  filter: PanelFilter
  onFilter: (filter: PanelFilter) => void
  /** Tarefas por projeto (vazio = não há contagem e o bloco some). */
  taskCounts: ProjectTaskCount[] | undefined
  /** "Equipo ahora" e se pode ser mostrado (exige tasks.view). */
  team: { data: TeamActivity | undefined; pending: boolean; error: boolean; retry: () => void } | null
  /** Dependências por área (§42); sem tasks.view ou ainda sem resposta, nada aparece. */
  dependencies?: Dependencies | undefined
  /** Blocos que o perfil mostra ("O que aparece" §48, `projects.blocks.*`); sem a função, todos. */
  shows?: (key: ScreenKey) => boolean
}

/** Painel da vista "Direção e gerência" de Em andamento (regras §41): indicadores, linha do tempo, gráficos e equipe. */
export function DirectionPanel({ projects, filter, onFilter, taskCounts, team, dependencies, shows = () => true }: DirectionPanelProps) {
  const scope = useMemo(() => panelScope(projects, filter), [projects, filter])
  const set = (patch: Partial<PanelFilter>) => onFilter({ ...filter, ...patch })
  // painel lateral das Dependências: null = fechado; only = projeto do ⚠ (null = todos do recorte)
  const [depView, setDepView] = useState<{ only: string | null } | null>(null)
  const depScope = useMemo(() => depInScope(dependencies, scope), [dependencies, scope])
  const affected = useMemo(() => depAffected(dependencies), [dependencies])
  // `contents`: a faixa fixa do filtro vale também sobre a tabela (o bloco pai dela é a página)
  return (
    <div className="contents" data-testid="direction-panel">
      {/* clicar no indicador escolhido de novo limpa a escolha (volta aos em andamento, sem destaque) */}
      {shows('projects.blocks.kpis') && <Kpis projects={projects} filter={filter} onSelect={(kpi) => set({ kpi: filter.kpi === kpi ? DEFAULT_PANEL.kpi : kpi })} />}
      <FilterBand projects={projects} filter={filter} count={scope.length} onClear={() => onFilter(DEFAULT_PANEL)} />
      {shows('projects.blocks.dependencies') && <DepStrip scope={depScope} onOpen={() => setDepView({ only: null })} />}
      {shows('projects.blocks.timeline') && (
        <Timeline projects={scope} affected={shows('projects.blocks.dependencies') ? affected : NO_DEPS} onDependencies={(projectId) => setDepView({ only: projectId })} />
      )}
      <DepDrawer data={dependencies} panel={scope} only={depView?.only ?? null} open={!!depView} onClose={() => setDepView(null)} onShowAll={() => setDepView({ only: null })} />
      {/* departamentos e estado de execução lado a lado (o bloco "Tarefas por projeto" saiu a pedido da coordenação) */}
      {(shows('projects.blocks.areas') || shows('projects.blocks.status')) && (
        <div className={cn('mb-4 grid gap-3', shows('projects.blocks.areas') && shows('projects.blocks.status') && 'lg:grid-cols-2')}>
          {shows('projects.blocks.areas') && <Departments projects={departmentScope(projects, filter)} area={filter.area} onSelect={(key) => set({ area: filter.area === key ? null : key })} />}
          {shows('projects.blocks.status') && <StatusStrip projects={statusScope(projects, filter)} status={filter.status} onSelect={(status) => set({ status: filter.status === status ? null : status })} />}
        </div>
      )}
      {team && <DirectionTeam team={teamInScope(team.data, scope)} projects={projects} counts={taskCounts} pending={team.pending} error={team.error} onRetry={team.retry} />}
    </div>
  )
}

/* ------------------------------------------------------------------ indicadores */

function Kpis({ projects, filter, onSelect }: { projects: Project[]; filter: PanelFilter; onSelect: (kpi: KpiId) => void }) {
  const { t } = useTranslation()
  const { base, stats } = useMemo(() => kpiStats(projects), [projects])
  const hints: Partial<Record<KpiId, string>> = { ongoing: t('direction.kpi.hintOngoing'), completed: t('direction.kpi.hintCompleted') }
  const dots: Partial<Record<KpiId, string>> = { planning: STATUS_COLORS.planning, active: STATUS_COLORS.active }
  return (
    <div role="group" aria-label={t('direction.kpi.label')} className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {KPI_IDS.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={filter.kpi === id}
          onClick={() => onSelect(id)}
          className={cn(
            'flex min-w-0 flex-col gap-1.5 rounded-xl border bg-surface p-4 text-left transition-[background-color,border-color,transform] duration-150 motion-reduce:transition-none',
            'hover:bg-surface-2 active:scale-[0.98] motion-reduce:active:scale-100',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            filter.kpi === id ? 'border-2 border-primary bg-primary-soft hover:bg-primary-soft' : 'border-border',
          )}
        >
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
            {dots[id] && dot(dots[id])}
            {t(`direction.kpi.${id}`)}
          </span>
          <span className="flex items-baseline gap-2.5">
            <span className="text-3xl font-bold leading-none tabular-nums text-fg">{stats[id].count}</span>
            {stats[id].percent !== null && <span className="text-sm font-bold tabular-nums text-muted">{stats[id].percent} %</span>}
          </span>
          <span className="text-xs text-muted">{hints[id] ?? t('direction.kpi.hintOfOngoing', { count: base })}</span>
        </button>
      ))}
    </div>
  )
}

function FilterBand({ projects, filter, count, onClear }: { projects: Project[]; filter: PanelFilter; count: number; onClear: () => void }) {
  const { t } = useTranslation()
  if (!isPanelFiltered(filter)) return null
  const areaName = filter.area === NO_AREA ? t('direction.departments.none') : projects.find((p) => p.area?.id === filter.area)?.area?.name
  const filters = [t(`direction.kpi.${kpiOf(filter)}`), filter.status && t(`projects.status.${filter.status}`), filter.area && areaName].filter(Boolean).join(' · ')
  return (
    <div role="status" className="sticky top-0 z-10 -mt-1 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-primary-border bg-primary-soft px-3.5 py-2.5 text-sm text-fg shadow-card">
      <span className="min-w-0 flex-1 basis-60">
        {t('direction.band.text', { filters, count })
          .split(filters)
          .flatMap((part, i, all) => (i < all.length - 1 ? [part, <strong key={i}>{filters}</strong>] : [part]))}
      </span>
      <button type="button" onClick={onClear} className="inline-flex items-center gap-1 font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-ring">
        <X aria-hidden className="size-3.5" />
        {t('direction.band.clear')}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ cartões */

function Card({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn('mb-4 rounded-xl border border-border bg-surface px-4 py-3.5', className)}>
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold tracking-tight text-fg">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ linha do tempo */

const LABEL_WIDTH = 220

function Timeline({ projects, affected, onDependencies }: { projects: Project[]; affected: Set<string>; onDependencies: (projectId: string) => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const model = useMemo(() => ganttModel(projects), [projects])
  // sem início e entrega válidos não há barra: aparecem no fim, marcados, para o número dos indicadores bater
  const undated = useMemo(() => projects.filter((p) => !(p.startDate && p.dueDate && p.dueDate.getTime() >= p.startDate.getTime())).sort((a, b) => a.name.localeCompare(b.name)), [projects])
  const legend = (
    <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-fg">
      {(['planning', 'active', 'paused'] as const).map((status) => (
        <li key={status} className="inline-flex items-center gap-1.5">
          {dot(STATUS_COLORS[status])}
          {t(`projects.status.${status}`)}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block size-2.5 rounded-full border-2 border-danger" />
        {t('direction.timeline.late')}
      </li>
    </ul>
  )
  return (
    <Card title={t('direction.timeline.title')} aside={legend}>
      {!model ? (
        <p className="py-2 text-sm text-muted">{t('direction.timeline.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="relative" style={{ minWidth: Math.max(720, model.months.length * 72 + LABEL_WIDTH) }}>
            <div className="grid border-b border-border pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted" style={{ gridTemplateColumns: `${LABEL_WIDTH}px 1fr` }}>
              <span>{t('direction.timeline.project')}</span>
              <div className="relative h-4">
                {model.months.map((month) => (
                  <span key={month.date.toISOString()} className="absolute top-0 whitespace-nowrap border-l border-border pl-1.5" style={{ left: `${month.left}%` }}>
                    {new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(month.date).replace('.', '')}
                  </span>
                ))}
              </div>
            </div>
            {/* linha de "Hoy" por cima de todas as linhas */}
            <div aria-hidden className="pointer-events-none absolute bottom-0 top-0 z-10" style={{ left: LABEL_WIDTH, right: 0 }}>
              <div className="absolute bottom-0 top-0 w-0.5 bg-danger" style={{ left: `${model.today}%` }}>
                <span className="absolute -left-3 top-0 -translate-y-0.5 rounded bg-surface px-0.5 text-[10px] font-extrabold uppercase text-danger">{t('direction.timeline.today')}</span>
              </div>
            </div>
            <ul>
              {model.rows.map((row) => {
                const color = STATUS_COLORS[row.project.status]
                const tip = t(row.late ? 'direction.timeline.tipLate' : 'direction.timeline.tip', {
                  name: row.project.name,
                  status: t(`projects.status.${row.project.status}`),
                  date: formatDay(row.project.dueDate, locale),
                })
                return (
                  <li key={row.project.id} className="grid min-h-6 items-center border-b border-border hover:bg-surface-2" style={{ gridTemplateColumns: `${LABEL_WIDTH}px 1fr` }}>
                    <span className="flex min-w-0 items-center pr-2.5">
                      <span className="truncate text-xs font-semibold text-fg" title={row.project.name}>
                        {row.project.name}
                      </span>
                      {affected.has(row.project.id) && <DepFlag name={row.project.name} onOpen={() => onDependencies(row.project.id)} />}
                    </span>
                    <div className="relative h-6">
                      <AppTooltip content={tip}>
                        <div
                          role="img"
                          aria-label={tip}
                          className={cn('absolute top-1.5 h-3 rounded', row.late && 'outline outline-2 outline-offset-1 outline-danger')}
                          style={{ left: `${row.left}%`, width: `${row.width}%`, background: color }}
                        />
                      </AppTooltip>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
      {undated.length > 0 && (
        <div>
          <p className="border-b border-border pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-muted">{t('direction.timeline.noDue', { count: undated.length })}</p>
          <ul>
            {undated.map((project) => (
              <li key={project.id} className="grid min-h-6 items-center border-b border-border" style={{ gridTemplateColumns: `${LABEL_WIDTH}px 1fr` }}>
                <span className="flex min-w-0 items-center pr-2.5">
                  <span className="truncate text-xs text-muted" title={project.name}>
                    {project.name}
                  </span>
                  {affected.has(project.id) && <DepFlag name={project.name} onOpen={() => onDependencies(project.id)} />}
                </span>
                <span className="justify-self-start rounded-md bg-warning-soft px-2 py-0.5 text-[11.5px] text-warning-soft-fg">{t('direction.timeline.noDueTag')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ departamentos */

function Departments({ projects, area, onSelect }: { projects: Project[]; area: string | null; onSelect: (key: string) => void }) {
  const { t } = useTranslation()
  const slices = useMemo(() => departmentSlices(projects), [projects])
  const items = slices.map((slice) => ({ ...slice, label: slice.key === NO_AREA ? t('direction.departments.none') : slice.name }))
  return (
    <Card title={t('direction.departments.title')} className="mb-0">
      {items.length === 0 ? (
        <p className="py-2 text-sm text-muted">{t('direction.departments.empty')}</p>
      ) : (
        <PieChart
          items={items}
          selected={area}
          onSelect={onSelect}
          chartLabel={t('direction.departments.chart')}
          sliceTitle={(item) => t('direction.departments.slice', { name: item.label, count: item.count, percent: item.percent })}
        />
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ estado de execução */

/** Estado de execução em torta (ajuste 25/11), no mesmo formato de "Projetos por departamento" e com as cores de sempre. */
function StatusStrip({ projects, status, onSelect }: { projects: Project[]; status: ProjectStatus | null; onSelect: (status: ProjectStatus) => void }) {
  const { t } = useTranslation()
  const slices = useMemo(() => statusSlices(projects), [projects])
  const items = slices.map((slice) => ({ key: slice.status, label: t(`projects.status.${slice.status}`), count: slice.count, percent: slice.percent, color: STATUS_COLORS[slice.status] }))
  const byKey = new Map(slices.map((slice) => [slice.status as string, slice.status]))
  return (
    <Card title={t('direction.status.title')} aside={<span className="text-xs text-muted">{t('direction.status.count', { count: projects.length })}</span>} className="mb-0">
      <PieChart
        items={items}
        selected={status}
        onSelect={(key) => {
          const picked = byKey.get(key)
          if (picked) onSelect(picked)
        }}
        chartLabel={t('direction.status.chart')}
        sliceTitle={(item) => t('direction.status.segment', { label: item.label, count: item.count, percent: item.percent })}
      />
    </Card>
  )
}

