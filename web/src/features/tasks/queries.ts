import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { ListQuery } from '@/domain/pagination'
import type { TaskListOptions } from '@/domain/repositories'
import type { TaskInput } from '@/domain/tasks'
import type { ForkInput, LinkOption } from '@/domain/relations'
import { useRepositories } from '@/presentation/common/repositories-context'

export const taskKeys = {
  all: ['tasks'] as const,
  list: (query: ListQuery, options?: TaskListOptions) => ['tasks', 'list', query, options ?? {}] as const,
  detail: (id: string) => ['tasks', 'detail', id] as const,
  history: (id: string) => ['tasks', 'history', id] as const,
  comments: (id: string) => ['tasks', 'comments', id] as const,
  mentions: (id: string) => ['tasks', 'mentions', id] as const,
  attachments: (id: string) => ['tasks', 'attachments', id] as const,
  relations: (id: string) => ['tasks', 'relations', id] as const,
}

export function useTaskRelations(taskId: string | undefined) {
  const { relations } = useRepositories()
  return useQuery({ queryKey: taskKeys.relations(taskId ?? ''), queryFn: () => relations.list(taskId as string), enabled: !!taskId })
}

/** Relacionar/desfazer e fork; tudo sob `tasks` (listas, quadro, planejamento e histórico se atualizam). */
export function useRelationMutations(taskId: string) {
  const { relations } = useRepositories()
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: taskKeys.all })
  return {
    create: useMutation({
      mutationFn: (input: { type: Exclude<LinkOption, 'parent' | 'child'>; targetId: string }) => relations.create(taskId, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (relationId: string) => relations.remove(relationId), onSuccess: invalidate }),
    fork: useMutation({ mutationFn: (input: ForkInput) => relations.fork(taskId, input), onSuccess: invalidate }),
  }
}

export function useTasksList(query: ListQuery, options?: TaskListOptions, enabled = true) {
  const { tasks } = useRepositories()
  return useQuery({ queryKey: taskKeys.list(query, options), queryFn: () => tasks.list(query, options), placeholderData: keepPreviousData, enabled })
}

export function useTask(id: string | undefined) {
  const { tasks } = useRepositories()
  return useQuery({ queryKey: taskKeys.detail(id ?? ''), queryFn: () => tasks.get(id as string), enabled: !!id })
}

export function useTaskHistory(id: string | undefined) {
  const { tasks } = useRepositories()
  return useQuery({ queryKey: taskKeys.history(id ?? ''), queryFn: () => tasks.history(id as string), enabled: !!id })
}

export function useTaskComments(taskId: string) {
  const { comments } = useRepositories()
  return useQuery({ queryKey: taskKeys.comments(taskId), queryFn: () => comments.list(taskId) })
}

export function useMentionCandidates(taskId: string, enabled = true) {
  const { comments } = useRepositories()
  return useQuery({ queryKey: taskKeys.mentions(taskId), queryFn: () => comments.mentionCandidates(taskId), enabled, staleTime: 60_000 })
}

export function useCommentMutations(taskId: string) {
  const { comments } = useRepositories()
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: taskKeys.comments(taskId) })
    void queryClient.invalidateQueries({ queryKey: taskKeys.history(taskId) })
    // contador de comentários nas listagens
    void queryClient.invalidateQueries({ queryKey: ['tasks', 'list'] })
  }
  return {
    create: useMutation({ mutationFn: (content: string) => comments.create(taskId, content), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, content }: { id: string; content: string }) => comments.update(id, content), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => comments.remove(id), onSuccess: invalidate }),
  }
}

export function useTaskAttachments(taskId: string | undefined) {
  const { attachments } = useRepositories()
  return useQuery({ queryKey: taskKeys.attachments(taskId ?? ''), queryFn: () => attachments.list(taskId as string), enabled: !!taskId })
}

/** Anexos mudaram: lista, histórico, campos de imagem/arquivo (detalhe) e contadores das listas. */
function invalidateTaskFiles(queryClient: QueryClient, taskId: string) {
  void queryClient.invalidateQueries({ queryKey: taskKeys.attachments(taskId) })
  void queryClient.invalidateQueries({ queryKey: taskKeys.history(taskId) })
  void queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) })
  void queryClient.invalidateQueries({ queryKey: ['tasks', 'list'] })
}

export function useAttachmentMutations(taskId: string) {
  const { attachments } = useRepositories()
  const queryClient = useQueryClient()
  const invalidate = () => invalidateTaskFiles(queryClient, taskId)
  return {
    upload: useMutation({
      mutationFn: ({ file, field, commentId }: { file: File; field?: string; commentId?: string }) => attachments.upload(taskId, file, { field, commentId }),
      onSuccess: (_, variables) => {
        invalidate()
        if (variables.commentId) void queryClient.invalidateQueries({ queryKey: taskKeys.comments(taskId) })
      },
    }),
    remove: useMutation({
      mutationFn: (id: string) => attachments.remove(id),
      onSuccess: () => {
        invalidate()
        void queryClient.invalidateQueries({ queryKey: taskKeys.comments(taskId) })
      },
    }),
  }
}

/**
 * Arquivo enviado direto num campo de imagem/arquivo; a tarefa vem em cada envio (na criação, ela
 * acabou de nascer — o formulário ainda não tinha o id).
 */
export function useFieldFileUpload() {
  const { attachments } = useRepositories()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, file, field }: { taskId: string; file: File; field: string }) => attachments.upload(taskId, file, { field }),
    onSuccess: (_, { taskId }) => invalidateTaskFiles(queryClient, taskId),
  })
}

export function useTaskMutations() {
  const { tasks } = useRepositories()
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: taskKeys.all })
  return {
    create: useMutation({
      mutationFn: (data: TaskInput & { projectId: string; taskTypeId: string; title: string }) => tasks.create(data),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: TaskInput }) => tasks.update(id, data),
      onSuccess: (task) => {
        queryClient.setQueryData(taskKeys.detail(task.id), task)
        invalidate()
      },
    }),
    remove: useMutation({ mutationFn: (id: string) => tasks.remove(id), onSuccess: invalidate }),
  }
}
