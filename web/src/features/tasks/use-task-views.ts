import { useMemo } from 'react'
import { inboxPath, tasksEntryPath, toTaskViews, visibleBoxes, type InboxBox, type TaskViews } from '@/domain/task-views'
import { useCan, useSession } from '@/features/auth/session'

export interface TaskViewsState {
  views: TaskViews
  /** As caixas da Caixa de entrada que a pessoa vê, na ordem da tela (a Todas exige `projects.view_all`). */
  boxes: InboxBox[]
  /** Para onde leva o menu Tarefas. */
  entry: string
  /** A aba Caixa de entrada (a caixa Todas quando é a entrada do perfil). */
  inbox: string
}

/** Tarefas do perfil da pessoa (ajustes 23 e 24/11): o que aparece (Lista e caixas) e onde o menu abre. */
export function useTaskViews(): TaskViewsState {
  const role = useSession().current?.role
  const seesAll = useCan('projects.view_all')
  return useMemo(() => {
    const views = toTaskViews(role)
    return { views, boxes: visibleBoxes(views, seesAll), entry: tasksEntryPath(views, seesAll), inbox: inboxPath(views, seesAll) }
  }, [role, seesAll])
}
