import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CompanyInput } from '@/domain/companies'
import { useRepositories } from '@/presentation/common/repositories-context'

/** Empresas (§46): as ativas (formulários e filtros) e todas com o uso (Configurações → Empresas). */
export const companyKeys = {
  all: ['companies'] as const,
  active: ['companies', 'active'] as const,
  manage: ['companies', 'manage'] as const,
}

/** Empresas ativas: as que os formulários oferecem e os filtros listam. */
export function useCompanies(enabled = true) {
  const { companies } = useRepositories()
  return useQuery({ queryKey: companyKeys.active, queryFn: () => companies.list(), enabled, staleTime: 60_000 })
}

/** Todas, com as contagens de uso (só quem gerencia a plataforma). */
export function useManagedCompanies() {
  const { companies } = useRepositories()
  return useQuery({ queryKey: companyKeys.manage, queryFn: () => companies.list({ includeInactive: true }) })
}

export function useCompanyMutations() {
  const { companies } = useRepositories()
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: companyKeys.all })
    // o nome e a sigla aparecem em projetos, tarefas e demandas
    void queryClient.invalidateQueries({ queryKey: ['projects'] })
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }
  return {
    create: useMutation({ mutationFn: (data: CompanyInput) => companies.create(data), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, data }: { id: string; data: Partial<CompanyInput> }) => companies.update(id, data), onSuccess: invalidate }),
  }
}
