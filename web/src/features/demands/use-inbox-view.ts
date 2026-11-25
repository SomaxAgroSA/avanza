import { useCallback, useMemo, useState } from 'react'
import { readJson, writeJson } from '@/core/storage/safe-storage'
import { toInboxView, type InboxView } from '@/domain/demands'
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
 * pessoa ou por projeto). Fica lembrada por pessoa neste navegador, como o escopo da Lista.
 */
export function useInboxView(): { view: InboxView; setView: (view: InboxView) => void; groupBy: GanttGroupBy; setGroupBy: (groupBy: GanttGroupBy) => void } {
  const userId = useSession().current?.user.id
  const stored = useMemo(() => (userId ? readJson<Stored | null>(viewKey(userId), null) : null), [userId])
  const [chosen, setChosen] = useState<{ view: InboxView; groupBy: GanttGroupBy } | null>(null)
  const current = chosen ?? { view: toInboxView(stored?.view), groupBy: toGanttGroupBy(stored?.groupBy) }
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
