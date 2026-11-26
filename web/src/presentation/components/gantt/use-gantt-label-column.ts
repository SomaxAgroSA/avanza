import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { readJson, safeStorage, writeJson } from '@/core/storage/safe-storage'
import { chooseLabelWidth, ganttMinWidth, labelColumnWidth, toLabelWidth, type GanttPeriod, type GanttScale } from '@/domain/gantt-scale'

/**
 * Coluna dos títulos e rótulos da escala das linhas do tempo (§52; as peças visuais estão em GanttScale.tsx). A
 * coluna mede o título mais longo à vista no DOM, com a fonte de verdade (cada título leva `data-gantt-label` e
 * `w-max`), e nunca fica menor que ele; o divisor só alarga. As barras têm um mínimo (os números dos dias cabem);
 * se título + mínimo não cabem, o conjunto rola para o lado.
 */

/** Largura aproximada de um caractere do rótulo da faixa (10,5px, negrito, maiúsculas), enquanto não há medida. */
const PERIOD_CHAR_PX = 6.4
/** Folga depois do rótulo da faixa atual, antes da faixa seguinte. */
const PERIOD_GAP = 8

/** Largura visível de um elemento (0 enquanto não há medida, como nos testes sem layout). */
function useClientWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [setElement, width]
}

export interface GanttLabelColumn {
  /** Largura atual da coluna dos títulos. */
  width: number
  /** O título mais longo (medido): a coluna nunca fica abaixo disso. */
  minimum: number
  /** Teto do divisor (sobra o mínimo das barras); undefined = ainda sem medida. */
  max: number | undefined
  /** Largura das barras (sem medida, o mínimo). */
  chartPx: number
  /** Largura mínima do conjunto (coluna + mínimo das barras): abaixo disso, rola. */
  minWidth: number
  columns: CSSProperties
  dragging: boolean
  choose: (next: number | null) => void
  startDrag: (event: ReactPointerEvent) => void
  moveDrag: (event: ReactPointerEvent) => void
  endDrag: (event: ReactPointerEvent) => void
  cancelDrag: () => void
}

/**
 * Coluna dos títulos de uma linha do tempo. `chosen` = largura escolhida pela pessoa (null = automática, a do
 * título mais longo); `estimate` vale enquanto não há medida; `scale` dá o mínimo das barras (os números dos dias
 * e o rótulo da faixa atual, medido, cabem); `measureKey` muda quando mudam os títulos à vista (mede de novo).
 */
export function useGanttLabelColumn({
  chosen,
  onChoose,
  estimate,
  scale,
  measureKey,
}: {
  chosen: number | null
  onChoose?: (width: number | null) => void
  estimate: number
  scale: GanttScale | null
  measureKey: string
}): {
  /** Para a área que rola (mede a largura disponível). */
  areaRef: (el: HTMLDivElement | null) => void
  /** Para o conteúdo da linha do tempo (onde estão os títulos medidos; base do arrasto). */
  gridRef: (el: HTMLDivElement | null) => void
  column: GanttLabelColumn
} {
  const [areaRef, available] = useClientWidth()
  const [grid, gridRef] = useState<HTMLDivElement | null>(null)
  const [measured, setMeasured] = useState(0)
  const [periodPx, setPeriodPx] = useState(0)
  const periodLabel = usePeriodLabel()
  const current = scale?.periods.find((p) => p.current)
  const currentLabel = scale && current ? periodLabel(scale, current) : ''
  useLayoutEffect(() => {
    if (!grid) return
    const labels = Array.from(grid.querySelectorAll<HTMLElement>('[data-gantt-label]'))
    const period = grid.querySelector<HTMLElement>('[data-gantt-period][data-current]')
    const measure = () => {
      setMeasured(Math.ceil(labels.reduce((max, el) => Math.max(max, el.getBoundingClientRect().width), 0)))
      setPeriodPx(Math.ceil(period?.getBoundingClientRect().width ?? 0))
    }
    measure()
    // a fonte da web chega depois: o tamanho dos títulos muda e a coluna acompanha
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    labels.forEach((el) => observer.observe(el))
    if (period) observer.observe(period)
    return () => observer.disconnect()
  }, [grid, measureKey, currentLabel])
  const minimum = measured > 0 ? measured : estimate
  const barsMin = scale ? ganttMinWidth(scale, (periodPx > 0 ? periodPx : Math.ceil(currentLabel.length * PERIOD_CHAR_PX)) + PERIOD_GAP) : 0
  const max = available > 0 ? Math.max(minimum, available - barsMin) : undefined
  const [dragging, setDragging] = useState<number | null>(null)
  const width = dragging ?? labelColumnWidth(minimum, chosen, max)
  const pointerWidth = (event: ReactPointerEvent) => labelColumnWidth(minimum, event.clientX - (grid?.getBoundingClientRect().left ?? 0), max)
  const choose = useCallback((next: number | null) => onChoose?.(next === null ? null : chooseLabelWidth(next, minimum, max)), [onChoose, minimum, max])
  const column: GanttLabelColumn = {
    width,
    minimum,
    max,
    chartPx: available > 0 ? Math.max(barsMin, available - width) : barsMin,
    minWidth: width + barsMin,
    columns: { gridTemplateColumns: `${width}px minmax(0, 1fr)` },
    dragging: dragging !== null,
    choose,
    startDrag: (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setDragging(width)
    },
    moveDrag: (event) => {
      if (dragging !== null) setDragging(pointerWidth(event))
    },
    endDrag: (event) => {
      if (dragging === null) return
      const next = pointerWidth(event)
      setDragging(null)
      choose(next)
    },
    cancelDrag: () => setDragging(null),
  }
  return { areaRef, gridRef, column }
}

/** Largura da coluna guardada por pessoa neste navegador (null = automática). */
export function useStoredLabelWidth(key: string | null): [number | null, (width: number | null) => void] {
  const [width, setWidth] = useState<number | null>(() => (key ? toLabelWidth(readJson<unknown>(key, null)) : null))
  const [loaded, setLoaded] = useState(key)
  if (loaded !== key) {
    // outra pessoa na mesma aba: a largura dela
    setLoaded(key)
    setWidth(key ? toLabelWidth(readJson<unknown>(key, null)) : null)
  }
  const save = useCallback(
    (next: number | null) => {
      setWidth(next)
      if (!key) return
      if (next === null) safeStorage.remove(key)
      else writeJson(key, next)
    },
    [key],
  )
  return [width, save]
}

/** Rótulo de cima: "16–22 nov" / "Esta semana · 23–29 nov" ou "nov 26" / "Este mês · nov 26" (em maiúsculas na tela). */
export function usePeriodLabel(): (scale: GanttScale, period: GanttPeriod) => string {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  return (scale, period) => {
    const month = (date: Date) => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date).replace('.', '')
    if (scale.unit === 'months') {
      const text = `${month(period.start)} ${String(period.start.getUTCFullYear()).slice(2)}`
      return period.current ? t('ganttScale.thisMonth', { month: text }) : text
    }
    const sameMonth = period.start.getUTCMonth() === period.last.getUTCMonth()
    const range = `${period.start.getUTCDate()}${sameMonth ? '' : ` ${month(period.start)}`}–${period.last.getUTCDate()} ${month(period.last)}`
    return period.current ? t('ganttScale.thisWeek', { range }) : range
  }
}
