import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LookupInput } from '@/domain/repositories'
import type { LookupKind } from '@/domain/workflow'
import { useRepositories } from '@/presentation/common/repositories-context'

export const workflowKeys = {
  all: ['workflow'] as const,
  list: (kind: LookupKind, includeInactive: boolean) => ['workflow', kind, includeInactive] as const,
}

function useLookupRepository(kind: LookupKind) {
  const repositories = useRepositories()
  return kind === 'status' ? repositories.statuses : kind === 'area' ? repositories.areas : repositories.priorities
}

export function useLookups(kind: LookupKind, includeInactive = false) {
  const repository = useLookupRepository(kind)
  return useQuery({ queryKey: workflowKeys.list(kind, includeInactive), queryFn: () => repository.list({ includeInactive }) })
}

export function useStatuses(includeInactive = false) {
  return useLookups('status', includeInactive)
}

export function usePriorities(includeInactive = false) {
  return useLookups('priority', includeInactive)
}

export function useAreas(includeInactive = false) {
  return useLookups('area', includeInactive)
}

export function useLookupMutations(kind: LookupKind) {
  const repository = useLookupRepository(kind)
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: workflowKeys.all })
  return {
    create: useMutation({ mutationFn: (data: LookupInput & { key: string }) => repository.create(data), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: Partial<LookupInput> }) => repository.update(id, data),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => repository.remove(id), onSuccess: invalidate }),
    reorder: useMutation({ mutationFn: (ids: string[]) => repository.reorder(ids), onSuccess: invalidate }),
  }
}
