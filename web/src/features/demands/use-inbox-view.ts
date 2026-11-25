import { useCallback, useMemo, useState } from 'react'
import { readJson, writeJson } from '@/core/storage/safe-storage'
import { INBOX_VIEWS, toInboxView, type InboxView } from '@/domain/demands'
import { toGanttGroupBy, type GanttGroupBy } from '@/domain/task-gantt'
import { useSession } from '@/features/auth/session'

interface Stored {
  view?: unknown
  groupBy?: unknown
}

/** Última escolha da pessoa (neste navegador). */
const viewKey = (userId: string) => `avanza.inbox.view.${userId}`

/**
 * Visão da Caixa de entrada (ajuste 25/11): Lista ou Linha do tempo e, na linha do tempo, o agrupamento (por
 * pessoa ou por projeto). Fica lembrada por pessoa neste navegador, como o escopo da Lista; sem escolha guardada,
 * abre na visão do perfil (`initial`, o "Abre em" de `tasks.views`, §48).
 */
export function useInboxView(initial: InboxView = 'list'): { view: InboxView; setView: (view: InboxView) => void; groupBy: GanttGroupBy; setGroupBy: (groupBy: GanttGroupBy) => void } {
  const userId = useSession().current?.user.id
  const stored = useMemo(() => (userId ? readJson<Stored | null>(viewKey(userId), null) : null), [userId])
  const [chosen, setChosen] = useState<{ view: InboxView; groupBy: GanttGroupBy } | null>(null)
  const storedView = (INBOX_VIEWS as readonly unknown[]).includes(stored?.view) ? toInboxView(stored?.view) : initial
  const current = chosen ?? { view: storedView, groupBy: toGanttGroupBy(stored?.groupBy) }
  const save = useCallback(
    (next: { view: InboxView; groupBy: GanttGroupBy }) => {
      setChosen(next)
      if (userId) writeJson(viewKey(userId), next)
    },
    [userId],
  )
  return {
    view: current.view,
    groupBy: current.groupBy,
    setView: (view) => save({ ...current, view }),
    setGroupBy: (groupBy) => save({ ...current, groupBy }),
  }
}
