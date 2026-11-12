import { useCallback, useSyncExternalStore } from 'react'
import { readJson, writeJson } from '@/core/storage/safe-storage'
import { useSession } from '@/features/auth/session'

/**
 * "Minhas tarefas primeiro" (padrão: ligado): na Lista, as tarefas atribuídas a quem está olhando vêm
 * antes das demais (o servidor ordena, `mine_first`); no Kanban os cards da pessoa ficam destacados —
 * lá a ordem de cada coluna é a prioridade manual do time e não muda. Nada fica escondido. A escolha é
 * por pessoa, guardada neste navegador, e vale para as duas telas ao mesmo tempo.
 */
const KEY = 'avanza.tasks.mineFirst'
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshot = () => readJson<boolean>(KEY, true) !== false

export function useMineFirst(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, snapshot, snapshot)
  const set = useCallback((next: boolean) => {
    writeJson(KEY, next)
    listeners.forEach((listener) => listener())
  }, [])
  return [value, set]
}

/** A tarefa é de quem está olhando e o destaque está ligado? */
export function useIsMine(assigneeId: string | null | undefined): boolean {
  const [on] = useMineFirst()
  const me = useSession().current?.user.id
  return on && !!me && assigneeId === me
}
