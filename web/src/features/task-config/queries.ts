import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CustomFieldInput, TaskTypeFieldInput, TaskTypeInput } from '@/domain/repositories'
import { withFieldOption, type CustomField, type TaskTypeDetail, type TaskTypeField } from '@/domain/task-config'
import type { TaskDetail } from '@/domain/tasks'
import { useRepositories } from '@/presentation/common/repositories-context'

export const configKeys = {
  fields: ['task-config', 'fields'] as const,
  types: (includeInactive: boolean) => ['task-config', 'types', includeInactive] as const,
  type: (id: string) => ['task-config', 'type', id] as const,
  typeHistory: (id: string) => ['task-config', 'type-history', id] as const,
}

export function useCustomFields() {
  const { customFields } = useRepositories()
  return useQuery({ queryKey: configKeys.fields, queryFn: () => customFields.list() })
}

export function useTaskTypes(includeInactive = false) {
  const { taskTypes } = useRepositories()
  return useQuery({ queryKey: configKeys.types(includeInactive), queryFn: () => taskTypes.list({ includeInactive }) })
}

export function useTaskType(id: string | undefined) {
  const { taskTypes } = useRepositories()
  return useQuery({ queryKey: configKeys.type(id ?? ''), queryFn: () => taskTypes.get(id as string), enabled: !!id })
}

export function useTaskTypeHistory(id: string) {
  const { taskTypes } = useRepositories()
  return useQuery({ queryKey: configKeys.typeHistory(id), queryFn: () => taskTypes.history(id) })
}

function useInvalidateConfig() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: ['task-config'] })
}

export function useCustomFieldMutations() {
  const { customFields } = useRepositories()
  const invalidate = useInvalidateConfig()
  return {
    create: useMutation({ mutationFn: (data: CustomFieldInput) => customFields.create(data), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: Partial<CustomFieldInput> }) => customFields.update(id, data),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => customFields.remove(id), onSuccess: invalidate }),
  }
}

/**
 * "Adicionar opção" pela tarefa. A opção entra na hora nos campos já carregados (biblioteca, tipos e
 * tarefas abertas) — o formulário já mostra e valida a opção escolhida — e essas consultas são
 * recarregadas em seguida.
 */
export function useAddFieldOption() {
  const { customFields } = useRepositories()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ fieldId, label }: { fieldId: string; label: string }) => customFields.addOption(fieldId, label),
    onSuccess: (option, { fieldId }) => {
      const links = (list: TaskTypeField[]) => list.map((link) => ({ ...link, field: withFieldOption(link.field, fieldId, option) }))
      queryClient.setQueriesData<CustomField[]>({ queryKey: configKeys.fields }, (list) => list?.map((field) => withFieldOption(field, fieldId, option)))
      queryClient.setQueriesData<TaskTypeDetail>({ queryKey: ['task-config', 'type'] }, (type) => (type ? { ...type, fields: links(type.fields) } : type))
      queryClient.setQueriesData<TaskDetail>({ queryKey: ['tasks', 'detail'] }, (task) => (task ? { ...task, fields: links(task.fields) } : task))
      void queryClient.invalidateQueries({ queryKey: ['task-config'] })
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'detail'] })
    },
  })
}

export function useTaskTypeMutations() {
  const { taskTypes } = useRepositories()
  const invalidate = useInvalidateConfig()
  return {
    create: useMutation({ mutationFn: (data: TaskTypeInput & { key: string }) => taskTypes.create(data), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: Partial<TaskTypeInput> }) => taskTypes.update(id, data),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => taskTypes.remove(id), onSuccess: invalidate }),
    reorder: useMutation({ mutationFn: (ids: string[]) => taskTypes.reorder(ids), onSuccess: invalidate }),
    setFields: useMutation({
      mutationFn: ({ id, fields }: { id: string; fields: TaskTypeFieldInput[] }) => taskTypes.setFields(id, fields),
      onSuccess: invalidate,
    }),
  }
}
