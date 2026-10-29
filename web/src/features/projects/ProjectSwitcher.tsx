import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { ProjectFilterScreen } from '@/domain/project-filter'
import { AppSelect } from '@/presentation/components'
import { cn } from '@/core/utils/cn'
import { ProjectFilterSettingsButton } from './ProjectFilterSettings'
import { useScreenProjects } from './use-project-filter'

/** Valor (e trecho da rota) de "Todos os projetos" nas visões que têm essa opção (Kanban). */
export const ALL_PROJECTS = 'all'

/**
 * Troca o projeto de uma visão por projeto (Kanban, Backlog): navega para `${basePath}/:id`. Com
 * `allOption`, a primeira opção é "Todos os projetos" (`${basePath}/all`). Ao lado, a engrenagem do
 * configurador do filtro de projetos da tela (`screen`): a lista respeita a configuração da pessoa,
 * mas o projeto aberto nunca some.
 */
export function ProjectSwitcher({
  screen,
  projectId,
  basePath,
  className,
  allOption = false,
}: {
  screen: ProjectFilterScreen
  projectId?: string
  basePath: string
  className?: string
  allOption?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const current = projectId && projectId !== ALL_PROJECTS ? [projectId] : []
  const { items } = useScreenProjects(screen, current)
  const options = items.filter((p) => !p.archivedAt || p.id === projectId).map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <AppSelect
        className={cn('min-w-0 flex-1', className ?? 'sm:w-72 sm:flex-none')}
        aria-label={t('projects.switcher')}
        value={projectId}
        placeholder={t('projects.chooseProject')}
        onValueChange={(id) => void navigate(`${basePath}/${encodeURIComponent(id)}`)}
        options={allOption ? [{ value: ALL_PROJECTS, label: t('projects.allProjects') }, ...options] : options}
      />
      <ProjectFilterSettingsButton screen={screen} />
    </div>
  )
}
