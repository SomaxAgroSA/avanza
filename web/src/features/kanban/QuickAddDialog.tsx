import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isAppError } from '@/core/errors/app-error'
import { safeStorage } from '@/core/storage/safe-storage'
import { isRequiredOnCreate } from '@/domain/task-config'
import type { TaskDetail } from '@/domain/tasks'
import { AppButton, AppDialog, AppSelect, AppTextField, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCan } from '@/features/auth/session'
import { useProjectMembers } from '@/features/projects/queries'
import { TaskTypeIconBadge } from '@/features/task-config/config-visuals'
import { useTaskType, useTaskTypes } from '@/features/task-config/queries'
import { usePriorities } from '@/features/workflow/queries'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { useTaskMutations } from '@/features/tasks/queries'
import type { TaskFormInitial } from '@/features/tasks/TaskFormDialog'

const LAST_TYPE_KEY = 'kamban.kanban.type'
const NONE = '__none__'

export interface QuickAddDialogProps {
  /** Coluna onde a tarefa nasce; null = fechado. */
  statusId: string | null
  statusName?: string
  /** Sprint onde a tarefa nasce (backlog). */
  sprintId?: string
  sprintName?: string
  projectId: string
  onOpenChange: (open: boolean) => void
  /** Campos obrigatórios do tipo: segue no formulário completo com o que já foi digitado. */
  onContinue: (initial: TaskFormInitial) => void
  onCreated?: (task: TaskDetail) => void
}

/** Remonta a cada abertura (rascunho novo). */
export function QuickAddDialog(props: QuickAddDialogProps) {
  return props.statusId ? <QuickAddForm key={props.statusId} {...props} statusId={props.statusId} /> : null
}

function QuickAddForm({ statusId, statusName, sprintId, sprintName, projectId, onOpenChange, onContinue, onCreated }: QuickAddDialogProps & { statusId: string }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const canAssign = useCan('tasks.assign')
  const { create } = useTaskMutations()
  const types = useTaskTypes(false)
  const priorities = usePriorities(false)
  const members = useProjectMembers(projectId)

  const [title, setTitle] = useState('')
  const [typeId, setTypeId] = useState(() => safeStorage.get(LAST_TYPE_KEY) ?? '')
  const [priorityId, setPriorityId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // tipo lembrado que deixou de existir/ficou inativo: cai no primeiro da lista
  const typeList = types.data ?? []
  if (types.data && typeList.length > 0 && !typeList.some((x) => x.id === typeId)) setTypeId(typeList[0]?.id ?? '')
  if (!priorityId && priorities.data) {
    const def = priorities.data.find((p) => p.isDefault)
    if (def) setPriorityId(def.id)
  }

  const typeDetail = useTaskType(typeId || undefined)
  // obrigatórios do status da coluna (sempre + exigidos nele) sem valor padrão levam ao formulário completo
  const needsFullForm = (typeDetail.data?.fields ?? []).some((link) => isRequiredOnCreate(link, statusId) && link.field.defaultValue === null)
  const assignable = (members.data ?? []).filter((m) => m.user.status === 'active' && (m.role !== 'viewer' || m.isOwner))
  const initial = (): TaskFormInitial => ({ title: title.trim(), typeId, statusId, priorityId, assigneeId, sprintId })

  function submit() {
    const found: Record<string, string> = {}
    if (!title.trim()) found.title = 'required'
    if (!typeId) found.task_type_id = 'required'
    setErrors(found)
    if (Object.keys(found).length > 0) return
    safeStorage.set(LAST_TYPE_KEY, typeId)
    if (needsFullForm) return onContinue(initial())

    create.mutate(
      { projectId, taskTypeId: typeId, title: title.trim(), statusId, priorityId: priorityId || undefined, assigneeId: assigneeId || undefined, sprintId },
      {
        onSuccess: (task) => {
          notify.success(t('tasks.created', { code: task.code }))
          onCreated?.(task)
          onOpenChange(false)
        },
        onError: (error) => {
          if (isAppError(error) && error.code === 'VALIDATION_ERROR') {
            const fields = error.fieldErrors()
            // obrigatório do tipo que o navegador não conhecia: termina no formulário completo
            if (Object.keys(fields).some((key) => key.startsWith('custom_values.'))) {
              notify.info(t('kanban.quickAdd.needsFullForm'))
              return onContinue(initial())
            }
            setErrors(fields)
            return
          }
          notify.error(errorMessage(error))
        },
      },
    )
  }

  return (
    <AppDialog
      open
      onOpenChange={onOpenChange}
      title={t('kanban.quickAdd.title')}
      description={statusName ? (sprintName ? t('kanban.quickAdd.descriptionSprint', { name: statusName, sprint: sprintName }) : t('kanban.quickAdd.description', { name: statusName })) : undefined}
      footer={
        <>
          <AppButton variant="ghost" onClick={() => onContinue(initial())} disabled={create.isPending} className="sm:mr-auto">
            {t('kanban.quickAdd.fullForm')}
          </AppButton>
          <AppButton variant="secondary" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={create.isPending}>
            {needsFullForm ? t('kanban.quickAdd.continue') : t('tasks.create')}
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
        <AppTextField
          label={t('tasks.fields.title')}
          required
          autoComplete="off"
          maxLength={200}
          value={title}
          error={errors.title}
          placeholder={t('tasks.titlePlaceholder')}
          onChange={(event) => setTitle(event.target.value)}
        />
        <AppSelect
          label={t('tasks.fields.type')}
          required
          value={typeId || undefined}
          placeholder={t('fields.selectPlaceholder')}
          error={errors.task_type_id}
          hint={needsFullForm ? t('kanban.quickAdd.requiredFieldsHint') : undefined}
          onValueChange={setTypeId}
          options={typeList.map((type) => ({
            value: type.id,
            label: (
              <span className="inline-flex items-center gap-2">
                <TaskTypeIconBadge icon={type.icon} color={type.color} size="sm" />
                {type.name}
              </span>
            ),
          }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <AppSelect
            label={t('tasks.fields.assignee')}
            value={assigneeId || NONE}
            error={errors.assignee_id}
            disabled={!canAssign}
            onValueChange={(value) => setAssigneeId(value === NONE ? '' : value)}
            options={[{ value: NONE, label: t('tasks.unassigned') }, ...assignable.map((m) => ({ value: m.user.id, label: m.user.name }))]}
          />
          <AppSelect
            label={t('tasks.fields.priority')}
            value={priorityId || undefined}
            error={errors.priority_id}
            onValueChange={setPriorityId}
            options={(priorities.data ?? []).map((p) => ({ value: p.id, label: <LookupBadge item={p} /> }))}
          />
        </div>
        {/* Enter no título envia */}
        <button type="submit" hidden />
      </form>
    </AppDialog>
  )
}
