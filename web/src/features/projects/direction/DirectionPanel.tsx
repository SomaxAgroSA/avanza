import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatDay } from '@/core/utils/format'
import type { Project, ProjectStatus, ProjectTaskCount, TeamActivity } from '@/domain/projects'
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
  kpiStats,
  panelScope,
  pieSlicePaths,
  statusScope,
  statusSlices,
  taskBars,
  teamInScope,
  type KpiId,
  type PanelFilter,
} from './direction-data'
import { DirectionTeam } from './DirectionTeam'
import { TaskBar } from './TaskBar'

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
}

/** Painel da vista "Direção e gerência" de Em andamento (regras §41): indicadores, linha do tempo, gráficos e equipe. */
export function DirectionPanel({ projects, filter, onFilter, taskCounts, team }: DirectionPanelProps) {
  const scope = useMemo(() => panelScope(projects, filter), [projects, filter])
  const set = (patch: Partial<PanelFilter>) => onFilter({ ...filter, ...patch })
  // `contents`: a faixa fixa do filtro vale também sobre a tabela (o bloco pai dela é a página)
  return (
    <div className="contents" data-testid="direction-panel">
      <Kpis projects={projects} filter={filter} onSelect={(kpi) => set({ kpi: filter.kpi === kpi && kpi !== DEFAULT_PANEL.kpi ? DEFAULT_PANEL.kpi : kpi })} />
      <FilterBand projects={projects} filter={filter} count={scope.length} onClear={() => onFilter(DEFAULT_PANEL)} />
      <Timeline projects={scope} />
      <div className={cn('mb-4 grid gap-3', taskCounts && taskCounts.length > 0 ? 'lg:grid-cols-2' : '')}>
        <Departments projects={departmentScope(projects, filter)} area={filter.area} onSelect={(key) => set({ area: filter.area === key ? null : key })} />
        {taskCounts && taskCounts.length > 0 && <TasksCard projects={scope} counts={taskCounts} />}
      </div>
      <StatusStrip projects={statusScope(projects, filter)} status={filter.status} onSelect={(status) => set({ status: filter.status === status ? null : status })} />
      {team && <DirectionTeam team={teamInScope(team.data, scope)} projects={projects} counts={taskCounts} pending={team.pending} error={team.error} onRetry={team.retry} />}
    </div>
  )
}

/* ------------------------------------------------------------------ indicadores */

function Kpis({ projects, filter, onSelect }: { projects: Project[]; filter: PanelFilter; onSelect: (kpi: KpiId) => void }) {
  const { t } = useTranslation()
  const stats = useMemo(() => kpiStats(projects), [projects])
  const hints: Partial<Record<KpiId, string>> = { ongoing: t('direction.kpi.hintOngoing'), high: t('direction.kpi.hintHigh') }
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
            <span className="text-sm font-bold tabular-nums text-muted">{stats[id].percent} %</span>
          </span>
          <span className="text-xs text-muted">{hints[id] ?? t('direction.kpi.hintTotal', { count: projects.length })}</span>
        </button>
      ))}
    </div>
  )
}

function FilterBand({ projects, filter, count, onClear }: { projects: Project[]; filter: PanelFilter; count: number; onClear: () => void }) {
  const { t } = useTranslation()
  if (!isPanelFiltered(filter)) return null
  const areaName = filter.area === NO_AREA ? t('direction.departments.none') : projects.find((p) => p.area?.id === filter.area)?.area?.name
  const filters = [t(`direction.kpi.${filter.kpi}`), filter.status && t(`projects.status.${filter.status}`), filter.area && areaName].filter(Boolean).join(' · ')
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

function Timeline({ projects }: { projects: Project[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const model = useMemo(() => ganttModel(projects), [projects])
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
                    <span className="truncate pr-2.5 text-xs font-semibold text-fg" title={row.project.name}>
                      {row.project.name}
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
    </Card>
  )
}

/* ------------------------------------------------------------------ departamentos */

function Departments({ projects, area, onSelect }: { projects: Project[]; area: string | null; onSelect: (key: string) => void }) {
  const { t } = useTranslation()
  const slices = useMemo(() => departmentSlices(projects), [projects])
  const paths = useMemo(() => pieSlicePaths(slices, 80, 80, 70), [slices])
  const nameOf = (name: string, key: string) => (key === NO_AREA ? t('direction.departments.none') : name)
  return (
    <Card title={t('direction.departments.title')} className="mb-0">
      <p className="mb-2 text-xs text-muted">{t('direction.departments.hint', { count: projects.length })}</p>
      {slices.length === 0 ? (
        <p className="py-2 text-sm text-muted">{t('direction.departments.empty')}</p>
      ) : (
        <div className="grid items-center gap-4 sm:grid-cols-[150px_1fr]">
          <svg viewBox="0 0 160 160" role="img" aria-label={t('direction.departments.chart')} className="mx-auto h-auto w-full max-w-[150px]">
            {slices.map((slice) => (
              <path
                key={slice.key}
                d={paths.find((p) => p.key === slice.key)?.d}
                fill={slice.color}
                stroke="var(--color-surface)"
                strokeWidth={2}
                className="cursor-pointer motion-safe:transition-opacity"
                opacity={area && area !== slice.key ? 0.3 : 1}
                onClick={() => onSelect(slice.key)}
              >
                <title>{t('direction.departments.slice', { name: nameOf(slice.name, slice.key), count: slice.count, percent: slice.percent })}</title>
              </path>
            ))}
          </svg>
          <ul className="flex flex-col">
            {slices.map((slice) => (
              <li key={slice.key}>
                <button
                  type="button"
                  aria-pressed={area === slice.key}
                  onClick={() => onSelect(slice.key)}
                  className="grid w-full grid-cols-[14px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] text-fg hover:bg-surface-2 aria-pressed:bg-surface-2 aria-pressed:font-semibold focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {dot(slice.color)}
                  <span className="truncate">{nameOf(slice.name, slice.key)}</span>
                  <span className="font-bold tabular-nums">{slice.count}</span>
                  <span className="min-w-9 text-right text-xs tabular-nums text-muted">{slice.percent} %</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ tarefas por projeto */

function TasksCard({ projects, counts }: { projects: Project[]; counts: ProjectTaskCount[] }) {
  const { t } = useTranslation()
  const bars = useMemo(() => taskBars(projects, counts), [projects, counts])
  const legend = (
    <span className="flex gap-3 text-xs text-fg">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block size-2.5 rounded-full bg-primary" />
        {t('direction.tasks.done')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block size-2.5 rounded-full bg-border-strong" />
        {t('direction.tasks.open')}
      </span>
    </span>
  )
  return (
    <Card title={t('direction.tasks.title')} aside={legend} className="mb-0">
      {bars.length === 0 ? (
        <p className="py-2 text-sm text-muted">{t('direction.tasks.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {bars.map((bar) => {
            const total = bar.done + bar.open
            const tip = t('direction.tasks.tip', { name: bar.project.name, done: bar.done, total, percent: bar.percent, open: bar.open })
            return (
              <li key={bar.project.id}>
                <AppTooltip content={tip}>
                  <div aria-label={tip} role="img">
                    <div className="mb-0.5 flex justify-between gap-2.5 text-[12.5px] text-fg">
                      <span className="truncate" title={bar.project.name}>
                        {bar.project.name}
                      </span>
                      <span className="shrink-0 text-xs font-bold tabular-nums text-fg">{bar.percent} %</span>
                    </div>
                    <TaskBar done={bar.done} open={bar.open} />
                  </div>
                </AppTooltip>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ estado de execução */

function StatusStrip({ projects, status, onSelect }: { projects: Project[]; status: ProjectStatus | null; onSelect: (status: ProjectStatus) => void }) {
  const { t } = useTranslation()
  const slices = useMemo(() => statusSlices(projects), [projects])
  return (
    <Card title={t('direction.status.title')} aside={<span className="text-xs text-muted">· {t('direction.status.count', { count: projects.length })}</span>}>
      <div role="group" aria-label={t('direction.status.bar')} className="my-2 flex h-3 gap-0.5 overflow-hidden rounded-md">
        {slices
          .filter((slice) => slice.count > 0)
          .map((slice) => {
            const label = t(`projects.status.${slice.status}`)
            const tip = t('direction.status.segment', { label, count: slice.count, percent: slice.percent })
            return (
              <AppTooltip key={slice.status} content={tip}>
                <button
                  type="button"
                  aria-label={tip}
                  aria-pressed={status === slice.status}
                  onClick={() => onSelect(slice.status)}
                  className="h-full cursor-pointer motion-safe:transition-opacity hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  style={{ flex: slice.count, background: STATUS_COLORS[slice.status], opacity: status && status !== slice.status ? 0.3 : 1 }}
                />
              </AppTooltip>
            )
          })}
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-1">
        {slices.map((slice) => (
          <li key={slice.status}>
            <button
              type="button"
              aria-pressed={status === slice.status}
              onClick={() => onSelect(slice.status)}
              className="inline-flex items-center gap-2 rounded-lg px-2 py-0.5 text-[13px] text-fg hover:bg-surface-2 aria-pressed:bg-surface-2 aria-pressed:font-semibold focus-visible:outline-2 focus-visible:outline-ring"
            >
              {dot(STATUS_COLORS[slice.status])}
              <span>{t(`projects.status.${slice.status}`)}</span>
              <b className="tabular-nums">{slice.count}</b>
              <span className="text-xs tabular-nums text-muted">{slice.percent} %</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

