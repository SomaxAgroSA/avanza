import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Crown, Pencil } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDateTime, formatDay } from '@/core/utils/format'
import { seesSection, type Project } from '@/domain/projects'
import { AppAvatar, AppBadge, AppButton, AppDrawer, AppErrorState, AppSkeleton } from '@/presentation/components'
import { useProjectMembers } from './queries'
import { coverStyle } from './project-theme'
import { UrgencyLabel } from '@/features/tasks/TaskUrgency'
import { AreaBadge } from '@/features/workflow/area-visuals'
import { ProjectAvatar, ProjectPriorityLabel, ProjectStatusBadge } from './project-visuals'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm font-medium text-fg">{children}</dd>
    </div>
  )
}

/** Quem participa do projeto: pessoa, e-mail e papel (dono em destaque). */
function MembersSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const members = useProjectMembers(projectId)
  return (
    <section aria-labelledby="project-preview-members" className="flex flex-col gap-2">
      <h3 id="project-preview-members" className="text-sm font-semibold text-fg">
        {t('projects.fields.members')}
        {members.data && <span className="font-normal text-muted"> · {members.data.length}</span>}
      </h3>
      {members.isPending ? (
        <AppSkeleton className="h-28 rounded-lg" />
      ) : members.isError ? (
        <AppErrorState correlationId={isAppError(members.error) ? members.error.correlationId : undefined} onRetry={() => void members.refetch()} />
      ) : (
        <ul aria-labelledby="project-preview-members" className="divide-y divide-border rounded-lg border border-border">
          {members.data.map((member) => (
            <li key={member.user.id} className="flex items-center gap-3 px-4 py-2.5">
              <AppAvatar name={member.user.name} src={member.user.avatarUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{member.user.name}</p>
                <p className="truncate text-xs text-muted">{member.user.email}</p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                {member.user.status === 'disabled' && <AppBadge tone="danger">{t('users.status.disabled')}</AppBadge>}
                {member.isOwner ? (
                  <AppBadge tone="warning">
                    <Crown /> {t('projects.roles.owner')}
                  </AppBadge>
                ) : (
                  <AppBadge tone="primary">{t(`projects.roles.${member.role}`)}</AppBadge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** "Visualizar" de projeto: resumo sem sair da listagem, com atalho para a página completa. */
export function ProjectPreviewDrawer({
  project,
  onOpenChange,
  onEdit,
}: {
  project: Project | null
  onOpenChange: (open: boolean) => void
  onEdit?: (project: Project) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  return (
    <AppDrawer
      open={!!project}
      onOpenChange={onOpenChange}
      title={project?.name ?? ''}
      description={project?.key}
      footer={
        project && (
          <>
            {project.capabilities.edit && onEdit && (
              <AppButton variant="secondary" leftIcon={<Pencil />} onClick={() => onEdit(project)}>
                {t('common.edit')}
              </AppButton>
            )}
            <AppButton asChild rightIcon={<ArrowRight />}>
              <Link to={`/projects/${project.id}`}>{t('projects.open')}</Link>
            </AppButton>
          </>
        )
      }
    >
      {project && (
        <div className="flex flex-col gap-5">
          <div className="relative overflow-hidden rounded-xl">
            <div className="h-20" style={coverStyle(project.cover)} />
            <div className="absolute bottom-3 left-4">
              <ProjectAvatar icon={project.icon} cover={project.cover} size="lg" className="ring-4 ring-surface" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ProjectStatusBadge status={project.status} />
            {project.archivedAt && <AppBadge>{t('projects.archivedBadge')}</AppBadge>}
            {project.myRole && <AppBadge tone="primary">{t(`projects.roles.${project.myRole}`)}</AppBadge>}
          </div>
          {project.description ? (
            <p className="whitespace-pre-line text-sm text-fg">{project.description}</p>
          ) : (
            <p className="text-sm text-subtle">{t('projects.noDescription')}</p>
          )}
          <dl className="divide-y divide-border rounded-lg border border-border px-4">
            <Row label={t('projects.fields.priority')}>
              <ProjectPriorityLabel priority={project.priority} />
            </Row>
            <Row label={t('tasks.fields.urgency')}>
              <UrgencyLabel urgency={project.urgency} />
            </Row>
            <Row label={t('tasks.fields.area')}>
              <AreaBadge area={project.area} />
            </Row>
            {project.parent && <Row label={t('projects.parent.field')}>{project.parent.name}</Row>}
            {project.childCount > 0 && <Row label={t('projects.parent.childrenTitle')}>{project.childCount}</Row>}
            <Row label={t('projects.fields.owner')}>
              {project.owner ? (
                <span className="inline-flex items-center gap-2">
                  <AppAvatar name={project.owner.name} size="xs" />
                  {project.owner.name}
                </span>
              ) : (
                '—'
              )}
            </Row>
            <Row label={t('projects.fields.members')}>{project.memberCount}</Row>
            <Row label={t('projects.fields.startDate')}>{formatDay(project.startDate, locale)}</Row>
            <Row label={t('projects.fields.dueDate')}>{formatDay(project.dueDate, locale)}</Row>
            <Row label={t('users.fields.createdAt')}>{formatDateTime(project.createdAt, locale)}</Row>
          </dl>
          {/* sem a seção Membros (§35) — e para o Responsável TI — a lista de membros não aparece */}
          {seesSection(project, 'members') && <MembersSection projectId={project.id} />}
        </div>
      )}
    </AppDrawer>
  )
}
