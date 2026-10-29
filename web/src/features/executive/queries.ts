import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { localDay, type ExecutiveProjectOption, type ExecutiveQuery } from '@/domain/executive'
import { useRepositories } from '@/presentation/common/repositories-context'

export const executiveKeys = {
  all: ['executive'] as const,
  detail: (query: ExecutiveQuery) => ['executive', query] as const,
  /** Projetos do painel (lista completa, com status e participação) — renovada a cada painel lido. */
  catalog: ['executive', 'catalog'] as const,
}

/** Painel executivo; ao trocar os filtros, o painel anterior fica na tela até o novo chegar. */
export function useExecutiveDashboard(query: ExecutiveQuery | null) {
  const { executive } = useRepositories()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: query ? executiveKeys.detail(query) : ['executive', 'none'],
    queryFn: async () => {
      const data = await executive.get(query as ExecutiveQuery)
      queryClient.setQueryData(executiveKeys.catalog, data.projects)
      return data
    },
    enabled: !!query,
    placeholderData: keepPreviousData,
  })
}

/**
 * Projetos do painel antes do primeiro painel, quando o configurador do filtro de projetos restringe a
 * tela (para já pedir o painel restrito). A lista `projects` da resposta é sempre a completa, então
 * basta o período mais leve (hoje); depois, cada painel lido renova esta lista.
 */
export function useExecutiveCatalog(enabled: boolean, tzOffset: number) {
  const { executive } = useRepositories()
  return useQuery<ExecutiveProjectOption[]>({
    queryKey: executiveKeys.catalog,
    queryFn: async () => {
      const today = localDay(new Date())
      return (await executive.get({ projectIds: [], statuses: [], from: today, to: today, tzOffset })).projects
    },
    enabled,
    staleTime: Infinity,
  })
}
