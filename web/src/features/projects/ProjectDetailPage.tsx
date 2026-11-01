import { type ReactNode, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore, ArrowLeft, BriefcaseBusiness, Copy, FolderSearch, KanbanSquare, ListTodo, Pencil, Trash2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { cn } from '@/core/utils/cn'
import { formatDateTime, formatDay } from '@/core/utils/format'
import { isOverdue, type Project } from '@/domain/projects'
import {
  AppAvatar,
  AppBadge,
  AppButton,
  AppCard,
  AppConfirmDialog,
  AppEmptyState,
  AppErrorState,
  AppIconButton,
  AppSelect,
  AppSkeleton,
  AppTabs,
  notify,
} from '@/presentation/components'
import { useLiveProject } from '@/presentation/common/use-live'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { AuditTimeline } from '@/features/audit/AuditTimeline'
import { useCan } from '@/features/auth/session'
import { ProjectTasksPanel } from '@/features/tasks/ProjectTasksPanel'
import { ProjectReportPanel } from './report/ProjectReportPanel'
import { ProjectCharterPanel } from './charter/ProjectCharterPanel'
import { managementLink } from '@/features/plan/paths'
import { PROJECT_ICON_COMPONENTS, coverHeroStyle } from './project-theme'
import { ProjectAvatar, ProjectPriorityLabel, ProjectStatusBadge } from './project-visuals'
import { ProjectFormDialog } from './ProjectFormDialog'
import { ProjectMembersPanel } from './ProjectMembersPanel'
import { ProjectChronology } from './ProjectChronology'
import { useProject, useProjectHistory, useProjectLifecycle, useProjectMembers } from './queries'

export function ProjectDetailPage() {
  const { projectId } = useParams()
  const { t } = useTranslation()
  const project = useProject(projectId)
  useDocumentTitle(project.data?.name ?? t('nav.projects'))
  useLiveProject(project.data?.id)

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

function ProjectDetail({ project }: { project: Project }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const lifecycle = useProjectLifecycle()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [params, setParams] = useSearchParams()
  const archived = !!project.archivedAt
  const caps = project.capabilities
  const canViewTasks = useCan('tasks.view')
  const canViewPlan = useCan('plan.view')
  // a gestão do projeto virou item próprio do menu: links antigos (?tab=plan, ?tab=timeline) vão para lá
  const legacyTab = params.get('tab')
  const legacyPlan = canViewPlan && (legacyTab === 'plan' || legacyTab === 'timeline')
  useEffect(() => {
    if (legacyTab === 'plan' || legacyTab === 'timeline') {
      if (!canViewPlan) setParams({}, { replace: true })
    }
  }, [legacyTab, canViewPlan, setParams])

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

  const tabs = [
    { value: 'overview', label: t('projects.tabs.overview'), content: <Overview project={project} /> },
    // para que o projeto existe, o que entrega e como se mede (objetivos, funcionalidades, alcance e resultados)
    { value: 'charter', label: t('projects.tabs.charter'), content: <ProjectCharterPanel project={project} /> },
    ...(canViewTasks ? [{ value: 'tasks', label: t('projects.tabs.tasks'), content: <ProjectTasksPanel project={project} /> }] : []),
    // quadro de gestão do projeto (Gerenciamento de Projetos — módulo à parte das tarefas)
    { value: 'history', label: t('projects.tabs.history'), content: <ProjectHistory projectId={project.id} /> },
    { value: 'members', label: t('projects.tabs.members', { count: project.memberCount }), content: <ProjectMembersPanel project={project} /> },
  ]
  // onde o informe é montado e baixado (escolha das tarefas na aba Tarefas)
  if (canViewTasks) {
    tabs.push({
      value: 'report',
      label: t('projects.tabs.report'),
      content: <ProjectReportPanel project={project} onChooseTasks={() => setParams({ tab: 'tasks' }, { replace: true })} />,
    })
  }

  // por último, a configuração do projeto
  if (caps.transfer || caps.archive || caps.delete) {
    tabs.push({
      value: 'settings',
      label: t('projects.tabs.settings'),
      content: <ProjectSettings project={project} onArchive={setArchived} onDelete={() => setDeleting(true)} />,
    })
  }

  if (legacyPlan) {
    const next = new URLSearchParams(params)
    next.delete('tab')
    if (legacyTab === 'timeline') next.set('view', 'timeline')
    return <Navigate to={managementLink(project.id, next)} replace />
  }

  return (
    <>
      <Link to={archived ? '/projects/archived' : '/projects'} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {t('projects.backToList')}
      </Link>

      {/* cabeçalho compacto em destaque: a capa do projeto (mais escura) ao fundo, nome grande e o ícone do projeto em marca-d'água */}
      <section className="relative mb-4 overflow-hidden rounded-2xl text-on-cover shadow-card" style={coverHeroStyle(project.cover)}>
        <ProjectWatermark icon={project.icon} />
        <div className="relative flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <ProjectAvatar icon={project.icon} cover={project.cover} size="lg" className="size-12 shrink-0 shadow-float ring-2 ring-on-cover/40 [&_svg]:size-6" />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold tracking-tight drop-shadow-sm sm:text-3xl">{project.name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(project.key).then(() => notify.success(t('common.copied')))}
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
          <div className="flex shrink-0 flex-wrap gap-2">
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

      {archived && (
        <div role="status" className="mb-4 rounded-lg border border-border bg-warning-soft px-4 py-2 text-sm text-warning-soft-fg">
          {t('projects.archivedNotice')}
        </div>
      )}

      <AppTabs
        actionsSlot
        tabs={tabs}
        aria-label={project.name}
        value={tabs.some((tab) => tab.value === params.get('tab')) ? (params.get('tab') as string) : 'overview'}
        // `?tab=tasks` abre direto no plano (links, notificações)
        onValueChange={(value) => setParams(value === 'overview' ? {} : { tab: value }, { replace: true })}
      />

      <ProjectFormDialog open={editing} onOpenChange={setEditing} project={project} />
      <AppConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('projects.deleteTitle', { name: project.name })}
        description={t('projects.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={lifecycle.remove.isPending}
        onConfirm={() =>
          lifecycle.remove.mutate(project.id, {
            onSuccess: () => {
              notify.success(t('projects.deleted', { key: project.key }))
              navigate('/projects/archived', { replace: true })
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm font-medium text-fg">{children}</dd>
    </div>
  )
}

function Overview({ project }: { project: Project }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const overdue = isOverdue(project)
  const canViewBoard = useCan('kanban.view')
  const canViewTasks = useCan('tasks.view')
  const canViewPlan = useCan('plan.view')
  const modules: Array<{ icon: ReactNode; label: string; phase?: number; to?: string; cta?: string }> = [
    ...(canViewTasks ? [{ icon: <ListTodo />, label: t('nav.planning'), to: `/planning/${project.id}`, cta: t('backlog.openBacklog') }] : []),
    ...(canViewBoard ? [{ icon: <KanbanSquare />, label: t('nav.kanban'), to: `/kanban/${project.id}`, cta: t('kanban.openBoard') }] : []),
    ...(canViewPlan ? [{ icon: <BriefcaseBusiness />, label: t('nav.management'), to: managementLink(project.id), cta: t('management.open') }] : []),
  ]
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <AppCard title={t('projects.fields.description')}>
          {project.description ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-fg">{project.description}</p>
          ) : (
            <p className="text-sm text-subtle">{t('projects.noDescription')}</p>
          )}
        </AppCard>
        <AppCard title={t('projects.workTitle')} description={t('projects.workDescription')}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {modules.map((item) => {
              const body = (
                <>
                  <span className={cn('flex size-9 items-center justify-center rounded-lg [&_svg]:size-4', item.to ? 'bg-primary-soft text-primary-soft-fg' : 'bg-surface-2 text-muted')}>
                    {item.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg">{item.label}</span>
                    <span className="block text-xs text-subtle">{item.cta ?? t('pages.comingSoon.badge', { phase: item.phase })}</span>
                  </span>
                </>
              )
              return (
                <li key={item.label}>
                  {item.to ? (
                    <Link to={item.to} className="flex items-center gap-3 rounded-lg border border-border px-3 py-3 transition-colors hover:border-primary hover:bg-surface-2">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-3">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </AppCard>
      </div>
      <AppCard title={t('projects.details')}>
        <dl className="divide-y divide-border">
          <Detail label={t('projects.fields.status')}>
            <ProjectStatusBadge status={project.status} />
          </Detail>
          <Detail label={t('projects.fields.priority')}>
            <ProjectPriorityLabel priority={project.priority} />
          </Detail>
          <Detail label={t('projects.fields.owner')}>
            {project.owner ? (
              <span className="inline-flex items-center gap-2">
                <AppAvatar name={project.owner.name} size="xs" />
                {project.owner.name}
              </span>
            ) : (
              '—'
            )}
          </Detail>
          <Detail label={t('projects.fields.startDate')}>{formatDay(project.startDate, locale)}</Detail>
          <Detail label={t('projects.fields.dueDate')}>
            <span className={cn(overdue && 'text-danger')}>
              {formatDay(project.dueDate, locale)}
              {overdue && <span className="ml-1 text-xs">({t('projects.overdue')})</span>}
            </span>
          </Detail>
          <Detail label={t('users.fields.createdAt')}>{formatDateTime(project.createdAt, locale)}</Detail>
          <Detail label={t('users.fields.updatedAt')}>{formatDateTime(project.updatedAt, locale)}</Detail>
        </dl>
      </AppCard>
    </div>
  )
}

function ProjectHistory({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const history = useProjectHistory(projectId)
  if (history.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <AppSkeleton className="h-12" />
        <AppSkeleton className="h-12" />
      </div>
    )
  }
  if (history.isError) return <AppErrorState onRetry={() => void history.refetch()} />
  // primeiro os fatos pela data em que aconteceram; depois a auditoria (quando cada coisa foi gravada)
  return (
    <div className="flex flex-col gap-4">
      <AppCard title={t('projects.chronology.title')} description={t('projects.chronology.description')}>
        <ProjectChronology projectId={projectId} />
      </AppCard>
      <AppCard title={t('projects.chronology.auditTitle')} description={t('projects.chronology.auditDescription')}>
        <AuditTimeline entries={history.data.items} hiddenFields={['session_id', 'user_id']} />
      </AppCard>
    </div>
  )
}

function ProjectSettings({ project, onArchive, onDelete }: { project: Project; onArchive: (value: boolean) => void; onDelete: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const members = useProjectMembers(project.id)
  const { transfer } = useProjectLifecycle()
  const [newOwner, setNewOwner] = useState<string | undefined>(undefined)
  const [confirmTransfer, setConfirmTransfer] = useState(false)
  const archived = !!project.archivedAt
  const candidates = (members.data ?? []).filter((m) => !m.isOwner && m.user.status === 'active')
  const target = candidates.find((m) => m.user.id === newOwner)

  return (
    <div className="flex flex-col gap-4">
      {project.capabilities.transfer && (
        <AppCard title={t('projects.transferTitle')} description={t('projects.transferDescription')}>
          {candidates.length === 0 ? (
            <p className="text-sm text-subtle">{t('projects.transferNoCandidates')}</p>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <AppSelect
                label={t('projects.newOwner')}
                value={newOwner}
                onValueChange={setNewOwner}
                placeholder={t('projects.selectMember')}
                options={candidates.map((m) => ({ value: m.user.id, label: `${m.user.name} (${m.user.email})` }))}
                className="sm:w-96"
              />
              <AppButton variant="secondary" disabled={!newOwner} onClick={() => setConfirmTransfer(true)}>
                {t('projects.transfer')}
              </AppButton>
            </div>
          )}
        </AppCard>
      )}

      <section className="rounded-xl border border-danger/40 bg-surface p-5">
        <h2 className="text-sm font-semibold text-danger">{t('projects.dangerZone')}</h2>
        <div className="mt-4 flex flex-col divide-y divide-border">
          {project.capabilities.archive && (
            <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-fg">{archived ? t('projects.unarchive') : t('projects.archive')}</p>
                <p className="text-sm text-muted">{archived ? t('projects.unarchiveHint') : t('projects.archiveHint')}</p>
              </div>
              <AppButton variant="secondary" leftIcon={archived ? <ArchiveRestore /> : <Archive />} onClick={() => onArchive(!archived)}>
                {archived ? t('projects.unarchive') : t('projects.archive')}
              </AppButton>
            </div>
          )}
          <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-fg">{t('projects.deleteProject')}</p>
              <p className="text-sm text-muted">{archived ? t('projects.deleteHint') : t('projects.deleteNeedsArchive')}</p>
            </div>
            <AppButton variant="danger" leftIcon={<Trash2 />} disabled={!project.capabilities.delete} onClick={onDelete}>
              {t('common.delete')}
            </AppButton>
          </div>
        </div>
      </section>

      <AppConfirmDialog
        open={confirmTransfer}
        onOpenChange={setConfirmTransfer}
        tone="primary"
        title={t('projects.transferConfirmTitle', { name: target?.user.name ?? '' })}
        description={t('projects.transferConfirmDescription')}
        confirmLabel={t('projects.transfer')}
        loading={transfer.isPending}
        onConfirm={() =>
          newOwner &&
          transfer.mutate(
            { id: project.id, userId: newOwner },
            {
              onSuccess: () => {
                notify.success(t('projects.transferred', { name: target?.user.name ?? '' }))
                setConfirmTransfer(false)
                setNewOwner(undefined)
              },
              onError: (error) => notify.error(errorMessage(error)),
            },
          )
        }
      />
    </div>
  )
}

/** Ícone do projeto grande e translúcido no canto do cabeçalho (decorativo). */
function ProjectWatermark({ icon }: { icon: Project['icon'] }) {
  const Icon = PROJECT_ICON_COMPONENTS[icon]
  return <Icon aria-hidden className="pointer-events-none absolute -bottom-12 right-40 size-44 -rotate-12 text-on-cover opacity-10" />
}
