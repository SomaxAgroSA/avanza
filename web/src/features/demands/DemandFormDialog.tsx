import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatShortDateTime } from '@/core/utils/format'
import type { TaskDetail } from '@/domain/tasks'
import { AppAvatar, AppButton, AppDialog, AppFormField, AppSelect, AppTextField, AppTextarea, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { TaskTypeIconBadge } from '@/features/task-config/config-visuals'
import { useTaskTypes } from '@/features/task-config/queries'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { useAreas, usePriorities } from '@/features/workflow/queries'
import { useTaskMutations } from '@/features/tasks/queries'
import { useDemandMutations, useDemandOwners } from './queries'

export interface DemandFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Demanda em edição; ausente = nova. */
  task?: TaskDetail | null
  /** Acima do formulário (os botões "Tarefa de projeto · Demanda interna" da criação). */
  header?: ReactNode
  /** Título e descrição da janela (a criação usa os de "Nova tarefa"). */
  title?: ReactNode
  description?: ReactNode
  onSaved?: (task: TaskDetail) => void
}

interface Draft {
  typeId: string
  title: string
  description: string
  ownerId: string
  areaId: string
  priorityId: string
}

/** Valor fixo (abertura, prazo, responsável na edição): com cadeado, sem campo. */
function LockedValue({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <AppFormField label={label}>
      {() => (
        <div className="flex min-h-9 items-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-2 px-3 py-2 text-sm text-muted">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">{children}</span>
        </div>
      )}
    </AppFormField>
  )
}

/** Remonta a cada abertura (rascunho novo). */
export function DemandFormDialog(props: DemandFormDialogProps) {
  const key = props.open ? (props.task?.id ?? 'new') : 'closed'
  return <DemandForm key={key} {...props} />
}

/**
 * Demanda interna (§45): o formulário curto. Esquerda: Tipo, Título e Descrição; direita: Responsável
 * (qualquer pessoa ativa; quem recebe e distribui), Departamento que pede, Prioridade, Abertura (automática,
 * travada) e Prazo (quem define é o responsável ao atribuir). Na edição o responsável fica fixo.
 */
function DemandForm({ open, onOpenChange, task, header, title, description, onSaved }: DemandFormDialogProps) {
  const { t, i18n } = useTranslation()
  const errorMessage = useErrorMessage()
  const isEdit = !!task
  const { create } = useDemandMutations()
  const { update } = useTaskMutations()
  const [draft, setDraft] = useState<Draft>(() => ({
    typeId: task?.type?.id ?? '',
    title: task?.title ?? '',
    description: task?.description ?? '',
    ownerId: task?.demand?.owner?.id ?? '',
    areaId: task?.area?.id ?? '',
    priorityId: task?.priority?.id ?? '',
  }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [openedAt] = useState(() => new Date())
  const types = useTaskTypes(false)
  const priorities = usePriorities(false)
  const areas = useAreas(false)
  const owners = useDemandOwners(open && !isEdit)
  const pending = create.isPending || update.isPending

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setErrors((e) => ({ ...e, [fieldOf(key)]: '' }))
  }

  const typeOptions = [...(types.data ?? []), ...(task?.type && !(types.data ?? []).some((x) => x.id === task.type?.id) ? [task.type] : [])].map((type) => ({
    value: type.id,
    label: (
      <span className="inline-flex items-center gap-2">
        <TaskTypeIconBadge icon={type.icon} color={type.color} size="sm" />
        {type.name}
      </span>
    ),
  }))
  const priorityOptions = (priorities.data ?? []).map((item) => ({ value: item.id, label: <LookupBadge item={item} /> }))
  const areaOptions = [...(areas.data ?? []), ...(task?.area && !(areas.data ?? []).some((a) => a.id === task.area?.id) ? [task.area] : [])].map((area) => ({ value: area.id, label: area.name }))
  // lista com busca: rótulo em texto e a foto à esquerda
  const ownerOptions = (owners.data ?? []).map((person) => ({ value: person.id, label: person.name, prefix: <AppAvatar name={person.name} src={person.avatarUrl} size="xs" /> }))

  function submit() {
    const found: Record<string, string> = {}
    if (!draft.typeId) found.task_type_id = 'required'
    if (!draft.title.trim()) found.title = 'required'
    if (!isEdit && !draft.ownerId) found.demand_owner_id = 'required'
    if (!draft.areaId) found.area_id = 'required'
    if (Object.keys(found).length > 0) return setErrors(found)
    const onError = (error: unknown) => {
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') setErrors(error.fieldErrors())
      else notify.error(errorMessage(error))
    }
    if (isEdit && task) {
      update.mutate(
        {
          id: task.id,
          data: { taskTypeId: draft.typeId, title: draft.title.trim(), description: draft.description, areaId: draft.areaId, ...(draft.priorityId ? { priorityId: draft.priorityId } : {}) },
        },
        {
          onSuccess: (saved) => {
            notify.success(t('demands.saved', { code: saved.code }))
            onOpenChange(false)
            onSaved?.(saved)
          },
          onError,
        },
      )
      return
    }
    create.mutate(
      { taskTypeId: draft.typeId, title: draft.title.trim(), description: draft.description, ownerId: draft.ownerId, areaId: draft.areaId, ...(draft.priorityId ? { priorityId: draft.priorityId } : {}) },
      {
        onSuccess: (saved) => {
          notify.success(t('demands.created', { code: saved.code, owner: saved.demand?.owner?.name ?? '' }))
          onOpenChange(false)
          onSaved?.(saved)
        },
        onError,
      },
    )
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="2xl"
      closeOnOutsideClick={false}
      title={title ?? (isEdit ? t('demands.form.editTitle', { code: task?.code }) : t('demands.form.createTitle'))}
      description={description ?? (isEdit ? task?.title : t('demands.form.createDescription'))}
      footer={
        <>
          <AppButton variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={pending}>
            {isEdit ? t('common.save') : t('demands.form.submit')}
          </AppButton>
        </>
      }
    >
      {header}
      <form
        noValidate
        aria-label={t('demands.newDemand')}
        className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_20rem]"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="flex min-w-0 flex-col gap-5">
          <AppSelect
            label={t('tasks.fields.type')}
            required
            value={draft.typeId || undefined}
            placeholder={t('fields.selectPlaceholder')}
            error={errors.task_type_id}
            onValueChange={(value) => set('typeId', value)}
            options={typeOptions}
          />
          <AppTextField
            label={t('tasks.fields.title')}
            required
            autoComplete="off"
            maxLength={200}
            value={draft.title}
            error={errors.title}
            placeholder={t('demands.form.titlePlaceholder')}
            onChange={(event) => set('title', event.target.value)}
          />
          <AppTextarea
            label={t('tasks.fields.description')}
            rows={6}
            maxLength={50000}
            value={draft.description}
            error={errors.description}
            placeholder={t('demands.form.descriptionPlaceholder')}
            hint={t('tasks.markdownHint')}
            onChange={(event) => set('description', event.target.value)}
          />
        </div>
        <aside aria-label={t('tasks.properties')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:border-l lg:border-border lg:pl-8">
          {isEdit ? (
            <LockedValue label={t('demands.form.owner')}>
              <span title={t('demands.form.ownerFixed')}>{task?.demand?.owner?.name ?? '—'}</span>
            </LockedValue>
          ) : (
            <AppSelect
              label={t('demands.form.owner')}
              required
              searchable
              value={draft.ownerId || undefined}
              placeholder={t('fields.selectPlaceholder')}
              error={errors.demand_owner_id}
              hint={t('demands.form.ownerHint')}
              onValueChange={(value) => set('ownerId', value)}
              options={ownerOptions}
            />
          )}
          <AppSelect
            label={t('demands.form.department')}
            required
            searchable
            value={draft.areaId || undefined}
            placeholder={t('fields.selectPlaceholder')}
            error={errors.area_id}
            onValueChange={(value) => set('areaId', value)}
            options={areaOptions}
          />
          <AppSelect
            label={t('tasks.fields.priority')}
            value={draft.priorityId || (priorities.data ?? []).find((p) => p.isDefault)?.id}
            error={errors.priority_id}
            onValueChange={(value) => set('priorityId', value)}
            options={priorityOptions}
          />
          <LockedValue label={t('demands.form.opening')}>
            {t('demands.form.openingAuto', { date: formatShortDateTime(task?.demand?.openedAt ?? openedAt, i18n.language) })}
          </LockedValue>
          <LockedValue label={t('demands.form.deadline')}>
            {task?.demand?.dueAt ? formatShortDateTime(task.demand.dueAt, i18n.language) : t('demands.form.deadlineLocked')}
          </LockedValue>
        </aside>
      </form>
    </AppDialog>
  )
}

/** Campo do rascunho → nome do campo na API (erros). */
function fieldOf(key: keyof Draft): string {
  return { typeId: 'task_type_id', title: 'title', description: 'description', ownerId: 'demand_owner_id', areaId: 'area_id', priorityId: 'priority_id' }[key]
}
