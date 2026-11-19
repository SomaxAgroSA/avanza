import { Fragment, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, TriangleAlert } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { TiDependencies, TiProject, TiTaskRef } from '@/domain/ti-dependencies'
import { AppButton, AppDrawer, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useConfirmTiBlock } from '../queries'
import { dueLabel, tiPeopleOf, type DueTone, type TiScope } from './ti-data'

/* Dependências de TI no painel Direção e gerência (regras §42): faixa, ⚠ do Gantt e painel lateral. */

const TONE: Record<DueTone, string> = {
  crit: 'bg-danger-soft text-danger-soft-fg',
  warn: 'bg-warning-soft text-warning-soft-fg',
  ok: 'bg-primary-soft text-primary-soft-fg',
}
const COUNT_TONE = { crit: 'font-bold text-danger', warn: 'font-bold text-warning-soft-fg', plain: 'font-bold text-fg' }

/** Partes do resumo ("1 bloqueada · 2 sem prazo · …"): bloqueadas e sem prazo sempre; as outras só se houver. */
function useSummaryParts(counts: TiScope['totals'] | TiProject['counts']): Array<{ key: string; text: string; tone: keyof typeof COUNT_TONE }> {
  const { t } = useTranslation()
  const parts: Array<{ key: string; text: string; tone: keyof typeof COUNT_TONE }> = [
    { key: 'blocked', text: t('tiDependencies.blocked', { count: counts.blocked }), tone: 'crit' },
    { key: 'noneDue', text: t('tiDependencies.noneDue', { count: counts.noneDue }), tone: 'warn' },
  ]
  if (counts.overdue > 0) parts.push({ key: 'overdue', text: t('tiDependencies.overdue', { count: counts.overdue }), tone: 'crit' })
  if (counts.afterProjectDue > 0) parts.push({ key: 'afterProjectDue', text: t('tiDependencies.afterProjectDue', { count: counts.afterProjectDue }), tone: 'crit' })
  if (counts.pending > 0) parts.push({ key: 'pending', text: t('tiDependencies.pending', { count: counts.pending }), tone: 'plain' })
  return parts
}

const Sep = () => (
  <span aria-hidden className="mx-2 text-border-strong">
    ·
  </span>
)

/** Faixa entre os indicadores e a linha do tempo; some quando nenhum projeto do recorte é afetado. */
export function TiStrip({ scope, onOpen }: { scope: TiScope; onOpen: () => void }) {
  const { t } = useTranslation()
  const parts = useSummaryParts(scope.totals)
  if (scope.projects.length === 0) return null
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={t('tiDependencies.stripAria')}
      onClick={onOpen}
      data-testid="ti-strip"
      className={cn(
        'mb-4 flex min-h-12 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warning/50 bg-warning-soft/60 px-4 py-2 text-left text-sm text-fg',
        'transition-colors duration-150 hover:border-warning hover:bg-warning-soft motion-reduce:transition-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      )}
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning-soft-fg" />
      <span className="whitespace-nowrap font-bold">{t('tiDependencies.title')}</span>
      <span className="min-w-0 flex-1 basis-64 text-[13px] text-muted">
        {parts.map((part, i) => (
          <Fragment key={part.key}>
            {i > 0 && <Sep />}
            <b className={COUNT_TONE[part.tone]}>{part.text}</b>
          </Fragment>
        ))}
        <span aria-hidden className="mx-2 text-border-strong">
          |
        </span>
        {t('tiDependencies.projects', { count: scope.totals.projects })}
      </span>
      <span className="inline-flex items-center gap-0.5 whitespace-nowrap font-bold text-fg">
        {t('tiDependencies.view')}
        <ChevronRight aria-hidden className="size-4" />
      </span>
    </button>
  )
}

/** ⚠ ao lado do nome do projeto na linha do tempo (as barras não mudam de cor). */
export function TiFlag({ name, onOpen }: { name: string; onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={t('tiDependencies.flag', { name })}
      title={t('tiDependencies.flag', { name })}
      onClick={onOpen}
      className="ml-1 inline-flex shrink-0 rounded p-0.5 text-warning-soft-fg hover:bg-warning-soft focus-visible:outline-2 focus-visible:outline-ring"
    >
      <TriangleAlert aria-hidden className="size-3.5" />
    </button>
  )
}

/* ------------------------------------------------------------------ painel lateral */

export interface TiDrawerProps {
  ti: TiDependencies | undefined
  /** Recorte já filtrado (pelo painel e, com `only`, por um projeto). */
  scope: TiScope
  /** Projeto aberto pelo ⚠ (null = todos do recorte). */
  only: string | null
  open: boolean
  onClose: () => void
  onShowAll: () => void
}

export function TiDrawer({ ti, scope, only, open, onClose, onShowAll }: TiDrawerProps) {
  const { t } = useTranslation()
  const people = tiPeopleOf(ti, scope.projects)
  const single = only ? scope.projects[0] : undefined
  const totals = scope.totals
  return (
    <AppDrawer open={open} onOpenChange={(next) => !next && onClose()} title={t('tiDependencies.title')} description={single ? single.project.name : t('tiDependencies.allProjects')} size="lg">
      <div className="flex flex-col gap-3.5 text-sm" data-testid="ti-drawer">
        {people.length > 0 && (
          <p className="text-[13px] text-muted">
            {t('tiDependencies.responsible')} <strong className="font-semibold text-fg">{people.map((p) => p.name).join(', ')}</strong>
            {!only && t('tiDependencies.separated')}
          </p>
        )}
        {!only && (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { key: 'blocked', value: totals.blocked, label: t('tiDependencies.stats.blocked', { count: totals.blocked }), tone: 'text-danger' },
              { key: 'noneDue', value: totals.noneDue, label: t('tiDependencies.stats.noneDue'), tone: 'text-warning-soft-fg' },
              { key: 'after', value: totals.afterProjectDue, label: t('tiDependencies.stats.afterProjectDue'), tone: 'text-danger' },
              { key: 'pending', value: totals.pending, label: t('tiDependencies.stats.pending'), tone: 'text-fg' },
            ].map((stat) => (
              <div key={stat.key} className="rounded-xl bg-surface-2 px-3 py-2.5 text-xs leading-snug text-muted">
                <dd className={cn('mb-0.5 text-[22px] font-bold leading-none tabular-nums', stat.tone)}>{stat.value}</dd>
                <dt>{stat.label}</dt>
              </div>
            ))}
          </dl>
        )}
        {scope.projects.map((row) => (
          <ProjectBlock key={row.project.id} row={row} today={ti?.today ?? ''} />
        ))}
        {only && (
          <AppButton variant="link" className="self-start" onClick={onShowAll} rightIcon={<ChevronRight />}>
            {t('tiDependencies.seeAll')}
          </AppButton>
        )}
        <details className="mt-1 border-t border-border pt-3 text-[12.5px] text-muted">
          <summary className="cursor-pointer font-bold text-fg">{t('tiDependencies.how')}</summary>
          <p className="mt-2 leading-relaxed">{t('tiDependencies.howText')}</p>
        </details>
      </div>
    </AppDrawer>
  )
}

function ProjectBlock({ row, today }: { row: TiProject; today: string }) {
  const { t } = useTranslation()
  const parts = useSummaryParts(row.counts)
  const shown = parts.filter((part) => (part.key === 'blocked' ? row.counts.blocked > 0 : part.key === 'noneDue' ? row.counts.noneDue > 0 : true))
  const other = (ref: TiTaskRef) =>
    ref.project.id !== row.project.id ? (
      <span className="ml-1.5 inline-block rounded-full bg-info-soft px-1.5 py-px text-[11px] font-bold text-info-soft-fg">{t('tiDependencies.fromProject', { name: ref.project.name })}</span>
    ) : null
  return (
    <section aria-label={row.project.name} className="rounded-xl border border-border px-3.5 pb-1.5 pt-3">
      <header className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-0.5 border-b border-border pb-2">
        <h3 className="text-[15px] font-semibold text-fg">{row.project.name}</h3>
        <span className="text-[12.5px] text-muted">
          {shown.length === 0
            ? t('tiDependencies.noAlerts')
            : shown.map((part, i) => (
                <Fragment key={part.key}>
                  {i > 0 && ' · '}
                  <b className={COUNT_TONE[part.tone]}>{part.text}</b>
                </Fragment>
              ))}
        </span>
      </header>

      {row.blocked.length > 0 && (
        <Subsection title={t('tiDependencies.blockedTitle')} dot="bg-danger">
          {row.blocked.map((task) => (
            <Row key={task.id} task={task} className="mb-1.5 rounded-lg border-l-[3px] border-danger bg-danger-soft/70 px-3 py-2.5" aside={<Due date={task.dueDate} today={today} />}>
              {task.waitingOn.map((w) => (
                <div key={w.id}>
                  {t('tiDependencies.waitsFor')} <b className="text-fg">{w.code}</b>
                  {other(w)} · {w.title}
                </div>
              ))}
            </Row>
          ))}
        </Subsection>
      )}

      {row.pending.length > 0 && (
        <Subsection title={t('tiDependencies.pendingTitle')} hint={t('tiDependencies.pendingHint')} dot="bg-warning">
          {row.pending.map((task) => (
            <Row key={task.relationId} task={task} className="mb-1.5 rounded-lg border border-dashed border-warning px-3 py-2.5" aside={task.canConfirm ? <ConfirmButton task={task} /> : null}>
              {t('tiDependencies.relatedTo')} <b className="text-fg">{task.relatedTo.code}</b>
              {other(task.relatedTo)} · {task.relatedTo.title}
            </Row>
          ))}
        </Subsection>
      )}

      {row.deliveries.length > 0 && (
        <Subsection title={t('tiDependencies.deliveriesTitle')} hint={String(row.deliveries.length)} dot="bg-info-soft-fg">
          <div className="flex justify-between border-b border-border px-0.5 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
            <span>{t('tiDependencies.deliveryHead')}</span>
            <span>{t('tiDependencies.dueHead')}</span>
          </div>
          <ul>
            {row.deliveries.map((d) => (
              <li key={d.id}>
                <Row task={d} className="border-b border-border px-0.5 py-2.5 last:border-b-0" aside={<Due date={d.dueDate} today={today} risk={d.risk} />}>
                  {d.waitingDays ? t('tiDependencies.waiting', { count: d.waitingDays }) : t('tiDependencies.waitingToday')}
                  {d.blocks > 0 && (
                    <>
                      {' · '}
                      <b className="text-danger">
                        {t('tiDependencies.blocks', { count: d.blocks })}
                        {d.blocksProjects.length > 0 && ` ${t('tiDependencies.blocksFrom', { names: d.blocksProjects.map((p) => p.name).join(', ') })}`}
                      </b>
                    </>
                  )}
                </Row>
              </li>
            ))}
          </ul>
        </Subsection>
      )}
    </section>
  )
}

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

/** Linha: código em coluna fixa, título alinhado quando quebra, detalhe embaixo e a coluna da direita. */
function Row({ task, aside, className, children }: { task: TiTaskRef; aside: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cn('grid grid-cols-1 items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto]', className)} data-testid="ti-row">
      <div className="min-w-0">
        <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-baseline text-sm font-semibold leading-snug text-fg">
          <span className="text-xs font-bold tabular-nums text-muted">{task.code}</span>
          <span>{task.title}</span>
        </div>
        <div className="mt-0.5 text-[12.5px] text-muted sm:pl-[4.75rem]">{children}</div>
      </div>
      {aside && <div className="justify-self-start sm:justify-self-end">{aside}</div>}
    </div>
  )
}

function Due({ date, today, risk }: { date: string | null; today: string; risk?: Parameters<typeof dueLabel>[2] }) {
  const { t, i18n } = useTranslation()
  const label = dueLabel(date, today, risk)
  const formatted = date
    ? new Intl.DateTimeFormat(i18n.language, { day: '2-digit', month: '2-digit', ...(label.withYear ? { year: '2-digit' } : {}), timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
    : ''
  return (
    <span className={cn('inline-block min-w-32 whitespace-nowrap rounded-lg px-2 py-0.5 text-right text-xs font-bold', TONE[label.tone])}>
      {t(`tiDependencies.due.${label.kind}`, { date: formatted, count: label.days })}
    </span>
  )
}

function ConfirmButton({ task }: { task: TiProject['pending'][number] }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const confirm = useConfirmTiBlock()
  return (
    <AppButton
      size="sm"
      variant="secondary"
      loading={confirm.isPending}
      onClick={() =>
        confirm.mutate(
          { taskId: task.id, deliveryId: task.relatedTo.id, relationId: task.relationId },
          {
            onSuccess: () => notify.success(t('tiDependencies.confirmed', { code: task.code, target: task.relatedTo.code })),
            onError: (error) => notify.error(errorMessage(error)),
          },
        )
      }
    >
      {t('tiDependencies.confirm')}
    </AppButton>
  )
}
