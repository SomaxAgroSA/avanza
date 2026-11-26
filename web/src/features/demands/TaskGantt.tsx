import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CalendarClock, RotateCcw } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatDay, formatNumber, formatShortDateTime } from '@/core/utils/format'
import type { DemandBox, DemandStatus } from '@/domain/demands'
import {
  GANTT_BARS_MIN,
  GANTT_LABEL_MIN,
  GANTT_LABEL_STEP,
  autoLabelWidth,
  clampLabelWidth,
  taskGantt,
  type GanttGroupBy,
  type TaskGanttGroup,
  type TaskGanttRow,
} from '@/domain/task-gantt'
import type { TaskSummary } from '@/domain/tasks'
import { AppAvatar, AppButton, AppCard, AppEmptyState, AppSegmentedControl, AppTooltip } from '@/presentation/components'
import { optionColor } from '@/features/task-config/config-theme'
import { demandStepColor, useDemandStepText } from './demand-step'

/** Passos que a linha do tempo desenha, na ordem da legenda. */
const LEGEND_STEPS: readonly DemandStatus[] = ['assigned', 'in_progress', 'to_validate']

const dot = (status: DemandStatus) => <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: optionColor(demandStepColor(status)) }} />

/**
 * Largura visível da área da linha do tempo (0 enquanto não há medida, como nos testes sem layout). A área só existe
 * com tarefas no Gantt: o elemento chega pela ref de callback e passa a ser observado (o observador já avisa a
 * primeira medida).
 */
function useAvailableWidth(): [(el: HTMLDivElement | null) => void, number] {
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

/**
 * Linha do tempo das tarefas da Caixa de entrada (ajuste 25/11, opção B aprovada em demonstração; mesmo desenho
 * da "Linha do tempo dos projetos" de Projetos › Em andamento): Gantt das tarefas da caixa e dos filtros atuais,
 * a toda a largura, agrupado por pessoa (Atribuída a) ou por projeto, com a linha de HOJE, a cor do passo e o
 * contorno vermelho no prazo vencido. A barra vai do início planejado (sem ele, a abertura) até o prazo; as sem
 * prazo ficam na Lista (nota no fim). Clicar abre a tarefa; a dica mostra o título inteiro, o passo e as datas.
 *
 * Formato estendido (ajuste aprovado em demonstração, 26/11, §50): os títulos não cortam com "…" — quebram em até
 * duas linhas — e a coluna deles abre com a largura automática (domain/task-gantt.ts#autoLabelWidth). O divisor
 * entre os títulos e as barras ajusta a largura (arrastar, ← → no teclado; duplo clique volta à automática);
 * "Restabelecer" também volta. A largura escolhida fica guardada por pessoa neste navegador (use-inbox-view.ts).
 */
export function TaskGantt({
  tasks,
  groupBy,
  onGroupByChange,
  labelWidth = null,
  onLabelWidthChange,
  back,
  place,
}: {
  tasks: readonly TaskSummary[]
  groupBy: GanttGroupBy
  onGroupByChange: (groupBy: GanttGroupBy) => void
  /** Largura escolhida da coluna dos títulos; null = automática. */
  labelWidth?: number | null
  onLabelWidthChange?: (width: number | null) => void
  /** Para onde volta o "← Voltar" da tarefa aberta (a mesma caixa, com os filtros). */
  back: string
  place: DemandBox
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { model, undated } = useMemo(() => taskGantt(tasks, groupBy), [tasks, groupBy])
  const stepText = useDemandStepText()
  const steps = model && model.groups.some((g) => g.rows.some((r) => r.step === 'unassigned')) ? (['unassigned', ...LEGEND_STEPS] as DemandStatus[]) : LEGEND_STEPS
  const tick = (date: Date) =>
    new Intl.DateTimeFormat(locale, model?.monthly ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(date).replace('.', '')
  const groupName = (group: TaskGanttGroup) => group.person?.name ?? group.project?.name ?? (groupBy === 'person' ? t('demands.row.noAssignee') : t('demands.chip'))
  const tip = (row: TaskGanttRow) =>
    t(row.late ? 'demands.gantt.tipLate' : 'demands.gantt.tip', {
      title: row.task.title,
      step: stepText(row.step, row.task.assignee),
      start: formatDay(row.start, locale),
      due: row.dueAt ? formatShortDateTime(row.dueAt, locale) : formatDay(row.dueDay, locale),
    })

  // coluna dos títulos: a automática (pelos títulos à vista) ou a escolhida; durante o arrasto, a do ponteiro
  const [areaRef, available] = useAvailableWidth()
  const titles = useMemo(() => (model ? model.groups.flatMap((g) => g.rows.map((r) => r.task.title)) : []), [model])
  const auto = autoLabelWidth(titles, available)
  const [dragging, setDragging] = useState<number | null>(null)
  const width = dragging ?? (labelWidth !== null ? clampLabelWidth(labelWidth, available) : auto)
  const maxWidth = available > 0 ? Math.max(GANTT_LABEL_MIN, available - GANTT_BARS_MIN) : undefined
  const gridRef = useRef<HTMLDivElement>(null)
  const columns = { gridTemplateColumns: `${width}px 1fr` }
  const choose = (next: number | null) => onLabelWidthChange?.(next === null ? null : clampLabelWidth(next, available))
  const pointerWidth = (event: ReactPointerEvent) => clampLabelWidth(event.clientX - (gridRef.current?.getBoundingClientRect().left ?? 0), available)

  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-x-3.5 gap-y-2">
      <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-fg" aria-label={t('demands.gantt.legend')}>
        {steps.map((status) => (
          <li key={status} className="inline-flex items-center gap-1.5">
            {dot(status)}
            {t(`demands.status.${status}`)}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-full border-2 border-danger" />
          {t('demands.gantt.late')}
        </li>
      </ul>
      <AppSegmentedControl<GanttGroupBy>
        size="sm"
        label={t('demands.gantt.groupBy')}
        value={groupBy}
        onValueChange={onGroupByChange}
        options={[
          { value: 'person', label: t('demands.gantt.byPerson') },
          { value: 'project', label: t('demands.gantt.byProject') },
        ]}
      />
      {model && onLabelWidthChange && (
        <AppButton variant="secondary" size="sm" leftIcon={<RotateCcw />} title={t('demands.gantt.resetHint')} onClick={() => choose(null)}>
          {t('demands.gantt.reset')}
        </AppButton>
      )}
    </div>
  )

  return (
    <AppCard title={t('demands.gantt.title')} actions={actions} aria-label={t('demands.gantt.title')}>
      {!model ? (
        <AppEmptyState compact icon={<CalendarClock />} title={t('demands.gantt.empty')} />
      ) : (
        <div ref={areaRef} className="overflow-x-auto">
          <div ref={gridRef} className="relative" style={{ minWidth: Math.max(760, model.ticks.length * 56 + width) }}>
            <div className="grid border-b border-border pb-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase" style={columns}>
              <span>{t('demands.columns.task')}</span>
              <div className="relative h-4">
                {model.ticks.map((mark) => (
                  <span key={mark.date.toISOString()} className="absolute top-0 border-l border-border pl-1.5 whitespace-nowrap" style={{ left: `${mark.left}%` }}>
                    {tick(mark.date)}
                  </span>
                ))}
              </div>
            </div>
            {/* linha de HOJE por cima de todas as linhas */}
            <div aria-hidden className="pointer-events-none absolute top-0 bottom-0 z-10" style={{ left: width, right: 0 }}>
              <div className="absolute top-0 bottom-0 w-0.5 bg-danger" style={{ left: `${model.today}%` }}>
                <span className="absolute top-0 -left-3 -translate-y-0.5 rounded bg-surface px-0.5 text-[10px] font-extrabold text-danger uppercase">{t('demands.gantt.today')}</span>
              </div>
            </div>
            {/* Divisor entre os títulos e as barras (padrão "window splitter"): arrastar ajusta, as setas também,
                duplo clique volta à largura automática. A área de pegar é larga; o traço aparece em verde. */}
            {onLabelWidthChange && (
              /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t('demands.gantt.divider')}
                aria-valuenow={width}
                aria-valuemin={GANTT_LABEL_MIN}
                aria-valuemax={maxWidth}
                title={t('demands.gantt.dividerHint')}
                tabIndex={0}
                data-testid="gantt-divider"
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                  event.preventDefault()
                  choose(width + (event.key === 'ArrowRight' ? GANTT_LABEL_STEP : -GANTT_LABEL_STEP))
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.preventDefault()
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  setDragging(width)
                }}
                onPointerMove={(event) => {
                  if (dragging !== null) setDragging(pointerWidth(event))
                }}
                onPointerUp={(event) => {
                  if (dragging === null) return
                  const next = pointerWidth(event)
                  setDragging(null)
                  choose(next)
                }}
                onPointerCancel={() => setDragging(null)}
                onDoubleClick={() => choose(null)}
                className={cn(
                  'absolute top-0 bottom-0 z-20 -ml-1.5 w-3 cursor-col-resize touch-none select-none focus-visible:outline-none',
                  "after:absolute after:top-0 after:bottom-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:content-['']",
                  'hover:after:bg-primary focus-visible:after:bg-primary',
                  dragging !== null && 'after:bg-primary',
                )}
                style={{ left: width }}
              />
              /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
            )}
            {model.groups.map((group) => (
              <section key={group.key || 'none'} aria-label={groupName(group)}>
                <h3 className="grid min-h-7 items-center border-b border-border bg-surface-2" style={columns}>
                  <span className="flex min-w-0 items-center gap-2 pr-2.5 text-xs font-bold text-fg">
                    {group.person && <AppAvatar name={group.person.name} src={group.person.avatarUrl} size="xs" />}
                    <span className="truncate">{groupName(group)}</span>
                    <span className="shrink-0 font-normal text-muted">{t('demands.gantt.groupSummary', { count: group.rows.length, hours: formatNumber(group.hours, locale) })}</span>
                  </span>
                  <span />
                </h3>
                <ul>
                  {group.rows.map((row) => {
                    const text = tip(row)
                    const target = { pathname: `/tasks/${row.task.id}` }
                    const state = { from: { to: back, place } }
                    return (
                      <li key={row.task.id} className="grid min-h-7 items-stretch border-b border-border hover:bg-surface-2" style={columns} data-testid="gantt-row">
                        {/* o título inteiro, em até duas linhas (sem "…" no meio do caminho); a dica tem tudo */}
                        <Link
                          to={target}
                          state={state}
                          title={row.task.title}
                          className="line-clamp-2 self-center py-1 pr-2.5 text-xs leading-snug break-words text-fg hover:text-primary-text hover:underline"
                          data-testid="gantt-title"
                        >
                          {row.task.title}
                        </Link>
                        <div className="relative min-h-7">
                          <AppTooltip content={text}>
                            <Link
                              to={target}
                              state={state}
                              aria-label={text}
                              tabIndex={-1}
                              className={cn(
                                'absolute top-1/2 h-3 -translate-y-1/2 rounded-full focus-visible:outline-2 focus-visible:outline-ring',
                                row.late && 'outline outline-2 outline-offset-1 outline-danger',
                              )}
                              style={{ left: `${row.left}%`, width: `${row.width}%`, background: optionColor(demandStepColor(row.step)) }}
                            />
                          </AppTooltip>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
      {undated > 0 && <p className="pt-3 text-xs text-muted">{t('demands.gantt.undated', { count: undated })}</p>}
    </AppCard>
  )
}
