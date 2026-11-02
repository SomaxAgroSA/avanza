import { useTranslation } from 'react-i18next'
import type { TaskSummary } from '@/domain/tasks'
import type { Area } from '@/domain/workflow'
import { notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { AreaPicker } from '@/features/workflow/area-visuals'
import { useTaskMutations } from './queries'

/** Célula da coluna Área das tarefas: troca com um clique, sem exigir os obrigatórios do status. */
export function AreaCell({ task, areas, canEdit }: { task: TaskSummary; areas: Area[]; canEdit: boolean }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { setArea } = useTaskMutations()
  return (
    <AreaPicker
      value={task.area}
      areas={areas}
      canEdit={canEdit}
      pending={setArea.isPending && setArea.variables?.id === task.id}
      changeLabel={t('areas.change', { name: task.code, area: task.area?.name ?? t('areas.none') })}
      onChoose={(areaId) =>
        setArea.mutate(
          { id: task.id, areaId },
          {
            onSuccess: (saved) => notify.success(t('areas.saved', { name: saved.code, area: saved.area?.name ?? t('areas.none') })),
            onError: (error) => notify.error(errorMessage(error)),
          },
        )
      }
    />
  )
}
