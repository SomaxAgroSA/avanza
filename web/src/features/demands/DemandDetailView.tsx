import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Lock, Pencil, Trash2 } from 'lucide-react'
import { formatNumber, formatShortDateTime } from '@/core/utils/format'
import type { TaskDetail } from '@/domain/tasks'
import { demandActionsFor } from '@/domain/demands'
import { AppAvatar, AppButton, AppCard, AppConfirmDialog, AppMarkdown, AppSkeleton, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useSession } from '@/features/auth/session'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { TaskComments } from '@/features/tasks/TaskComments'
import { TaskAttachments } from '@/features/tasks/TaskAttachments'
import { TaskFormDialog } from '@/features/tasks/TaskFormDialog'
import { useTaskHistory, useTaskMutations } from '@/features/tasks/queries'
import { DemandActions } from './DemandActions'
import { DemandStatusBadge } from './demand-visuals'
import { useDemandEvents } from './demand-timeline'

/** De onde a pessoa veio (o "← Voltar a …"): Tarefas ou uma das caixas da tela Demandas. */
interface BackTarget {
  to: string
  place: 'tasks' | 'received' | 'assigned' | 'requested'
}

function backTarget(state: unknown): BackTarget {
  const from = (state as { from?: Partial<BackTarget> } | null)?.from
  const places: BackTarget['place'][] = ['tasks', 'received', 'assigned', 'requested']
  if (from && typeof from.to === 'string' && from.to.startsWith('/tasks') && from.place && places.includes(from.place)) return { to: from.to, place: from.place }
  return { to: '/tasks', place: 'tasks' }
}

function Property({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2 text-sm last:border-b-0">
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
 * Página inteira da demanda interna (§45): "← Voltar a …", código · Demanda interna · tipo, título, passo e
 * prioridade, os botões do papel da pessoa + Editar; Descrição e "Linha do tempo e comentários" (histórico
 * e comentários juntos, com o campo de comentar); à direita, Propriedades e Anexos.
 */
export function DemandDetailView({ task }: { task: TaskDetail }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const location = useLocation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const me = useSession().current?.user.id
  const back = backTarget(location.state)
  const history = useTaskHistory(task.id)
  const events = useDemandEvents(history.data?.items ?? [])
  const { remove } = useTaskMutations()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const demand = task.demand
  if (!demand) return null
  const actions = demand.actions ?? demandActionsFor(me, task)

  return (
    <>
      <Link to={back.to} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {t('demands.detail.backTo', { place: t(`demands.detail.places.${back.place}`) })}
      </Link>

      <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted">{[task.code, t('demands.chip'), task.type?.name].filter(Boolean).join(' · ')}</p>
          <h1 className="mt-1 mb-2.5 text-2xl font-semibold tracking-tight break-words text-fg">{task.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <DemandStatusBadge status={demand.status} />
            {task.priority && <LookupBadge item={{ ...task.priority, name: t('demands.detail.priority', { name: task.priority.name }) }} />}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <DemandActions task={task} actions={actions} size="md" />
          {task.capabilities.edit && (
            <AppButton variant="secondary" leftIcon={<Pencil />} onClick={() => setEditing(true)}>
              {t('common.edit')}
            </AppButton>
          )}
          {task.capabilities.delete && (
            <AppButton variant="danger" leftIcon={<Trash2 />} onClick={() => setDeleting(true)}>
              {t('common.delete')}
            </AppButton>
          )}
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <AppCard title={t('demands.detail.description')}>
            {task.description ? <AppMarkdown text={task.description} /> : <p className="text-sm text-subtle">{t('tasks.noDescription')}</p>}
          </AppCard>
          <AppCard title={t('demands.detail.timeline')}>{history.isPending ? <AppSkeleton className="h-24" /> : <TaskComments task={task} events={events} />}</AppCard>
        </div>
        <div className="flex flex-col gap-4">
          <AppCard title={t('demands.detail.properties')}>
            <dl>
              <Property label={t('demands.detail.requester')}>
                <Person person={task.reporter} empty="—" />
              </Property>
              <Property label={t('demands.detail.department')}>{task.area?.name ?? '—'}</Property>
              <Property label={t('demands.detail.owner')}>
                <Person person={demand.owner} empty="—" />
              </Property>
              <Property label={t('demands.detail.assignee')}>
                <Person person={task.assignee} empty={t('demands.detail.unassigned')} />
              </Property>
              <Property label={t('demands.detail.opened')}>
                <span className="inline-flex items-center gap-1" title={t('demands.detail.openedLocked')}>
                  <Lock className="size-3.5 text-muted" aria-hidden />
                  {formatShortDateTime(demand.openedAt, locale)}
                </span>
              </Property>
              <Property label={t('demands.detail.deadline')}>{demand.dueAt ? formatShortDateTime(demand.dueAt, locale) : '—'}</Property>
              <Property label={t('demands.detail.estimate')}>
                {task.estimatedHours ? t('demands.detail.hours', { hours: formatNumber(task.estimatedHours, locale) }) : '—'}
              </Property>
            </dl>
          </AppCard>
          <AppCard title={t('demands.detail.attachments')}>
            <TaskAttachments task={task} />
          </AppCard>
        </div>
      </div>

      <TaskFormDialog open={editing} onOpenChange={setEditing} task={task} />
      <AppConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('tasks.deleteTitle', { code: task.code })}
        description={t('tasks.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(task.id, {
            onSuccess: () => {
              notify.success(t('tasks.deleted', { code: task.code }))
              void navigate(back.to)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </>
  )
}
