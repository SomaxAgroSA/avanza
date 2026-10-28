import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UserStatus } from '@/domain/entities'
import type { ListQuery } from '@/domain/pagination'
import type { CreateUserData, UpdateUserData } from '@/domain/repositories'
import { useRepositories } from '@/presentation/common/repositories-context'
import { SESSION_QUERY_KEY } from '@/features/auth/session'

export const usersKeys = {
  all: ['users'] as const,
  list: (query: ListQuery) => ['users', 'list', query] as const,
}

export function useUsersList(query: ListQuery, enabled = true) {
  const { users } = useRepositories()
  return useQuery({
    queryKey: usersKeys.list(query),
    queryFn: () => users.list(query),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/** Reenvia o convite por e-mail (quem ainda não entrou). */
export function useResendInvite() {
  const { users } = useRepositories()
  return useMutation({ mutationFn: (id: string) => users.resendInvite(id) })
}

export function useCreateUser() {
  const { users } = useRepositories()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateUserData) => users.create(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['roles'] }) // contagem de usuários por perfil
    },
  })
}

export function useUpdateUser() {
  const { users } = useRepositories()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserData }) => users.update(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['roles'] })
    },
  })
}

export function useSetUserStatus() {
  const { users } = useRepositories()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) => users.setStatus(id, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: usersKeys.all }),
  })
}

/** Foto do usuário depois de salvar o cadastro: `file` envia (substitui), `null` remove. */
export function useSaveUserAvatar() {
  const { users } = useRepositories()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File | null }) => (file ? users.uploadAvatar(id, file) : users.removeAvatar(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKeys.all })
      // a própria foto aparece no topo da tela
      void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
  })
}
