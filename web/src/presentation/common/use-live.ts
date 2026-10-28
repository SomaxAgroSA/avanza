import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeEvent, RealtimeStatus } from '@/core/realtime/realtime-client'
import { invalidationKeys, projectTopic, userTopic } from '@/domain/realtime'
import { useRealtime } from './realtime-context'

/** Avisos que chegam juntos (ex.: mover vários cartões) viram uma só busca. */
const BATCH_MS = 250

/**
 * Equipe grande mexendo no mesmo quadro: no máximo uma busca a cada 2,5 s por tela. Sem isso, cada
 * mudança de cada colega vira uma busca em cada tela aberta (cresce com o quadrado da equipe). A
 * primeira depois de um tempo quieto continua saindo na hora.
 */
export const LIVE_MIN_INTERVAL_MS = 2_500

/** Com o tempo real ligado, a consulta periódica das telas vira só rede de segurança. */
export const LIVE_SAFETY_NET_MS = 5 * 60_000

/**
 * Enquanto a tela está aberta, assina os tópicos e atualiza os dados afetados pelos avisos. Os avisos
 * de todos os tópicos da tela entram no mesmo lote e no mesmo limite de uma busca a cada 2,5 s.
 */
function useLiveTopics(topics: readonly string[]) {
  const realtime = useRealtime()
  const queryClient = useQueryClient()
  // a lista muda de identidade a cada render: o efeito depende só do conteúdo
  const joined = topics.join('\n')
  useEffect(() => {
    if (!joined) return
    const pending = new Map<string, readonly unknown[]>()
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastFlush = Number.NEGATIVE_INFINITY
    const flush = () => {
      // alteração da própria pessoa em andamento (ex.: arrastar um cartão): buscar agora traria o estado
      // de antes e o cartão "voltaria"; a alteração atualiza a tela ao terminar, e depois vem o resto
      if (queryClient.isMutating() > 0) {
        timer = setTimeout(flush, BATCH_MS)
        return
      }
      timer = null
      lastFlush = Date.now()
      pending.forEach((queryKey) => void queryClient.invalidateQueries({ queryKey }))
      pending.clear()
    }
    const onEvent = (event: RealtimeEvent) => {
      invalidationKeys(event).forEach((key) => pending.set(JSON.stringify(key), key))
      if (!timer) timer = setTimeout(flush, Math.max(BATCH_MS, lastFlush + LIVE_MIN_INTERVAL_MS - Date.now()))
    }
    const offs = joined.split('\n').map((topic) => realtime.subscribe(topic, onEvent))
    return () => {
      offs.forEach((off) => off())
      if (timer) clearTimeout(timer)
    }
  }, [joined, realtime, queryClient])
}

/** Quadro, lista ou tarefa de um projeto aberta: atualiza sozinha quando alguém muda algo. */
export function useLiveProject(projectId: string | null | undefined) {
  useLiveTopics(projectId ? [projectTopic(projectId)] : [])
}

/** Tela com vários projetos (Kanban de todos os projetos): um tópico por projeto, num lote só. */
export function useLiveProjects(projectIds: readonly string[]) {
  useLiveTopics(projectIds.map(projectTopic))
}

/** Notificações da pessoa (sino) em tempo real. */
export function useLiveNotifications(userId: string | null | undefined) {
  useLiveTopics(userId ? [userTopic(userId)] : [])
}

export function useRealtimeStatus(): RealtimeStatus {
  const realtime = useRealtime()
  return useSyncExternalStore(
    (onChange) => realtime.onStatus(onChange),
    () => realtime.getStatus(),
    () => 'idle',
  )
}

/** Intervalo da consulta periódica: rede de segurança com o tempo real ligado; `fallbackMs` sem ele. */
export function useLiveRefetchInterval(fallbackMs: number): number {
  return useRealtimeStatus() === 'live' ? LIVE_SAFETY_NET_MS : fallbackMs
}

/**
 * A conexão do tempo real caiu e voltou: os avisos do intervalo se perderam, então busca de novo o que
 * está na tela (só as consultas em uso; as outras ficam marcadas como velhas). Uma vez, no app.
 */
export function useRealtimeResync() {
  const realtime = useRealtime()
  const queryClient = useQueryClient()
  useEffect(() => {
    let dropped = false
    return realtime.onStatus((status) => {
      if (status === 'reconnecting') dropped = true
      else if (status === 'live' && dropped) {
        dropped = false
        void queryClient.invalidateQueries()
      } else if (status === 'idle') dropped = false
    })
  }, [realtime, queryClient])
}
