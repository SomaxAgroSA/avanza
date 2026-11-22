import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AssignInput, DemandBox, DemandInput, DemandListFilters } from '@/domain/demands'
import type { TaskDetail } from '@/domain/tasks'
import { useRepositories } from '@/presentation/common/repositories-context'
import { useCan } from '@/features/auth/session'
import { taskKeys } from '@/features/tasks/queries'

/**
 * Chaves das demandas internas (§45) debaixo de `tasks`: tudo o que mexe em tarefas (editar, comentar,
 * excluir) também atualiza as caixas, os números e o selo do menu.
 */
export const demandKeys = {
  all: [...taskKeys.all, 'demands'] as const,
  list: (box: DemandBox, filters: DemandListFilters = {}) => [...taskKeys.all, 'demands', 'list', box, filters] as const,
  overview: [...taskKeys.all, 'demands', 'overview'] as const,
  owners: [...taskKeys.all, 'demands', 'owners'] as const,
  team: (id: string) => [...taskKeys.all, 'demands', 'team', id] as const,
}

/** Uma caixa (com os filtros de pessoa da caixa Todas). */
export function useDemandList(box: DemandBox, filters: DemandListFilters = {}, enabled = true) {
  const { demands } = useRepositories()
  return useQuery({ queryKey: demandKeys.list(box, filters), queryFn: () => demands.list(box, filters), enabled })
}

/** Números das caixas e a carga da equipe (também o selo do menu Tarefas). */
export function useDemandOverview(enabled = true) {
  const { demands } = useRepositories()
  return useQuery({ queryKey: demandKeys.overview, queryFn: () => demands.overview(), enabled, staleTime: 60_000 })
}

/**
 * Selo da aba Caixa de entrada e do menu Tarefas: o que espera por mim — recebidas sem atribuir,
 * atribuídas a mim não concluídas e pedidas por mim para validar (o servidor soma; 0 = sem selo).
 */
export function useDemandBadge(): number {
  const canView = useCan('tasks.view')
  const canList = useCan('tasks.list')
  const allowed = canView && canList
  const overview = useDemandOverview(allowed)
  return allowed ? (overview.data?.pending ?? 0) : 0
}

/** Responsáveis possíveis no formulário de demanda (pessoas ativas). */
export function useDemandOwners(enabled: boolean) {
  const { demands } = useRepositories()
  return useQuery({ queryKey: demandKeys.owners, queryFn: () => demands.owners(), enabled, staleTime: 5 * 60_000 })
}

/** Quem pode receber a demanda (diálogos Atribuir e Passar a…). */
export function useDemandTeam(id: string | undefined) {
  const { demands } = useRepositories()
  return useQuery({ queryKey: demandKeys.team(id ?? ''), queryFn: () => demands.team(id as string), enabled: !!id })
}

/** Abrir e conduzir demandas: guarda o detalhe devolvido e atualiza listas, caixas, números e histórico. */
export function useDemandMutations() {
  const { demands } = useRepositories()
  const queryClient = useQueryClient()
  const done = (task: TaskDetail) => {
    queryClient.setQueryData(taskKeys.detail(task.id), task)
    void queryClient.invalidateQueries({ queryKey: taskKeys.all })
  }
  return {
    create: useMutation({ mutationFn: (data: DemandInput) => demands.create(data), onSuccess: done }),
    assign: useMutation({ mutationFn: ({ id, input }: { id: string; input: AssignInput }) => demands.assign(id, input), onSuccess: done }),
    start: useMutation({ mutationFn: (id: string) => demands.start(id), onSuccess: done }),
    pass: useMutation({ mutationFn: ({ id, assigneeId, comment }: { id: string; assigneeId: string; comment: string }) => demands.pass(id, { assigneeId, comment }), onSuccess: done }),
    conclude: useMutation({ mutationFn: ({ id, comment }: { id: string; comment: string }) => demands.conclude(id, comment), onSuccess: done }),
    validate: useMutation({ mutationFn: (id: string) => demands.validate(id), onSuccess: done }),
    returnDemand: useMutation({ mutationFn: ({ id, comment }: { id: string; comment: string }) => demands.returnDemand(id, comment), onSuccess: done }),
  }
}
