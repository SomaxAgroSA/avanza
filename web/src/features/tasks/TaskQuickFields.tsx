import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import type { OptionColor } from '@/domain/task-config'
import type { TaskDetail, TaskInput } from '@/domain/tasks'
import { statusChoices, type StatusCategory } from '@/domain/workflow'
import { AppSelect, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useProjectMembers } from '@/features/projects/queries'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { usePriorities, useStatuses } from '@/features/workflow/queries'
import { useTaskMutations } from './queries'
import { RequiredFieldsDialog, type RequiredFieldsRequest } from './RequiredFieldsDialog'
import { missingForStatus } from './required-fields'

const NONE = '__none__'

interface LookupOption {
  id: string
  name: string
  color: OptionColor
  category?: StatusCategory
}

const withCurrent = <T extends { id: string }>(list: readonly T[], current: T | null): T[] =>
  current && !list.some((x) => x.id === current.id) ? [...list, current] : [...list]

/**
 * Troca rápida de status, prioridade e responsável (página da tarefa e painel do Kanban),
 * com mensagem e "desfazer". O status lista só as transições permitidas a partir do atual.
 */
export function TaskQuickFields({ task, className }: { task: TaskDetail; className?: string }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { update } = useTaskMutations()
  const statuses = useStatuses(false)
  const priorities = usePriorities(false)
  // a lista de pessoas só serve para trocar o responsável (o Responsável TI não reatribui nem vê os membros)
  const members = useProjectMembers(task.capabilities.assign ? task.project?.id : undefined)
  const assignable = (members.data ?? []).filter((m) => m.user.status === 'active' && (m.role !== 'viewer' || m.isOwner))

  const [required, setRequired] = useState<RequiredFieldsRequest | null>(null)

  function quickChange(data: TaskInput, undo: TaskInput) {
    update.mutate(
      { id: task.id, data },
      {
        onSuccess: (saved) =>
          notify.success(t('tasks.updated', { code: saved.code }), {
            undo: { label: t('common.undo'), onClick: () => update.mutate({ id: task.id, data: undo }, { onError: (error) => notify.error(errorMessage(error)) }) },
          }),
        onError: (error) => {
          // o novo status exige campos vazios: abre o preenchimento e aplica a troca em seguida
          const missing = missingForStatus(error)
          const target = statuses.data?.find((s) => s.id === data.statusId)
          if (missing && data.statusId && target) {
            setRequired({
              taskId: task.id,
              code: task.code,
              status: missing.status ?? { id: target.id, name: target.name },
              fieldNames: missing.fieldNames,
              retry: () => update.mutateAsync({ id: task.id, data: { statusId: data.statusId } }),
            })
            return
          }
          notify.error(errorMessage(error))
        },
      },
    )
  }

  return (
    <div className={cn('grid gap-3 sm:grid-cols-3', className)}>
      <AppSelect
        size="sm"
        label={t('tasks.fields.status')}
        value={task.status?.id}
        disabled={!task.capabilities.edit || update.isPending}
        onValueChange={(statusId) => quickChange({ statusId }, { statusId: task.status?.id })}
        options={withCurrent<LookupOption>(statusChoices(statuses.data ?? [], task.status?.id), task.status).map((s) => ({ value: s.id, label: <LookupBadge item={s} /> }))}
      />
      <AppSelect
        size="sm"
        label={t('tasks.fields.priority')}
        value={task.priority?.id}
        disabled={!task.capabilities.edit || update.isPending}
        onValueChange={(priorityId) => quickChange({ priorityId }, { priorityId: task.priority?.id })}
        options={withCurrent<LookupOption>(priorities.data ?? [], task.priority).map((p) => ({ value: p.id, label: <LookupBadge item={p} /> }))}
      />
      <AppSelect
        size="sm"
        label={t('tasks.fields.assignee')}
        value={task.assignee?.id ?? NONE}
        disabled={!task.capabilities.assign || update.isPending}
        onValueChange={(value) => quickChange({ assigneeId: value === NONE ? null : value }, { assigneeId: task.assignee?.id ?? null })}
        options={[
          { value: NONE, label: t('tasks.unassigned') },
          ...withCurrent(
            assignable.map((m) => m.user),
            task.assignee,
          ).map((u) => ({ value: u.id, label: u.name })),
        ]}
      />
      <RequiredFieldsDialog request={required} onClose={() => setRequired(null)} />
    </div>
  )
}
