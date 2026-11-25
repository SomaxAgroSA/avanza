import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskDetail, TaskInput } from '@/domain/tasks'
import type { Urgency } from '@/domain/urgency'
import { notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useStatuses } from '@/features/workflow/queries'
import { useTaskMutations } from './queries'
import { RequiredFieldsDialog, type RequiredFieldsRequest } from './RequiredFieldsDialog'
import { missingForStatus } from './required-fields'

/**
 * Troca rápida de um campo da tarefa (status, prioridade, responsável, urgência) com a mensagem e o "desfazer".
 * Se o novo status exige campos vazios, abre o "Preencha para mover" (`dialog`, que a tela coloca) e aplica a
 * troca em seguida. Usada no topo da tarefa (TaskQuickFields) e nos selos da página da tarefa (TaskSheetView).
 */
export function useTaskQuickChange(task: TaskDetail): {
  change: (data: TaskInput, undo: TaskInput) => void
  changeUrgency: (next: Urgency | null, undo: Urgency | null) => void
  busy: boolean
  dialog: ReactNode
} {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { update, setUrgency } = useTaskMutations()
  const statuses = useStatuses(false)
  const [required, setRequired] = useState<RequiredFieldsRequest | null>(null)

  function change(data: TaskInput, undo: TaskInput) {
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

  function changeUrgency(next: Urgency | null, undo: Urgency | null) {
    const label = (u: Urgency | null) => (u ? t(`tasks.urgency.${u}`) : t('tasks.urgency.none'))
    setUrgency.mutate(
      { id: task.id, urgency: next },
      {
        onSuccess: (saved) =>
          notify.success(t('tasks.urgency.saved', { code: saved.code, urgency: label(saved.urgency) }), {
            undo: { label: t('common.undo'), onClick: () => setUrgency.mutate({ id: task.id, urgency: undo }, { onError: (error) => notify.error(errorMessage(error)) }) },
          }),
        onError: (error) => notify.error(errorMessage(error)),
      },
    )
  }

  return { change, changeUrgency, busy: update.isPending || setUrgency.isPending, dialog: <RequiredFieldsDialog request={required} onClose={() => setRequired(null)} /> }
}
