import { useMemo } from 'react'
import { inboxPath, showsAllBox, tasksEntryPath, toTaskViews, type TaskViews } from '@/domain/task-views'
import { useCan, useSession } from '@/features/auth/session'

export interface TaskViewsState {
  views: TaskViews
  /** A caixa Todas aparece (`projects.view_all` e o perfil não a escondeu). */
  allBox: boolean
  /** Para onde leva o menu Tarefas. */
  entry: string
  /** A aba Caixa de entrada (a caixa Todas quando é a entrada do perfil). */
  inbox: string
}

/** Tarefas do perfil da pessoa (ajuste 23/11): onde o menu abre, a Lista e a caixa Todas. */
export function useTaskViews(): TaskViewsState {
  const role = useSession().current?.role
  const seesAll = useCan('projects.view_all')
  return useMemo(() => {
    const views = toTaskViews(role)
    return { views, allBox: showsAllBox(views, seesAll), entry: tasksEntryPath(views, seesAll), inbox: inboxPath(views, seesAll) }
  }, [role, seesAll])
}
