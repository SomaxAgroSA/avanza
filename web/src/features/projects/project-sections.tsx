import { type ReactNode, useState } from 'react'
import { Navigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatDateTime, formatDay } from '@/core/utils/format'
import { projectPath } from '@/domain/project-routes'
import { isOverdue, type Project } from '@/domain/projects'
import { AppAvatar, AppButton, AppCard, AppConfirmDialog, AppErrorState, AppSelect, AppSkeleton, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { AuditTimeline } from '@/features/audit/AuditTimeline'
import { useCan } from '@/features/auth/session'
import { ProjectHealth } from '@/features/plan/PlanHealth'
import { ProjectTasksPanel } from '@/features/tasks/ProjectTasksPanel'
import { UrgencyLabel } from '@/features/tasks/TaskUrgency'
import { AreaBadge } from '@/features/workflow/area-visuals'
import { useProjectOutlet } from './project-context'
import { ProjectChronology } from './ProjectChronology'
import { ProjectFilesPanel } from './ProjectFilesPanel'
import { ProjectMembersPanel } from './ProjectMembersPanel'
import { ProjectTaskViewsNav } from './ProjectTaskViewsNav'
import { ProjectPriorityLabel, ProjectStatusBadge } from './project-visuals'
import { useProjectHistory, useProjectLifecycle, useProjectMembers } from './queries'

/*
 * Abas da página do projeto (rotas filhas de `/projects/:projectId`). O projeto vem da página
 * (useProjectOutlet); as visões Kanban, Planejamento e Cronograma da aba Tarefas e as abas Gestão, Ficha
 * (charter/) e Informe (report/) ficam nos módulos delas (cada uma no seu pedaço do código).
 */

/** Visão geral: saúde do projeto (quando há quadro de gestão), descrição e detalhes. */
export function ProjectOverviewTab() {
  return <Overview project={useProjectOutlet().project} />
}

/** Aba Tarefas, visão Lista (`/projects/:projectId/tasks`). */
export function ProjectTasksTab() {
  const { project } = useProjectOutlet()
  return <ProjectTasksPanel project={project} nav={<ProjectTaskViewsNav projectId={project.id} current="list" />} />
}

/** Documentos do projeto fora das tarefas (contratos, atas, cronogramas). */
export function ProjectFilesTab() {
  return <ProjectFilesPanel project={useProjectOutlet().project} />
}

export function ProjectMembersTab() {
  return <ProjectMembersPanel project={useProjectOutlet().project} />
}

export function ProjectHistoryTab() {
  return <ProjectHistory projectId={useProjectOutlet().project.id} />
}

/** Transferir, arquivar e excluir — só para quem administra o projeto. */
export function ProjectSettingsTab() {
  const { project, onArchive, onDelete } = useProjectOutlet()
  const caps = project.capabilities
  if (!caps.transfer && !caps.archive && !caps.delete) return <Navigate to={projectPath(project.id)} replace />
  return <ProjectSettings project={project} onArchive={onArchive} onDelete={onDelete} />
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
  const canViewPlan = useCan('plan.view')
  return (
    <div className="flex flex-col gap-4">
      {/* saúde do quadro de gestão (só quando o projeto tem quadro com elementos) */}
      {canViewPlan && <ProjectHealth projectId={project.id} />}
      <div className="grid gap-4 lg:grid-cols-3">
        <AppCard title={t('projects.fields.description')} className="lg:col-span-2">
          {project.description ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-fg">{project.description}</p>
          ) : (
            <p className="text-sm text-subtle">{t('projects.noDescription')}</p>
          )}
        </AppCard>
        <AppCard title={t('projects.details')}>
          <dl className="divide-y divide-border">
            <Detail label={t('projects.fields.status')}>
              <ProjectStatusBadge status={project.status} />
            </Detail>
            <Detail label={t('projects.fields.priority')}>
              <ProjectPriorityLabel priority={project.priority} />
            </Detail>
            <Detail label={t('tasks.fields.urgency')}>
              <UrgencyLabel urgency={project.urgency} />
            </Detail>
            <Detail label={t('tasks.fields.area')}>
              <AreaBadge area={project.area} />
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
