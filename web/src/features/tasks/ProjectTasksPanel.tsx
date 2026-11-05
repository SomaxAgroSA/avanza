import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { isItRole, seesSection, type Project } from '@/domain/projects'
import { AppButton } from '@/presentation/components'
import { SectionHeader } from '@/presentation/layouts/SectionHeader'
import { useCan } from '@/features/auth/session'
import { TaskFormDialog } from './TaskFormDialog'
import { TasksTable } from './TasksTable'

/**
 * Visão Lista da aba Tarefas do projeto: a mesma listagem de tarefas, filtrada pelo projeto. "Colunas" e
 * "Nova tarefa" ficam na linha das visões (como nas outras visões), e a barra de filtros numa linha só.
 */
export function ProjectTasksPanel({ project, nav }: { project: Project; nav?: ReactNode }) {
  const { t } = useTranslation()
  const canCreate = useCan('tasks.create') && project.myRole !== 'viewer' && !project.archivedAt
  const [creating, setCreating] = useState(false)
  const [tableActions, setTableActions] = useState<HTMLElement | null>(null)
  return (
    <div className="flex flex-col">
      <SectionHeader
        nav={nav}
        actions={
          <>
            <div ref={setTableActions} className="flex items-center gap-2 empty:hidden" />
            {canCreate && (
              <AppButton leftIcon={<Plus />} onClick={() => setCreating(true)}>
                {t('tasks.create')}
              </AppButton>
            )}
          </>
        }
      />
      <TasksTable
        tableId="project-tasks"
        projectId={project.id}
        actionsSlot={tableActions}
        marks={{ report: seesSection(project, 'report'), itVisible: !isItRole(project) }}
      />
      <TaskFormDialog open={creating} onOpenChange={setCreating} projectId={project.id} />
    </div>
  )
}
