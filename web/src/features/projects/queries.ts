import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MemberRole } from '@/domain/projects'
import type { ProjectData, ProjectListQuery } from '@/domain/repositories'
import { useRepositories } from '@/presentation/common/repositories-context'

export const projectKeys = {
  all: ['projects'] as const,
  list: (query: ProjectListQuery) => ['projects', 'list', query] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
  members: (id: string) => ['projects', 'members', id] as const,
  candidates: (id: string, search: string) => ['projects', 'candidates', id, search] as const,
  history: (id: string) => ['projects', 'history', id] as const,
  files: (id: string) => ['projects', 'files', id] as const,
  covers: (exclude: string) => ['projects', 'covers', exclude] as const,
}

/** Lista geral dos filtros de projeto (seletor das visões, Tarefas, Relatórios): ativos, pelo nome. */
export const PROJECT_OPTIONS_QUERY: ProjectListQuery = { view: 'all', page: 1, perPage: 100, sort: { id: 'name', direction: 'asc' }, search: '', filters: {} }

export function useProjects(query: ProjectListQuery, enabled = true) {
  const { projects } = useRepositories()
  return useQuery({ queryKey: projectKeys.list(query), queryFn: () => projects.list(query), placeholderData: keepPreviousData, enabled })
}

export function useProject(id: string | undefined) {
  const { projects } = useRepositories()
  return useQuery({ queryKey: projectKeys.detail(id ?? ''), queryFn: () => projects.get(id as string), enabled: !!id })
}

/** Cores já usadas por outros projetos e a próxima livre (formulário do projeto). */
export function useProjectCovers(exclude: string | undefined, enabled: boolean) {
  const { projects } = useRepositories()
  return useQuery({ queryKey: projectKeys.covers(exclude ?? ''), queryFn: () => projects.covers(exclude), enabled, staleTime: 0 })
}

export function useProjectMembers(id: string | undefined) {
  const { projects } = useRepositories()
  return useQuery({ queryKey: projectKeys.members(id ?? ''), queryFn: () => projects.listMembers(id as string), enabled: !!id })
}

export function useMemberCandidates(id: string, search: string, enabled: boolean) {
  const { projects } = useRepositories()
  return useQuery({
    queryKey: projectKeys.candidates(id, search),
    queryFn: () => projects.memberCandidates(id, search),
    enabled,
    placeholderData: keepPreviousData,
  })
}

export function useProjectHistory(id: string | undefined) {
  const { projects } = useRepositories()
  return useQuery({
    queryKey: projectKeys.history(id ?? ''),
    queryFn: () => projects.history(id as string, { page: 1, perPage: 50 }),
    enabled: !!id,
  })
}

/** Invalida tudo que depende de projetos (listas, detalhe, membros, histórico). */
function useInvalidateProjects() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: projectKeys.all })
}

export function useCreateProject() {
  const { projects } = useRepositories()
  const invalidate = useInvalidateProjects()
  return useMutation({ mutationFn: (data: ProjectData & { key: string }) => projects.create(data), onSuccess: invalidate })
}

export function useUpdateProject() {
  const { projects } = useRepositories()
  const invalidate = useInvalidateProjects()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProjectData> }) => projects.update(id, data),
    onSuccess: invalidate,
  })
}

export function useProjectLifecycle() {
  const { projects } = useRepositories()
  const invalidate = useInvalidateProjects()
  return {
    archive: useMutation({ mutationFn: (id: string) => projects.archive(id), onSuccess: invalidate }),
    unarchive: useMutation({ mutationFn: (id: string) => projects.unarchive(id), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => projects.remove(id), onSuccess: invalidate }),
    transfer: useMutation({
      mutationFn: ({ id, userId }: { id: string; userId: string }) => projects.transferOwnership(id, userId),
      onSuccess: invalidate,
    }),
  }
}

export function useMemberMutations(projectId: string) {
  const { projects } = useRepositories()
  const invalidate = useInvalidateProjects()
  return {
    add: useMutation({
      mutationFn: ({ userId, role }: { userId: string; role: MemberRole }) => projects.addMember(projectId, userId, role),
      onSuccess: invalidate,
    }),
    changeRole: useMutation({
      mutationFn: ({ userId, role }: { userId: string; role: MemberRole }) => projects.updateMemberRole(projectId, userId, role),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (userId: string) => projects.removeMember(projectId, userId), onSuccess: invalidate }),
  }
}

/** Arquivos do projeto (aba Arquivos). */
export function useProjectFiles(projectId: string) {
  const { projectFiles } = useRepositories()
  return useQuery({ queryKey: projectKeys.files(projectId), queryFn: () => projectFiles.list(projectId) })
}

/** Enviar (um arquivo por vez) e excluir; o histórico do projeto também muda. */
export function useProjectFileMutations(projectId: string) {
  const { projectFiles } = useRepositories()
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: projectKeys.files(projectId) })
    void queryClient.invalidateQueries({ queryKey: projectKeys.history(projectId) })
  }
  return {
    upload: useMutation({ mutationFn: (file: File) => projectFiles.upload(projectId, file), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => projectFiles.remove(id), onSuccess: invalidate }),
  }
}
