import { useMemo } from 'react'
import { toProjectLists, type ProjectList } from '@/domain/project-lists'
import { useSession } from '@/features/auth/session'

/** As listas do menu Projetos do perfil da pessoa (ajuste 25/11), na ordem do menu; sem escolha, as quatro. */
export function useProjectLists(): ProjectList[] {
  const lists = useSession().current?.role?.projectsLists
  return useMemo(() => toProjectLists(lists), [lists])
}
