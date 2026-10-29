import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { AppTooltip } from './AppTooltip'

/* ------------------------------------------------------------------ indicador */

const STAT_TONES = {
  default: 'text-fg',
  danger: 'text-danger',
  warning: 'text-warning',
  success: 'text-success',
} as const

export interface AppStatCardProps {
  label: ReactNode
  value: ReactNode
  /** Linha de apoio (ex.: "no período", amostra da média). */
  hint?: ReactNode
  icon?: ReactNode
  tone?: keyof typeof STAT_TONES
  className?: string
  /** Torna o card clicável (ex.: abrir as tarefas por trás do número). */
  onSelect?: () => void
  /** Texto da ação, mostrado ao passar o mouse ou focar (ex.: "Ver tarefas"). */
  actionLabel?: ReactNode
  /** O que o indicador mede (dica ao passar o mouse ou focar). */
  tooltip?: ReactNode
}

/** Indicador numérico (valor grande + rótulo + dica). Com `onSelect`, vira um botão com destaque ao passar o mouse. */
export function AppStatCard({ label, value, hint, icon, tone = 'default', className, onSelect, actionLabel, tooltip }: AppStatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2 text-sm text-muted">
        <span className="line-clamp-2">{label}</span>
        {icon && <span className={cn('shrink-0 text-subtle transition-colors [&_svg]:size-4', onSelect && 'group-hover:text-primary-text group-focus-visible:text-primary-text')}>{icon}</span>}
      </div>
      <div className={cn('text-2xl font-semibold tracking-tight tabular-nums', STAT_TONES[tone])}>{value}</div>
      <div className="flex items-end justify-between gap-2">
        {hint ? <div className="line-clamp-2 min-w-0 text-xs text-subtle">{hint}</div> : <span />}
        {onSelect && actionLabel && (
          // sempre no DOM (compõe o nome do botão); aparece ao passar o mouse ou focar
          <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary-text opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {actionLabel}
            <ArrowRight className="size-3.5" aria-hidden />
          </span>
        )}
      </div>
    </>
  )
  const base = 'flex min-w-0 flex-col gap-1 rounded-2xl border border-border bg-surface p-4 shadow-card'
  if (!onSelect) return <div className={cn(base, className)}>{body}</div>
  return (
    <AppTooltip content={tooltip}>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          base,
          'group w-full cursor-pointer text-left transition duration-150',
          'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-float active:translate-y-0',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'motion-reduce:transform-none motion-reduce:transition-none',
          className,
        )}
      >
        {body}
      </button>
    </AppTooltip>
  )
}

/* ------------------------------------------------------------------ barras horizontais */

export interface AppBarListItem {
  key: string
  label: ReactNode
  /** Linha secundária sob o rótulo (ex.: "2 pendentes · 28 h"). */
  detail?: ReactNode
  value: number
}

export interface AppBarListProps {
  items: AppBarListItem[]
  /** Nome acessível da lista (ex.: "Abertas por prioridade"). */
  label: string
  formatValue?: (value: number) => ReactNode
  empty?: ReactNode
  className?: string
}

/** Distribuição em barras horizontais proporcionais ao maior valor. */
export function AppBarList({ items, label, formatValue = (v) => v, empty, className }: AppBarListProps) {
  const max = Math.max(0, ...items.map((i) => i.value))
  if (items.length === 0 || max === 0) return <p className="text-sm text-subtle">{empty}</p>
  return (
    <ul aria-label={label} className={cn('flex flex-col gap-2', className)}>
      {items.map((item) => (
        <li key={item.key} className={cn('grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm', item.detail !== undefined && 'sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]')}>
          {item.detail !== undefined ? (
            <span className="flex min-w-0 flex-col">
              <span className="min-w-0 truncate text-fg">{item.label}</span>
              <span className="min-w-0 truncate text-xs text-muted">{item.detail}</span>
            </span>
          ) : (
            <span className="min-w-0 truncate text-fg">{item.label}</span>
          )}
          <span className="h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
          </span>
          <span className="text-right tabular-nums text-muted">{formatValue(item.value)}</span>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ evolução (duas séries) */

export interface AppTrendPoint {
  key: string
  /** Rótulo do eixo (ex.: "12/09"). */
  label: string
  a: number
  b: number
  /** Terceira série (opcional; ver `seriesC`). */
  c?: number
}

export interface AppTrendChartProps {
  points: AppTrendPoint[]
  seriesA: string
  seriesB: string
  /** Terceira série, em tom neutro (ex.: "Tarefas criadas" ao lado das entregas). */
  seriesC?: string
  /** Descrição acessível (ex.: "Criadas e concluídas por dia"). */
  title: string
  height?: number
  className?: string
}

/** Colunas lado a lado (série A em destaque, B no lima e C, opcional, neutra) com legenda e tabela acessível. */
export function AppTrendChart({ points, seriesA, seriesB, seriesC, title, height = 160, className }: AppTrendChartProps) {
  const max = Math.max(1, ...points.map((p) => Math.max(p.a, p.b, seriesC ? (p.c ?? 0) : 0)))
  const barWidth = seriesC ? 'w-1/3' : 'w-1/2'
  // no máximo ~12 rótulos no eixo para não embaralhar
  const every = Math.max(1, Math.ceil(points.length / 12))
  return (
    // relative: a tabela sr-only fica ancorada no gráfico (não estica a página)
    <figure className={cn('relative flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary" />
          {seriesA}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-accent" />
          {seriesB}
        </span>
        {seriesC && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-muted" />
            {seriesC}
          </span>
        )}
      </div>
      <div className="flex items-end gap-1 overflow-x-auto" style={{ height }} aria-hidden>
        {points.map((p, i) => (
          <div key={p.key} className="group relative flex h-full min-w-2 flex-1 items-end justify-center gap-px rounded-sm transition-colors hover:bg-surface-2">
            <span className={cn(barWidth, 'max-w-3 rounded-t-sm bg-primary transition-opacity group-hover:opacity-90')} style={{ height: `${(p.a / max) * 100}%`, minHeight: p.a ? 2 : 0 }} />
            <span className={cn(barWidth, 'max-w-3 rounded-t-sm bg-accent transition-opacity group-hover:opacity-90')} style={{ height: `${(p.b / max) * 100}%`, minHeight: p.b ? 2 : 0 }} />
            {seriesC && (
              <span className={cn(barWidth, 'max-w-3 rounded-t-sm bg-muted transition-opacity group-hover:opacity-90')} style={{ height: `${((p.c ?? 0) / max) * 100}%`, minHeight: p.c ? 2 : 0 }} />
            )}
            {/* valores do ponto ao passar o mouse (a tabela sr-only abaixo cobre leitores de tela) */}
            <span
              className={cn(
                'pointer-events-none absolute top-0 z-10 hidden whitespace-nowrap rounded-md bg-fg px-2 py-1 text-[11px] font-medium text-bg shadow-float group-hover:block',
                i < points.length / 3 ? 'left-0' : i > (points.length * 2) / 3 ? 'right-0' : 'left-1/2 -translate-x-1/2',
              )}
            >
              <span className="block">{p.label}</span>
              <span className="block">
                {seriesA}: {p.a} · {seriesB}: {p.b}
                {seriesC && ` · ${seriesC}: ${p.c ?? 0}`}
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-1 text-[10px] text-subtle" aria-hidden>
        {points.map((p, i) => (
          <span key={p.key} className="min-w-2 flex-1 overflow-hidden text-center whitespace-nowrap">
            {i % every === 0 ? p.label : ''}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">—</th>
            <th scope="col">{seriesA}</th>
            <th scope="col">{seriesB}</th>
            {seriesC && <th scope="col">{seriesC}</th>}
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}>
              <th scope="row">{p.label}</th>
              <td>{p.a}</td>
              <td>{p.b}</td>
              {seriesC && <td>{p.c ?? 0}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
