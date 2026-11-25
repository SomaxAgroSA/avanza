import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronRight, GitFork, Lock, Pencil, Trash2 } from 'lucide-react'
import { formatDay, formatNumber, formatShortDateTime } from '@/core/utils/format'
import { demandActionsFor } from '@/domain/demands'
import { relationCount } from '@/domain/relations'
import type { TaskDetail } from '@/domain/tasks'
import { isUrgency, NO_URGENCY } from '@/domain/urgency'
import type { OptionColor } from '@/domain/task-config'
import { statusChoices, type StatusCategory } from '@/domain/workflow'
import { AppAvatar, AppBadge, AppButton, AppCard, AppConfirmDialog, AppDrawer, AppMarkdown, AppSelect, AppSkeleton, notify, type AppSelectOption } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCan, useSession } from '@/features/auth/session'
import { CompanyChip } from '@/features/companies/company-visuals'
import { DemandActions } from '@/features/demands/DemandActions'
import { DemandStepBadge } from '@/features/demands/demand-visuals'
import { useDemandEvents } from '@/features/demands/demand-timeline'
import { useTaskDocs } from '@/features/docs/queries'
import { managementLink } from '@/features/plan/paths'
import { useProjectMembers } from '@/features/projects/queries'
import { TagList } from '@/features/tags/tag-visuals'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { usePriorities, useStatuses } from '@/features/workflow/queries'
import { ForkTaskDialog } from './ForkTaskDialog'
import { TaskAttachments } from './TaskAttachments'
import { TaskChecklist } from './TaskChecklist'
import { TaskComments } from './TaskComments'
import { TaskDocsPanel } from './TaskDocsPanel'
import { TaskFormDialog } from './TaskFormDialog'
import { TaskCustomValues } from './TaskProperties'
import { TaskRelationsPanel } from './TaskRelationsPanel'
import { UrgencyLight } from './TaskUrgency'
import { DueDate } from './task-visuals'
import { useTaskAttachments, useTaskHistory, useTaskMutations, useTaskRelations } from './queries'
import { useUrgencyChoices } from './urgency-choices'
import { useTaskQuickChange } from './use-task-quick-change'

/** Status ou prioridade (o que o selo e o seletor precisam). */
interface LookupOption {
  id: string
  name: string
  color: OptionColor
  category?: StatusCategory
}

/** De onde a pessoa veio (o "← Voltar a …"): Tarefas ou uma das caixas da Caixa de entrada. */
interface BackTarget {
  to: string
  place: 'tasks' | 'received' | 'assigned' | 'requested' | 'all'
}

function backTarget(state: unknown): BackTarget {
  const from = (state as { from?: Partial<BackTarget> } | null)?.from
  const places: BackTarget['place'][] = ['tasks', 'received', 'assigned', 'requested', 'all']
  if (from && typeof from.to === 'string' && from.to.startsWith('/tasks') && from.place && places.includes(from.place)) return { to: from.to, place: from.place }
  return { to: '/tasks', place: 'tasks' }
}

/** Painéis que abrem ao lado (as tarjetas compactas da direita); `?tab=` antigo abre o painel do mesmo nome. */
type Panel = 'attachments' | 'relations' | 'docs'
const PANELS: readonly Panel[] = ['attachments', 'relations', 'docs']

function Property({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2 text-sm last:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words text-fg">{children}</dd>
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
 * Página da tarefa no módulo Tarefas (`/tasks/:id`: Lista, Caixa de entrada e notificações) — desde o ajuste
 * 25/11 a mesma para a demanda interna (§45) e para a tarefa de projeto: "← Voltar a …"; código · projeto (ou
 * "Demanda interna") · tipo; título; os selos (passo do fluxo ou status, prioridade e urgência — com permissão de
 * editar, cada selo troca o valor como os campos rápidos) e os botões do papel da pessoa + Editar, Fork e Excluir.
 * À esquerda, Descrição, "Campos de <tipo>" (quando o tipo tem campos), Checklist (quando tem itens) e uma só
 * "Linha do tempo e comentários" (histórico e comentários juntos, com o campo de comentar e as menções); à
 * direita, Propriedades (só o que tem dado) e as tarjetas Anexos, Relações e Documentação, que abrem ao lado.
 * Dentro do projeto a tarefa continua abrindo como antes (TaskDetailView, na janela sobre o quadro).
 */
export function TaskSheetView({ task }: { task: TaskDetail }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const errorMessage = useErrorMessage()
  const me = useSession().current?.user.id
  const back = backTarget(location.state)
  const history = useTaskHistory(task.id)
  const events = useDemandEvents(history.data?.items ?? [])
  const { remove } = useTaskMutations()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [forking, setForking] = useState(false)
  const timelineId = useId()
  // `?tab=` (notificações, links antigos): comentários e histórico rolam até a linha do tempo; os outros abrem o painel
  const tab = params.get('tab')
  const [panel, setPanel] = useState<Panel | null>(() => (PANELS.includes(tab as Panel) ? (tab as Panel) : null))
  useEffect(() => {
    if (tab === 'comments' || tab === 'history') document.getElementById(timelineId)?.scrollIntoView?.({ block: 'start' })
  }, [tab, timelineId])
  const closePanel = () => {
    setPanel(null)
    if (tab) {
      const next = new URLSearchParams(params)
      next.delete('tab')
      setParams(next, { replace: true })
    }
  }

  const attachments = useTaskAttachments(task.id)
  const relations = useTaskRelations(task.id)
  const canDocs = useCan('docs.view')
  const taskDocs = useTaskDocs(canDocs ? task.id : undefined)
  const members = useProjectMembers(task.project?.id)
  const references = useMemo(
    () => ({
      people: (members.data ?? []).map((m) => ({ id: m.user.id, name: m.user.name })),
      attachments: (attachments.data ?? []).map((a) => ({ id: a.id, name: a.name, kind: a.kind, url: a.url })),
    }),
    [members.data, attachments.data],
  )
  const demand = task.demand ?? null
  const actions = demand ? (demand.actions ?? demandActionsFor(me, task)) : null
  const hasTypeFields = task.fields.some((link) => link.visible)
  const hours = (value: number | null) => (value ? t('demands.detail.hours', { hours: formatNumber(value, locale) }) : '—')
  const panels: Array<{ key: Panel; title: string; count: number }> = [
    { key: 'attachments', title: t('demands.detail.attachments'), count: attachments.data?.length ?? task.attachmentCount },
    { key: 'relations', title: t('demands.detail.relations'), count: relations.data ? relationCount(relations.data) : 0 },
    ...(canDocs ? [{ key: 'docs' as const, title: t('demands.detail.docs'), count: taskDocs.data?.length ?? 0 }] : []),
  ]
  const open = panels.find((p) => p.key === panel)

  return (
    <>
      <Link to={back.to} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {t('demands.detail.backTo', { place: t(`demands.detail.places.${back.place}`) })}
      </Link>

      <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted">{[task.code, task.project ? task.project.name : t('demands.chip'), task.type?.name].filter(Boolean).join(' · ')}</p>
          <h1 className="mt-1 mb-2.5 text-2xl font-semibold tracking-tight break-words text-fg">{task.title}</h1>
          <TaskChips task={task} />
          {(task.parent || task.forkedFrom) && (
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {task.parent && (
                <span>
                  {t('relations.subtaskOf')}{' '}
                  <Link to={`/tasks/${task.parent.id}`} className="font-medium text-fg hover:text-primary-text">
                    {task.parent.code} · {task.parent.title}
                  </Link>
                </span>
              )}
              {task.forkedFrom && (
                <span className="inline-flex items-center gap-1">
                  <GitFork className="size-3.5" aria-hidden />
                  {t('relations.forkOf')}{' '}
                  <Link to={`/tasks/${task.forkedFrom.id}`} className="font-medium text-fg hover:text-primary-text">
                    {task.forkedFrom.code}
                  </Link>
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions && <DemandActions task={task} actions={actions} size="md" />}
          {task.capabilities.edit && (
            <AppButton variant="secondary" leftIcon={<Pencil />} onClick={() => setEditing(true)}>
              {t('common.edit')}
            </AppButton>
          )}
          {task.capabilities.fork && (
            <AppButton variant="secondary" leftIcon={<GitFork />} onClick={() => setForking(true)}>
              {t('relations.fork')}
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
          {hasTypeFields && (
            <AppCard title={t('tasks.typeFields', { name: task.type?.name ?? '' })}>
              <TaskCustomValues task={task} references={references} />
            </AppCard>
          )}
          {task.checklist.length > 0 && (
            <AppCard title={t('checklist.title')}>
              <TaskChecklist task={task} />
            </AppCard>
          )}
          <AppCard id={timelineId} title={t('demands.detail.timeline')} className="scroll-mt-4">
            {history.isPending ? <AppSkeleton className="h-24" /> : <TaskComments task={task} events={events} />}
          </AppCard>
        </div>
        <div className="flex flex-col gap-4">
          <AppCard title={t('demands.detail.properties')}>
            <dl>
              {task.project && <Property label={t('tasks.fields.project')}>{task.project.name}</Property>}
              {task.area && <Property label={task.project ? t('tasks.fields.area') : t('demands.detail.department')}>{task.area.name}</Property>}
              <Property label={t('companies.field')}>
                <CompanyChip company={task.company} />
              </Property>
              {task.reporter && (
                <Property label={task.project ? t('tasks.fields.reporter') : t('demands.detail.requester')}>
                  <Person person={task.reporter} empty="—" />
                </Property>
              )}
              <Property label={t('demands.detail.owner')}>
                <Person person={demand ? demand.owner : task.assignee} empty={demand ? '—' : t('tasks.unassigned')} />
              </Property>
              {demand && (
                <Property label={t('demands.detail.assignee')}>
                  <Person person={task.assignee} empty={t('demands.detail.unassigned')} />
                </Property>
              )}
              {demand && !task.project && (
                <Property label={t('demands.detail.opened')}>
                  <span className="inline-flex items-center gap-1" title={t('demands.detail.openedLocked')}>
                    <Lock className="size-3.5 text-muted" aria-hidden />
                    {formatShortDateTime(demand.openedAt, locale)}
                  </span>
                </Property>
              )}
              {task.startDate && <Property label={t('tasks.fields.startDate')}>{formatDay(task.startDate, locale)}</Property>}
              <Property label={t('demands.detail.deadline')}>{demand ? (demand.dueAt ? formatShortDateTime(demand.dueAt, locale) : '—') : <DueDate task={task} />}</Property>
              <Property label={t('demands.detail.estimate')}>{hours(task.estimatedHours)}</Property>
              {!!task.actualHours && <Property label={t('tasks.fields.actualHours')}>{hours(task.actualHours)}</Property>}
              {task.sprint && (
                <Property label={t('tasks.fields.sprint')}>
                  {task.sprint.name}
                  {task.sprint.state === 'closed' && <span className="font-normal text-subtle"> · {t('sprints.states.closed')}</span>}
                </Property>
              )}
              {task.planItem && <PlanItemProperty task={task} />}
            </dl>
          </AppCard>
          {panels.map((item) => (
            <section key={item.key} aria-label={item.title} className="rounded-xl border border-border bg-surface shadow-card">
              <button
                type="button"
                onClick={() => setPanel(item.key)}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-5 py-3 text-left text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="font-semibold text-fg">
                  {item.title} <span className="font-normal text-muted tabular-nums">({item.count})</span>
                </span>
                <span className="inline-flex items-center gap-1 text-primary-text">
                  {t('demands.detail.open')}
                  <ChevronRight className="size-4" aria-hidden />
                </span>
              </button>
            </section>
          ))}
        </div>
      </div>

      <AppDrawer open={!!open} onOpenChange={(value) => !value && closePanel()} title={open ? `${open.title} (${open.count})` : ''} description={`${task.code} · ${task.title}`} size="lg">
        {panel === 'attachments' && <TaskAttachments task={task} />}
        {panel === 'relations' && <TaskRelationsPanel task={task} />}
        {panel === 'docs' && <TaskDocsPanel task={task} />}
      </AppDrawer>
      <TaskFormDialog open={editing} onOpenChange={setEditing} task={task} />
      <ForkTaskDialog task={task} open={forking} onOpenChange={setForking} />
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

/** Elemento da Gestão que a tarefa executa (link para quem vê a Gestão). */
function PlanItemProperty({ task }: { task: TaskDetail }) {
  const { t } = useTranslation()
  const canViewPlan = useCan('plan.view')
  if (!task.planItem) return null
  return (
    <Property label={t('tasks.planLink.label')}>
      {canViewPlan && task.project ? (
        <Link to={managementLink(task.project.id, { item: task.planItem.id })} title={t('tasks.planLink.open', { name: task.planItem.name })} className="hover:text-primary-text">
          {task.planItem.name}
        </Link>
      ) : (
        task.planItem.name
      )}
    </Property>
  )
}

/**
 * Selos do topo: o passo do fluxo por extenso (com quem recebe e distribui; muda pelos botões) ou o status, a
 * prioridade e a urgência. Com permissão de editar, o status (só as transições permitidas), a prioridade e a
 * urgência trocam no próprio selo, com a mensagem e o "desfazer" (como os campos rápidos). Também o bloqueio e as
 * etiquetas.
 */
function TaskChips({ task }: { task: TaskDetail }) {
  const { t } = useTranslation()
  const statuses = useStatuses(false)
  const priorities = usePriorities(false)
  const urgencyChoices = useUrgencyChoices()
  const { change, changeUrgency, busy, dialog } = useTaskQuickChange(task)
  const editable = task.capabilities.edit
  // a lista com o valor atual (mesmo inativo ou fora das transições permitidas), cada opção no seu selo
  const lookupOptions = (list: readonly LookupOption[], current: LookupOption): AppSelectOption[] =>
    [...list, ...(list.some((x) => x.id === current.id) ? [] : [current])].map((item) => ({ value: item.id, label: <LookupBadge item={item} />, textValue: item.name }))
  const urgencyName = task.urgency ? t('demands.detail.urgency', { name: t(`tasks.urgency.${task.urgency}`) }) : t('tasks.urgency.none')
  const urgencyChip = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-fg">
      <UrgencyLight urgency={task.urgency} />
      {urgencyName}
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-2">
      {task.demand ? (
        <DemandStepBadge status={task.demand.status} assignee={task.assignee} />
      ) : (
        task.status && (
          <ChipSelect
            label={t('tasks.fields.status')}
            editable={editable}
            busy={busy}
            value={task.status.id}
            display={<LookupBadge item={task.status} />}
            onChange={(statusId) => statusId !== task.status?.id && change({ statusId }, { statusId: task.status?.id })}
            options={lookupOptions(statusChoices(statuses.data ?? [], task.status.id), task.status)}
          />
        )
      )}
      {task.priority && (
        <ChipSelect
          label={t('tasks.fields.priority')}
          editable={editable}
          busy={busy}
          value={task.priority.id}
          display={<LookupBadge item={{ ...task.priority, name: t('demands.detail.priority', { name: task.priority.name }) }} />}
          onChange={(priorityId) => priorityId !== task.priority?.id && change({ priorityId }, { priorityId: task.priority?.id })}
          options={lookupOptions(priorities.data ?? [], task.priority)}
        />
      )}
      <ChipSelect
        label={t('tasks.fields.urgency')}
        editable={editable}
        busy={busy}
        value={task.urgency ?? NO_URGENCY}
        display={urgencyChip}
        onChange={(value) => {
          const next = isUrgency(value) ? value : null
          if (next !== task.urgency) changeUrgency(next, task.urgency)
        }}
        options={urgencyChoices}
      />
      {task.blocked && (
        <AppBadge tone="danger" title={t('relations.blockedHint')}>
          <Lock aria-hidden /> {t('relations.blocked')}
        </AppBadge>
      )}
      <TagList tags={task.tags} max={8} />
      {dialog}
    </div>
  )
}

/** Selo que vira seletor para quem pode editar (o gatilho tem a cara do selo); sem permissão, só o selo. */
function ChipSelect({
  label,
  editable,
  busy,
  value,
  display,
  options,
  onChange,
}: {
  label: string
  editable: boolean
  busy: boolean
  value: string
  display: ReactNode
  options: AppSelectOption[]
  onChange: (value: string) => void
}) {
  if (!editable) return <>{display}</>
  return (
    <AppSelect
      size="sm"
      aria-label={label}
      value={value}
      disabled={busy}
      onValueChange={onChange}
      options={options}
      renderValue={display}
      className="w-auto"
      triggerClassName="h-auto w-auto gap-0.5 rounded-full border-0 bg-transparent px-0 shadow-none hover:bg-surface-2"
    />
  )
}
