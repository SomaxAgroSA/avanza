import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AppSelect } from '@/presentation/components'
import { useProjects } from './queries'

const PROJECT_QUERY = { view: 'all' as const, page: 1, perPage: 100, sort: { id: 'name', direction: 'asc' as const }, search: '', filters: {} }

/** Valor (e trecho da rota) de "Todos os projetos" nas visões que têm essa opção (Kanban). */
export const ALL_PROJECTS = 'all'

/**
 * Troca o projeto de uma visão por projeto (Kanban, Backlog): navega para `${basePath}/:id`. Com
 * `allOption`, a primeira opção é "Todos os projetos" (`${basePath}/all`).
 */
export function ProjectSwitcher({ projectId, basePath, className, allOption = false }: { projectId?: string; basePath: string; className?: string; allOption?: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const projects = useProjects(PROJECT_QUERY)
  const options = (projects.data?.items ?? []).filter((p) => !p.archivedAt || p.id === projectId).map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))
  return (
    <AppSelect
      className={className ?? 'w-full sm:w-72'}
      aria-label={t('projects.switcher')}
      value={projectId}
      placeholder={t('projects.chooseProject')}
      onValueChange={(id) => void navigate(`${basePath}/${encodeURIComponent(id)}`)}
      options={allOption ? [{ value: ALL_PROJECTS, label: t('projects.allProjects') }, ...options] : options}
    />
  )
}
