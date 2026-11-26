import { useCallback, useMemo, useState } from 'react'
import { readJson, writeJson } from '@/core/storage/safe-storage'
import { INBOX_VIEWS, toInboxView, type InboxView } from '@/domain/demands'
import { toGanttGroupBy, toLabelWidth, type GanttGroupBy } from '@/domain/task-gantt'
import { useSession } from '@/features/auth/session'

interface Stored {
  view?: unknown
  groupBy?: unknown
  labelWidth?: unknown
}

interface Chosen {
  view: InboxView
  groupBy: GanttGroupBy
  /** Largura da coluna dos títulos na linha do tempo (§50); null = automática (formato estendido). */
  labelWidth: number | null
}

/** Última escolha da pessoa (neste navegador). */
const viewKey = (userId: string) => `avanza.inbox.view.${userId}`

export interface InboxViewState {
  view: InboxView
  setView: (view: InboxView) => void
  groupBy: GanttGroupBy
  setGroupBy: (groupBy: GanttGroupBy) => void
  labelWidth: number | null
  setLabelWidth: (width: number | null) => void
}

/**
 * Visão da Caixa de entrada (ajuste 25/11): Lista ou Linha do tempo e, na linha do tempo, o agrupamento (por
 * pessoa ou por projeto) e a largura da coluna dos títulos (§50; sem escolha, a automática). Fica lembrada por
 * pessoa neste navegador, como o escopo da Lista; sem escolha guardada, abre na visão do perfil (`initial`, o
 * "Abre em" de `tasks.views`, §48).
 */
export function useInboxView(initial: InboxView = 'list'): InboxViewState {
  const userId = useSession().current?.user.id
  const stored = useMemo(() => (userId ? readJson<Stored | null>(viewKey(userId), null) : null), [userId])
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const storedView = (INBOX_VIEWS as readonly unknown[]).includes(stored?.view) ? toInboxView(stored?.view) : initial
  const current: Chosen = chosen ?? { view: storedView, groupBy: toGanttGroupBy(stored?.groupBy), labelWidth: toLabelWidth(stored?.labelWidth) }
  const save = useCallback(
    (next: Chosen) => {
      setChosen(next)
      // a largura só fica guardada quando a pessoa escolheu uma (sem ela, a automática)
      const { labelWidth, ...rest } = next
      if (userId) writeJson(viewKey(userId), labelWidth === null ? rest : next)
    },
    [userId],
  )
  return {
    view: current.view,
    groupBy: current.groupBy,
    labelWidth: current.labelWidth,
    setView: (view) => save({ ...current, view }),
    setGroupBy: (groupBy) => save({ ...current, groupBy }),
    setLabelWidth: (labelWidth) => save({ ...current, labelWidth }),
  }
}
