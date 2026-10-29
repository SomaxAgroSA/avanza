import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { AppTooltip } from './AppTooltip'
import { CHART_TONES, type AppChartTone } from './chart-tones'

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
  /** Empilha A e B numa coluna só (ex.: o total de entregas e a parte de cada tipo); ignora a série C. */
  stacked?: boolean
  className?: string
}

/** Colunas lado a lado (série A em destaque, B no lima e C, opcional, neutra) com legenda e tabela acessível. */
export function AppTrendChart({ points, seriesA, seriesB, seriesC: thirdSeries, title, height = 160, stacked = false, className }: AppTrendChartProps) {
  const seriesC = stacked ? undefined : thirdSeries
  const max = Math.max(1, ...points.map((p) => (stacked ? p.a + p.b : Math.max(p.a, p.b, seriesC ? (p.c ?? 0) : 0))))
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
            {stacked ? (
              // B por cima de A, com um respiro de 2px entre as partes; só a ponta de cima é arredondada
              <span
                data-stack
                className="flex w-3/5 max-w-6 origin-bottom animate-grow-y flex-col-reverse gap-0.5 transition-[height] duration-500 ease-out"
                style={{ height: `${((p.a + p.b) / max) * 100}%`, animationDelay: `${Math.min(i, 24) * 35}ms` }}
              >
                {p.a > 0 && <span className={cn('min-h-0.5 bg-primary transition-opacity group-hover:opacity-90', !p.b && 'rounded-t')} style={{ flexGrow: p.a, flexBasis: 0 }} />}
                {p.b > 0 && <span className="min-h-0.5 rounded-t bg-accent transition-opacity group-hover:opacity-90" style={{ flexGrow: p.b, flexBasis: 0 }} />}
              </span>
            ) : (
              <>
                <span className={cn(barWidth, 'max-w-3 rounded-t-sm bg-primary transition-opacity group-hover:opacity-90')} style={{ height: `${(p.a / max) * 100}%`, minHeight: p.a ? 2 : 0 }} />
                <span className={cn(barWidth, 'max-w-3 rounded-t-sm bg-accent transition-opacity group-hover:opacity-90')} style={{ height: `${(p.b / max) * 100}%`, minHeight: p.b ? 2 : 0 }} />
              </>
            )}
            {seriesC && (
              <span className={cn(barWidth, 'max-w-3 rounded-t-sm bg-muted transition-opacity group-hover:opacity-90')} style={{ height: `${((p.c ?? 0) / max) * 100}%`, minHeight: p.c ? 2 : 0 }} />
            )}
            {/* valores do ponto ao passar o mouse (a tabela sr-only abaixo cobre leitores de tela) */}
            <AppChartTooltip
              className={cn('top-0 hidden group-hover:flex', i < points.length / 3 ? 'left-0' : i > (points.length * 2) / 3 ? 'right-0' : 'left-1/2 -translate-x-1/2')}
              title={p.label}
              rows={[
                { key: 'a', label: seriesA, value: p.a, tone: 'primary' as const },
                { key: 'b', label: seriesB, value: p.b, tone: 'accent' as const },
                ...(seriesC ? [{ key: 'c', label: seriesC, value: p.c ?? 0, tone: 'neutral' as const }] : []),
              ]}
            />
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
      {/* sr-only num div: uma tabela ignora a largura de 1px e alargaria a rolagem da página */}
      <div className="sr-only">
        <table>
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
      </div>
    </figure>
  )
}

/* ------------------------------------------------------------------ tons dos gráficos */

export interface AppChartSegment {
  key: string
  label: string
  value: number
  tone: AppChartTone
}

/** "Rótulo: A 3, B 1" — o gráfico inteiro como texto para leitores de tela. */
function describeChart(label: string, segments: AppChartSegment[], format: (value: number) => ReactNode = (v) => v): string {
  const parts = segments.map((s) => `${s.label} ${String(format(s.value))}`)
  return parts.length ? `${label}: ${parts.join(', ')}` : label
}

/** Liga a animação de entrada depois da 1ª pintura (o CSS zera a duração com "reduzir movimento"). */
function useDrawn() {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return drawn
}

/* ------------------------------------------------------------------ dica dos gráficos */

export interface AppChartTooltipRow {
  key: string
  label: ReactNode
  value: ReactNode
  tone?: AppChartTone
}

/** Balão com os valores exatos de uma marca do gráfico (ao passar o mouse); não recebe o ponteiro. */
export function AppChartTooltip({ title, rows, className, style }: { title?: ReactNode; rows: AppChartTooltipRow[]; className?: string; style?: CSSProperties }) {
  return (
    <span role="presentation" style={style} className={cn('pointer-events-none absolute z-20 flex min-w-28 flex-col gap-0.5 whitespace-nowrap rounded-lg bg-fg px-2.5 py-1.5 text-[11px] text-bg shadow-float animate-fade-in', className)}>
      {title && <span className="font-semibold">{title}</span>}
      {rows.map((row) => (
        <span key={row.key} className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5">
            {row.tone && <span aria-hidden className={cn('size-2 rounded-full', CHART_TONES[row.tone].bg)} />}
            {row.label}
          </span>
          <span className="font-semibold tabular-nums">{row.value}</span>
        </span>
      ))}
    </span>
  )
}

/* ------------------------------------------------------------------ rosca */

export interface AppDonutProps {
  segments: AppChartSegment[]
  /** Nome acessível (o gráfico vira "Nome: parte valor, ..."). */
  label: string
  /** Conteúdo no centro (ex.: o total); ao passar o mouse numa parte, o centro mostra a parte. */
  children?: ReactNode
  /** Espessura do anel (em % do diâmetro). */
  thickness?: number
  /** Parte em destaque (ex.: filtro ativo): as outras ficam esmaecidas. */
  activeKey?: string | null
  /** Clique numa parte (o teclado usa a legenda, que quem chama torna clicável). */
  onSegmentClick?: (key: string) => void
  className?: string
}

/**
 * Rosca (anel) com as partes proporcionais, separadas por um respiro, e o centro livre para o total.
 * As partes se desenham ao aparecer e ao mudar; passar o mouse destaca a parte e mostra o valor no centro.
 */
export function AppDonut({ segments, label, children, thickness = 10, activeKey, onSegmentClick, className }: AppDonutProps) {
  const drawn = useDrawn()
  const [hovered, setHovered] = useState<string | null>(null)
  const visible = segments.filter((s) => s.value > 0)
  const total = visible.reduce((sum, s) => sum + s.value, 0)
  const gap = visible.length > 1 ? 1.2 : 0
  const radius = 50 - thickness / 2
  // início (em % do anel) de cada parte
  const arcs = visible.map((segment, index) => ({
    segment,
    length: (segment.value / total) * 100,
    start: visible.slice(0, index).reduce((sum, s) => sum + (s.value / total) * 100, 0),
  }))
  const focus = hovered ?? activeKey ?? null
  const shown = hovered ? visible.find((s) => s.key === hovered) : undefined
  return (
    <div className={cn('relative size-40 shrink-0', className)}>
      <svg viewBox="0 0 100 100" role="img" aria-label={describeChart(label, visible)} className="size-full -rotate-90 overflow-visible" onMouseLeave={() => setHovered(null)}>
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth={thickness} className="stroke-surface-3" />
        {arcs.map(({ segment, length, start }) => {
          const dash = Math.max(0.4, length - gap)
          const dimmed = focus !== null && focus !== segment.key
          return (
            // o clique é atalho de mouse; no teclado, a legenda (de quem chama) faz o mesmo
            <circle
              key={segment.key}
              data-segment={segment.key}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={hovered === segment.key ? thickness + 3 : thickness}
              pathLength={100}
              strokeDasharray={drawn ? `${dash} ${100 - dash}` : `0 100`}
              strokeDashoffset={-start}
              onMouseEnter={() => setHovered(segment.key)}
              onClick={onSegmentClick ? () => onSegmentClick(segment.key) : undefined}
              className={cn(
                CHART_TONES[segment.tone].text,
                'transition-[stroke-dasharray,stroke-width,opacity] duration-700 ease-out',
                dimmed && 'opacity-30',
                onSegmentClick && 'cursor-pointer',
              )}
            />
          )
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        {shown ? (
          <>
            <span className="font-display text-3xl font-semibold leading-none tabular-nums text-fg">{shown.value}</span>
            <span className="mt-1 max-w-20 text-xs leading-tight text-muted">{shown.label}</span>
          </>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ barra empilhada */

export interface AppStackedBarProps {
  segments: AppChartSegment[]
  /** Nome acessível da barra e da legenda. */
  label: string
  formatValue?: (value: number) => ReactNode
  /** Legenda com os números sob a barra (padrão: sim). */
  legend?: boolean
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Uma barra com as partes de um todo (ex.: elementos por situação) e a legenda com os valores. A barra
 * cresce ao aparecer e as partes deslizam quando os números mudam; passar o mouse mostra o valor e a %.
 */
export function AppStackedBar({ segments, label, formatValue = (v) => v, legend = true, size = 'md', className }: AppStackedBarProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const visible = segments.filter((s) => s.value > 0)
  const total = visible.reduce((sum, s) => sum + s.value, 0)
  const index = visible.findIndex((s) => s.key === hovered)
  const active = visible[index]
  const center = active ? (visible.slice(0, index).reduce((sum, s) => sum + s.value, 0) + active.value / 2) / total : 0
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="relative">
        {active && (
          <AppChartTooltip
            className={cn('bottom-full mb-2', center < 0.2 ? 'left-0' : center > 0.8 ? 'right-0' : '-translate-x-1/2')}
            style={center >= 0.2 && center <= 0.8 ? { left: `${center * 100}%` } : undefined}
            rows={[{ key: active.key, label: active.label, value: <>{formatValue(active.value)} · {Math.round((active.value / total) * 100)}%</>, tone: active.tone }]}
          />
        )}
        <div
          role="img"
          aria-label={describeChart(label, segments, formatValue)}
          onMouseLeave={() => setHovered(null)}
          className={cn('flex w-full gap-0.5 overflow-hidden rounded-full bg-surface-3', size === 'sm' ? 'h-2' : 'h-3')}
        >
          <div className="flex w-full origin-left animate-grow-x gap-0.5">
            {visible.map((segment) => (
              <span
                key={segment.key}
                data-segment={segment.key}
                onMouseEnter={() => setHovered(segment.key)}
                className={cn('h-full min-w-1.5 transition-[flex-grow,opacity] duration-500 ease-out', CHART_TONES[segment.tone].bg, hovered && hovered !== segment.key && 'opacity-40')}
                style={{ flexGrow: segment.value, flexBasis: 0 }}
              />
            ))}
          </div>
        </div>
      </div>
      {legend && (
        <ul aria-label={label} className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          {segments.map((segment) => (
            <li key={segment.key} className={cn('inline-flex items-center gap-1.5 transition-opacity', hovered && hovered !== segment.key && 'opacity-50')}>
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full', CHART_TONES[segment.tone].bg)} />
              <span className="text-muted">{segment.label}</span>
              <span className="font-medium tabular-nums text-fg">{formatValue(segment.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ minigráfico */

export interface AppSparklineProps {
  values: number[]
  /** Nome acessível (ex.: "Entregas por mês"). */
  label: string
  tone?: AppChartTone
  className?: string
}

/** Linha mínima da tendência (sem eixos), com área suave e o último ponto marcado. Menos de 2 pontos: nada. */
export function AppSparkline({ values, label, tone = 'primary', className }: AppSparklineProps) {
  if (values.length < 2) return null
  const max = Math.max(1, ...values)
  const x = (i: number) => (i / (values.length - 1)) * 100
  const y = (v: number) => 30 - (v / max) * 28
  const points = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`)
  const last = values[values.length - 1] ?? 0
  return (
    <div className={cn('relative h-8 w-full animate-reveal-x', CHART_TONES[tone].text, className)}>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label={label} className="size-full overflow-visible">
        <polygon points={`0,32 ${points.join(' ')} 100,32`} fill="currentColor" opacity={0.12} />
        <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span aria-hidden className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-2 ring-surface" style={{ left: '100%', top: `${(y(last) / 32) * 100}%` }} />
    </div>
  )
}

/* ------------------------------------------------------------------ métrica solta */

const METRIC_TONES = { default: 'text-fg', danger: 'text-danger', warning: 'text-warning-soft-fg', success: 'text-primary-text' } as const

export interface AppMetricProps {
  label: ReactNode
  value: ReactNode
  /** Linha de apoio (ex.: "4 tarefas · 3 elementos"). */
  hint?: ReactNode
  tone?: keyof typeof METRIC_TONES
  size?: 'md' | 'lg'
  /** Visual sob o número (barra fina, minigráfico). */
  children?: ReactNode
  /** Torna a métrica um botão (ex.: ir para a seção do detalhe). */
  onSelect?: () => void
  /** Texto da ação, mostrado ao passar o mouse ou focar (ex.: "Ver portfólio"); compõe o nome do botão. */
  actionLabel?: ReactNode
  className?: string
}

/** Número de destaque sem cartão (dentro de um bloco maior): rótulo, valor grande, apoio e o visual no pé. */
export function AppMetric({ label, value, hint, tone = 'default', size = 'md', children, onSelect, actionLabel, className }: AppMetricProps) {
  const body = (
    <>
      <span className="text-sm text-muted">{label}</span>
      <span className={cn('mt-1 font-display font-semibold leading-tight tracking-tight tabular-nums', size === 'lg' ? 'text-4xl' : 'text-2xl', METRIC_TONES[tone])}>{value}</span>
      {hint && <span className="mt-1 text-xs text-muted">{hint}</span>}
      {/* o visual fica no pé: métricas lado a lado alinham os números e os gráficos */}
      {children && <span className="mt-auto block pt-4">{children}</span>}
      {onSelect && actionLabel && (
        // fora do fluxo: aparece no canto ao passar o mouse sem apertar o rótulo
        <span className="absolute top-2 right-3 inline-flex items-center gap-0.5 text-xs font-medium text-primary-text opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {actionLabel}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      )}
    </>
  )
  if (!onSelect) return <div className={cn('flex min-w-0 flex-col', className)}>{body}</div>
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group relative flex min-w-0 cursor-pointer flex-col text-left transition-colors duration-150 hover:bg-surface-2/70',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      {body}
    </button>
  )
}

/* ------------------------------------------------------------------ medidor */

export interface AppMeterProps {
  /** 0 a 100 (fora disso, limita). */
  value: number
  /** Nome acessível (ex.: "Progresso do CRM"). */
  label: string
  tone?: AppChartTone
  size?: 'sm' | 'md'
  className?: string
}

/** Barra fina de progresso (o número fica com quem usa, ao lado ou acima); cresce ao aparecer e ao mudar. */
export function AppMeter({ value, label, tone = 'primary', size = 'sm', className }: AppMeterProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('w-full overflow-hidden rounded-full bg-surface-3', size === 'sm' ? 'h-1.5' : 'h-2', className)}
    >
      <div className={cn('h-full origin-left animate-grow-x rounded-full transition-[width] duration-700 ease-out', CHART_TONES[tone].bg)} style={{ width: `${clamped}%` }} />
    </div>
  )
}
