import { Navigate, useLocation, useParams } from 'react-router'
import { projectPath, type ProjectSection } from '@/domain/project-routes'
import { useCan, useSession } from '@/features/auth/session'
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

/**
 * Início (/ e o antigo /dashboard, que saiu do menu): a gerência abre no Panorama; os demais, na lista de
 * projetos. Links antigos, o pós-login e "Voltar ao início" passam por aqui.
 */
export function HomeRedirect() {
  const executive = useCan('executive.view')
  return <Navigate to={executive ? '/tracking' : '/projects'} replace />
}

/** /settings → a primeira tela de Configurações que a pessoa pode abrir (na ordem do menu). */
export function SettingsIndexRedirect() {
  const { current } = useSession()
  const settings = visibleNavItems(current?.permissions ?? []).find((item) => item.id === 'settings')
  return <Navigate to={settings?.children?.[0]?.to ?? '/'} replace />
}

/**
 * /settings/roles e /settings/permissions viraram abas do Controle de acesso (regras §35): leva à aba,
 * com o resto da query (`?role=` destaca o perfil na matriz).
 */
export function AccessTabRedirect({ tab }: { tab: 'roles' | 'matrix' }) {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  params.set('tab', tab)
  return <Navigate to={`/settings/access?${params.toString()}`} replace />
}
