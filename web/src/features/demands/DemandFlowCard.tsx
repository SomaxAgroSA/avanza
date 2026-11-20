import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatNumber, formatShortDateTime } from '@/core/utils/format'
import { demandActionsFor } from '@/domain/demands'
import type { TaskDetail } from '@/domain/tasks'
import { AppAvatar } from '@/presentation/components'
import { useSession } from '@/features/auth/session'
import { DemandActions } from './DemandActions'
import { DemandStatusBadge } from './demand-visuals'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-fg">{children}</dd>
    </div>
  )
}

function Person({ person, empty }: { person: TaskDetail['assignee']; empty: string }) {
  if (!person) return <span className="font-normal text-muted">{empty}</span>
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <AppAvatar name={person.name} src={person.avatarUrl} size="xs" />
      <span className="truncate">{person.name}</span>
    </span>
  )
}

/**
 * Tarefa de projeto com quem recebe e distribui (§45): o passo, o responsável, a quem está atribuída, o
 * prazo com hora, a estimativa e os botões do papel da pessoa (Atribuir, Começar, Passar a…, Concluir,
 * Validar, Devolver). Some na tarefa sem responsável.
 */
export function DemandFlowCard({ task }: { task: TaskDetail }) {
  const { t, i18n } = useTranslation()
  const me = useSession().current?.user.id
  const demand = task.demand
  if (!demand) return null
  const actions = demand.actions ?? demandActionsFor(me, task)
  return (
    <section aria-label={t('demands.projectFlow.title')} className="rounded-xl border border-border bg-surface-2/60 px-4 py-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-subtle uppercase">{t('demands.projectFlow.title')}</h3>
        <DemandStatusBadge status={demand.status} />
      </div>
      <dl className="divide-y divide-border">
        <Row label={t('demands.projectFlow.owner')}>
          <Person person={demand.owner} empty="—" />
        </Row>
        <Row label={t('demands.projectFlow.assignee')}>
          <Person person={task.assignee} empty={t('demands.detail.unassigned')} />
        </Row>
        <Row label={t('demands.projectFlow.deadline')}>{demand.dueAt ? formatShortDateTime(demand.dueAt, i18n.language) : '—'}</Row>
        <Row label={t('demands.detail.estimate')}>{task.estimatedHours ? t('demands.detail.hours', { hours: formatNumber(task.estimatedHours, i18n.language) }) : '—'}</Row>
      </dl>
      {Object.values(actions).some(Boolean) && (
        <div className="mt-2 flex justify-end">
          <DemandActions task={task} actions={actions} />
        </div>
      )}
    </section>
  )
}
