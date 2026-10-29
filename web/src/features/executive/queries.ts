import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ExecutiveQuery } from '@/domain/executive'
import { useRepositories } from '@/presentation/common/repositories-context'

export const executiveKeys = {
  all: ['executive'] as const,
  detail: (query: ExecutiveQuery) => ['executive', query] as const,
}

/** Painel executivo; ao trocar os filtros, o painel anterior fica na tela até o novo chegar. */
export function useExecutiveDashboard(query: ExecutiveQuery | null) {
  const { executive } = useRepositories()
  return useQuery({
    queryKey: query ? executiveKeys.detail(query) : ['executive', 'none'],
    queryFn: () => executive.get(query as ExecutiveQuery),
    enabled: !!query,
    placeholderData: keepPreviousData,
  })
}
