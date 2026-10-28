import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { liveProjectIds, moveCardInBoard, type Board } from '@/domain/kanban'
import { MAX_LIVE_PROJECTS } from '@/domain/realtime'
import { useRepositories } from '@/presentation/common/repositories-context'
import { useLiveRefetchInterval } from '@/presentation/common/use-live'
import { taskKeys } from '@/features/tasks/queries'

/** Sob `tasks`: qualquer mutação de tarefa também atualiza o quadro. */
export const boardKeys = {
  detail: (projectId: string) => ['tasks', 'board', projectId] as const,
  /** Quadro de todos os projetos (o tempo real invalida a mesma chave — domain/realtime.ts). */
  all: () => ['tasks', 'board-all'] as const,
}

export type BoardKey = ReturnType<typeof boardKeys.detail> | ReturnType<typeof boardKeys.all>

/**
 * Atualização periódica enquanto a aba está visível (pausada durante o arraste) quando o tempo real
 * não está ligado; com ele, só a rede de segurança (`LIVE_SAFETY_NET_MS`).
 */
export const BOARD_REFRESH_MS = 15_000

export function useBoard(projectId: string | undefined, paused = false) {
  const { board } = useRepositories()
  const refreshMs = useLiveRefetchInterval(BOARD_REFRESH_MS)
  return useQuery({
    queryKey: boardKeys.detail(projectId ?? ''),
    queryFn: () => board.get(projectId as string),
    enabled: !!projectId,
    refetchInterval: paused ? false : refreshMs,
  })
}

/**
 * Quadro de todos os projetos. Com mais projetos do que a tela assina no tempo real
 * (`MAX_LIVE_PROJECTS`), a consulta periódica volta ao intervalo curto para os demais não ficarem
 * esperando a rede de segurança.
 */
export function useAllBoard(enabled: boolean, paused = false) {
  const { board } = useRepositories()
  const refreshMs = useLiveRefetchInterval(BOARD_REFRESH_MS)
  return useQuery({
    queryKey: boardKeys.all(),
    queryFn: () => board.getAll(),
    enabled,
    refetchInterval: (query) => {
      if (paused) return false
      const data = query.state.data
      return data && !liveProjectIds(data, MAX_LIVE_PROJECTS).complete ? BOARD_REFRESH_MS : refreshMs
    },
  })
}

export interface MoveCardInput {
  taskId: string
  statusId: string
  /** Vizinhos enviados ao servidor (a posição é calculada entre eles). */
  prevId?: string
  nextId?: string
  /**
   * Card logo acima na tela, para a atualização otimista (ausente = topo da coluna). No quadro do
   * projeto é o próprio `prevId`; no de todos os projetos, o vizinho do servidor é o do mesmo projeto.
   */
  screenPrevId?: string
}

/** Move com atualização otimista; em erro o quadro volta ao estado anterior. */
export function useMoveCard(key: BoardKey) {
  const { board } = useRepositories()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, statusId, prevId, nextId }: MoveCardInput) => board.move(taskId, { statusId, prevId, nextId }),
    onMutate: async ({ taskId, statusId, screenPrevId }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Board>(key)
      if (previous) queryClient.setQueryData<Board>(key, moveCardInBoard(previous, taskId, statusId, screenPrevId))
      return { previous }
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSuccess: (task) => queryClient.setQueryData(taskKeys.detail(task.id), task),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: taskKeys.all }),
  })
}
