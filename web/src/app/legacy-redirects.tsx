import { Navigate, useLocation, useParams } from 'react-router'
import { projectPath, type ProjectSection } from '@/domain/project-routes'
import { useSession } from '@/features/auth/session'
import { visibleNavItems } from '@/presentation/navigation/nav-items'

/**
 * Endereço antigo de uma visão por projeto (`/project-management/:id`, `/planning/:id`, `/backlog/:id`,
 * `/timeline/:id`, `/kanban/:id`) → a aba do projeto. Mantém a query e o fragmento (`?item=`, `?view=`):
 * links de notificações, e-mails e favoritos continuam abrindo no mesmo lugar.
 */
export function LegacyProjectRedirect({ section }: { section: ProjectSection }) {
  const { projectId = '' } = useParams()
  const { search, hash } = useLocation()
  return <Navigate to={`${projectPath(projectId, section, search)}${hash}`} replace />
}

/** /settings → a primeira tela de Configurações que a pessoa pode abrir (na ordem do menu). */
export function SettingsIndexRedirect() {
  const { current } = useSession()
  const settings = visibleNavItems(current?.permissions ?? []).find((item) => item.id === 'settings')
  return <Navigate to={settings?.children?.[0]?.to ?? '/dashboard'} replace />
}
