import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChartGantt, KanbanSquare, List, ListTodo } from 'lucide-react'
import { projectPath, visibleTaskViews, type ProjectTaskView } from '@/domain/project-routes'
import { AppNavTabs } from '@/presentation/components'
import { useSession } from '@/features/auth/session'

const ICONS: Record<ProjectTaskView, ReactNode> = {
  list: <List />,
  kanban: <KanbanSquare />,
  planning: <ListTodo />,
  timeline: <ChartGantt />,
}

/**
 * Visões da aba Tarefas do projeto (Lista, Kanban, Planejamento e Cronograma), cada uma com o seu
 * endereço; só as que a pessoa pode abrir. Com uma visão só, não há o que trocar.
 */
export function ProjectTaskViewsNav({ projectId, current }: { projectId: string; current: ProjectTaskView }) {
  const { t } = useTranslation()
  const { current: session } = useSession()
  const views = visibleTaskViews(session?.permissions ?? [])
  if (views.length < 2) return null
  return (
    <AppNavTabs
      aria-label={t('projects.taskViews.label')}
      variant="pill"
      items={views.map((view) => ({ key: view, to: projectPath(projectId, view), label: t(`projects.taskViews.${view}`), icon: ICONS[view], active: view === current }))}
    />
  )
}
