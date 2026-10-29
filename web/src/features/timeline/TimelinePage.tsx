import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChartGantt } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { safeStorage } from '@/core/storage/safe-storage'
import { AppEmptyState } from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useLiveProject } from '@/presentation/common/use-live'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { ProjectSwitcher } from '@/features/projects/ProjectSwitcher'
import { useTimeline } from './queries'
import { TimelineView } from './TimelineView'

const LAST_PROJECT_KEY = 'kamban.timeline.project'

/** `/timeline` abre a última timeline usada; `/timeline/:projectId` mostra a do projeto. */
export function TimelinePage() {
  const { projectId } = useParams()
  if (!projectId) {
    const last = safeStorage.get(LAST_PROJECT_KEY)
    return last ? <Navigate to={`/timeline/${encodeURIComponent(last)}`} replace /> : <TimelineShell />
  }
  return <TimelineShell key={projectId} projectId={projectId} />
}

function TimelineShell({ projectId }: { projectId?: string }) {
  useLiveProject(projectId)
  const { t } = useTranslation()
  useDocumentTitle(t('timeline.title'))
  if (!projectId) {
    return (
      <>
        <PageHeader title={t('timeline.title')} description={t('timeline.description')} />
        <AppEmptyState icon={<ChartGantt />} title={t('timeline.pickTitle')} description={t('timeline.pickHint')} action={<ProjectSwitcher screen="timeline" basePath="/timeline" />} />
      </>
    )
  }
  return <ProjectTimeline projectId={projectId} />
}

function ProjectTimeline({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const timeline = useTimeline(projectId)
  const notFound = isAppError(timeline.error) && (timeline.error.code === 'PROJECT_NOT_FOUND' || timeline.error.code === 'FORBIDDEN')

  // lembra o último projeto aberto (e esquece se ele sumiu para a pessoa)
  useEffect(() => {
    if (timeline.data) safeStorage.set(LAST_PROJECT_KEY, timeline.data.project.id)
    if (notFound) safeStorage.remove(LAST_PROJECT_KEY)
  }, [timeline.data, notFound])

  return (
    <>
      <PageHeader
        title={t('timeline.title')}
        description={timeline.data ? timeline.data.project.name : t('timeline.description')}
        actions={<ProjectSwitcher screen="timeline" projectId={projectId} basePath="/timeline" />}
      />
      {notFound ? <AppEmptyState icon={<ChartGantt />} title={t('timeline.notFound')} description={t('timeline.pickHint')} /> : <TimelineView projectId={projectId} />}
    </>
  )
}
