import { Navigate, Outlet, useLocation } from 'react-router'
import { hiddenListRedirect } from '@/domain/project-lists'
import { useProjectLists } from './use-project-lists'

/**
 * Listas de Projetos do perfil (ajuste 25/11): o endereço de uma lista que o perfil não mostra leva à primeira
 * visível (com a mesma query, ex.: `?new=1`). Só a tela — a página de um projeto por link direto segue abrindo.
 */
export function ProjectListGate() {
  const { pathname, search } = useLocation()
  const target = hiddenListRedirect(pathname, useProjectLists())
  return target ? <Navigate to={`${target}${search}`} replace /> : <Outlet />
}
