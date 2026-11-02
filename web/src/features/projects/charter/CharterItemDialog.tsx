import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isAppError } from '@/core/errors/app-error'
import {
  CHARTER_LIMITS,
  FEATURE_STATES,
  MEASURE_FREQUENCIES,
  OBJECTIVE_STATES,
  itemsOf,
  type CharterItem,
  type CharterItemInput,
  type CharterKind,
  type ProjectCharter,
} from '@/domain/charter'
import type { ProjectMember } from '@/domain/projects'
import type { TaskSummary } from '@/domain/tasks'
import { AppButton, AppDatePicker, AppDialog, AppMultiSelect, AppSelect, AppTextField, AppTextarea, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCharterMutations } from './queries'

export type CharterDialogState = { mode: 'create'; kind: CharterKind } | { mode: 'edit'; item: CharterItem } | null

const NONE = 'none'

/** Criar ou editar um item da ficha; cada tipo mostra só os seus campos. */
export function CharterItemDialog(props: { projectId: string; charter: ProjectCharter; members: ProjectMember[]; tasks: TaskSummary[]; state: CharterDialogState; onClose: () => void }) {
  if (!props.state) return null
  return <CharterItemForm key={props.state.mode === 'edit' ? props.state.item.id : `new-${props.state.kind}`} {...props} state={props.state} />
}

const numberOrNull = (text: string) => {
  const value = Number(text.replace(',', '.'))
  return text.trim() === '' || !Number.isFinite(value) ? null : value
}

function CharterItemForm({
  projectId,
  charter,
  members,
  tasks,
  state,
  onClose,
}: {
  projectId: string
  charter: ProjectCharter
  members: ProjectMember[]
  tasks: TaskSummary[]
  state: Exclude<CharterDialogState, null>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { create, update } = useCharterMutations(projectId)
  const editing = state.mode === 'edit' ? state.item : null
  const kind: CharterKind = editing ? editing.kind : state.mode === 'create' ? state.kind : 'objective'
  const isScope = kind === 'scope_in' || kind === 'scope_out'

  const [scopeKind, setScopeKind] = useState<'scope_in' | 'scope_out'>(kind === 'scope_out' ? 'scope_out' : 'scope_in')
  const [title, setTitle] = useState(editing?.title ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [itemState, setItemState] = useState(editing && (editing.kind === 'objective' || editing.kind === 'feature') ? editing.state : 'auto')
  const [ownerId, setOwnerId] = useState(editing?.owner?.id ?? NONE)
  const [linkIds, setLinkIds] = useState<string[]>(editing?.kind === 'objective' ? editing.linkIds : [])
  const [taskIds, setTaskIds] = useState<string[]>(editing?.kind === 'feature' ? editing.taskIds : [])
  const result = editing?.kind === 'result' ? editing : null
  const [unit, setUnit] = useState(result?.unit ?? '')
  const [baseline, setBaseline] = useState(result ? String(result.baseline) : '0')
  const [target, setTarget] = useState(result ? String(result.target) : '')
  const [startDate, setStartDate] = useState(result?.startDate ?? '')
  const [dueDate, setDueDate] = useState(result?.dueDate ?? '')
  const [frequency, setFrequency] = useState<string>(result?.frequency ?? 'monthly')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const pending = create.isPending || update.isPending

  const ownerOptions = useMemo(
    () => [{ value: NONE, label: t('charter.fields.noOwner') }, ...members.filter((m) => m.user.status === 'active').map((m) => ({ value: m.user.id, label: m.user.name }))],
    [members, t],
  )
  const linkOptions = useMemo(
    () => [...itemsOf(charter, 'feature'), ...itemsOf(charter, 'result')].map((i) => ({ value: i.id, label: `${t(`charter.kinds.${i.kind}`)} · ${i.title}` })),
    [charter, t],
  )
  const taskOptions = useMemo(() => tasks.map((task) => ({ value: task.id, label: `${task.code} · ${task.title}` })), [tasks])
  const stateOptions = [
    { value: 'auto', label: t('charter.state.auto') },
    ...(kind === 'objective' ? OBJECTIVE_STATES.map((s) => ({ value: s, label: t(`charter.objectiveState.${s}`) })) : FEATURE_STATES.map((s) => ({ value: s, label: t(`charter.featureState.${s}`) }))),
  ]

  function submit() {
    const found: Record<string, string> = {}
    if (!title.trim()) found.title = 'required'
    const targetValue = numberOrNull(target)
    const baselineValue = numberOrNull(baseline)
    if (kind === 'result') {
      if (targetValue === null) found.target = target.trim() ? 'invalid_type' : 'required'
      if (baseline.trim() && baselineValue === null) found.baseline = 'invalid_type'
      if (startDate && dueDate && startDate > dueDate) found.start_date = 'after_due_date'
    }
    setErrors(found)
    if (Object.keys(found).length > 0) return

    const input: CharterItemInput = { title: title.trim(), description: description.trim() }
    if (!editing) input.kind = isScope ? scopeKind : kind
    if (kind === 'objective' || kind === 'feature') {
      input.state = itemState
      input.ownerId = ownerId === NONE ? null : ownerId
    }
    if (kind === 'objective') input.linkIds = linkIds
    if (kind === 'feature') input.taskIds = taskIds
    if (kind === 'result') {
      Object.assign(input, {
        ownerId: ownerId === NONE ? null : ownerId,
        unit: unit.trim(),
        baseline: baselineValue ?? 0,
        target: targetValue as number,
        startDate: startDate || null,
        dueDate: dueDate || null,
        frequency: frequency as CharterItemInput['frequency'],
      })
    }
    const onError = (error: unknown) => {
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') return setErrors(error.fieldErrors())
      notify.error(errorMessage(error))
    }
    const onSuccess = () => {
      notify.success(editing ? t('charter.updated', { title: input.title }) : t('charter.created', { title: input.title }))
      onClose()
    }
    if (editing) update.mutate({ id: editing.id, input }, { onSuccess, onError })
    else create.mutate(input, { onSuccess, onError })
  }

  const titleKey = isScope ? 'scope' : kind
  return (
    <AppDialog
      open
      onOpenChange={(open) => !open && !pending && onClose()}
      size={kind === 'result' || kind === 'feature' ? 'xl' : 'lg'}
      closeOnOutsideClick={false}
      title={t(editing ? `charter.dialog.edit.${titleKey}` : `charter.dialog.create.${titleKey}`)}
      description={t(`charter.dialog.hint.${titleKey}`)}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={pending}>
            {t('common.save')}
          </AppButton>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {isScope && !editing && (
          <AppSelect
            label={t('charter.fields.scopeKind')}
            value={scopeKind}
            onValueChange={(value) => setScopeKind(value === 'scope_out' ? 'scope_out' : 'scope_in')}
            options={[
              { value: 'scope_in', label: t('charter.kinds.scope_in') },
              { value: 'scope_out', label: t('charter.kinds.scope_out') },
            ]}
          />
        )}
        <AppTextField
          label={t(kind === 'result' ? 'charter.fields.indicator' : 'charter.fields.title')}
          required
          maxLength={CHARTER_LIMITS.title}
          autoComplete="off"
          value={title}
          error={errors.title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <AppTextarea label={t('charter.fields.description')} rows={2} maxLength={CHARTER_LIMITS.description} value={description} error={errors.description} onChange={(event) => setDescription(event.target.value)} />

        {(kind === 'objective' || kind === 'feature') && (
          <div className="grid gap-4 sm:grid-cols-2">
            <AppSelect label={t('charter.fields.state')} hint={t(`charter.state.autoHint.${kind}`)} value={itemState} onValueChange={(value) => setItemState(value as typeof itemState)} options={stateOptions} error={errors.state} />
            <AppSelect label={t('charter.fields.owner')} value={ownerId} onValueChange={setOwnerId} options={ownerOptions} error={errors.owner_id} />
          </div>
        )}
        {kind === 'objective' && (
          <AppMultiSelect label={t('charter.fields.links')} hint={t('charter.fields.linksHint')} value={linkIds} onValueChange={setLinkIds} options={linkOptions} error={errors.link_ids} placeholder={t('charter.fields.linksPlaceholder')} />
        )}
        {kind === 'feature' && (
          <AppMultiSelect label={t('charter.fields.tasks')} hint={t('charter.fields.tasksHint')} value={taskIds} onValueChange={setTaskIds} options={taskOptions} error={errors.task_ids} placeholder={t('charter.fields.tasksPlaceholder')} />
        )}
        {kind === 'result' && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <AppTextField label={t('charter.fields.baseline')} inputMode="decimal" value={baseline} error={errors.baseline} onChange={(event) => setBaseline(event.target.value)} />
              <AppTextField label={t('charter.fields.target')} required inputMode="decimal" value={target} error={errors.target} onChange={(event) => setTarget(event.target.value)} />
              <AppTextField label={t('charter.fields.unit')} placeholder={t('charter.fields.unitPlaceholder')} maxLength={CHARTER_LIMITS.unit} value={unit} error={errors.unit} onChange={(event) => setUnit(event.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <AppDatePicker label={t('charter.fields.startDate')} value={startDate} error={errors.start_date} onValueChange={setStartDate} />
              <AppDatePicker label={t('charter.fields.dueDate')} value={dueDate} error={errors.due_date} onValueChange={setDueDate} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <AppSelect
                label={t('charter.fields.frequency')}
                hint={t('charter.fields.frequencyHint')}
                value={frequency}
                onValueChange={setFrequency}
                options={MEASURE_FREQUENCIES.map((f) => ({ value: f, label: t(`charter.frequency.${f}`) }))}
              />
              <AppSelect label={t('charter.fields.owner')} hint={t('charter.fields.ownerHint')} value={ownerId} onValueChange={setOwnerId} options={ownerOptions} error={errors.owner_id} />
            </div>
          </>
        )}
      </form>
    </AppDialog>
  )
}

/** Objetivo geral (texto livre, até 2000 caracteres). */
export function ObjectiveDialog({ projectId, value, open, onClose }: { projectId: string; value: string; open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { saveObjective } = useCharterMutations(projectId)
  const [text, setText] = useState(value)
  const [error, setError] = useState<string | undefined>()
  if (!open) return null

  function submit() {
    if (!text.trim()) return setError('required')
    saveObjective.mutate(text.trim(), {
      onSuccess: () => {
        notify.success(t('charter.objectiveSaved'))
        onClose()
      },
      onError: (e) => (isAppError(e) && e.code === 'VALIDATION_ERROR' ? setError(e.fieldErrors().objective) : notify.error(errorMessage(e))),
    })
  }

  return (
    <AppDialog
      open
      onOpenChange={(next) => !next && !saveObjective.isPending && onClose()}
      size="lg"
      closeOnOutsideClick={false}
      title={t('charter.general.title')}
      description={t('charter.general.hint')}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={saveObjective.isPending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={saveObjective.isPending}>
            {t('common.save')}
          </AppButton>
        </>
      }
    >
      <AppTextarea label={t('charter.general.title')} required rows={5} maxLength={CHARTER_LIMITS.objective} value={text} error={error} onChange={(event) => setText(event.target.value)} />
    </AppDialog>
  )
}
