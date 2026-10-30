import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MilestoneInput, Timeline } from '@/domain/timeline'
import { useRepositories } from '@/presentation/common/repositories-context'
import { taskKeys } from '@/features/tasks/queries'

/** Sob `tasks`: mudanças em tarefas (em qualquer tela) também atualizam a timeline. */
export const timelineKeys = {
  detail: (projectId: string) => ['tasks', 'timeline', projectId] as const,
}

export function useTimeline(projectId: string, enabled = true) {
  const { timeline } = useRepositories()
  return useQuery({ queryKey: timelineKeys.detail(projectId), queryFn: () => timeline.get(projectId), enabled })
}

const utcDay = (day: string) => new Date(`${day}T00:00:00.000Z`)

/** Novas datas da tarefa com atualização otimista (a barra fica onde foi solta); em erro, volta. */
export function useMoveDates(projectId: string) {
  const { tasks } = useRepositories()
  const queryClient = useQueryClient()
  const key = timelineKeys.detail(projectId)
  return useMutation({
    mutationFn: ({ taskId, startDate, dueDate }: { taskId: string; startDate: string; dueDate: string }) => tasks.update(taskId, { startDate, dueDate }),
    onMutate: async ({ taskId, startDate, dueDate }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Timeline>(key)
      if (previous) {
        queryClient.setQueryData<Timeline>(key, {
          ...previous,
          tasks: previous.tasks.map((t) => (t.id === taskId ? { ...t, startDate: utcDay(startDate), dueDate: utcDay(dueDate) } : t)),
        })
      }
      return { previous }
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSuccess: (task) => queryClient.setQueryData(taskKeys.detail(task.id), task),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: taskKeys.all }),
  })
}

export function useMilestoneMutations(projectId: string) {
  const { milestones } = useRepositories()
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: timelineKeys.detail(projectId) })
  return {
    create: useMutation({ mutationFn: (input: MilestoneInput) => milestones.create(projectId, input), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: MilestoneInput }) => milestones.update(id, input), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => milestones.remove(id), onSuccess: invalidate }),
  }
}
