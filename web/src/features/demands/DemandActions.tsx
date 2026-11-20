import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheckBig, Play, Repeat, Undo2, UserPlus } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { deadlineToIso, isoToDeadline, type DemandActions as Actions } from '@/domain/demands'
import { parseHours, type TaskSummary } from '@/domain/tasks'
import { AppAvatar, AppButton, AppDatePicker, AppDialog, AppSelect, AppTextField, AppTextarea, AppTimeField, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useDemandMutations, useDemandTeam } from './queries'

type Dialog = 'assign' | 'pass' | 'conclude' | 'return' | null

export interface DemandActionsProps {
  task: TaskSummary
  /** O que a pessoa pode fazer (do detalhe ou de demandActionsFor nas caixas). */
  actions: Actions
  /** `sm` nas linhas das caixas; `md` na página da demanda. */
  size?: 'sm' | 'md'
}

/**
 * Botões do fluxo da demanda (§45) conforme o papel e o passo, com os diálogos: Atribuir/Reatribuir (equipe,
 * prazo com data e hora, estimativa), Começar, Passar a… (comentário obrigatório), Concluir (o que foi
 * entregue, obrigatório), Validar e Devolver (comentário obrigatório).
 */
export function DemandActions({ task, actions, size = 'sm' }: DemandActionsProps) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const mutations = useDemandMutations()
  const [dialog, setDialog] = useState<Dialog>(null)
  const unassigned = task.demand?.status === 'unassigned'
  const fail = (error: unknown) => notify.error(errorMessage(error))

  return (
    <>
      <span className="inline-flex flex-wrap items-center justify-end gap-2">
        {actions.assign && (
          <AppButton size={size} variant={unassigned ? 'primary' : 'secondary'} leftIcon={<UserPlus />} onClick={() => setDialog('assign')}>
            {unassigned ? t('demands.actions.assign') : t('demands.actions.reassign')}
          </AppButton>
        )}
        {actions.start && (
          <AppButton
            size={size}
            variant="secondary"
            leftIcon={<Play />}
            loading={mutations.start.isPending}
            onClick={() => mutations.start.mutate(task.id, { onSuccess: (saved) => notify.success(t('demands.started', { code: saved.code })), onError: fail })}
          >
            {t('demands.actions.start')}
          </AppButton>
        )}
        {actions.pass && (
          <AppButton size={size} variant="secondary" leftIcon={<Repeat />} onClick={() => setDialog('pass')}>
            {t('demands.actions.pass')}
          </AppButton>
        )}
        {actions.conclude && (
          <AppButton size={size} leftIcon={<CircleCheckBig />} onClick={() => setDialog('conclude')}>
            {t('demands.actions.conclude')}
          </AppButton>
        )}
        {actions.return && (
          <AppButton size={size} variant="secondary" leftIcon={<Undo2 />} onClick={() => setDialog('return')}>
            {t('demands.actions.return')}
          </AppButton>
        )}
        {actions.validate && (
          <AppButton
            size={size}
            leftIcon={<CircleCheckBig />}
            loading={mutations.validate.isPending}
            onClick={() => mutations.validate.mutate(task.id, { onSuccess: (saved) => notify.success(t('demands.validated', { code: saved.code })), onError: fail })}
          >
            {t('demands.actions.validate')}
          </AppButton>
        )}
      </span>
      {dialog === 'assign' && <AssignDialog task={task} onClose={() => setDialog(null)} />}
      {dialog === 'pass' && <PassDialog task={task} onClose={() => setDialog(null)} />}
      {(dialog === 'conclude' || dialog === 'return') && <NoteDialog task={task} kind={dialog} onClose={() => setDialog(null)} />}
    </>
  )
}

/** Pessoa na lista com busca: rótulo em texto e a foto à esquerda. */
function personOption(person: { id: string; name: string; avatarUrl: string | null }) {
  return { value: person.id, label: person.name, prefix: <AppAvatar name={person.name} src={person.avatarUrl} size="xs" /> }
}

/** Responsável atribui ou reatribui: alguém da equipe, prazo (data e hora, obrigatório) e estimativa (h). */
function AssignDialog({ task, onClose }: { task: TaskSummary; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { assign } = useDemandMutations()
  const team = useDemandTeam(task.id)
  const initial = isoToDeadline(task.demand?.dueAt)
  const [assigneeId, setAssigneeId] = useState(task.assignee?.id ?? '')
  const [day, setDay] = useState(initial.day)
  const [time, setTime] = useState(initial.time)
  const [hours, setHours] = useState(task.estimatedHours === null ? '' : String(task.estimatedHours))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const reassign = !!task.assignee

  function submit() {
    const found: Record<string, string> = {}
    if (!assigneeId) found.assignee_id = 'required'
    if (!day) found.due_date = 'required'
    if (!time) found.due_time = 'required'
    const dueAt = day && time ? deadlineToIso(day, time) : null
    if (day && time && !dueAt) found.due_date = 'invalid_date'
    const estimate = parseHours(hours)
    if (Number.isNaN(estimate) || (estimate !== null && estimate <= 0)) found.estimated_hours = 'too_small'
    if (Object.keys(found).length > 0 || !dueAt) return setErrors(found)
    assign.mutate(
      { id: task.id, input: { assigneeId, dueAt, estimatedHours: estimate } },
      {
        onSuccess: (saved) => {
          notify.success(t('demands.assign.done', { code: saved.code, name: saved.assignee?.name ?? '' }))
          onClose()
        },
        onError: (error) => {
          if (isAppError(error) && error.code === 'VALIDATION_ERROR') {
            const fields = error.fieldErrors()
            setErrors({ ...fields, ...(fields.due_at ? { due_date: fields.due_at } : {}) })
          } else notify.error(errorMessage(error))
        },
      },
    )
  }

  return (
    <AppDialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="md"
      title={reassign ? t('demands.assign.reassignTitle', { code: task.code }) : t('demands.assign.title', { code: task.code })}
      description={task.title}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={assign.isPending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={assign.isPending}>
            {t('demands.assign.submit')}
          </AppButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <AppSelect
          label={t('demands.assign.assignee')}
          required
          searchable
          value={assigneeId || undefined}
          placeholder={t('fields.selectPlaceholder')}
          error={errors.assignee_id}
          onValueChange={(value) => {
            setAssigneeId(value)
            setErrors((e) => ({ ...e, assignee_id: '' }))
          }}
          options={(team.data ?? []).map(personOption)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <AppDatePicker
            label={t('demands.assign.dueDate')}
            required
            value={day}
            clearable={false}
            error={errors.due_date}
            onValueChange={(value) => {
              setDay(value)
              setErrors((e) => ({ ...e, due_date: '' }))
            }}
          />
          <AppTimeField
            label={t('demands.assign.dueTime')}
            required
            value={time}
            error={errors.due_time}
            onValueChange={(value) => {
              setTime(value)
              setErrors((e) => ({ ...e, due_time: '' }))
            }}
          />
        </div>
        <AppTextField
          label={t('demands.assign.estimate')}
          inputMode="decimal"
          autoComplete="off"
          value={hours}
          error={errors.estimated_hours}
          onChange={(event) => {
            setHours(event.target.value)
            setErrors((e) => ({ ...e, estimated_hours: '' }))
          }}
        />
      </div>
    </AppDialog>
  )
}

/** Quem executa passa a outra pessoa da equipe do responsável, com comentário obrigatório. */
function PassDialog({ task, onClose }: { task: TaskSummary; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { pass } = useDemandMutations()
  const team = useDemandTeam(task.id)
  const [assigneeId, setAssigneeId] = useState('')
  const [comment, setComment] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const owner = task.demand?.owner?.name ?? ''

  function submit() {
    const found: Record<string, string> = {}
    if (!assigneeId) found.assignee_id = 'required'
    if (!comment.trim()) found.comment = 'required'
    if (Object.keys(found).length > 0) return setErrors(found)
    pass.mutate(
      { id: task.id, assigneeId, comment: comment.trim() },
      {
        onSuccess: (saved) => {
          notify.success(t('demands.pass.done', { code: saved.code, name: saved.assignee?.name ?? '' }))
          onClose()
        },
        onError: (error) => (isAppError(error) && error.code === 'VALIDATION_ERROR' ? setErrors(error.fieldErrors()) : notify.error(errorMessage(error))),
      },
    )
  }

  return (
    <AppDialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="md"
      title={t('demands.pass.title', { code: task.code })}
      description={task.title}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={pass.isPending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={pass.isPending}>
            {t('demands.pass.submit')}
          </AppButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <AppSelect
          label={t('demands.pass.to')}
          required
          searchable
          value={assigneeId || undefined}
          placeholder={t('fields.selectPlaceholder')}
          hint={t('demands.pass.toHint', { owner })}
          error={errors.assignee_id}
          onValueChange={(value) => {
            setAssigneeId(value)
            setErrors((e) => ({ ...e, assignee_id: '' }))
          }}
          options={(team.data ?? []).filter((person) => person.id !== task.assignee?.id).map(personOption)}
        />
        <AppTextarea
          label={t('demands.pass.comment')}
          required
          rows={4}
          maxLength={5000}
          value={comment}
          error={errors.comment}
          placeholder={t('demands.pass.placeholder')}
          hint={t('demands.pass.note', { owner })}
          onChange={(event) => {
            setComment(event.target.value)
            setErrors((e) => ({ ...e, comment: '' }))
          }}
        />
      </div>
    </AppDialog>
  )
}

/** Concluir (o que foi entregue) ou Devolver (o que falta): comentário obrigatório. */
function NoteDialog({ task, kind, onClose }: { task: TaskSummary; kind: 'conclude' | 'return'; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { conclude, returnDemand } = useDemandMutations()
  const mutation = kind === 'conclude' ? conclude : returnDemand
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | undefined>()
  const names = { requester: task.reporter?.name ?? '', owner: task.demand?.owner?.name ?? '', name: task.assignee?.name ?? '' }

  function submit() {
    if (!comment.trim()) return setError('required')
    mutation.mutate(
      { id: task.id, comment: comment.trim() },
      {
        onSuccess: (saved) => {
          notify.success(t(`demands.${kind}.done`, { code: saved.code, name: saved.assignee?.name ?? '' }))
          onClose()
        },
        onError: (err) => (isAppError(err) && err.code === 'VALIDATION_ERROR' ? setError(err.fieldErrors().comment ?? 'invalid_value') : notify.error(errorMessage(err))),
      },
    )
  }

  return (
    <AppDialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="md"
      title={t(`demands.${kind}.title`, { code: task.code })}
      description={task.title}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={mutation.isPending}>
            {t(`demands.${kind}.submit`)}
          </AppButton>
        </>
      }
    >
      <AppTextarea
        label={kind === 'conclude' ? t('demands.conclude.delivered') : t('demands.return.comment')}
        required
        rows={5}
        maxLength={5000}
        value={comment}
        error={error}
        placeholder={t(`demands.${kind}.placeholder`)}
        hint={t(`demands.${kind}.note`, names)}
        onChange={(event) => {
          setComment(event.target.value)
          setError(undefined)
        }}
      />
    </AppDialog>
  )
}
