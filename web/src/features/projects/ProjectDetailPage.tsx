import { useState } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore, ArrowLeft, Copy, ExternalLink, FolderSearch, FolderTree, Pencil, Trash2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import {
  canOpenSection,
  legacyProjectTab,
  projectPath,
  sectionFromPath,
  tabOfSection,
  visibleProjectTabs,
  visibleTaskViews,
  type ProjectSection,
  type ProjectTab,
} from '@/domain/project-routes'
import { VIEW_STATUSES, isItRole, type Project } from '@/domain/projects'
import { AppBadge, AppButton, AppEmptyState, AppErrorState, AppIcon, AppIconButton, AppNavTabs, AppSkeleton, notify } from '@/presentation/components'
import { useLiveProject } from '@/presentation/common/use-live'
import { TabActionsSlotContext } from '@/presentation/common/tab-actions-slot'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCopy } from '@/presentation/common/use-copy'
import { useSession } from '@/features/auth/session'
import { PROJECT_ICON_COMPONENTS, coverHeroStyle } from './project-theme'
import { ProjectAvatar, ProjectStatusBadge } from './project-visuals'
import { ProjectFormDialog } from './ProjectFormDialog'
import { DeleteProjectDialog } from './DeleteProjectDialog'
import type { ProjectOutletContext } from './project-context'
import { useProject, useProjectLifecycle } from './queries'
import { lastNavChild } from '@/presentation/navigation/nav-memory'

/**
 * Página do projeto — o centro do trabalho: cabeçalho do projeto e as abas Visão geral, Ficha, Gestão,
 * Tarefas (Lista, Kanban, Planejamento e Cronograma), Informe, Arquivos, Membros, Histórico e
 * Configurações, cada uma com o seu endereço (`/projects/:projectId/<seção>`; as abas são rotas filhas).
 * A seção sem sub-navegação põe as suas ações na ponta direita da linha das abas (SectionHeader).
 */
export function ProjectDetailPage() {
  const { projectId } = useParams()
  const { t } = useTranslation()
  const project = useProject(projectId)
  // Responsável TI não assina o projeto (o servidor recusa; o resumo dele se atualiza pelas tarefas)
  useLiveProject(project.data && !isItRole(project.data) ? project.data.id : undefined)

  if (project.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <AppSkeleton className="h-40 rounded-2xl" />
        <AppSkeleton className="h-64 rounded-2xl" />
      </div>
    )
  }
  if (project.isError) {
    if (isAppError(project.error) && project.error.code === 'PROJECT_NOT_FOUND') {
      return (
        <AppEmptyState
          icon={<FolderSearch />}
          title={t('projects.notFoundTitle')}
          description={t('projects.notFoundDescription')}
          action={
            <AppButton asChild variant="secondary">
              <Link to="/projects">{t('projects.backToList')}</Link>
            </AppButton>
          }
        />
      )
    }
    return <AppErrorState onRetry={() => void project.refetch()} />
  }
  return <ProjectDetail project={project.data} />
}

/**
 * "Voltar a projetos": a lista de onde a pessoa veio (Em andamento, Concluídos… com os filtros).
 * Sem lista lembrada (link direto, Panorama), a lista do status do projeto; arquivado, Arquivados.
 */
function backToListPath(status: Project['status'], archived: boolean): string {
  if (archived) return '/projects/archived'
  const last = lastNavChild('projects')
  if (last && !last.startsWith('/projects/archived')) return last
  return VIEW_STATUSES.finished?.includes(status) ? '/projects/finished' : '/projects/ongoing'
}

/** Domínio do enlace (dre.somaxagro.com), para o botão da plataforma. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function ProjectDetail({ project }: { project: Project }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const errorMessage = useErrorMessage()
  const copy = useCopy()
  const lifecycle = useProjectLifecycle()
  const { current } = useSession()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // lugar das ações da seção aberta, à direita da linha das abas
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null)
  const archived = !!project.archivedAt
  const caps = project.capabilities
  const permissions = current?.permissions ?? []
  // Responsável TI (§33): só o resumo e, se o perfil liberar, a Ficha; os demais, as seções do perfil (§35)
  const it = isItRole(project)
  const access = { manage: caps.transfer || caps.archive || caps.delete, sections: caps.sections, it }
  const section = sectionFromPath(pathname, project.id) ?? 'overview'
  const label = sectionLabel(section, project, t)
  useDocumentTitle(label ? `${label} · ${project.name}` : project.name)

  function setArchived(value: boolean) {
    const mutation = value ? lifecycle.archive : lifecycle.unarchive
    mutation.mutate(project.id, {
      onSuccess: () =>
        notify.success(value ? t('projects.archived', { key: project.key }) : t('projects.unarchived', { key: project.key }), {
          undo: value ? { label: t('common.undo'), onClick: () => setArchived(false) } : undefined,
        }),
      onError: (error) => notify.error(errorMessage(error)),
    })
  }

  // endereços antigos com a aba na query (?tab=plan, ?tab=members…): vão para a aba nova, com o resto da query
  if (params.has('tab')) {
    const legacy = legacyProjectTab(params.get('tab'))
    const target = legacy && canOpenSection(legacy.section, permissions, access) ? legacy : { section: 'overview' as const, params: {} }
    const next = new URLSearchParams(params)
    next.delete('tab')
    Object.entries(target.params).forEach(([key, value]) => next.set(key, value))
    return <Navigate to={projectPath(project.id, target.section, next)} replace />
  }
  // aba que a pessoa não pode abrir (link antigo, permissão retirada): fica na visão geral
  if (!canOpenSection(section, permissions, access)) return <Navigate to={projectPath(project.id)} replace />

  const taskViews = visibleTaskViews(permissions)
  const tabPath: Record<ProjectTab, string> = {
    overview: projectPath(project.id),
    charter: projectPath(project.id, 'charter'),
    management: projectPath(project.id, 'management'),
    tasks: projectPath(project.id, taskViews[0] ?? 'list'),
    report: projectPath(project.id, 'report'),
    files: projectPath(project.id, 'files'),
    docs: projectPath(project.id, 'docs'),
    members: projectPath(project.id, 'members'),
    history: projectPath(project.id, 'history'),
    settings: projectPath(project.id, 'settings'),
  }
  const activeTab = tabOfSection(section)
  const outlet: ProjectOutletContext = { project, onArchive: setArchived, onDelete: () => setDeleting(true) }

  return (
    <>
      <Link to={backToListPath(project.status, archived)} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {t('projects.backToList')}
      </Link>

      {it ? (
        <BriefHero project={project} />
      ) : (
        /* cabeçalho compacto em destaque: a capa do projeto (mais escura) ao fundo, nome grande e o ícone do projeto em marca-d'água */
        <section className="relative mb-4 overflow-hidden rounded-2xl text-on-cover shadow-card" style={coverHeroStyle(project.cover)}>
          <ProjectWatermark icon={project.icon} />
          <div className="relative flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <ProjectAvatar icon={project.icon} cover={project.cover} size="lg" className="size-12 shrink-0 shadow-float ring-2 ring-on-cover/40 [&_svg]:size-6" />
              <div className="min-w-0">
                {project.parent && (
                  <Link
                    to={projectPath(project.parent.id)}
                    className="mb-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-on-cover/85 hover:text-on-cover hover:underline focus-visible:outline-2 focus-visible:outline-on-cover"
                    title={t('projects.parent.of', { name: project.parent.name })}
                    aria-label={t('projects.parent.of', { name: project.parent.name })}
                  >
                    <FolderTree className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{project.parent.name}</span>
                  </Link>
                )}
                <h1 className="truncate text-2xl font-bold tracking-tight drop-shadow-sm sm:text-3xl">{project.name}</h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copy(project.key)}
                    className="inline-flex items-center gap-1 rounded-full bg-on-cover/15 px-2 py-0.5 font-mono text-xs font-semibold text-on-cover ring-1 ring-on-cover/25 hover:bg-on-cover/25 focus-visible:outline-2 focus-visible:outline-on-cover"
                    title={t('projects.copyKey')}
                  >
                    {project.key} <Copy className="size-3" aria-hidden />
                  </button>
                  <ProjectStatusBadge status={project.status} />
                  {archived && <AppBadge>{t('projects.archivedBadge')}</AppBadge>}
                  {project.myRole && <AppBadge tone="primary">{t(`projects.roles.${project.myRole}`)}</AppBadge>}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {project.platformUrl && (
                // enlace da plataforma desenvolvida: o destaque do cabeçalho (abre em outra aba)
                <a
                  href={project.platformUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#facc15] px-3 text-sm font-semibold text-[#1d2a05] shadow-sm ring-2 ring-[#facc15]/40 hover:bg-[#fde047] focus-visible:outline-2 focus-visible:outline-on-cover"
                  title={project.platformUrl}
                  data-testid="project-platform-link"
                >
                  <ExternalLink className="size-4" aria-hidden /> {t('projects.openPlatform')}
                  <span className="hidden text-xs font-normal opacity-75 sm:inline">{hostOf(project.platformUrl)}</span>
                </a>
              )}
              {caps.edit && (
                <AppButton variant="secondary" size="sm" leftIcon={<Pencil />} onClick={() => setEditing(true)}>
                  {t('common.edit')}
                </AppButton>
              )}
              {caps.archive && (
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon={archived ? <ArchiveRestore /> : <Archive />}
                  loading={lifecycle.archive.isPending || lifecycle.unarchive.isPending}
                  onClick={() => setArchived(!archived)}
                >
                  {archived ? t('projects.unarchive') : t('projects.archive')}
                </AppButton>
              )}
              {caps.delete && <AppIconButton size="sm" variant="secondary" label={t('common.delete')} icon={<Trash2 />} onClick={() => setDeleting(true)} />}
            </div>
          </div>
        </section>
      )}

      {archived && (
        <div role="status" className="mb-4 rounded-lg border border-border bg-warning-soft px-4 py-2 text-sm text-warning-soft-fg">
          {t('projects.archivedNotice')}
        </div>
      )}

      <AppNavTabs
        aria-label={project.name}
        className="mb-4"
        items={visibleProjectTabs(permissions, access).map((tab) => ({ key: tab, to: tabPath[tab], label: tabLabel(tab, project, t), active: tab === activeTab }))}
        actions={<div ref={setActionsSlot} className="flex items-center gap-2" />}
      />
      <TabActionsSlotContext.Provider value={actionsSlot}>
        <Outlet context={outlet} />
      </TabActionsSlotContext.Provider>

      <ProjectFormDialog open={editing} onOpenChange={setEditing} project={project} />
      <DeleteProjectDialog project={project} open={deleting} onOpenChange={setDeleting} onDeleted={() => navigate('/projects/archived', { replace: true })} />
    </>
  )
}

type Translate = ReturnType<typeof useTranslation>['t']

/** Rótulo da aba (o Responsável TI também vê "Visão geral", com o resumo dele). */
function tabLabel(tab: ProjectTab, project: Project, t: Translate): string {
  return tab === 'members' ? t('projects.tabs.members', { count: project.memberCount }) : t(`projects.tabs.${tab}`)
}

/** Nome da seção no título da aba do navegador ("Kanban · Projeto"); a visão geral é só o projeto. */
function sectionLabel(section: ProjectSection, project: Project, t: Translate): string {
  if (section === 'overview') return ''
  if (section === 'list') return t('projects.tabs.tasks')
  if (section === 'kanban' || section === 'planning' || section === 'timeline') return t(`projects.taskViews.${section}`)
  return tabLabel(section, project, t)
}

/**
 * Cabeçalho do Responsável TI (regras §33): só o nome do projeto e para que ele está ali — sem chave,
 * estado, papel nem ações (nada disso é dele), e sem o projeto pai (que ele não vê).
 */
function BriefHero({ project }: { project: Project }) {
  const { t } = useTranslation()
  return (
    <section className="relative mb-4 overflow-hidden rounded-2xl text-on-cover shadow-card" style={coverHeroStyle(project.cover)}>
      <ProjectWatermark icon={project.icon} />
      <div className="relative flex items-center gap-4 px-5 py-4">
        <ProjectAvatar icon={project.icon} cover={project.cover} size="lg" className="size-12 shrink-0 shadow-float ring-2 ring-on-cover/40 [&_svg]:size-6" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight drop-shadow-sm sm:text-3xl">{project.name}</h1>
          <p className="mt-1 text-sm text-on-cover/85">{t('brief.subtitle')}</p>
        </div>
      </div>
    </section>
  )
}

/** Ícone do projeto grande e translúcido no canto do cabeçalho (decorativo). */
function ProjectWatermark({ icon }: { icon: Project['icon'] }) {
  return <AppIcon name={icon} builtins={PROJECT_ICON_COMPONENTS} fallback={PROJECT_ICON_COMPONENTS.folder} aria-hidden className="pointer-events-none absolute -bottom-12 right-40 size-44 -rotate-12 text-on-cover opacity-10" />
}
