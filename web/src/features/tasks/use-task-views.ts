import { useMemo } from 'react'
import { inboxPath, taskViewsOf, tasksEntryPath, visibleBoxes, type InboxBox, type TaskViews } from '@/domain/task-views'
import { useCan } from '@/features/auth/session'
import { useScreens } from '@/features/auth/use-screens'

export interface TaskViewsState {
  views: TaskViews
  /** As caixas da Caixa de entrada que a pessoa vê, na ordem da tela (a Todas exige `projects.view_all`). */
  boxes: InboxBox[]
  /** Para onde leva o menu Tarefas. */
  entry: string
  /** A aba Caixa de entrada (a caixa Todas quando é a entrada do perfil). */
  inbox: string
}

/** Tarefas do perfil da pessoa ("O que aparece", §48): a Lista, as caixas e onde o menu abre. */
export function useTaskViews(): TaskViewsState {
  const settings = useScreens().settings
  const seesAll = useCan('projects.view_all')
  return useMemo(() => {
    const views = taskViewsOf(settings)
    return { views, boxes: visibleBoxes(views, seesAll), entry: tasksEntryPath(views, seesAll), inbox: inboxPath(views, seesAll) }
  }, [settings, seesAll])
}
