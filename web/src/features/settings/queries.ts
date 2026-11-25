import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PermissionCode } from '@/domain/permissions'
import type { RoleInputData } from '@/domain/repositories'
import type { TaskViews } from '@/domain/task-views'
import { useRepositories } from '@/presentation/common/repositories-context'

export const rolesKeys = {
  all: ['roles'] as const,
  permissions: ['roles', 'permissions-catalog'] as const,
}

export function useRoles(enabled = true) {
  const { roles } = useRepositories()
  return useQuery({ queryKey: rolesKeys.all, queryFn: () => roles.list(), staleTime: 60_000, enabled })
}

export function usePermissionCatalog() {
  const { roles } = useRepositories()
  return useQuery({ queryKey: rolesKeys.permissions, queryFn: () => roles.listPermissions(), staleTime: 10 * 60_000 })
}

function useInvalidateRoles() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: rolesKeys.all })
    // Permissões do próprio usuário podem ter mudado (ex.: perfil alterado por outro admin).
    void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
  }
}

export function useCreateRole() {
  const { roles } = useRepositories()
  const invalidate = useInvalidateRoles()
  return useMutation({ mutationFn: (data: RoleInputData) => roles.create(data), onSuccess: invalidate })
}

export function useUpdateRole() {
  const { roles } = useRepositories()
  const invalidate = useInvalidateRoles()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Pick<RoleInputData, 'name' | 'description' | 'ongoingView' | 'projectsLists' | keyof TaskViews> }) => roles.update(id, data),
    onSuccess: invalidate,
  })
}

export function useUpdateRolePermissions() {
  const { roles } = useRepositories()
  const invalidate = useInvalidateRoles()
  return useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: PermissionCode[] }) => roles.updatePermissions(id, permissions),
    onSuccess: invalidate,
  })
}

export function useDeleteRole() {
  const { roles } = useRepositories()
  const invalidate = useInvalidateRoles()
  return useMutation({ mutationFn: (id: string) => roles.remove(id), onSuccess: invalidate })
}
