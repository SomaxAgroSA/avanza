import { useMemo } from 'react'
import { pieSlicePaths } from './direction-data'

/** Uma fatia da torta e a sua linha na legenda. */
export interface PieItem {
  key: string
  /** Nome já traduzido. */
  label: string
  count: number
  percent: number
  color: string
}

/** Cor da marca; o nome vai sempre ao lado (a cor nunca fica sozinha). */
const dot = (color: string) => <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} />

/**
 * Torta com a legenda ao lado (nome, número e %), a de "Projetos por departamento" e de "Estado de execução"
 * (ajuste 25/11). Clicar numa fatia ou na linha da legenda escolhe (de novo, tira — quem chama decide); as outras
 * ficam atenuadas. Fatia com zero não aparece na torta, mas a linha fica (0 %). Dica ao passar o mouse na fatia.
 */
export function PieChart({
  items,
  selected,
  onSelect,
  chartLabel,
  sliceTitle,
}: {
  items: PieItem[]
  selected: string | null
  onSelect: (key: string) => void
  /** Nome acessível do gráfico. */
  chartLabel: string
  /** Texto da dica de cada fatia. */
  sliceTitle: (item: PieItem) => string
}) {
  const drawn = useMemo(() => items.filter((item) => item.count > 0), [items])
  const paths = useMemo(() => pieSlicePaths(drawn, 80, 80, 70), [drawn])
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[150px_1fr]">
      <svg viewBox="0 0 160 160" role="img" aria-label={chartLabel} className="mx-auto h-auto w-full max-w-[150px]">
        {drawn.map((item) => (
          <path
            key={item.key}
            data-slice={item.key}
            d={paths.find((p) => p.key === item.key)?.d}
            fill={item.color}
            stroke="var(--color-surface)"
            strokeWidth={2}
            className="cursor-pointer motion-safe:transition-opacity"
            opacity={selected && selected !== item.key ? 0.3 : 1}
            onClick={() => onSelect(item.key)}
          >
            <title>{sliceTitle(item)}</title>
          </path>
        ))}
      </svg>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              aria-pressed={selected === item.key}
              onClick={() => onSelect(item.key)}
              className="grid w-full grid-cols-[14px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] text-fg hover:bg-surface-2 aria-pressed:bg-surface-2 aria-pressed:font-semibold focus-visible:outline-2 focus-visible:outline-ring"
            >
              {dot(item.color)}
              <span className="truncate">{item.label}</span>
              <span className="font-bold tabular-nums">{item.count}</span>
              <span className="min-w-9 text-right text-xs tabular-nums text-muted">{item.percent} %</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
