import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore, Copy, ExternalLink, FolderPlus, Users } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { cn } from '@/core/utils/cn'
import { formatDay } from '@/core/utils/format'
import {
  PROJECT_PRIORITY_FILTER_ORDER,
  PROJECT_STATUSES,
  PROJECT_URGENCY_FILTER_ORDER,
  VIEW_STATUSES,
  isOverdue,
  projectListFilters,
  type Project,
  type ProjectView,
  type UserSummary,
} from '@/domain/projects'
import {
  AppAvatar,
  AppButton,
  AppDataTable,
  AppEmptyState,
  AppErrorState,
  AppSkeleton,
  notify,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCopy } from '@/presentation/common/use-copy'
import { useCan, useSession } from '@/features/auth/session'
import { ProjectAvatar, ProjectPriorityLabel, ProjectStatusBadge } from './project-visuals'
import { ProjectFormDialog } from './ProjectFormDialog'
import { DeleteProjectDialog } from './DeleteProjectDialog'
import { ProjectPreviewDrawer } from './ProjectPreviewDrawer'
import { useAllOpenProjects, useProjectLifecycle, useProjectTaskCounts, useProjects, useTeamActivity, useTiDependencies, useUpdateProject } from './queries'
import { ActivityCell, TeamActivityDrawer } from './team-activity'
import { activityByProject } from './team-activity-data'
import { UrgencyPicker } from '@/features/tasks/TaskUrgency'
import { AreaPicker } from '@/features/workflow/area-visuals'
import { useAreas } from '@/features/workflow/queries'
import type { Area } from '@/domain/workflow'
import { DirectionPanel } from './direction/DirectionPanel'
import { DEFAULT_PANEL, ONGOING_STATUSES, tableFilters, type PanelFilter } from './direction/direction-data'

const EMPTY: Project[] = []

const TITLES: Record<ProjectView, string> = {
  all: 'nav.projects',
  mine: 'nav.projectsMine',
  ongoing: 'nav.projectsOngoing',
  finished: 'nav.projectsFinished',
  archived: 'nav.projectsArchived',
}

export const AllProjectsPage = () => <ProjectsPage view="all" />
export const MyProjectsPage = () => <ProjectsPage view="mine" />
export const OngoingProjectsPage = () => <ProjectsPage view="ongoing" />
export const FinishedProjectsPage = () => <ProjectsPage view="finished" />
export const ArchivedProjectsPage = () => <ProjectsPage view="archived" />

export function ProjectsPage({ view }: { view: ProjectView }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const copy = useCopy()
  const canCreate = useCan('projects.create')
  // Vista de En marcha do perfil (§41): Direção e gerência = painel de consulta; senão, a lista de gestão de sempre
  const { current: session } = useSession()
  const direction = view === 'ongoing' && session?.role?.ongoingView === 'executive'
  const [panel, setPanel] = useState<PanelFilter>(DEFAULT_PANEL)
  // Equipo ahora: quién está trabajando en cada proyecto (solo en las listas de proyectos en marcha)
  const showActivity = useCan('tasks.view') && view !== 'archived' && view !== 'finished'
  const team = useTeamActivity(showActivity)
  const activity = useMemo(() => activityByProject(team.data), [team.data])
  const [teamOpen, setTeamOpen] = useState(false)
  const createHere = canCreate && view !== 'archived' && view !== 'finished' && !direction
  const [params, setParams] = useSearchParams()

  const table = useDataTableState(`projects-${view}`, { sort: { id: 'name', direction: 'asc' }, columnVisibility: { parent: false } })
  // só os filtros da barra (§37): Departamento/Projeto pai guardados de antes não filtram escondidos — e saem do navegador
  const filters = useMemo(() => projectListFilters(table.query.filters), [table.query.filters])
  const { setFilter } = table
  useEffect(() => {
    Object.keys(table.state.filters)
      .filter((id) => !(id in filters))
      .forEach((id) => setFilter(id, undefined))
  }, [table.state.filters, filters, setFilter])
  // sem as quantidades nos botões (ajuste 18/11): a lista não pede `facets` (a API continua oferecendo)
  // na Direção e gerência o painel (indicador, estado, departamento) soma-se à barra; sem projeto possível, a tabela fica vazia
  const merged = direction ? tableFilters(panel, filters) : null
  const projects = useProjects({ ...table.query, filters: merged ? merged.filters : filters, view: direction ? 'all' : view }, !merged?.empty)
  const rows = merged?.empty ? EMPTY : (projects.data?.items ?? EMPTY)
  const overview = useAllOpenProjects(direction)
  const canSeeTasks = useCan('tasks.view')
  const taskCounts = useProjectTaskCounts(direction && canSeeTasks)
  const ti = useTiDependencies(direction && canSeeTasks)
  const lifecycle = useProjectLifecycle()

  const [viewing, setViewing] = useState<Project | null>(null)
  const [editing, setEditing] = useState<Project | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Project | null>(null)

  // "Criar projeto" vindo da command palette / dashboard (/projects?new=1)
  const creatingFromUrl = canCreate && !direction && params.get('new') === '1'

  function archive(project: Project) {
    lifecycle.archive.mutate(project.id, {
      onSuccess: () =>
        notify.success(t('projects.archived', { key: project.key }), {
          undo: { label: t('common.undo'), onClick: () => unarchive(project) },
        }),
      onError: (error) => notify.error(errorMessage(error)),
    })
  }

  function unarchive(project: Project) {
    lifecycle.unarchive.mutate(project.id, {
      onSuccess: () => notify.success(t('projects.unarchived', { key: project.key })),
      onError: (error) => notify.error(errorMessage(error)),
    })
  }

  const areas = useAreas(false)
  const columns = useMemo<DataTableColumn<Project>[]>(
    () => [
      {
        id: 'name',
        header: t('projects.fields.name'),
        sortable: true,
        hideable: false,
        pinned: true,
        size: 300,
        minSize: 220,
        cell: (project) => (
          <div className="flex min-w-0 items-center gap-3">
            <ProjectAvatar icon={project.icon} cover={project.cover} />
            <div className="min-w-0">
              <Link to={`/projects/${project.id}`} className="block truncate font-medium text-fg hover:text-primary-text hover:underline">
                {project.name}
              </Link>
              <p className="truncate text-xs text-muted">
                <span className="font-mono">{project.key}</span>
                {project.parent && (
                  <span title={t('projects.parent.of', { name: project.parent.name })}>
                    {' · ↳ '}
                    {project.parent.name}
                  </span>
                )}
                {project.childCount > 0 && (
                  <span>
                    {' · '}
                    {t('projects.parent.children', { count: project.childCount })}
                  </span>
                )}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: 'status',
        header: t('projects.fields.status'),
        sortable: true,
        size: 140,
        cell: (project) => <ProjectStatusBadge status={project.status} />,
        // seletor só com os status desta lista (§37); na Direção e gerência, os do indicador escolhido
        filter: {
          label: t('projects.fields.status'),
          options: (direction ? (panel.kpi === 'completed' ? (['completed'] as const) : ONGOING_STATUSES) : (VIEW_STATUSES[view] ?? PROJECT_STATUSES)).map((s) => ({ value: s, label: t(`projects.status.${s}`) })),
        },
      },
      // Gestión, Desarrollo y Trabajando junto al estado: se ven sin desplazar la tabla
      {
        // quem gerencia o projeto (o dono aparece em Membros, com a coroa, e se troca em Configurações)
        id: 'lead',
        header: t('projects.fields.lead'),
        sortable: true,
        size: 190,
        cell: (project) => <PersonCell person={project.lead} />,
      },
      {
        // quem executa a parte técnica
        id: 'dev_lead',
        header: t('projects.fields.devLead'),
        sortable: true,
        size: 190,
        cell: (project) => <PersonCell person={project.devLead} />,
      },
      ...(showActivity
        ? [
            {
              id: 'activity',
              header: t('team.column'),
              size: 280,
              cell: (project: Project) => <ActivityCell entries={activity.get(project.id)} />,
            },
          ]
        : []),
      {
        id: 'priority',
        header: t('projects.fields.priority'),
        sortable: true,
        sortDescFirst: true,
        size: 130,
        cell: (project) => <ProjectPriorityLabel priority={project.priority} />,
        // botões (§37): vários ao mesmo tempo
        filter: {
          label: t('projects.fields.priority'),
          variant: 'buttons',
          options: PROJECT_PRIORITY_FILTER_ORDER.map((p) => ({ value: p, label: t(`projects.priority.${p}`) })),
        },
      },
      {
        // semáforo: quem edita o projeto troca com um clique
        id: 'urgency',
        header: t('tasks.fields.urgency'),
        sortable: true,
        sortDescFirst: true,
        size: 160,
        cell: (project) => <ProjectUrgencyCell project={project} readOnly={direction} />,
        // botões (§37): da menor para a maior, e "sem urgência" no fim
        filter: {
          label: t('tasks.fields.urgency'),
          variant: 'buttons',
          options: PROJECT_URGENCY_FILTER_ORDER.map((u) => ({ value: u, label: t(`tasks.urgency.${u}`) })),
        },
      },
      {
        // área responsável: quem edita o projeto troca com um clique (sem filtro na barra desde §37)
        id: 'area',
        header: t('tasks.fields.area'),
        sortable: true,
        size: 190,
        cell: (project) => <ProjectAreaCell project={project} areas={areas.data ?? []} readOnly={direction} />,
      },
      {
        // projeto pai (§34; sem filtro na barra desde §37)
        id: 'parent',
        header: t('projects.parent.field'),
        size: 200,
        cell: (project) =>
          project.parent ? (
            <Link to={`/projects/${project.parent.id}`} className="block truncate text-muted hover:text-primary-text hover:underline">
              {project.parent.name}
            </Link>
          ) : (
            <span className="text-subtle">—</span>
          ),
      },
      { id: 'members', header: t('projects.fields.members'), sortable: true, sortDescFirst: true, size: 110, align: 'end', cell: (project) => project.memberCount },
      {
        id: 'due_date',
        header: t('projects.fields.dueDate'),
        sortable: true,
        size: 180,
        cell: (project) => (
          <span className={cn(isOverdue(project) ? 'font-medium text-danger' : 'text-muted')} title={isOverdue(project) ? t('projects.overdue') : undefined}>
            {formatDay(project.dueDate, locale)}
          </span>
        ),
      },
    ],
    [t, locale, areas.data, view, showActivity, activity, direction, panel.kpi],
  )

  const emptyState =
    !table.hasActiveFilters && view !== 'archived' ? (
      <AppEmptyState
        icon={<FolderPlus />}
        title={view === 'mine' ? t('projects.emptyMine') : view === 'ongoing' || view === 'finished' ? t(`projects.empty_${view}`) : t('projects.empty')}
        description={t('projects.emptyDescription')}
        action={
          canCreate && !direction ? (
            <AppButton leftIcon={<FolderPlus />} onClick={() => setCreating(true)}>
              {t('projects.create')}
            </AppButton>
          ) : undefined
        }
      />
    ) : undefined

  return (
    <>
      <PageHeader
        title={t(TITLES[view])}
        description={t(`projects.descriptions.${view}`)}
        actions={
          !direction && (showActivity || createHere) ? (
            <div className="flex flex-wrap items-center gap-2">
              {showActivity && (
                <AppButton variant="secondary" leftIcon={<Users />} onClick={() => setTeamOpen(true)}>
                  {t('team.open')}
                </AppButton>
              )}
              {createHere && (
                <AppButton leftIcon={<FolderPlus />} onClick={() => setCreating(true)}>
                  {t('projects.create')}
                </AppButton>
              )}
            </div>
          ) : undefined
        }
      />
      {showActivity && !direction && <TeamActivityDrawer open={teamOpen} onOpenChange={setTeamOpen} />}
      {direction &&
        (overview.isPending ? (
          <div className="mb-6 flex flex-col gap-3" role="status" aria-label={t('direction.loading')}>
            <AppSkeleton className="h-24 rounded-xl" />
            <AppSkeleton className="h-52 rounded-xl" />
          </div>
        ) : overview.isError ? (
          <AppErrorState onRetry={() => void overview.refetch()} />
        ) : (
          <DirectionPanel
            projects={overview.data}
            filter={panel}
            onFilter={setPanel}
            taskCounts={canSeeTasks ? taskCounts.data : undefined}
            ti={canSeeTasks ? ti.data : undefined}
            team={showActivity ? { data: team.data, pending: team.isPending, error: team.isError, retry: () => void team.refetch() } : null}
          />
        ))}

      <AppDataTable
        caption={t(TITLES[view])}
        columns={columns}
        data={rows}
        total={merged?.empty ? 0 : (projects.data?.total ?? 0)}
        getRowId={(project) => project.id}
        table={table}
        loading={projects.isPending && !merged?.empty}
        fetching={projects.isFetching}
        error={projects.isError ? { correlationId: isAppError(projects.error) ? projects.error.correlationId : undefined } : null}
        onRetry={() => void projects.refetch()}
        searchPlaceholder={t('projects.searchPlaceholder')}
        emptyState={emptyState}
        // Direção e gerência: só consulta (o olho); o resto das ações some. As permissões reais continuam as do perfil
        actions={
          direction
            ? { onView: setViewing, hideMore: true }
            : {
              onView: setViewing,
              onOpen: (project) => navigate(`/projects/${project.id}`),
              onEdit: setEditing,
              canEdit: (project) => project.capabilities.edit,
              onDelete: (project) => (project.archivedAt ? setDeleting(project) : archive(project)),
              canDelete: (project) => (project.archivedAt ? project.capabilities.delete : project.capabilities.archive),
              deleteLabel: (project) => (project.archivedAt ? t('common.delete') : t('projects.archive')),
              deleteIcon: (project) => (project.archivedAt ? undefined : <Archive />),
              deleteTone: (project) => (project.archivedAt ? 'danger' : 'ghost'),
              more: (project) => [
                { key: 'open', label: t('projects.open'), icon: <ExternalLink />, onSelect: () => navigate(`/projects/${project.id}`) },
                {
                  key: 'copy',
                  label: t('projects.copyKey'),
                  icon: <Copy />,
                  onSelect: () => void copy(project.key),
                },
                ...(project.archivedAt && project.capabilities.archive
                  ? [{ key: 'unarchive', label: t('projects.unarchive'), icon: <ArchiveRestore />, onSelect: () => unarchive(project) }]
                  : []),
                ...(!project.archivedAt && project.capabilities.archive
                  ? [{ key: 'archive', label: t('projects.archive'), icon: <Archive />, onSelect: () => archive(project) }]
                  : []),
              ],
            }
        }
      />

      <ProjectPreviewDrawer
        project={viewing}
        onOpenChange={(open) => !open && setViewing(null)}
        onEdit={
          direction
            ? undefined
            : (project) => {
                setViewing(null)
                setEditing(project)
              }
        }
      />
      <ProjectFormDialog
        open={creating || creatingFromUrl || !!editing}
        project={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
            if (params.has('new')) setParams({}, { replace: true })
          }
        }}
      />
      <DeleteProjectDialog key={deleting?.id ?? 'none'} project={deleting} open={!!deleting} onOpenChange={(open: boolean) => !open && setDeleting(null)} onDeleted={() => setDeleting(null)} />
    </>
  )
}

/** Pessoa (Gestão ou Desenvolvimento) na lista: avatar e nome; vazio = "—". */
function PersonCell({ person }: { person: UserSummary | null }) {
  if (!person) return <span className="text-subtle">—</span>
  return (
    <div className="flex min-w-0 items-center gap-2">
      <AppAvatar name={person.name} src={person.avatarUrl} size="xs" />
      <span className="truncate">{person.name}</span>
    </div>
  )
}

/** Urgência do projeto na lista: semáforo que quem edita o projeto troca com um clique. */
/** Área responsável do projeto na lista: quem edita o projeto troca com um clique. */
function ProjectAreaCell({ project, areas, readOnly }: { project: Project; areas: Area[]; readOnly: boolean }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const update = useUpdateProject()
  return (
    <AreaPicker
      value={project.area}
      areas={areas}
      canEdit={project.capabilities.edit && !project.archivedAt && !readOnly}
      pending={update.isPending}
      changeLabel={t('areas.change', { name: project.name, area: project.area?.name ?? t('areas.none') })}
      onChoose={(areaId) =>
        update.mutate(
          { id: project.id, data: { areaId } },
          {
            onSuccess: (saved) => notify.success(t('areas.saved', { name: saved.name, area: saved.area?.name ?? t('areas.none') })),
            onError: (error) => notify.error(errorMessage(error)),
          },
        )
      }
    />
  )
}

function ProjectUrgencyCell({ project, readOnly }: { project: Project; readOnly: boolean }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const update = useUpdateProject()
  const label = project.urgency ? t(`tasks.urgency.${project.urgency}`) : t('tasks.urgency.none')
  return (
    <UrgencyPicker
      value={project.urgency}
      canEdit={project.capabilities.edit && !project.archivedAt && !readOnly}
      pending={update.isPending}
      changeLabel={t('projects.urgencyChange', { name: project.name, urgency: label })}
      onChoose={(urgency) =>
        update.mutate(
          { id: project.id, data: { urgency } },
          {
            onSuccess: (saved) => notify.success(t('projects.urgencySaved', { name: saved.name, urgency: saved.urgency ? t(`tasks.urgency.${saved.urgency}`) : t('tasks.urgency.none') })),
            onError: (error) => notify.error(errorMessage(error)),
          },
        )
      }
    />
  )
}
