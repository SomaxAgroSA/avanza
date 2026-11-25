import { useId, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { pieSlicePaths } from './direction-data'

/** Uma fatia da torta e a sua linha na legenda. */
export interface PieItem {
  key: string
  /** Nome já traduzido. */
  label: string
  count: number
  percent: number
  color: string
  /** Fatia que agrupa ("Outros"): a linha abre a lista destes, e cada um se escolhe como os outros. */
  children?: Array<Omit<PieItem, 'color' | 'children'>>
}

/** Rosca: viewBox 200×200, raio externo 96 e furo de 58 (ajuste 25/11). */
const SIZE = 200
const OUTER = 96
const INNER = 58

/** Cor da marca; o nome vai sempre ao lado (a cor nunca fica sozinha). */
const dot = (color: string) => <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} />

const ROW = 'grid w-full grid-cols-[10px_minmax(0,1fr)_minmax(28px,auto)_40px] items-center gap-2.5 rounded-lg px-2 py-1 text-left text-[13px] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring'

/**
 * Torta em rosca com o total no meio e a legenda ao lado (nome, número e %), a de "Projetos por departamento" e
 * de "Estado de execução" (ajuste 25/11). Clicar numa fatia ou na linha da legenda escolhe (de novo, tira — quem
 * chama decide); as outras ficam atenuadas e o meio mostra o escolhido. A fatia que agrupa ("Outros") não se
 * escolhe: abre a lista dos agrupados embaixo da linha, e ela fica aberta enquanto um deles estiver escolhido.
 * Fatia com zero não aparece na torta, mas a linha fica (0 %). Dica ao passar o mouse na fatia.
 */
export function PieChart({
  items,
  selected,
  onSelect,
  chartLabel,
  sliceTitle,
  unit,
}: {
  items: PieItem[]
  selected: string | null
  onSelect: (key: string) => void
  /** Nome acessível do gráfico. */
  chartLabel: string
  /** Texto da dica de cada fatia. */
  sliceTitle: (item: PieItem) => string
  /** Palavra embaixo do total no meio da rosca ("projetos"). */
  unit: (count: number) => string
}) {
  const subId = useId()
  const [open, setOpen] = useState(false)
  const drawn = useMemo(() => items.filter((item) => item.count > 0), [items])
  const paths = useMemo(() => pieSlicePaths(drawn, SIZE / 2, SIZE / 2, OUTER, INNER), [drawn])
  const total = items.reduce((sum, item) => sum + item.count, 0)
  const holds = (item: PieItem) => !!item.children?.some((child) => child.key === selected)
  // o escolhido (nunca a fatia que agrupa: ela só abre a lista)
  const picked = selected ? [...items.filter((item) => !item.children), ...items.flatMap((item) => item.children ?? [])].find((item) => item.key === selected) : undefined
  const expanded = open || items.some(holds)

  return (
    <div className="flex flex-1 flex-col justify-center @container">
      <div className="grid justify-items-center gap-3 @md:min-h-[228px] @md:grid-cols-[184px_minmax(0,340px)] @md:items-center @md:justify-center @md:justify-items-stretch @md:gap-7">
        <div className="relative size-[184px] shrink-0">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={chartLabel} className="block size-full">
            {drawn.map((item) => (
              <path
                key={item.key}
                data-slice={item.key}
                d={paths.find((p) => p.key === item.key)?.d}
                fill={item.color}
                stroke="var(--color-surface)"
                strokeWidth={2}
                className="cursor-pointer motion-safe:transition-opacity"
                opacity={selected && selected !== item.key && !holds(item) ? 0.3 : 1}
                onClick={() => (item.children ? setOpen(true) : onSelect(item.key))}
              >
                <title>{sliceTitle(item)}</title>
              </path>
            ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-11 text-center" data-testid="pie-center">
            <span className="text-[28px] font-bold leading-none tabular-nums text-fg">{picked ? picked.count : total}</span>
            <span className="mt-1 line-clamp-2 text-xs leading-tight text-muted">{picked ? picked.label : unit(total)}</span>
          </div>
        </div>
        <ul className="flex w-full max-w-[340px] flex-col">
          {items.map((item) => (
            <li key={item.key}>
              {item.children ? (
                <>
                  <button type="button" aria-expanded={expanded} aria-controls={expanded ? subId : undefined} onClick={() => setOpen(!expanded)} className={cn(ROW, 'text-fg')}>
                    {dot(item.color)}
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="truncate">{item.label}</span>
                      <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-subtle motion-safe:transition-transform', expanded && 'rotate-90')} />
                    </span>
                    <span className="text-right font-bold tabular-nums">{item.count}</span>
                    <span className="text-right text-xs tabular-nums text-muted">{item.percent} %</span>
                  </button>
                  {expanded && (
                    <ul id={subId} className="flex flex-col">
                      {item.children.map((child) => (
                        <li key={child.key}>
                          <button
                            type="button"
                            aria-pressed={selected === child.key}
                            onClick={() => onSelect(child.key)}
                            className={cn(ROW, 'pl-[26px] text-muted aria-pressed:bg-surface-2 aria-pressed:font-semibold aria-pressed:text-fg')}
                          >
                            <span aria-hidden />
                            <span className="truncate">{child.label}</span>
                            <span className="text-right font-bold tabular-nums">{child.count}</span>
                            <span className="text-right text-xs tabular-nums">{child.percent} %</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <button type="button" aria-pressed={selected === item.key} onClick={() => onSelect(item.key)} className={cn(ROW, 'text-fg aria-pressed:bg-surface-2 aria-pressed:font-semibold')}>
                  {dot(item.color)}
                  <span className="truncate">{item.label}</span>
                  <span className="text-right font-bold tabular-nums">{item.count}</span>
                  <span className="text-right text-xs tabular-nums text-muted">{item.percent} %</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
