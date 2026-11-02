import { Navigate, useParams, useSearchParams } from 'react-router'
import { projectPath } from '@/domain/project-routes'
import { ProjectBoard } from './ProjectBoard'

/**
 * Aba Gestão da página do projeto (`/projects/:projectId/management`): o quadro de gestão (módulo à
 * parte das tarefas) com as visões Quadro, Cronograma e Gestão. O cabeçalho do projeto é o contexto —
 * sem título próprio nem seletor de projeto.
 */
export function ProjectManagementPage() {
  const { projectId = '' } = useParams()
  const [params] = useSearchParams()
  // a visão Relatórios saiu: a saúde do projeto fica na visão geral
  if (params.get('view') === 'reports') return <Navigate to={projectPath(projectId)} replace />
  return <ProjectBoard key={projectId} projectId={projectId} />
}
