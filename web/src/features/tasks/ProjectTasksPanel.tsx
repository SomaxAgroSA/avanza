import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { Project } from '@/domain/projects'
import { AppButton } from '@/presentation/components'
import { SectionHeader } from '@/presentation/layouts/SectionHeader'
import { useCan } from '@/features/auth/session'
import { TaskFormDialog } from './TaskFormDialog'
import { TasksTable } from './TasksTable'

/** Visão Lista da aba Tarefas do projeto: a mesma listagem de tarefas, filtrada pelo projeto. */
export function ProjectTasksPanel({ project, nav }: { project: Project; nav?: ReactNode }) {
  const { t } = useTranslation()
  const canCreate = useCan('tasks.create') && project.myRole !== 'viewer' && !project.archivedAt
  const [creating, setCreating] = useState(false)
  return (
    <div className="flex flex-col">
      <SectionHeader
        nav={nav}
        actions={
          canCreate && (
            <AppButton leftIcon={<Plus />} onClick={() => setCreating(true)}>
              {t('tasks.create')}
            </AppButton>
          )
        }
      />
      <TasksTable tableId="project-tasks" projectId={project.id} />
      <TaskFormDialog open={creating} onOpenChange={setCreating} projectId={project.id} />
    </div>
  )
}
