import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChartGantt } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { AppEmptyState } from '@/presentation/components'
import { SectionHeader } from '@/presentation/layouts/SectionHeader'
import { ProjectTaskViewsNav } from '@/features/projects/ProjectTaskViewsNav'
import { useTimeline } from './queries'
import { TimelineView } from './TimelineView'

/**
 * Visão Cronograma (timeline das tarefas e marcos) da aba Tarefas do projeto
 * (`/projects/:projectId/timeline`). O cabeçalho do projeto é o contexto (sem título próprio nem
 * seletor de projeto); o tempo real vem da página do projeto.
 */
export function ProjectTimelinePage() {
  const { projectId = '' } = useParams()
  return <ProjectTimeline key={projectId} projectId={projectId} />
}

function ProjectTimeline({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const timeline = useTimeline(projectId)
  const notFound = isAppError(timeline.error) && (timeline.error.code === 'PROJECT_NOT_FOUND' || timeline.error.code === 'FORBIDDEN')
  return (
    <>
      <SectionHeader nav={<ProjectTaskViewsNav projectId={projectId} current="timeline" />} />
      {notFound ? <AppEmptyState icon={<ChartGantt />} title={t('timeline.notFound')} description={t('timeline.pickHint')} /> : <TimelineView projectId={projectId} />}
    </>
  )
}
