import { useMemo } from 'react'
import { projectListsOf, type ProjectList } from '@/domain/project-lists'
import { useScreens } from '@/features/auth/use-screens'

/** As listas do menu Projetos do perfil da pessoa (§48): a de entrada primeiro; sem escolha, as quatro. */
export function useProjectLists(): ProjectList[] {
  const settings = useScreens().settings
  return useMemo(() => projectListsOf(settings), [settings])
}
