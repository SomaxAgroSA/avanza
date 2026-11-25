import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, TriangleAlert } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { Project } from '@/domain/projects'
import type { DepAreaRef, Dependencies, DepProject, DepTaskRef } from '@/domain/dependencies'
import { projectDisplayName } from '@/domain/demands'
import { AppButton, AppDrawer } from '@/presentation/components'
import { TaskPreviewDrawer } from '@/features/tasks/TaskPreviewDrawer'
import { TaskEditDialog } from '@/features/tasks/TaskEditDialog'
import { areaChips, depInScope, dueLabel, type DepScope, type DueTone } from './dependency-data'

/* Dependências por área no painel Direção e gerência (regras §42): faixa, ⚠ do Gantt e painel lateral. */

const TONE: Record<DueTone, string> = {
  crit: 'bg-danger-soft text-danger-soft-fg',
  warn: 'bg-warning-soft text-warning-soft-fg',
  ok: 'bg-success-soft text-success-soft-fg',
}
const COUNT_TONE = { crit: 'font-bold text-danger', warn: 'font-bold text-warning-soft-fg', plain: 'font-bold text-fg' }

const Sep = ({ char = '·' }: { char?: string }) => (
  <span aria-hidden className="mx-2 text-border-strong">
    {char}
  </span>
)

/** Faixa entre os indicadores e a linha do tempo: só os alertas que existem; some sem projetos afetados. */
export function DepStrip({ scope, onOpen }: { scope: DepScope; onOpen: () => void }) {
  const { t } = useTranslation()
  if (scope.projects.length === 0) return null
  const totals = scope.totals
  const parts = [
    { key: 'blocked', value: totals.blocked, text: t('dependencies.blocked', { count: totals.blocked }), tone: 'crit' as const },
    { key: 'noneDue', value: totals.noneDue, text: t('dependencies.noneDue', { count: totals.noneDue }), tone: 'warn' as const },
    { key: 'overdue', value: totals.overdue, text: t('dependencies.overdue', { count: totals.overdue }), tone: 'crit' as const },
    { key: 'pending', value: totals.pending, text: t('dependencies.pending', { count: totals.pending }), tone: 'plain' as const },
  ].filter((part) => part.value > 0)
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={t('dependencies.stripAria')}
      onClick={onOpen}
      data-testid="dep-strip"
      className={cn(
        'mb-4 flex min-h-12 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warning/50 bg-warning-soft/60 px-4 py-2 text-left text-sm text-fg',
        'transition-colors duration-150 hover:border-warning hover:bg-warning-soft motion-reduce:transition-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      )}
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning-soft-fg" />
      <span className="whitespace-nowrap font-bold">{t('dependencies.title')}</span>
      <span className="min-w-0 flex-1 basis-64 text-[13px] text-muted">
        {parts.map((part, i) => (
          <Fragment key={part.key}>
            {i > 0 && <Sep />}
            <b className={COUNT_TONE[part.tone]}>{part.text}</b>
          </Fragment>
        ))}
        {parts.length > 0 && <Sep char="|" />}
        {t('dependencies.projects', { count: scope.totals.projects })}
      </span>
      <span className="inline-flex items-center gap-0.5 whitespace-nowrap font-bold text-fg">
        {t('dependencies.view')}
        <ChevronRight aria-hidden className="size-4" />
      </span>
    </button>
  )
}

/** ⚠ ao lado do nome do projeto na linha do tempo (as barras não mudam de cor). */
export function DepFlag({ name, onOpen }: { name: string; onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={t('dependencies.flagAria', { name })}
      title={t('dependencies.flag')}
      onClick={onOpen}
      className="ml-1 inline-flex shrink-0 rounded p-0.5 text-warning-soft-fg hover:bg-warning-soft focus-visible:outline-2 focus-visible:outline-ring"
    >
      <TriangleAlert aria-hidden className="size-3.5" />
    </button>
  )
}

/* ------------------------------------------------------------------ painel lateral */

export interface DepDrawerProps {
  data: Dependencies | undefined
  /** Projetos do recorte do painel. */
  panel: readonly Pick<Project, 'id'>[]
  /** Projeto aberto pelo ⚠ (null = todos do recorte). */
  only: string | null
  open: boolean
  onClose: () => void
  onShowAll: () => void
}

export function DepDrawer({ data, panel, only, open, onClose, onShowAll }: DepDrawerProps) {
  const { t } = useTranslation()
  // área escolhida nas chips (null = todas); a tarefa aberta por cima e a edição dela
  const [area, setArea] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const all = useMemo(() => depInScope(data, panel, only), [data, panel, only])
  const chips = useMemo(() => areaChips(data, all.projects), [data, all])
  // a área escolhida some do recorte (outro projeto, entrega concluída): volta para todas
  const selected = area && chips.areas.some((a) => a.key === area) ? area : null
  const shown = useMemo(() => (selected ? depInScope(data, panel, only, selected) : all), [data, panel, only, selected, all])
  const today = data?.today ?? ''

  return (
    <>
      <AppDrawer
        open={open}
        onOpenChange={(next) => {
          if (next) return
          setArea(null)
          onClose()
        }}
        title={t('dependencies.title')}
        size="lg"
      >
        <div className="flex flex-col gap-3.5 text-sm" data-testid="dep-drawer">
          <div role="group" aria-label={t('dependencies.areaFilter')} className="flex flex-wrap gap-1.5">
            <AreaChip label={t('dependencies.allAreas')} count={chips.total} pressed={!selected} onClick={() => setArea(null)} />
            {chips.areas.map((a) => (
              <AreaChip key={a.key} label={a.name} count={a.count} pressed={selected === a.key} onClick={() => setArea(a.key)} />
            ))}
          </div>
          {shown.projects.length === 0 && <p className="text-[13px] text-muted">{t('dependencies.empty')}</p>}
          {shown.projects.map((row) => (
            <ProjectBlock key={row.project.id} row={row} today={today} onOpenTask={setTaskId} />
          ))}
          {only && (
            <AppButton variant="link" className="self-start" onClick={onShowAll} rightIcon={<ChevronRight />}>
              {t('dependencies.seeAll')}
            </AppButton>
          )}
        </div>
      </AppDrawer>
      {/* a tarefa abre por cima: fechar (ou "Voltar a Dependências") volta para o painel */}
      <TaskPreviewDrawer
        taskId={taskId}
        onOpenChange={(next) => !next && setTaskId(null)}
        backLabel={t('dependencies.back')}
        onEdit={(id) => {
          setTaskId(null)
          setEditing(id)
        }}
      />
      <TaskEditDialog taskId={editing} onOpenChange={(next) => !next && setEditing(null)} />
    </>
  )
}

function AreaChip({ label, count, pressed, onClick }: { label: string; count: number; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-[13px] font-semibold transition-colors duration-150 motion-reduce:transition-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        pressed ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong bg-surface text-fg hover:bg-surface-2',
      )}
    >
      {label}
      <b className={cn('ml-1.5 tabular-nums', pressed ? 'text-primary-fg' : 'text-muted')}>{count}</b>
    </button>
  )
}

const Chip = ({ children }: { children: ReactNode }) => (
  <span className="inline-block rounded-full bg-info-soft px-1.5 py-px text-[11px] font-bold leading-4 text-info-soft-fg">{children}</span>
)

function ProjectBlock({ row, today, onOpenTask }: { row: DepProject; today: string; onOpenTask: (id: string) => void }) {
  const { t } = useTranslation()
  const other = (ref: DepTaskRef) => (ref.project.id !== row.project.id ? <Chip>{t('dependencies.fromProject', { name: projectDisplayName(t, ref.project) })}</Chip> : null)
  const name = projectDisplayName(t, row.project)
  return (
    <section aria-label={name} className="rounded-xl border border-border px-3.5 pb-1.5 pt-3">
      <header className="mb-1 flex items-baseline justify-between gap-2.5 border-b border-border pb-2">
        <h3 className="min-w-0 text-[15px] font-semibold text-fg">{name}</h3>
        <span
          aria-label={t('dependencies.pendingCount', { count: row.deliveries.length })}
          className="min-w-7 shrink-0 rounded-full bg-surface-2 px-2.5 py-px text-center text-[15px] font-extrabold tabular-nums text-fg"
        >
          {row.deliveries.length}
        </span>
      </header>

      {row.blocked.length > 0 && (
        <Subsection title={t('dependencies.blockedTitle')} dot="bg-danger">
          {row.blocked.map((task) => (
            <TaskRow key={task.id} title={task.title} onOpen={() => onOpenTask(task.id)} className="mb-1.5 border-l-[3px] border-danger bg-danger-soft/70 px-3 hover:bg-danger-soft" aside={<Due date={task.dueDate} today={today} />}>
              {task.waitingOn.map((w) => (
                <span key={w.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span>
                    {t('dependencies.waitsFor')} <b className="font-semibold text-fg">{w.title}</b>
                  </span>
                  {other(w)}
                </span>
              ))}
            </TaskRow>
          ))}
        </Subsection>
      )}

      {row.pending.length > 0 && (
        <Subsection title={t('dependencies.pendingTitle')} hint={t('dependencies.pendingHint')} dot="bg-warning">
          {row.pending.map((task) => (
            <div key={task.relationId} className="mb-1.5 rounded-lg border border-dashed border-warning px-3 py-2.5" data-testid="dep-row">
              <div className="min-w-0">
                <span className="block text-sm font-semibold leading-snug text-fg">{task.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-muted">
                  <span>
                    {t('dependencies.relatedTo')} <b className="font-semibold text-fg">{task.relatedTo.title}</b>
                  </span>
                  {other(task.relatedTo)}
                </span>
              </div>
            </div>
          ))}
        </Subsection>
      )}

      {row.deliveries.length > 0 && (
        <div className="mt-3 mb-1">
          <div className="flex justify-between border-b border-border px-0.5 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
            <span>{t('dependencies.deliveryHead')}</span>
            <span>{t('dependencies.dueHead')}</span>
          </div>
          <ul>
            {row.deliveries.map((d) => (
              <li key={d.id} className="border-b border-border last:border-b-0">
                <TaskRow title={d.title} onOpen={() => onOpenTask(d.id)} className="px-1 hover:bg-surface-2" aside={<Due date={d.dueDate} today={today} />}>
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <AreaTag area={d.area} />
                    <span>· {d.waitingDays ? t('dependencies.waiting', { count: d.waitingDays }) : t('dependencies.waitingToday')}</span>
                    {d.blocks > 0 && (
                      <b className="font-bold text-danger">
                        · {t('dependencies.blocks', { count: d.blocks })}
                        {d.blocksProjects.length > 0 && ` ${t('dependencies.blocksFrom', { names: d.blocksProjects.map((p) => p.name).join(', ') })}`}
                      </b>
                    )}
                  </span>
                </TaskRow>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

const AreaTag = ({ area }: { area: DepAreaRef }) => <Chip>{area.name}</Chip>

function Subsection({ title, hint, dot, children }: { title: string; hint?: string; dot: string; children: ReactNode }) {
  return (
    <div className="mt-3 mb-1">
      <h4 className="mb-2 flex items-center gap-2 text-[11.5px] font-extrabold uppercase tracking-wider text-fg">
        <span aria-hidden className={cn('inline-block size-2 rounded-full', dot)} />
        {title}
        {hint && <span className="font-medium normal-case tracking-normal text-muted">{hint}</span>}
      </h4>
      {children}
    </div>
  )
}

/**
 * Linha clicável (botão): o título inteiro, alinhado quando quebra, o detalhe embaixo e o prazo à direita.
 * Sem código da tarefa. Clicar (ou Enter/Espaço) abre a tarefa por cima do painel.
 */
function TaskRow({ title, onOpen, aside, className, children }: { title: string; onOpen: () => void; aside: ReactNode; className?: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onOpen}
      title={t('dependencies.openTask', { title })}
      data-testid="dep-row"
      className={cn(
        'group grid w-full grid-cols-1 items-center gap-x-3 gap-y-1.5 rounded-lg py-2.5 text-left transition-colors duration-150 motion-reduce:transition-none sm:grid-cols-[minmax(0,1fr)_auto]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      <span className="block min-w-0">
        <span className="block text-sm font-semibold leading-snug text-fg underline decoration-transparent underline-offset-2 transition-colors group-hover:decoration-current">{title}</span>
        <span className="mt-0.5 block text-[12.5px] text-muted">{children}</span>
      </span>
      <span className="justify-self-start sm:justify-self-end">{aside}</span>
    </button>
  )
}

function Due({ date, today }: { date: string | null; today: string }) {
  const { t } = useTranslation()
  const label = dueLabel(date, today)
  // dd/mm (+ /aa fora do ano atual), igual nos três idiomas
  const formatted = date ? `${date.slice(8, 10)}/${date.slice(5, 7)}${label.withYear ? `/${date.slice(2, 4)}` : ''}` : ''
  return (
    <span className={cn('inline-block min-w-32 whitespace-nowrap rounded-lg px-2 py-0.5 text-right text-xs font-bold', TONE[label.tone])}>
      {t(`dependencies.due.${label.kind}`, { date: formatted, count: label.days })}
    </span>
  )
}
