import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { Project } from '@/domain/projects'
import { AppButton } from '@/presentation/components'
import { useCan } from '@/features/auth/session'
import { TaskFormDialog } from './TaskFormDialog'
import { TasksTable } from './TasksTable'

/** Aba "Tarefas" da página do projeto: mesma listagem, filtrada pelo projeto. */
export function ProjectTasksPanel({ project }: { project: Project }) {
  const { t } = useTranslation()
  const canCreate = useCan('tasks.create') && project.myRole !== 'viewer' && !project.archivedAt
  const [creating, setCreating] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <TasksTable
        tableId="project-tasks"
        projectId={project.id}
        primaryAction={
          canCreate ? (
            <AppButton leftIcon={<Plus />} onClick={() => setCreating(true)}>
              {t('tasks.create')}
            </AppButton>
          ) : undefined
        }
      />
      <TaskFormDialog open={creating} onOpenChange={setCreating} projectId={project.id} />
    </div>
  )
}
