import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { applyMove, type DocMoveTarget, type DocPage, type DocSpaceDetail, type DocSpaceInput, type RichContent } from '@/domain/docs'
import { useRepositories } from '@/presentation/common/repositories-context'

export const docsKeys = {
  all: ['docs'] as const,
  spaces: ['docs', 'spaces'] as const,
  space: (key: string) => ['docs', 'space', key] as const,
  page: (id: string) => ['docs', 'page', id] as const,
  draft: (id: string) => ['docs', 'draft', id] as const,
  versions: (id: string) => ['docs', 'versions', id] as const,
  version: (id: string, version: number) => ['docs', 'versions', id, version] as const,
  search: (q: string) => ['docs', 'search', q] as const,
  recent: ['docs', 'recent'] as const,
  pageTasks: (id: string) => ['docs', 'page-tasks', id] as const,
  taskDocs: (taskId: string) => ['docs', 'task-docs', taskId] as const,
}

export function useDocSpaces(enabled = true) {
  const { docs } = useRepositories()
  return useQuery({ queryKey: docsKeys.spaces, queryFn: () => docs.listSpaces(), enabled })
}

export function useDocSpace(key: string) {
  const { docs } = useRepositories()
  return useQuery({ queryKey: docsKeys.space(key), queryFn: () => docs.getSpace(key) })
}

export function useDocPage(id: string | undefined) {
  const { docs } = useRepositories()
  return useQuery({ queryKey: docsKeys.page(id ?? ''), queryFn: () => docs.getPage(id as string), enabled: !!id })
}

/** Rascunho para edição: carregado uma vez ao abrir o editor (o editor passa a ser a fonte até publicar/sair). */
export function useDocDraft(id: string, enabled: boolean) {
  const { docs } = useRepositories()
  return useQuery({ queryKey: docsKeys.draft(id), queryFn: () => docs.getDraft(id), enabled, staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false })
}

export function useDocVersions(id: string, enabled: boolean) {
  const { docs } = useRepositories()
  return useQuery({ queryKey: docsKeys.versions(id), queryFn: () => docs.listVersions(id), enabled })
}

export function useDocVersion(id: string, version: number | null) {
  const { docs } = useRepositories()
  return useQuery({ queryKey: docsKeys.version(id, version ?? 0), queryFn: () => docs.getVersion(id, version as number), enabled: version !== null })
}

/** Busca (2+ caracteres); mantém os resultados anteriores enquanto digita. */
export function useDocSearch(q: string) {
  const { docs } = useRepositories()
  const term = q.trim()
  return useQuery({ queryKey: docsKeys.search(term), queryFn: () => docs.search(term), enabled: term.length >= 2, placeholderData: keepPreviousData })
}

export function useDocRecent() {
  const { docs } = useRepositories()
  return useQuery({ queryKey: docsKeys.recent, queryFn: () => docs.recent() })
}

/** Tarefas vinculadas à página (só as que a pessoa vê). */
export function usePageTasks(pageId: string | undefined) {
  const { docs } = useRepositories()
  return useQuery({ queryKey: docsKeys.pageTasks(pageId ?? ''), queryFn: () => docs.listPageTasks(pageId as string), enabled: !!pageId })
}

/** Páginas vinculadas à tarefa (aba Documentação da tarefa). */
export function useTaskDocs(taskId: string | undefined) {
  const { docs } = useRepositories()
  return useQuery({ queryKey: docsKeys.taskDocs(taskId ?? ''), queryFn: () => docs.listTaskDocs(taskId as string), enabled: !!taskId })
}

/** Vincular/desvincular página ↔ tarefa: atualiza as listas dos dois lados, a árvore e o histórico da tarefa. */
export function useDocLinkMutations() {
  const { docs } = useRepositories()
  const queryClient = useQueryClient()
  const refresh = (taskIds: string[]) => {
    void queryClient.invalidateQueries({ queryKey: docsKeys.all })
    taskIds.forEach((id) => void queryClient.invalidateQueries({ queryKey: ['tasks', 'history', id] }))
  }
  return {
    link: useMutation({ mutationFn: ({ pageId, taskIds }: { pageId: string; taskIds: string[] }) => docs.linkTasks(pageId, taskIds), onSuccess: (_list, input) => refresh(input.taskIds) }),
    unlink: useMutation({ mutationFn: ({ pageId, taskId }: { pageId: string; taskId: string }) => docs.unlinkTask(pageId, taskId), onSuccess: (_result, input) => refresh([input.taskId]) }),
  }
}

export function useSpaceMutations() {
  const { docs } = useRepositories()
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: docsKeys.all })
  return {
    create: useMutation({ mutationFn: (input: DocSpaceInput) => docs.createSpace(input), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: DocSpaceInput }) => docs.updateSpace(id, input), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => docs.deleteSpace(id), onSuccess: invalidate }),
  }
}

/** Mutações de páginas de um espaço; toda mudança atualiza a árvore, a página e as listas. */
export function usePageMutations(spaceKey: string) {
  const { docs } = useRepositories()
  const queryClient = useQueryClient()
  const spaceKeyQuery = docsKeys.space(spaceKey)
  const refresh = (page?: DocPage) => {
    if (page) queryClient.setQueryData(docsKeys.page(page.id), page)
    void queryClient.invalidateQueries({ queryKey: spaceKeyQuery })
    void queryClient.invalidateQueries({ queryKey: docsKeys.recent })
    void queryClient.invalidateQueries({ queryKey: docsKeys.spaces })
    if (page) void queryClient.invalidateQueries({ queryKey: docsKeys.versions(page.id) })
  }
  return {
    create: useMutation({
      mutationFn: ({ spaceId, title, parentId }: { spaceId: string; title: string; parentId?: string | null }) => docs.createPage(spaceId, { title, parentId }),
      onSuccess: (page) => refresh(page),
    }),
    remove: useMutation({
      mutationFn: (id: string) => docs.deletePage(id),
      onSuccess: (_count, id) => {
        queryClient.removeQueries({ queryKey: docsKeys.page(id) })
        refresh()
      },
    }),
    /** Otimista: a página já aparece no novo lugar da árvore; em erro, volta. */
    move: useMutation({
      mutationFn: ({ id, target }: { id: string; target: DocMoveTarget }) => docs.move(id, target),
      onMutate: async ({ id, target }) => {
        await queryClient.cancelQueries({ queryKey: spaceKeyQuery })
        const previous = queryClient.getQueryData<DocSpaceDetail>(spaceKeyQuery)
        if (previous) queryClient.setQueryData<DocSpaceDetail>(spaceKeyQuery, { ...previous, pages: applyMove(previous.pages, id, target) })
        return { previous }
      },
      onError: (_error, _input, context) => {
        if (context?.previous) queryClient.setQueryData(spaceKeyQuery, context.previous)
      },
      onSettled: (page) => refresh(page),
    }),
    publish: useMutation({
      mutationFn: ({ id, title, content }: { id: string; title?: string; content?: RichContent }) => docs.publish(id, title === undefined ? undefined : { title, content }),
      onSuccess: (page) => {
        queryClient.removeQueries({ queryKey: docsKeys.draft(page.id) })
        refresh(page)
      },
    }),
    discard: useMutation({
      mutationFn: (id: string) => docs.discardDraft(id),
      onSuccess: (_result, id) => {
        queryClient.removeQueries({ queryKey: docsKeys.draft(id) })
        void queryClient.invalidateQueries({ queryKey: docsKeys.page(id) })
        refresh()
      },
    }),
    restore: useMutation({ mutationFn: ({ id, version }: { id: string; version: number }) => docs.restoreVersion(id, version), onSuccess: (page) => refresh(page) }),
  }
}

/** Autosalvamento do rascunho (sem invalidar a página a cada tecla; a árvore marca "rascunho" no fim). */
export function useSaveDraft(id: string) {
  const { docs } = useRepositories()
  return useMutation({ mutationFn: (input: { title: string; content: RichContent }) => docs.saveDraft(id, input) })
}

