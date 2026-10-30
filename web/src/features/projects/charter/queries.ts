import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CharterItemInput, CharterKind, MeasurementInput, ProjectCharter } from '@/domain/charter'
import { useRepositories } from '@/presentation/common/repositories-context'

/** Sob `tasks`: concluir uma tarefa (em qualquer tela) também atualiza o avanço da ficha. */
export const charterKeys = {
  detail: (projectId: string) => ['tasks', 'charter', projectId] as const,
  measurements: (itemId: string) => ['tasks', 'charter-measurements', itemId] as const,
}

export function useCharter(projectId: string) {
  const { charter } = useRepositories()
  return useQuery({ queryKey: charterKeys.detail(projectId), queryFn: () => charter.get(projectId) })
}

export function useMeasurements(itemId: string | null) {
  const { charter } = useRepositories()
  return useQuery({ queryKey: charterKeys.measurements(itemId ?? ''), queryFn: () => charter.measurements(itemId as string), enabled: !!itemId })
}

export function useCharterMutations(projectId: string) {
  const { charter } = useRepositories()
  const queryClient = useQueryClient()
  const key = charterKeys.detail(projectId)
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: key })
  const replace = (next: ProjectCharter) => queryClient.setQueryData(key, next)
  return {
    saveObjective: useMutation({ mutationFn: (objective: string) => charter.saveObjective(projectId, objective), onSuccess: replace }),
    create: useMutation({ mutationFn: (input: CharterItemInput) => charter.createItem(projectId, input), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: CharterItemInput }) => charter.updateItem(id, input), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => charter.removeItem(id), onSuccess: invalidate }),
    reorder: useMutation({ mutationFn: ({ kind, ids }: { kind: CharterKind; ids: string[] }) => charter.reorder(projectId, kind, ids), onSuccess: replace }),
    measure: useMutation({
      mutationFn: ({ id, input }: { id: string; input: MeasurementInput }) => charter.addMeasurement(id, input),
      onSuccess: (_item, { id }) => {
        invalidate()
        void queryClient.invalidateQueries({ queryKey: charterKeys.measurements(id) })
      },
    }),
  }
}
