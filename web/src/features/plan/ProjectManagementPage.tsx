import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { BriefcaseBusiness } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { safeStorage } from '@/core/storage/safe-storage'
import { AppEmptyState } from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { ProjectSwitcher } from '@/features/projects/ProjectSwitcher'
import { ProjectBoard } from './ProjectBoard'
import { MANAGEMENT_PATH } from './paths'
import { usePlan } from './queries'

const LAST_PROJECT_KEY = 'kamban.management.project'

/**
 * Gestão de projetos (módulo à parte das tarefas): item próprio do menu lateral, com o seletor de
 * projeto — `/project-management` abre o último projeto usado; `/project-management/:projectId` mostra
 * o quadro do projeto com as visões (Quadro principal, Cronograma, Kanban, Gestão e Relatórios).
 */
export function ProjectManagementPage() {
  const { projectId } = useParams()
  if (!projectId) {
    const last = safeStorage.get(LAST_PROJECT_KEY)
    return last ? <Navigate to={`${MANAGEMENT_PATH}/${encodeURIComponent(last)}`} replace /> : <ManagementShell />
  }
  return <ManagementShell key={projectId} projectId={projectId} />
}

function ManagementShell({ projectId }: { projectId?: string }) {
  const { t } = useTranslation()
  useDocumentTitle(t('management.title'))
  if (!projectId) {
    return (
      <>
        <PageHeader title={t('management.title')} description={t('management.description')} />
        <AppEmptyState icon={<BriefcaseBusiness />} title={t('management.pickTitle')} description={t('management.pickHint')} action={<ProjectSwitcher screen="plan" basePath={MANAGEMENT_PATH} />} />
      </>
    )
  }
  return <ProjectManagement projectId={projectId} />
}

function ProjectManagement({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const plan = usePlan(projectId)
  const notFound = isAppError(plan.error) && (plan.error.code === 'PROJECT_NOT_FOUND' || plan.error.code === 'FORBIDDEN')

  // lembra o último projeto aberto (e esquece se ele sumiu para a pessoa)
  useEffect(() => {
    if (plan.data) safeStorage.set(LAST_PROJECT_KEY, plan.data.project.id)
    if (notFound) safeStorage.remove(LAST_PROJECT_KEY)
  }, [plan.data, notFound])

  return (
    <>
      <PageHeader
        title={t('management.title')}
        description={plan.data ? plan.data.project.name : t('management.description')}
        actions={<ProjectSwitcher screen="plan" projectId={projectId} basePath={MANAGEMENT_PATH} />}
      />
      {notFound ? <AppEmptyState icon={<BriefcaseBusiness />} title={t('management.notFound')} description={t('management.pickHint')} /> : <ProjectBoard projectId={projectId} />}
    </>
  )
}
