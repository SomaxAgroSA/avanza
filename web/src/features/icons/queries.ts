import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRepositories } from '@/presentation/common/repositories-context'

export const iconKeys = { all: ['icons'] as const }

/** Biblioteca de ícones da plataforma (todos os seletores de ícone usam). */
export function useIconLibrary(enabled = true) {
  const { icons } = useRepositories()
  return useQuery({ queryKey: iconKeys.all, queryFn: () => icons.list(), staleTime: 60_000, enabled })
}

/** Todos os nomes da galeria (Lucide): carregados só quando a galeria abre. */
export function useIconGallery(enabled: boolean) {
  return useQuery({ queryKey: ['icons', 'gallery'], queryFn: () => import('lucide-react/dynamic').then((m) => m.iconNames as readonly string[]), staleTime: Infinity, enabled })
}

export function useIconMutations() {
  const { icons } = useRepositories()
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: iconKeys.all, exact: true })
  return {
    importIcons: useMutation({ mutationFn: (names: string[]) => icons.importIcons(names), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (name: string) => icons.remove(name), onSuccess: invalidate }),
  }
}
