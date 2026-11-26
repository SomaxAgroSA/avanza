import { useMemo } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CalendarClock, RotateCcw } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatDay, formatNumber, formatShortDateTime } from '@/core/utils/format'
import type { DemandBox, DemandStatus } from '@/domain/demands'
import { estimateLabelWidth } from '@/domain/gantt-scale'
import { taskGantt, type GanttGroupBy, type TaskGanttGroup, type TaskGanttRow } from '@/domain/task-gantt'
import type { TaskSummary } from '@/domain/tasks'
import {
  AppAvatar,
  AppButton,
  AppCard,
  AppEmptyState,
  AppSegmentedControl,
  AppTooltip,
  GanttDivider,
  GanttFrame,
  useGanttLabelColumn,
} from '@/presentation/components'
import { optionColor } from '@/features/task-config/config-theme'
import { demandStepColor, useDemandStepText } from './demand-step'

/** Passos que a linha do tempo desenha, na ordem da legenda. */
const LEGEND_STEPS: readonly DemandStatus[] = ['assigned', 'in_progress', 'to_validate']

const dot = (status: DemandStatus) => <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: optionColor(demandStepColor(status)) }} />

/**
 * Linha do tempo das tarefas da Caixa de entrada (ajuste 25/11, opção B aprovada em demonstração; mesmo desenho
 * da "Linha do tempo dos projetos" de Projetos › Em andamento): Gantt das tarefas da caixa e dos filtros atuais,
 * a toda a largura, agrupado por pessoa (Atribuída a) ou por projeto, com a linha de HOJE, a cor do passo e o
 * contorno vermelho no prazo vencido. A barra vai do início planejado (sem ele, a abertura) até o prazo; as sem
 * prazo ficam na Lista (nota no fim). Clicar abre a tarefa; a dica mostra o título inteiro, o passo e as datas.
 *
 * Títulos inteiros numa linha e cabeçalho por semanas (ajuste aprovado em demonstração, 26/11, §52): o título vai
 * sempre inteiro, numa linha só (sem quebra e sem "…"); a coluna mede o título mais longo à vista e as barras se
 * estreitam para dar lugar (com um mínimo; abaixo disso, rola para o lado). O cabeçalho mostra as semanas e os
 * dias (ou, numa janela longa, os meses e as segundas-feiras), com os fins de semana sombreados, a semana atual
 * em destaque e HOJE em vermelho (presentation/components/gantt). O divisor só alarga (arrastar, ← → no teclado;
 * duplo clique volta à automática); "Restabelecer" também volta. A largura escolhida fica guardada por pessoa
 * neste navegador (use-inbox-view.ts); uma guardada menor que o título mais longo não vale.
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
  const groupName = (group: TaskGanttGroup) => group.person?.name ?? group.project?.name ?? (groupBy === 'person' ? t('demands.row.noAssignee') : t('demands.chip'))
  const tip = (row: TaskGanttRow) =>
    t(row.late ? 'demands.gantt.tipLate' : 'demands.gantt.tip', {
      title: row.task.title,
      step: stepText(row.step, row.task.assignee),
      start: formatDay(row.start, locale),
      due: row.dueAt ? formatShortDateTime(row.dueAt, locale) : formatDay(row.dueDay, locale),
    })

  // coluna dos títulos: o título mais longo à vista (medido) ou a largura escolhida, se maior; durante o arrasto, a do ponteiro
  const titles = useMemo(() => (model ? model.groups.flatMap((g) => g.rows.map((r) => r.task.title)) : []), [model])
  const { areaRef, gridRef, column } = useGanttLabelColumn({
    chosen: labelWidth,
    onChoose: onLabelWidthChange,
    estimate: estimateLabelWidth([...titles, t('demands.columns.task')]),
    scale: model?.scale ?? null,
    measureKey: [groupBy, ...titles].join('|'),
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
      {model && onLabelWidthChange && (
        <AppButton variant="secondary" size="sm" leftIcon={<RotateCcw />} title={t('demands.gantt.resetHint')} onClick={() => column.choose(null)}>
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
          <div ref={gridRef} style={{ minWidth: column.minWidth }}>
            <GanttFrame
              scale={model.scale}
              column={column}
              label={t('demands.columns.task')}
              divider={
                onLabelWidthChange && <GanttDivider column={column} label={t('demands.gantt.divider')} hint={t('demands.gantt.dividerHint')} testId="gantt-divider" />
              }
            >
              {model.groups.map((group) => (
                <section key={group.key || 'none'} aria-label={groupName(group)}>
                  {/* a faixa do grupo ocupa a linha inteira (não tem barras), na mesma altura das tarefas */}
                  <h3 className="flex h-7 items-center gap-2 border-b border-border text-[11.5px] font-bold tracking-wide whitespace-nowrap text-fg uppercase">
                    {group.person && <AppAvatar name={group.person.name} src={group.person.avatarUrl} size="xs" />}
                    <span>{groupName(group)}</span>
                    <span className="font-normal tracking-normal text-muted normal-case">{t('demands.gantt.groupSummary', { count: group.rows.length, hours: formatNumber(group.hours, locale) })}</span>
                  </h3>
                  <ul>
                    {group.rows.map((row) => {
                      const text = tip(row)
                      const target = { pathname: `/tasks/${row.task.id}` }
                      const state = { from: { to: back, place } }
                      return (
                        <li key={row.task.id} className="grid h-7 items-center border-b border-border hover:bg-surface-2/70" style={column.columns} data-testid="gantt-row">
                          {/* o título inteiro, numa linha só (sem quebra e sem "…"): a coluna mede o mais longo */}
                          <Link
                            to={target}
                            state={state}
                            title={row.task.title}
                            data-gantt-label
                            className="block w-max pr-3 text-xs leading-7 whitespace-nowrap text-fg hover:text-primary-text hover:underline"
                            data-testid="gantt-title"
                          >
                            {row.task.title}
                          </Link>
                          <div className="relative h-full">
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
            </GanttFrame>
          </div>
        </div>
      )}
      {undated > 0 && <p className="pt-3 text-xs text-muted">{t('demands.gantt.undated', { count: undated })}</p>}
    </AppCard>
  )
}
