import { projectPath } from '@/domain/project-routes'

/** Aba Gestão do projeto, com os parâmetros da tela (visão, painel do elemento…). */
export function managementLink(projectId: string, params?: URLSearchParams | Record<string, string>): string {
  return projectPath(projectId, 'management', params)
}
