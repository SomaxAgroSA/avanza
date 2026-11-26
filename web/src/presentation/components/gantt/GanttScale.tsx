import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import { GANTT_LABEL_STEP, marksClearOfToday, type GanttScale } from '@/domain/gantt-scale'
import { usePeriodLabel, type GanttLabelColumn } from './use-gantt-label-column'

/**
 * Peças comuns das linhas do tempo (Caixa de entrada › Linha do tempo e "Linha do tempo dos projetos" de Em
 * andamento), ajuste aprovado em demonstração em 26/11 (§52):
 *
 * - `useGanttLabelColumn`: a coluna dos títulos mede o título mais longo à vista (no DOM, com a fonte de verdade;
 *   cada título leva `data-gantt-label` e `w-max`) e nunca fica menor que ele; o divisor só alarga. As barras têm
 *   um mínimo (os números dos dias cabem); se título + mínimo não cabem, o conjunto rola para o lado.
 * - `GanttFrame`: o cabeçalho em duas linhas (semanas e dias, ou meses e segundas-feiras), o sombreado de todo o
 *   alto (fins de semana, semana ou mês atual, separadores) e HOJE em vermelho, com a linha vertical.
 * - `GanttDivider`: o separador entre os títulos e as barras (arrastar, ← → no teclado, duplo clique volta).
 */

/** Altura do cabeçalho (`h-10`): a linha de HOJE começa logo abaixo. */
const HEADER_PX = 40

/**
 * Moldura da linha do tempo: o sombreado de todo o alto por trás das linhas, o cabeçalho em duas linhas, as
 * linhas (`children`, cada uma na grade `column.columns`), a linha vermelha de HOJE por cima e o divisor.
 */
export function GanttFrame({
  scale,
  column,
  label,
  divider,
  children,
}: {
  scale: GanttScale
  column: GanttLabelColumn
  /** Título da coluna (Tarefa, Projeto). */
  label: ReactNode
  divider?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const periodLabel = usePeriodLabel()
  const marks = marksClearOfToday(scale, column.chartPx)
  const chart = { left: column.width, right: 0 }
  return (
    <div className="relative isolate" data-testid="gantt-frame">
      {/* sombreado de todo o alto, por trás das linhas: semana/mês atual, fins de semana e separadores */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 -z-10" style={chart}>
        {scale.periods.map((period) =>
          period.current ? <span key="current" className="absolute inset-y-0 bg-primary-soft/40" style={{ left: `${period.left}%`, width: `${period.width}%` }} /> : null,
        )}
        {scale.weekends.map((weekend) => (
          <span key={weekend.left} className="absolute inset-y-0 bg-surface-2/80" style={{ left: `${weekend.left}%`, width: `${weekend.width}%` }} data-testid="gantt-weekend" />
        ))}
        {scale.periods.slice(1).map((period) => (
          <span key={period.start.toISOString()} className="absolute inset-y-0 w-px bg-border" style={{ left: `${period.left}%` }} />
        ))}
      </div>
      <div className="grid h-10 border-b border-border" style={column.columns} data-testid="gantt-header">
        <span data-gantt-label className="w-max self-end pr-3 pb-1 text-[10.5px] leading-4 font-semibold tracking-wide whitespace-nowrap text-muted uppercase">
          {label}
        </span>
        <div aria-hidden className="relative">
          {scale.periods.map((period) => (
            <span
              key={period.start.toISOString()}
              className={cn(
                'absolute top-1 pl-1.5 text-[10.5px] leading-4 tracking-wide whitespace-nowrap uppercase',
                period.current ? 'font-bold text-fg' : 'font-semibold text-muted',
              )}
              style={{ left: `${period.left}%` }}
              data-gantt-period
              data-current={period.current || undefined}
              data-testid="gantt-period"
            >
              {periodLabel(scale, period)}
            </span>
          ))}
          {marks.map((mark) => (
            <span key={mark.date.toISOString()} className="absolute bottom-1 -translate-x-1/2 text-[11px] leading-4 text-muted tabular-nums" style={{ left: `${mark.left}%` }} data-testid="gantt-mark">
              {mark.date.getUTCDate()}
            </span>
          ))}
          {scale.today !== null && (
            <span className="absolute bottom-1 -translate-x-1/2 rounded bg-surface px-1 text-[10px] leading-4 font-extrabold text-danger uppercase" style={{ left: `${scale.today}%` }}>
              {t('ganttScale.today')}
            </span>
          )}
        </div>
      </div>
      {children}
      {/* linha de HOJE por cima das linhas, de logo abaixo do rótulo até o fim */}
      {scale.today !== null && (
        <div aria-hidden className="pointer-events-none absolute bottom-0 z-10" style={{ ...chart, top: HEADER_PX }}>
          <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-danger" style={{ left: `${scale.today}%` }} data-testid="gantt-today" />
        </div>
      )}
      {divider}
    </div>
  )
}

/**
 * Divisor entre os títulos e as barras (padrão "window splitter"): arrastar alarga, as setas também, duplo
 * clique volta à largura automática. Nunca deixa a coluna abaixo do título mais longo. A área de pegar é larga;
 * o traço aparece em verde.
 */
export function GanttDivider({ column, label, hint, testId }: { column: GanttLabelColumn; label: string; hint: string; testId?: string }) {
  return (
    /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={column.width}
      aria-valuemin={column.minimum}
      aria-valuemax={column.max}
      title={hint}
      tabIndex={0}
      data-testid={testId}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        column.choose(column.width + (event.key === 'ArrowRight' ? GANTT_LABEL_STEP : -GANTT_LABEL_STEP))
      }}
      onPointerDown={column.startDrag}
      onPointerMove={column.moveDrag}
      onPointerUp={column.endDrag}
      onPointerCancel={column.cancelDrag}
      onDoubleClick={() => column.choose(null)}
      className={cn(
        'absolute top-0 bottom-0 z-20 -ml-1.5 w-3 cursor-col-resize touch-none select-none focus-visible:outline-none',
        "after:absolute after:top-0 after:bottom-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:content-['']",
        'hover:after:bg-primary focus-visible:after:bg-primary',
        column.dragging && 'after:bg-primary',
      )}
      style={{ left: column.width }}
    />
    /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
  )
}
