import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { MARKER_MAX_LANES, barBox, daysFromPixels, estimateTextWidth, layoutLabels, shiftSpan, weekdayOf, type DaySpan, type HeaderSegment } from '@/domain/timeline'

/* ------------------------------------------------------------------ tipos */

export interface AppTimelineBar {
  id: string
  /** Conteúdo da coluna da esquerda (código, título…). */
  label: ReactNode
  /** Texto curto dentro da barra. */
  barText: string
  /** Nome acessível da barra (ex.: "CRM-3 · Desenho, 3 a 9 de out."). */
  ariaLabel: string
  span: DaySpan | null
  /** Cores da barra (tokens do tema, ex.: optionColor/optionTint/optionText). */
  accent: string
  tint: string
  text: string
  /** 0..1 (subtarefas/checklist). */
  progress?: number
  /** Atrasada. */
  danger?: boolean
  /** Começa antes do prazo de uma tarefa de que depende. */
  conflict?: boolean
  /** Linha de base (período planejado salvo): traço fino sob a barra. */
  baseline?: DaySpan | null
  draggable: boolean
}

export interface AppTimelineGroup {
  key: string
  label: ReactNode
  collapsed: boolean
  bars: AppTimelineBar[]
  /** Período do grupo (menor início → maior fim), desenhado no cabeçalho do grupo. */
  summary?: { span: DaySpan; color: string } | null
}

export interface AppTimelineMarker {
  id: string
  day: number
  label: string
  ariaLabel: string
  done: boolean
}

export interface AppTimelineBand {
  id: string
  start: number
  end: number
  label: string
}

export interface AppTimelineLink {
  id: string
  from: string
  to: string
  conflict: boolean
}

export interface AppTimelineProps {
  /** Nome acessível do componente. */
  label: string
  groups: AppTimelineGroup[]
  showGroupHeaders: boolean
  range: DaySpan
  pxPerDay: number
  today: number
  tiers: { top: HeaderSegment[]; bottom: HeaderSegment[] }
  formatTop: (segment: HeaderSegment) => string
  formatBottom: (segment: HeaderSegment) => string
  /** Período legível (ex.: "3 a 9 de out.") para o anúncio ao mover pelo teclado. */
  formatSpan: (span: DaySpan) => string
  leftHeader: ReactNode
  todayLabel: string
  /** Instruções de teclado (lidas pelo leitor de tela ao focar a barra). */
  keyboardHint: string
  markers?: AppTimelineMarker[]
  bands?: AppTimelineBand[]
  links?: AppTimelineLink[]
  shadeWeekends?: boolean
  onToggleGroup?: (key: string) => void
  onChange?: (id: string, span: DaySpan) => void
  onOpen?: (id: string) => void
  onMarkerClick?: (id: string) => void
  /** Soltar algo arrastado de fora (ex.: tarefa sem datas): recebe o texto do arraste e o dia. */
  onDropExternal?: (payload: string, day: number) => void
  /** Pedido para rolar até um dia (muda o `nonce` para repetir). */
  scrollTo?: { day: number; nonce: number }
  className?: string
}

/** Tipo do dado arrastado de fora para a timeline (HTML5 drag and drop). */
export const TIMELINE_DRAG_TYPE = 'application/x-kamban-timeline'

const TIER_H = 28
const LANE_H = 26
const GROUP_H = 34
const ROW_H = 44
const BAR_H = 26
const COMMIT_DELAY = 700

/* marcos: losango + nome em faixas (text-[11px] font-medium) */
const MARKER_FONT_PX = 11
const MARKER_LANE_H = 22
/** Do início do botão ao centro do losango: px-1 (4) + metade do losango (6). */
const MARKER_ANCHOR = 10
/** Tudo menos o texto: px-1 dos dois lados (8) + losango (12) + gap-1.5 (6) + folga de arredondamento (2). */
const MARKER_CHROME = 28
/** max-w-48 */
const MARKER_MAX_W = 192
/** Só o losango (sem nome) quando não sobra espaço. */
const MARKER_MIN_W = 20
/** Abaixo disso (≈ 3 letras + reticências) o nome não se lê: fica só o losango. */
const MARKER_MIN_READABLE = MARKER_CHROME + 24
const MARKER_GAP = 6

let measureContext: OffscreenCanvasRenderingContext2D | null | undefined

/** Mede textos com a fonte da página (canvas, peso 500); sem canvas (ex.: testes), a estimativa do domínio. */
function textMeasurer(fontPx: number): (text: string) => number {
  if (measureContext === undefined) measureContext = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d')
  const context = measureContext
  if (!context) return (text) => estimateTextWidth(text, fontPx)
  context.font = `500 ${fontPx}px ${getComputedStyle(document.body).fontFamily}`
  return (text) => context.measureText(text).width
}

/** Muda quando as fontes da página terminam de carregar (medir de novo com a fonte certa). */
function useFontsVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!('fonts' in document)) return
    let alive = true
    void document.fonts.ready.then(() => {
      if (alive) setVersion((v) => v + 1)
    })
    return () => {
      alive = false
    }
  }, [])
  return version
}

type Edge = 'move' | 'start' | 'end'

interface Row {
  kind: 'group' | 'bar'
  key: string
  group?: AppTimelineGroup
  bar?: AppTimelineBar
  y: number
}

/**
 * Linha do tempo (Gantt) do design system: régua com dois níveis, grupos recolhíveis, barras que
 * se arrastam (mover) e se esticam pelas pontas, setas de dependência, marcos (nomes próximos vão
 * para faixas extras; além do máximo, reticências com o nome inteiro na dica), faixas (sprints),
 * linha de hoje, fins de semana, linha de base sob as barras e o período de cada grupo no cabeçalho.
 * Rola dentro de si mesma (a página não ganha 2ª barra).
 * Teclado: setas movem 1 dia; Shift + setas mudam o fim; Alt + setas mudam o início; Enter abre.
 */
export function AppTimeline({
  label,
  groups,
  showGroupHeaders,
  range,
  pxPerDay,
  today,
  tiers,
  formatTop,
  formatBottom,
  formatSpan,
  leftHeader,
  todayLabel,
  keyboardHint,
  markers = [],
  bands = [],
  links = [],
  shadeWeekends = false,
  onToggleGroup,
  onChange,
  onOpen,
  onMarkerClick,
  onDropExternal,
  scrollTo,
  className,
}: AppTimelineProps) {
  const hintId = useId()
  const scroller = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const days = range.end - range.start + 1
  const width = days * pxPerDay
  const fontsVersion = useFontsVersion()

  // marcos próximos não se sobrepõem: nomes em faixas (guloso pela posição); além do máximo, reticências
  const markerLayout = useMemo(() => {
    void fontsVersion
    const anchorOf = (day: number) => (day - range.start) * pxPerDay + pxPerDay / 2
    const byId = new Map(markers.map((marker) => [marker.id, marker]))
    const measure = markers.length ? textMeasurer(MARKER_FONT_PX) : () => 0
    const { lanes, slots } = layoutLabels(
      markers.map((marker) => ({
        id: marker.id,
        left: anchorOf(marker.day) - MARKER_ANCHOR,
        width: Math.min(MARKER_MAX_W, Math.ceil(measure(marker.label)) + MARKER_CHROME),
      })),
      { maxLanes: MARKER_MAX_LANES, gap: MARKER_GAP, minWidth: MARKER_MIN_W, minReadable: MARKER_MIN_READABLE },
    )
    const height = lanes ? lanes * MARKER_LANE_H + 4 : 0
    // faixa 0 embaixo, junto das linhas tracejadas do corpo
    const items = slots.map((slot) => {
      const marker = byId.get(slot.id) as AppTimelineMarker
      return { marker, slot, anchor: anchorOf(marker.day), top: 3 + (lanes - 1 - slot.lane) * MARKER_LANE_H }
    })
    return { height, items }
  }, [markers, range.start, pxPerDay, fontsVersion])
  const headerH = TIER_H * 2 + (bands.length ? LANE_H : 0) + markerLayout.height

  // arraste com o mouse/toque (prévia local; grava ao soltar)
  const [drag, setDrag] = useState<{ id: string; edge: Edge; originX: number; delta: number; moved: boolean } | null>(null)
  // teclado: acumula e grava depois de uma pausa
  const [pending, setPending] = useState<{ id: string; span: DaySpan } | null>(null)
  const timer = useRef<number | null>(null)
  const [announce, setAnnounce] = useState('')

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    [],
  )

  useEffect(() => {
    if (!scrollTo || !scroller.current) return
    const el = scroller.current
    el.scrollLeft = Math.max(0, (scrollTo.day - range.start) * pxPerDay - el.clientWidth / 3)
    // só quando o pedido muda (nonce)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo?.nonce, pxPerDay])

  const rows = useMemo(() => {
    const list: Row[] = []
    let y = 0
    groups.forEach((group) => {
      if (showGroupHeaders) {
        list.push({ kind: 'group', key: `g:${group.key}`, group, y })
        y += GROUP_H
      }
      if (!showGroupHeaders || !group.collapsed) {
        group.bars.forEach((bar) => {
          list.push({ kind: 'bar', key: bar.id, bar, y })
          y += ROW_H
        })
      }
    })
    return { list, height: y }
  }, [groups, showGroupHeaders])

  const spanOf = (bar: AppTimelineBar): DaySpan | null => {
    if (!bar.span) return null
    if (drag && drag.id === bar.id) return shiftSpan(bar.span, drag.delta, drag.edge)
    if (pending && pending.id === bar.id) return pending.span
    return bar.span
  }

  const positions = useMemo(() => {
    const map = new Map<string, { x1: number; x2: number; y: number }>()
    rows.list.forEach((row) => {
      if (row.kind !== 'bar' || !row.bar) return
      const span = spanOf(row.bar)
      if (!span) return
      const box = barBox(span, range.start, pxPerDay)
      map.set(row.bar.id, { x1: box.left, x2: box.left + box.width, y: row.y + ROW_H / 2 })
    })
    return map
    // a prévia (drag/pending) muda as setas junto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, range.start, pxPerDay, drag, pending])

  function commitLater(id: string, span: DaySpan) {
    setPending({ id, span })
    setAnnounce(formatSpan(span))
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      onChange?.(id, span)
      setPending(null)
    }, COMMIT_DELAY)
  }

  function onBarKeyDown(event: KeyboardEvent<HTMLButtonElement>, bar: AppTimelineBar) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpen?.(bar.id)
      return
    }
    if (event.key === 'Escape' && pending) {
      if (timer.current) window.clearTimeout(timer.current)
      setPending(null)
      return
    }
    if (!bar.draggable || !bar.span || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    const delta = event.key === 'ArrowLeft' ? -1 : 1
    const edge: Edge = event.shiftKey ? 'end' : event.altKey ? 'start' : 'move'
    const base = pending && pending.id === bar.id ? pending.span : bar.span
    commitLater(bar.id, shiftSpan(base, delta, edge))
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, bar: AppTimelineBar) {
    if (event.button !== 0) return
    const edge = ((event.target as HTMLElement).closest('[data-edge]')?.getAttribute('data-edge') as Edge | null) ?? 'move'
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ id: bar.id, edge: bar.draggable ? edge : 'move', originX: event.clientX, delta: 0, moved: false })
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>, bar: AppTimelineBar) {
    if (!drag || drag.id !== bar.id) return
    const dx = event.clientX - drag.originX
    const moved = drag.moved || Math.abs(dx) > 4
    const delta = bar.draggable ? daysFromPixels(dx, pxPerDay) : 0
    if (moved !== drag.moved || delta !== drag.delta) setDrag({ ...drag, moved, delta })
  }

  function onPointerUp(bar: AppTimelineBar) {
    if (!drag || drag.id !== bar.id) return
    const current = drag
    setDrag(null)
    if (!current.moved) {
      onOpen?.(bar.id)
      return
    }
    if (bar.span && bar.draggable && current.delta !== 0) onChange?.(bar.id, shiftSpan(bar.span, current.delta, current.edge))
  }

  function dayAt(clientX: number): number {
    const left = area.current?.getBoundingClientRect().left ?? 0
    return range.start + Math.floor((clientX - left) / pxPerDay)
  }

  const external = onDropExternal
    ? {
        onDragOver: (event: DragEvent<HTMLDivElement>) => {
          if (!event.dataTransfer.types.includes(TIMELINE_DRAG_TYPE)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        },
        onDrop: (event: DragEvent<HTMLDivElement>) => {
          const payload = event.dataTransfer.getData(TIMELINE_DRAG_TYPE)
          if (!payload) return
          event.preventDefault()
          onDropExternal(payload, dayAt(event.clientX))
        },
      }
    : {}

  const x = (day: number) => (day - range.start) * pxPerDay
  const summaryBox = (span: DaySpan) => {
    const box = barBox(span, range.start, pxPerDay)
    return { left: box.left, width: Math.max(box.width, 4) }
  }
  const todayVisible = today >= range.start && today <= range.end

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'relative overflow-hidden rounded-xl border border-border bg-surface shadow-card [--tl-left:10rem] sm:[--tl-left:18rem]',
        className,
      )}
    >
      <p id={hintId} className="sr-only">
        {keyboardHint}
      </p>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <div ref={scroller} className="relative h-[calc(100dvh-17rem)] min-h-[22rem] overflow-auto overscroll-contain" {...external}>
        <div className="relative" style={{ width: `calc(var(--tl-left) + ${width}px)` }}>
          {/* cabeçalho fixo: régua, faixas (sprints) e marcos */}
          <div className="sticky top-0 z-20 flex border-b border-border bg-surface" style={{ height: headerH }}>
            <div className="sticky left-0 z-30 flex w-[var(--tl-left)] shrink-0 items-end border-r border-border bg-surface px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              {leftHeader}
            </div>
            <div ref={area} className="relative shrink-0" style={{ width }} aria-hidden>
              {tiers.top.map((seg) => (
                <div key={`t${seg.start}`} className="absolute top-0 border-l border-border text-xs font-semibold leading-7 text-fg" style={{ left: x(seg.start), width: (seg.end - seg.start + 1) * pxPerDay, height: TIER_H }}>
                  <span className="sticky inline-block max-w-full truncate px-2" style={{ left: 'var(--tl-left)' }}>
                    {formatTop(seg)}
                  </span>
                </div>
              ))}
              {tiers.bottom.map((seg) => (
                <div
                  key={`b${seg.start}`}
                  title={today >= seg.start && today <= seg.end ? todayLabel : undefined}
                  className={cn(
                    'absolute truncate border-l border-t border-border text-center text-[11px] leading-7',
                    today >= seg.start && today <= seg.end ? 'bg-primary-soft font-semibold text-primary-soft-fg' : 'text-muted',
                  )}
                  style={{ top: TIER_H, left: x(seg.start), width: (seg.end - seg.start + 1) * pxPerDay, height: TIER_H }}
                >
                  {formatBottom(seg)}
                </div>
              ))}
              {bands.length > 0 && (
                <div className="absolute inset-x-0 border-t border-border" style={{ top: TIER_H * 2, height: LANE_H }}>
                  {bands.map((band) => (
                    <div
                      key={band.id}
                      title={band.label}
                      className="absolute top-1 truncate rounded-md bg-primary-soft px-2 text-[11px] font-medium leading-5 text-primary-soft-fg"
                      style={{ left: x(Math.max(band.start, range.start)), width: Math.max(pxPerDay, (Math.min(band.end, range.end) - Math.max(band.start, range.start) + 1) * pxPerDay) }}
                    >
                      {band.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {markers.length > 0 && (
              // marcos ficam fora do aria-hidden (são botões); na ordem da régua (Tab segue as datas)
              <div className="absolute border-t border-border" style={{ top: TIER_H * 2 + (bands.length ? LANE_H : 0), height: markerLayout.height, left: 'var(--tl-left)', width }}>
                {/* haste do losango até as linhas tracejadas do corpo (atrás dos nomes) */}
                {markerLayout.items.map(({ marker, anchor, top }) => (
                  <span
                    key={`stem-${marker.id}`}
                    aria-hidden
                    className={cn('absolute bottom-0 border-l-2 border-dashed', marker.done ? 'border-success/50' : 'border-primary/50')}
                    style={{ left: anchor - 1, top: top + MARKER_ANCHOR }}
                  />
                ))}
                {markerLayout.items.map(({ marker, slot, anchor, top }) => (
                  <button
                    key={marker.id}
                    type="button"
                    aria-label={marker.ariaLabel}
                    title={marker.ariaLabel}
                    data-testid={`timeline-marker-${marker.id}`}
                    data-lane={slot.lane}
                    data-truncated={slot.truncated || undefined}
                    disabled={!onMarkerClick}
                    onClick={() => onMarkerClick?.(marker.id)}
                    className="absolute flex max-w-48 items-center gap-1.5 rounded-md bg-surface px-1 text-[11px] font-medium leading-5 text-fg hover:bg-surface-2 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:hover:bg-surface"
                    style={{ left: anchor - MARKER_ANCHOR, top, maxWidth: slot.truncated ? slot.width : undefined }}
                  >
                    <span aria-hidden className={cn('size-3 shrink-0 rotate-45 rounded-[2px] border-2', marker.done ? 'border-success bg-success' : 'border-primary bg-surface')} />
                    {slot.width > MARKER_MIN_W && <span className="min-w-0 truncate">{marker.label}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* corpo */}
          <div className="relative" style={{ height: rows.height }}>
            {/* camadas visuais atrás das barras */}
            <div className="pointer-events-none absolute inset-y-0" style={{ left: 'var(--tl-left)', width }} aria-hidden>
              {shadeWeekends &&
                Array.from({ length: days }, (_, i) => range.start + i)
                  .filter((day) => weekdayOf(day) === 0 || weekdayOf(day) === 6)
                  .map((day) => <div key={day} className="absolute inset-y-0 bg-surface-2" style={{ left: x(day), width: pxPerDay }} />)}
              {tiers.bottom.map((seg) => (
                <div key={seg.start} className="absolute inset-y-0 border-l border-border/60" style={{ left: x(seg.start) }} />
              ))}
              {markers.map((marker) => (
                <div key={marker.id} className={cn('absolute inset-y-0 border-l-2 border-dashed', marker.done ? 'border-success/50' : 'border-primary/50')} style={{ left: x(marker.day) + pxPerDay / 2 - 1 }} />
              ))}
              {todayVisible && <div className="absolute inset-y-0 w-0.5 bg-primary" style={{ left: x(today) + pxPerDay / 2 }} />}
              <svg className="absolute inset-0 overflow-visible" width={width} height={rows.height}>
                <defs>
                  <marker id={`${hintId}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
                  </marker>
                </defs>
                {links.map((link) => {
                  const from = positions.get(link.from)
                  const to = positions.get(link.to)
                  if (!from || !to) return null
                  const bend = from.x2 + 10
                  const entry = to.x1 - 10
                  // volta para trás: passa pela borda da linha de destino e entra pela esquerda da barra
                  const edgeY = to.y > from.y ? to.y - ROW_H / 2 + 3 : to.y + ROW_H / 2 - 3
                  const path = entry >= bend ? `M${from.x2},${from.y} H${bend} V${to.y} H${to.x1 - 2}` : `M${from.x2},${from.y} H${bend} V${edgeY} H${entry} V${to.y} H${to.x1 - 2}`
                  return (
                    <path
                      key={link.id}
                      d={path}
                      fill="none"
                      strokeWidth={link.conflict ? 2 : 1.5}
                      strokeDasharray={link.conflict ? '4 3' : undefined}
                      markerEnd={`url(#${hintId}-arrow)`}
                      className={link.conflict ? 'stroke-danger' : 'stroke-border-strong'}
                    />
                  )
                })}
              </svg>
            </div>

            {rows.list.map((row) => {
              if (row.kind === 'group' && row.group) {
                const group = row.group
                return (
                  <div key={row.key} className="absolute inset-x-0 flex border-b border-border bg-surface-2" style={{ top: row.y, height: GROUP_H }}>
                    <button
                      type="button"
                      aria-expanded={!group.collapsed}
                      onClick={() => onToggleGroup?.(group.key)}
                      className="sticky left-0 z-10 flex w-[var(--tl-left)] shrink-0 items-center gap-1.5 border-r border-border bg-surface-2 px-2 text-left text-sm font-semibold text-fg hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {group.collapsed ? <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden /> : <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />}
                      <span className="min-w-0 flex-1 truncate">{group.label}</span>
                    </button>
                    {group.summary && (
                      <div className="relative shrink-0" style={{ width }} aria-hidden>
                        <span
                          className="absolute rounded-full opacity-70"
                          style={{ ...summaryBox(group.summary.span), top: GROUP_H / 2 - 4, height: 8, backgroundColor: group.summary.color }}
                        />
                      </div>
                    )}
                  </div>
                )
              }
              const bar = row.bar as AppTimelineBar
              const span = spanOf(bar)
              const box = span ? barBox(span, range.start, pxPerDay) : null
              return (
                <div key={row.key} className="absolute inset-x-0 flex border-b border-border/60" style={{ top: row.y, height: ROW_H }}>
                  <div className="sticky left-0 z-10 flex w-[var(--tl-left)] shrink-0 items-center border-r border-border bg-surface px-3">{bar.label}</div>
                  <div className="relative shrink-0" style={{ width }}>
                    {bar.baseline && (
                      <span
                        aria-hidden
                        data-testid={`timeline-baseline-${bar.id}`}
                        className="absolute h-1 rounded-full bg-border-strong"
                        style={{ ...summaryBox(bar.baseline), top: (ROW_H + BAR_H) / 2 + 2 }}
                      />
                    )}
                    {box && (
                      <button
                        type="button"
                        aria-label={bar.ariaLabel}
                        aria-describedby={bar.draggable ? hintId : undefined}
                        title={bar.ariaLabel}
                        data-testid={`timeline-bar-${bar.id}`}
                        onPointerDown={(event) => onPointerDown(event, bar)}
                        onPointerMove={(event) => onPointerMove(event, bar)}
                        onPointerUp={() => onPointerUp(bar)}
                        onPointerCancel={() => setDrag(null)}
                        onKeyDown={(event) => onBarKeyDown(event, bar)}
                        className={cn(
                          'group absolute flex touch-none select-none items-center overflow-hidden rounded-md border text-left text-xs font-medium shadow-xs',
                          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                          bar.draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                          bar.danger && 'ring-2 ring-danger',
                          drag?.id === bar.id && drag.moved && 'z-10 shadow-float',
                        )}
                        style={{ left: box.left, width: Math.max(box.width, 6), top: (ROW_H - BAR_H) / 2, height: BAR_H, backgroundColor: 'var(--kb-surface)', backgroundImage: `linear-gradient(${bar.tint}, ${bar.tint})`, borderColor: bar.accent, color: bar.text }}
                      >
                        {bar.progress !== undefined && bar.progress > 0 && (
                          <span aria-hidden className="absolute inset-y-0 left-0 opacity-25" style={{ width: `${Math.round(bar.progress * 100)}%`, backgroundColor: bar.accent }} />
                        )}
                        {bar.draggable && <span data-edge="start" aria-hidden className="absolute inset-y-0 left-0 w-2 cursor-ew-resize" />}
                        <span className="relative flex min-w-0 items-center gap-1 px-2">
                          {bar.conflict && <AlertTriangle className="size-3 shrink-0 text-danger" aria-hidden />}
                          <span className="truncate">{bar.barText}</span>
                        </span>
                        {bar.draggable && <span data-edge="end" aria-hidden className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" />}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
