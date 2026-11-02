import { useOutletContext } from 'react-router'
import type { Project } from '@/domain/projects'

/** O que a página do projeto entrega às abas (rotas filhas). */
export interface ProjectOutletContext {
  project: Project
  onArchive: (value: boolean) => void
  onDelete: () => void
}

/** Projeto aberto na página do projeto (só dentro das abas). */
export function useProjectOutlet(): ProjectOutletContext {
  return useOutletContext<ProjectOutletContext>()
}
