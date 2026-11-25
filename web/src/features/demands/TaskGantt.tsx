import { useMemo } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CalendarClock } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatDay, formatNumber, formatShortDateTime } from '@/core/utils/format'
import type { DemandBox, DemandStatus } from '@/domain/demands'
import { taskGantt, type GanttGroupBy, type TaskGanttGroup, type TaskGanttRow } from '@/domain/task-gantt'
import type { TaskSummary } from '@/domain/tasks'
import { AppAvatar, AppCard, AppEmptyState, AppSegmentedControl, AppTooltip } from '@/presentation/components'
import { optionColor } from '@/features/task-config/config-theme'
import { demandStepColor, useDemandStepText } from './demand-step'

/** Largura da coluna dos nomes (tarefa ou grupo). */
const LABEL_WIDTH = 288
/** Passos que a linha do tempo desenha, na ordem da legenda. */
const LEGEND_STEPS: readonly DemandStatus[] = ['assigned', 'in_progress', 'to_validate']

const dot = (status: DemandStatus) => <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: optionColor(demandStepColor(status)) }} />

/**
 * Linha do tempo das tarefas da Caixa de entrada (ajuste 25/11, opção B aprovada em demonstração; mesmo desenho
 * da "Linha do tempo dos projetos" de Projetos › Em andamento): Gantt das tarefas da caixa e dos filtros atuais,
 * a toda a largura, agrupado por pessoa (Atribuída a) ou por projeto, com a linha de HOJE, a cor do passo e o
 * contorno vermelho no prazo vencido. A barra vai do início planejado (sem ele, a abertura) até o prazo; as sem
 * prazo ficam na Lista (nota no fim). Clicar abre a tarefa; a dica mostra tarefa, passo e datas.
 */
export function TaskGantt({
  tasks,
  groupBy,
  onGroupByChange,
  back,
  place,
}: {
  tasks: readonly TaskSummary[]
  groupBy: GanttGroupBy
  onGroupByChange: (groupBy: GanttGroupBy) => void
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
    </div>
  )

  return (
    <AppCard title={t('demands.gantt.title')} actions={actions} aria-label={t('demands.gantt.title')}>
      {!model ? (
        <AppEmptyState compact icon={<CalendarClock />} title={t('demands.gantt.empty')} />
      ) : (
        <div className="overflow-x-auto">
          <div className="relative" style={{ minWidth: Math.max(760, model.ticks.length * 56 + LABEL_WIDTH) }}>
            <div className="grid border-b border-border pb-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase" style={{ gridTemplateColumns: `${LABEL_WIDTH}px 1fr` }}>
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
            <div aria-hidden className="pointer-events-none absolute top-0 bottom-0 z-10" style={{ left: LABEL_WIDTH, right: 0 }}>
              <div className="absolute top-0 bottom-0 w-0.5 bg-danger" style={{ left: `${model.today}%` }}>
                <span className="absolute top-0 -left-3 -translate-y-0.5 rounded bg-surface px-0.5 text-[10px] font-extrabold text-danger uppercase">{t('demands.gantt.today')}</span>
              </div>
            </div>
            {model.groups.map((group) => (
              <section key={group.key || 'none'} aria-label={groupName(group)}>
                <h3 className="grid min-h-7 items-center border-b border-border bg-surface-2" style={{ gridTemplateColumns: `${LABEL_WIDTH}px 1fr` }}>
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
                      <li key={row.task.id} className="grid min-h-7 items-center border-b border-border hover:bg-surface-2" style={{ gridTemplateColumns: `${LABEL_WIDTH}px 1fr` }} data-testid="gantt-row">
                        <Link to={target} state={state} title={row.task.title} className="truncate pr-2.5 text-xs text-fg hover:text-primary-text hover:underline">
                          {row.task.title}
                        </Link>
                        <div className="relative h-7">
                          <AppTooltip content={text}>
                            <Link
                              to={target}
                              state={state}
                              aria-label={text}
                              tabIndex={-1}
                              className={cn('absolute top-2 h-3 rounded-full focus-visible:outline-2 focus-visible:outline-ring', row.late && 'outline outline-2 outline-offset-1 outline-danger')}
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
