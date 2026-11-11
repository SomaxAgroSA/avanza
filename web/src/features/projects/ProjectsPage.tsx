import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore, Copy, ExternalLink, FolderPlus } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { cn } from '@/core/utils/cn'
import { formatDay } from '@/core/utils/format'
import { PROJECT_PRIORITIES, PROJECT_STATUSES, VIEW_STATUSES, isOverdue, type Project, type ProjectView } from '@/domain/projects'
import type { ProjectListQuery } from '@/domain/repositories'
import {
  AppAvatar,
  AppButton,
  AppConfirmDialog,
  AppDataTable,
  AppEmptyState,
  notify,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCopy } from '@/presentation/common/use-copy'
import { useCan } from '@/features/auth/session'
import { ProjectAvatar, ProjectPriorityLabel, ProjectStatusBadge } from './project-visuals'
import { ProjectFormDialog } from './ProjectFormDialog'
import { ProjectPreviewDrawer } from './ProjectPreviewDrawer'
import { useProjectLifecycle, useProjects, useUpdateProject } from './queries'
import { UrgencyPicker } from '@/features/tasks/TaskUrgency'
import { useUrgencyFilterOptions } from '@/features/tasks/urgency-options'
import { AreaPicker } from '@/features/workflow/area-visuals'
import { useAreaFilterOptions } from '@/features/workflow/area-options'
import { useAreas } from '@/features/workflow/queries'
import type { Area } from '@/domain/workflow'

const EMPTY: Project[] = []

const TITLES: Record<ProjectView, string> = {
  all: 'nav.projects',
  mine: 'nav.projectsMine',
  ongoing: 'nav.projectsOngoing',
  finished: 'nav.projectsFinished',
  archived: 'nav.projectsArchived',
}

/** Projetos principais (sem pai), para o filtro "Projeto pai" (§34): os que têm subprojetos viram opção. */
const MAIN_PROJECTS: ProjectListQuery = { view: 'all', page: 1, perPage: 100, sort: { id: 'name', direction: 'asc' }, search: '', filters: { parent: 'none' } }

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
  const [params, setParams] = useSearchParams()

  const table = useDataTableState(`projects-${view}`, { sort: { id: 'name', direction: 'asc' }, columnVisibility: { parent: false } })
  const projects = useProjects({ ...table.query, view })
  const lifecycle = useProjectLifecycle()

  const [viewing, setViewing] = useState<Project | null>(null)
  const [editing, setEditing] = useState<Project | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Project | null>(null)

  // "Criar projeto" vindo da command palette / dashboard (/projects?new=1)
  const creatingFromUrl = canCreate && params.get('new') === '1'

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

  const urgencyOptions = useUrgencyFilterOptions()
  const mainProjects = useProjects(MAIN_PROJECTS)
  const parentOptions = useMemo(
    () => [
      { value: 'none', label: t('projects.parent.onlyMain') },
      ...(mainProjects.data?.items ?? []).filter((p) => p.childCount > 0).map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` })),
    ],
    [mainProjects.data, t],
  )
  const areas = useAreas(false)
  const areaOptions = useAreaFilterOptions(areas.data)
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
        size: 140,
        cell: (project) => <ProjectStatusBadge status={project.status} />,
        filter: { label: t('projects.fields.status'), options: (VIEW_STATUSES[view] ?? PROJECT_STATUSES).map((s) => ({ value: s, label: t(`projects.status.${s}`) })) },
      },
      {
        id: 'priority',
        header: t('projects.fields.priority'),
        size: 130,
        cell: (project) => <ProjectPriorityLabel priority={project.priority} />,
        filter: { label: t('projects.fields.priority'), options: PROJECT_PRIORITIES.map((p) => ({ value: p, label: t(`projects.priority.${p}`) })) },
      },
      {
        // semáforo: quem edita o projeto troca com um clique
        id: 'urgency',
        header: t('tasks.fields.urgency'),
        size: 160,
        cell: (project) => <ProjectUrgencyCell project={project} />,
        filter: { label: t('tasks.fields.urgency'), options: urgencyOptions },
      },
      {
        // área responsável: quem edita o projeto troca com um clique
        id: 'area',
        header: t('tasks.fields.area'),
        size: 190,
        cell: (project) => <ProjectAreaCell project={project} areas={areas.data ?? []} />,
        filter: { label: t('tasks.fields.area'), options: areaOptions },
      },
      {
        // projeto pai (§34): filtra os subprojetos de um pai ou só os projetos principais
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
        filter: { label: t('projects.parent.field'), options: parentOptions },
      },
      {
        id: 'owner',
        header: t('projects.fields.owner'),
        size: 200,
        cell: (project) =>
          project.owner ? (
            <div className="flex min-w-0 items-center gap-2">
              <AppAvatar name={project.owner.name} src={project.owner.avatarUrl} size="xs" />
              <span className="truncate">{project.owner.name}</span>
            </div>
          ) : (
            '—'
          ),
      },
      { id: 'members', header: t('projects.fields.members'), size: 110, align: 'end', cell: (project) => project.memberCount },
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
    [t, locale, urgencyOptions, areas.data, areaOptions, parentOptions, view],
  )

  const emptyState =
    !table.hasActiveFilters && view !== 'archived' ? (
      <AppEmptyState
        icon={<FolderPlus />}
        title={view === 'mine' ? t('projects.emptyMine') : view === 'ongoing' || view === 'finished' ? t(`projects.empty_${view}`) : t('projects.empty')}
        description={t('projects.emptyDescription')}
        action={
          canCreate ? (
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
          canCreate && view !== 'archived' && view !== 'finished' ? (
            <AppButton leftIcon={<FolderPlus />} onClick={() => setCreating(true)}>
              {t('projects.create')}
            </AppButton>
          ) : undefined
        }
      />

      <AppDataTable
        caption={t(TITLES[view])}
        columns={columns}
        data={projects.data?.items ?? EMPTY}
        total={projects.data?.total ?? 0}
        getRowId={(project) => project.id}
        table={table}
        loading={projects.isPending}
        fetching={projects.isFetching}
        error={projects.isError ? { correlationId: isAppError(projects.error) ? projects.error.correlationId : undefined } : null}
        onRetry={() => void projects.refetch()}
        searchPlaceholder={t('projects.searchPlaceholder')}
        // status, prioridade, urgência e área à vista
        maxVisibleFilters={4}
        emptyState={emptyState}
        actions={{
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
        }}
      />

      <ProjectPreviewDrawer
        project={viewing}
        onOpenChange={(open) => !open && setViewing(null)}
        onEdit={(project) => {
          setViewing(null)
          setEditing(project)
        }}
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
      <AppConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('projects.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('projects.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={lifecycle.remove.isPending}
        onConfirm={() =>
          deleting &&
          lifecycle.remove.mutate(deleting.id, {
            onSuccess: () => {
              notify.success(t('projects.deleted', { key: deleting.key }))
              setDeleting(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </>
  )
}

/** Urgência do projeto na lista: semáforo que quem edita o projeto troca com um clique. */
/** Área responsável do projeto na lista: quem edita o projeto troca com um clique. */
function ProjectAreaCell({ project, areas }: { project: Project; areas: Area[] }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const update = useUpdateProject()
  return (
    <AreaPicker
      value={project.area}
      areas={areas}
      canEdit={project.capabilities.edit && !project.archivedAt}
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

function ProjectUrgencyCell({ project }: { project: Project }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const update = useUpdateProject()
  const label = project.urgency ? t(`tasks.urgency.${project.urgency}`) : t('tasks.urgency.none')
  return (
    <UrgencyPicker
      value={project.urgency}
      canEdit={project.capabilities.edit && !project.archivedAt}
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
