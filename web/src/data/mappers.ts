import { DEPENDENCY_RULES, PLAN_STATUS_CATEGORIES, PROGRESS_SOURCES, type Plan, type PlanLink, type PlanGroup, type PlanGroupSummary, type PlanItem, type PlanResource, type PlanStatus } from '@/domain/plan'
import type { PlanFile, PlanUpdate } from '@/domain/plan-updates'
import type { JournalEntryDto, PlanColumnDto, PlanFileDto, PlanIssueDto, PlanReportDto, PlanUpdateDto } from './dtos'
import type { PasswordPolicyDto, PlatformInfoDto, PlatformSettingsDto, PlatformValuesDto } from './dtos'
import type { EmailSettingsDto, OutboxSummaryDto, ResetTokenCheckDto, ApiTokenDto } from './dtos'
import type { ApiToken, ApiTokenState } from '@/domain/api-tokens'
import type { WebhookDto, WebhookDeliveryDto } from './dtos'
import type { Webhook, WebhookDelivery, WebhookDeliveryStatus } from '@/domain/webhooks'
import type { EmailSettingsPatch, EmailSettingsView, OutboxKind, OutboxStatus, OutboxSummary, ResetTokenCheck, ResetTokenState } from '@/domain/email'
import { BRANDING_SLOTS, type PasswordPolicy, type PlatformInfo, type PlatformSettings, type PlatformSettingsValues } from '@/domain/platform'
import { COLUMN_TYPES, type PlanColumn } from '@/domain/plan-columns'
import { HEALTH_FACTORS, ISSUE_STATES, type HealthFactorKey, type HealthLevel, type JournalEntry, type PlanIssue, type PlanReport } from '@/domain/plan-management'
import type { PlanDto, PlanGroupDto, PlanGroupSummaryDto, PlanItemDto, PlanLinkDto, PlanResourceDto, PlanStatusDto } from './dtos'
import type { AuditEntry, CurrentUser, Permission, Role, RoleSummary, Session, User } from '@/domain/entities'
import { isPermissionCode, type PermissionCode } from '@/domain/permissions'
import { DEFAULT_LANGUAGE, isSupportedLanguage } from '@/core/i18n'
import { isThemePreference } from '@/core/theme/theme'
import type { Attachment, ProjectFile } from '@/domain/attachments'
import { NOTIFICATION_TYPES, type AppNotification } from '@/domain/notifications'
import type { ExecutiveDto, ExecutivePersonDto, ExecutiveProjectRefDto } from './dtos'
import type { ExecutiveDashboard, ExecutiveHealth, ExecutivePerson, ExecutiveProjectRef } from '@/domain/executive'
import type { BacklogDto, BoardDto, DocPageDto, DocSpaceDto, DocTreePageDto, DurationDto, MilestoneDto, ReportDto, ReportTaskDto, SprintDto, NotificationDto, TaskRelationsDto, TimelineDto } from './dtos'
import { MILESTONE_STATES, type Milestone, type Timeline } from '@/domain/timeline'
import { SPACE_ICONS, SPACE_VISIBILITIES, type DocPage, type DocSpace, type DocTreePage, type RichContent } from '@/domain/docs'
import { RELATION_TYPES, type TaskRelations } from '@/domain/relations'
import { REPORT_DIMENSIONS, type BreakdownLabel, type Duration, type Report, type ReportDimension, type ReportTask } from '@/domain/reports'
import type { Board } from '@/domain/kanban'
import type { FieldValue } from '@/domain/task-config'
import type { LibraryIconDto } from './dtos'
import type { LibraryIcon } from '@/domain/icons'
import { toIcon } from '@/domain/icons'
import type { AttachmentDto, CommentDto, CustomFieldDto, FieldOptionDto, LookupDto, ProjectFileDto, TagDto, TaskDetailDto, TaskDto, TaskTypeDetailDto, TaskTypeDto } from './dtos'
import type { Tag, TaskComment, TaskDetail, TaskSummary } from '@/domain/tasks'
import { SPRINT_STATES, type Sprint } from '@/domain/sprints'
import type { BacklogView } from '@/domain/backlog'
import { STATUS_CATEGORIES, type LookupItem, type TaskPriority, type TaskStatus } from '@/domain/workflow'
import { toColor } from '@/domain/colors'
import { FIELD_TYPES, OPTION_COLORS, TASK_TYPE_ICONS, type CustomField, type FieldOption, type TaskType, type TaskTypeDetail, type ContentLocale, type TypeTexts } from '@/domain/task-config'
import type { AuditEntryDto, MeDto, PermissionDto, ProjectDto, ProjectMemberDto, RoleDto, SessionDto, UserDto, UserSummaryDto } from './dtos'
import {
  MEMBER_ROLES,
  PROJECT_COVERS,
  PROJECT_ICONS,
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  type Project,
  type ProjectMember,
  type UserSummary,
} from '@/domain/projects'

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Ignora códigos desconhecidos (ex.: permissão nova no backend ainda não mapeada no frontend). */
function toPermissionCodes(codes: string[] | undefined): PermissionCode[] {
  return (codes ?? []).filter(isPermissionCode)
}

export function toUser(dto: UserDto): User {
  return {
    id: dto.id,
    name: dto.name,
    email: dto.email,
    avatarUrl: dto.avatar_url,
    status: dto.status === 'disabled' ? 'disabled' : 'active',
    roleId: dto.role_id,
    locale: isSupportedLanguage(dto.locale) ? dto.locale : DEFAULT_LANGUAGE,
    theme: isThemePreference(dto.theme) ? dto.theme : 'system',
    emailNotifications: dto.email_notifications !== false,
    createdAt: toDate(dto.created_at),
    updatedAt: toDate(dto.updated_at),
    lastLoginAt: toDate(dto.last_login_at),
  }
}

export function toRoleSummary(dto: RoleDto): RoleSummary {
  return { id: dto.id, code: dto.code, name: dto.name, description: dto.description, isSystem: dto.is_system }
}

export function toRole(dto: RoleDto): Role {
  return {
    ...toRoleSummary(dto),
    permissions: toPermissionCodes(dto.permissions),
    userCount: dto.user_count ?? 0,
  }
}

export function toPermission(dto: PermissionDto): Permission | null {
  return isPermissionCode(dto.code) ? { id: dto.id, code: dto.code, module: dto.module } : null
}

export function toSession(dto: SessionDto): Session {
  return {
    id: dto.id,
    ip: dto.ip,
    userAgent: dto.user_agent,
    remember: dto.remember,
    createdAt: toDate(dto.created_at),
    lastSeenAt: toDate(dto.last_seen_at),
    expiresAt: toDate(dto.expires_at),
    current: dto.current,
  }
}

export function toAuditEntry(dto: AuditEntryDto): AuditEntry {
  return {
    id: dto.id,
    entityType: dto.entity_type,
    entityId: dto.entity_id,
    action: dto.action,
    oldValue: dto.old_value,
    newValue: dto.new_value,
    user: dto.user,
    ip: dto.ip,
    correlationId: dto.correlation_id,
    createdAt: toDate(dto.created_at),
  }
}

function oneOf<T extends string>(options: readonly T[], value: string, fallback: T): T {
  return (options as readonly string[]).includes(value) ? (value as T) : fallback
}

export function toUserSummary(dto: UserSummaryDto): UserSummary {
  return { id: dto.id, name: dto.name, email: dto.email, avatarUrl: dto.avatar_url }
}

export function toProject(dto: ProjectDto): Project {
  const role = dto.my_role
  return {
    id: dto.id,
    name: dto.name,
    key: dto.key,
    description: dto.description ?? '',
    icon: toIcon(PROJECT_ICONS, dto.icon, 'folder'),
    cover: toColor(PROJECT_COVERS, dto.cover, 'violet'),
    status: oneOf(PROJECT_STATUSES, dto.status, 'planning'),
    priority: oneOf(PROJECT_PRIORITIES, dto.priority, 'medium'),
    owner: dto.owner ? toUserSummary(dto.owner) : null,
    startDate: toDate(dto.start_date),
    dueDate: toDate(dto.due_date),
    archivedAt: toDate(dto.archived_at),
    createdAt: toDate(dto.created_at),
    updatedAt: toDate(dto.updated_at),
    memberCount: dto.member_count ?? 0,
    myRole: role === 'owner' || role === 'manager' || role === 'member' || role === 'viewer' ? role : null,
    capabilities: {
      edit: !!dto.capabilities?.edit,
      manageMembers: !!dto.capabilities?.manage_members,
      archive: !!dto.capabilities?.archive,
      delete: !!dto.capabilities?.delete,
      transfer: !!dto.capabilities?.transfer,
      uploadFiles: !!dto.capabilities?.upload_files,
    },
  }
}

export function toProjectMember(dto: ProjectMemberDto): ProjectMember {
  return {
    user: { ...toUserSummary(dto.user), status: dto.user.status === 'disabled' ? 'disabled' : 'active' },
    role: oneOf(MEMBER_ROLES, dto.role, 'member'),
    isOwner: dto.is_owner,
    joinedAt: toDate(dto.joined_at),
  }
}

export function toFieldOption(dto: FieldOptionDto): FieldOption {
  return {
    id: dto.id,
    label: dto.label,
    color: toColor(OPTION_COLORS, dto.color, 'gray'),
    order: dto.order,
    isActive: dto.is_active !== false,
  }
}

export function toCustomField(dto: CustomFieldDto): CustomField {
  return {
    id: dto.id,
    name: dto.name,
    label: dto.label,
    type: oneOf(FIELD_TYPES, dto.type, 'text'),
    description: dto.description ?? '',
    config: dto.config ?? {},
    defaultValue: dto.default_value ?? null,
    searchable: !!dto.searchable,
    filterable: !!dto.filterable,
    sortable: !!dto.sortable,
    options: (dto.options ?? []).map(toFieldOption),
    usedBy: dto.used_by ?? [],
    createdAt: toDate(dto.created_at),
    updatedAt: toDate(dto.updated_at),
  }
}

function toLookup(dto: LookupDto): LookupItem {
  return {
    id: dto.id,
    key: dto.key,
    name: dto.name,
    description: dto.description ?? '',
    color: toColor(OPTION_COLORS, dto.color, 'gray'),
    order: dto.order,
    isActive: dto.is_active !== false,
    isDefault: dto.is_default === true,
    createdAt: toDate(dto.created_at),
    updatedAt: toDate(dto.updated_at),
  }
}

export function toStatus(dto: LookupDto): TaskStatus {
  return { ...toLookup(dto), category: oneOf(STATUS_CATEGORIES, dto.category ?? '', 'todo'), wipLimit: dto.wip_limit ?? 0, allowedNext: dto.allowed_next ?? [] }
}

export function toPriority(dto: LookupDto): TaskPriority {
  return toLookup(dto)
}

/** Versões do tipo: pt-BR (original) + en/es; servidor antigo sem traduções usa o próprio texto. */
function toTypeTranslations(dto: TaskTypeDto): Record<ContentLocale, TypeTexts> {
  const source = dto.translations ?? {}
  const version = (locale: ContentLocale): TypeTexts => ({ name: source[locale]?.name ?? '', description: source[locale]?.description ?? '' })
  const original = source['pt-BR'] ? version('pt-BR') : { name: dto.name, description: dto.description ?? '' }
  return { 'pt-BR': original, en: version('en'), es: version('es') }
}

export function toTaskType(dto: TaskTypeDto): TaskType {
  return {
    id: dto.id,
    key: dto.key,
    name: dto.name,
    description: dto.description ?? '',
    translations: toTypeTranslations(dto),
    icon: toIcon(TASK_TYPE_ICONS, dto.icon, 'check-square'),
    color: toColor(OPTION_COLORS, dto.color, 'blue'),
    order: dto.order,
    isActive: dto.is_active !== false,
    fieldCount: dto.field_count ?? 0,
    createdAt: toDate(dto.created_at),
    updatedAt: toDate(dto.updated_at),
  }
}

export function toTaskTypeDetail(dto: TaskTypeDetailDto): TaskTypeDetail {
  return { ...toTaskType(dto), fields: toTypeFields(dto.fields) }
}

function toTypeFields(fields: TaskTypeDetailDto['fields'] | undefined) {
  return (fields ?? []).map((f) => ({
    field: toCustomField(f.field),
    order: f.order,
    required: f.required,
    visible: f.visible,
    showOnCard: f.show_on_card,
    requiredStatusIds: f.required_status_ids ?? [],
  }))
}

export function toReportTask(dto: ReportTaskDto): ReportTask {
  return { ...toTaskSummary(dto), metricHours: dto.metric_hours ?? null }
}

export function toTaskSummary(dto: TaskDto): TaskSummary {
  return {
    id: dto.id,
    code: dto.code,
    number: dto.number,
    title: dto.title,
    project: dto.project,
    type: dto.type
      ? { ...dto.type, icon: toIcon(TASK_TYPE_ICONS, dto.type.icon, 'check-square'), color: toColor(OPTION_COLORS, dto.type.color, 'blue') }
      : null,
    status: dto.status
      ? { ...dto.status, color: toColor(OPTION_COLORS, dto.status.color, 'gray'), category: oneOf(STATUS_CATEGORIES, dto.status.category, 'todo') }
      : null,
    priority: dto.priority ? { ...dto.priority, color: toColor(OPTION_COLORS, dto.priority.color, 'gray') } : null,
    sprint: dto.sprint ? { id: dto.sprint.id, name: dto.sprint.name, state: oneOf(SPRINT_STATES, dto.sprint.state, 'planned') } : null,
    creator: dto.creator ? toUserSummary(dto.creator) : null,
    assignee: dto.assignee ? toUserSummary(dto.assignee) : null,
    reporter: dto.reporter ? toUserSummary(dto.reporter) : null,
    parentTaskId: dto.parent_task_id,
    startDate: toDate(dto.start_date ?? null),
    dueDate: toDate(dto.due_date),
    estimatedHours: dto.estimated_hours ?? null,
    actualHours: dto.actual_hours ?? null,
    startedAt: toDate(dto.started_at),
    completedAt: toDate(dto.completed_at),
    createdAt: toDate(dto.created_at),
    updatedAt: toDate(dto.updated_at),
    tags: (dto.tags ?? []).map((tag) => ({ id: tag.id, name: tag.name, color: toColor(OPTION_COLORS, tag.color, 'gray') })),
    checklistProgress: dto.checklist_progress ?? { done: 0, total: 0 },
    commentCount: dto.comment_count ?? 0,
    attachmentCount: dto.attachment_count ?? 0,
    subtaskProgress: dto.subtask_progress ?? { done: 0, total: 0 },
    blocked: !!dto.blocked,
  }
}

export function toProjectFile(dto: ProjectFileDto): ProjectFile {
  return {
    id: dto.id,
    projectId: dto.project_id,
    name: dto.name,
    mime: dto.mime,
    kind: dto.kind === 'image' ? 'image' : 'document',
    size: dto.size,
    uploadedBy: dto.uploaded_by ? toUserSummary(dto.uploaded_by) : null,
    createdAt: toDate(dto.created_at),
    url: dto.url,
    capabilities: { delete: !!dto.capabilities?.delete },
  }
}

export function toAttachment(dto: AttachmentDto): Attachment {
  return {
    id: dto.id,
    taskId: dto.task_id,
    commentId: dto.comment_id ?? null,
    name: dto.name,
    mime: dto.mime,
    kind: dto.kind === 'image' ? 'image' : 'document',
    size: dto.size,
    uploadedBy: dto.uploaded_by ? toUserSummary(dto.uploaded_by) : null,
    createdAt: toDate(dto.created_at),
    url: dto.url,
    capabilities: { delete: !!dto.capabilities?.delete },
  }
}

export function toNotification(dto: NotificationDto): AppNotification {
  const data = dto.data ?? {}
  const text = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : undefined)
  return {
    id: dto.id,
    type: oneOf(NOTIFICATION_TYPES, dto.type, 'comment'),
    task: dto.task ?? null,
    planItem: dto.plan_item ? { id: dto.plan_item.id, projectId: dto.plan_item.project_id ?? '', name: dto.plan_item.name, projectName: dto.plan_item.project_name } : null,
    actor: dto.actor ? toUserSummary(dto.actor) : null,
    data: { comment: text('comment') ?? text('update'), status: text('status'), due_date: text('due_date') },
    read: !!dto.read,
    createdAt: toDate(dto.created_at),
  }
}

export function toBoard(dto: BoardDto): Board {
  const project = dto.project ?? null
  return {
    project,
    projects: dto.projects ?? (project ? [{ id: project.id, key: project.key, name: project.name }] : []),
    capabilities: { move: !!dto.capabilities?.move, create: !!dto.capabilities?.create },
    columns: dto.columns.map((column) => ({
      status: {
        id: column.status.id,
        key: column.status.key,
        name: column.status.name,
        color: toColor(OPTION_COLORS, column.status.color, 'gray'),
        category: oneOf(STATUS_CATEGORIES, column.status.category, 'todo'),
        isDefault: !!column.status.is_default,
      },
      wipLimit: column.wip_limit ?? 0,
      allowedNext: column.allowed_next ?? [],
      total: column.total,
      truncated: !!column.truncated,
      cards: column.tasks.map((task) => ({
        ...toTaskSummary(task),
        cardFields: (task.card_fields ?? []).map((f) => {
          const field = toCustomField(f.field)
          return { field: { id: field.id, name: field.name, label: field.label, type: field.type, options: field.options, config: field.config }, value: f.value as FieldValue }
        }),
        ...(task.capabilities ? { canMove: !!task.capabilities.move } : {}),
      })),
    })),
  }
}

const docStatus = (value: string): 'draft' | 'published' => (value === 'published' ? 'published' : 'draft')

export function toDocSpace(dto: DocSpaceDto): DocSpace {
  return {
    id: dto.id,
    key: dto.key,
    name: dto.name,
    description: dto.description ?? '',
    icon: toIcon(SPACE_ICONS, dto.icon, 'book'),
    color: toColor(OPTION_COLORS, dto.color, 'blue'),
    visibility: oneOf(SPACE_VISIBILITIES, dto.visibility, 'company'),
    project: dto.project,
    homePageId: dto.home_page_id,
    pageCount: dto.page_count ?? null,
    createdAt: toDate(dto.created_at),
    updatedAt: toDate(dto.updated_at),
    capabilities: { edit: !!dto.capabilities?.edit, manage: !!dto.capabilities?.manage },
  }
}

export function toDocTreePage(dto: DocTreePageDto): DocTreePage {
  return { id: dto.id, parentId: dto.parent_id, title: dto.title, status: docStatus(dto.status), position: dto.position ?? 0, hasDraft: !!dto.has_draft, isHome: !!dto.is_home, updatedAt: toDate(dto.updated_at) }
}

export function toDocPage(dto: DocPageDto): DocPage {
  return {
    id: dto.id,
    space: dto.space,
    parentId: dto.parent_id,
    title: dto.title,
    status: docStatus(dto.status),
    content: (dto.content as unknown as RichContent) ?? null,
    version: dto.version ?? 0,
    publishedAt: toDate(dto.published_at),
    publishedBy: dto.published_by ? toUserSummary(dto.published_by) : null,
    createdBy: dto.created_by ? toUserSummary(dto.created_by) : null,
    isHome: !!dto.is_home,
    ancestors: dto.ancestors ?? [],
    children: (dto.children ?? []).map((c) => ({ id: c.id, title: c.title, status: docStatus(c.status) })),
    draft: dto.draft ? { title: dto.draft.title, by: dto.draft.by ? toUserSummary(dto.draft.by) : null, at: toDate(dto.draft.at) } : null,
    capabilities: { edit: !!dto.capabilities?.edit, manage: !!dto.capabilities?.manage },
  }
}

export function toMilestone(dto: MilestoneDto): Milestone {
  return {
    id: dto.id,
    projectId: dto.project_id,
    name: dto.name,
    description: dto.description ?? '',
    dueDate: dto.due_date.slice(0, 10),
    state: oneOf(MILESTONE_STATES, dto.state, 'pending'),
    createdAt: toDate(dto.created_at),
    updatedAt: toDate(dto.updated_at),
  }
}

export function toTimeline(dto: TimelineDto): Timeline {
  return {
    project: { id: dto.project.id, key: dto.project.key, name: dto.project.name, startDate: toDate(dto.project.start_date), dueDate: toDate(dto.project.due_date), archived: !!dto.project.archived },
    capabilities: { edit: !!dto.capabilities.edit, manageMilestones: !!dto.capabilities.manage_milestones },
    tasks: (dto.tasks ?? []).map(toTaskSummary),
    dependencies: (dto.dependencies ?? []).map((e) => ({ id: e.id, type: e.type === 'depends_on' ? 'depends_on' : 'blocks', from: e.from, to: e.to, conflict: !!e.conflict })),
    milestones: (dto.milestones ?? []).map(toMilestone),
    sprints: (dto.sprints ?? []).map(toSprint),
    truncated: !!dto.truncated,
  }
}

export function toSprint(dto: SprintDto): Sprint {
  return {
    id: dto.id,
    projectId: dto.project_id,
    name: dto.name,
    goal: dto.goal ?? '',
    startDate: dto.start_date ? dto.start_date.slice(0, 10) : null,
    endDate: dto.end_date ? dto.end_date.slice(0, 10) : null,
    state: oneOf(SPRINT_STATES, dto.state, 'planned'),
    order: dto.order ?? 0,
    createdAt: toDate(dto.created_at),
    updatedAt: toDate(dto.updated_at),
  }
}

export function toBacklog(dto: BacklogDto): BacklogView {
  return {
    project: dto.project,
    capabilities: { rank: !!dto.capabilities?.rank, create: !!dto.capabilities?.create, manageSprints: !!dto.capabilities?.manage_sprints },
    statuses: (dto.statuses ?? []).map((s) => ({
      id: s.id,
      key: s.key,
      name: s.name,
      color: toColor(OPTION_COLORS, s.color, 'gray'),
      category: oneOf(STATUS_CATEGORIES, s.category, 'backlog'),
      isDefault: !!s.is_default,
    })),
    sprints: (dto.sprints ?? []).map(toSprint),
    items: (dto.items ?? []).map(toTaskSummary),
    truncated: !!dto.truncated,
  }
}

const duration = (d: DurationDto | undefined): Duration => ({ hours: d?.hours ?? null, count: d?.count ?? 0 })

function toBreakdownLabel(dimension: ReportDimension, label: Record<string, unknown> | null): BreakdownLabel | null {
  if (!label) return null
  const str = (key: string) => String(label[key] ?? '')
  if (dimension === 'status') return { kind: 'status', id: str('id'), name: str('name'), color: toColor(OPTION_COLORS, str('color'), 'gray'), category: oneOf(STATUS_CATEGORIES, str('category'), 'todo') }
  if (dimension === 'priority') return { kind: 'priority', id: str('id'), name: str('name'), color: toColor(OPTION_COLORS, str('color'), 'gray') }
  if (dimension === 'type') return { kind: 'type', id: str('id'), name: str('name'), icon: toIcon(TASK_TYPE_ICONS, str('icon'), 'check-square'), color: toColor(OPTION_COLORS, str('color'), 'blue') }
  if (dimension === 'assignee') return { kind: 'assignee', user: toUserSummary(label as unknown as UserSummaryDto) }
  return { kind: 'project', id: str('id'), key: str('key'), name: str('name') }
}

export function toReport(dto: ReportDto): Report {
  const dimension = oneOf(REPORT_DIMENSIONS, dto.breakdown?.dimension, 'status')
  const i = dto.indicators
  return {
    period: { from: new Date(dto.period.from), to: new Date(dto.period.to), tzOffset: dto.period.tz_offset ?? 0 },
    generatedAt: new Date(dto.generated_at),
    definitions: { bugTypes: dto.definitions?.bug_types ?? [], criticalPriority: dto.definitions?.critical_priority ?? null },
    indicators: {
      total: i.total,
      open: i.open,
      backlog: i.backlog,
      todo: i.todo,
      inProgress: i.in_progress,
      blocked: i.blocked,
      overdue: i.overdue,
      criticalBugs: i.critical_bugs,
      created: i.created,
      completed: i.completed,
      cancelled: i.cancelled,
      leadTime: duration(i.lead_time),
      cycleTime: duration(i.cycle_time),
      bugResolution: duration(i.bug_resolution),
    },
    series: { bucket: dto.series?.bucket === 'week' ? 'week' : 'day', points: dto.series?.points ?? [] },
    breakdown: {
      dimension,
      rows: (dto.breakdown?.rows ?? []).map((row) => ({
        key: row.key,
        label: toBreakdownLabel(dimension, row.label),
        total: row.total,
        open: row.open,
        overdue: row.overdue,
        blocked: row.blocked,
        created: row.created,
        completed: row.completed,
        leadTime: duration(row.lead_time),
      })),
    },
    overdueTasks: (dto.overdue_tasks ?? []).map(toTaskSummary),
  }
}

export function toLibraryIcon(dto: LibraryIconDto): LibraryIcon {
  return {
    name: dto.name,
    createdAt: toDate(dto.created_at),
    createdBy: dto.created_by ? toUserSummary(dto.created_by) : null,
    usage: { projects: dto.usage?.projects ?? 0, taskTypes: dto.usage?.task_types ?? 0, docSpaces: dto.usage?.doc_spaces ?? 0 },
  }
}

export function toTag(dto: TagDto): Tag {
  return { id: dto.id, name: dto.name, color: toColor(OPTION_COLORS, dto.color, 'gray'), taskCount: dto.task_count ?? 0 }
}

export function toComment(dto: CommentDto): TaskComment {
  return {
    id: dto.id,
    taskId: dto.task_id,
    author: dto.author ? toUserSummary(dto.author) : null,
    content: dto.content ?? '',
    mentions: (dto.mentions ?? []).map(toUserSummary),
    attachments: (dto.attachments ?? []).map(toAttachment),
    deleted: !!dto.deleted,
    createdAt: toDate(dto.created_at),
    editedAt: toDate(dto.edited_at),
    capabilities: { edit: !!dto.capabilities?.edit, delete: !!dto.capabilities?.delete },
  }
}

export function toTaskDetail(dto: TaskDetailDto): TaskDetail {
  return {
    ...toTaskSummary(dto),
    description: dto.description ?? '',
    checklist: (dto.checklist ?? []).map((item) => ({ id: item.id, text: item.text, done: !!item.done })),
    customValues: (dto.custom_values ?? {}) as TaskDetail['customValues'],
    fields: toTypeFields(dto.fields),
    parent: dto.parent ?? null,
    forkedFrom: dto.forked_from ?? null,
    capabilities: {
      edit: !!dto.capabilities?.edit,
      delete: !!dto.capabilities?.delete,
      assign: !!dto.capabilities?.assign,
      comment: !!dto.capabilities?.comment,
      link: !!dto.capabilities?.link,
      fork: !!dto.capabilities?.fork,
    },
  }
}

export function toTaskRelations(dto: TaskRelationsDto): TaskRelations {
  return {
    parent: dto.parent ? toTaskSummary(dto.parent) : null,
    children: (dto.children ?? []).map(toTaskSummary),
    subtaskProgress: dto.subtask_progress ?? { done: 0, total: 0 },
    forkedFrom: dto.forked_from ? toTaskSummary(dto.forked_from) : null,
    forks: (dto.forks ?? []).map(toTaskSummary),
    relations: (dto.relations ?? []).map((r) => ({
      id: r.id,
      type: oneOf(RELATION_TYPES, r.type, 'relates'),
      task: toTaskSummary(r.task),
      createdBy: r.created_by ? toUserSummary(r.created_by) : null,
      createdAt: toDate(r.created_at),
      capabilities: { delete: !!r.capabilities?.delete },
    })),
    capabilities: {
      link: !!dto.capabilities?.link,
      fork: !!dto.capabilities?.fork,
      createSubtask: !!dto.capabilities?.create_subtask,
      edit: !!dto.capabilities?.edit,
    },
  }
}

export function toCurrentUser(dto: MeDto): CurrentUser {
  return {
    user: toUser(dto.user),
    role: dto.role ? toRoleSummary(dto.role) : null,
    permissions: toPermissionCodes(dto.permissions),
    session: dto.session ? toSession(dto.session) : null,
  }
}

/* ------------------------------------------------------------------ quadro do projeto */

/** Dia AAAA-MM-DD (a API pode mandar o instante completo). */
const dayOf = (value: string | null | undefined) => (typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : null)

export function toPlanStatus(dto: PlanStatusDto): PlanStatus {
  return {
    id: dto.id,
    name: dto.name,
    color: toColor(OPTION_COLORS, dto.color, 'gray'),
    category: oneOf(PLAN_STATUS_CATEGORIES, dto.category, 'todo'),
    position: dto.position ?? 0,
  }
}

export function toPlanResource(dto: PlanResourceDto): PlanResource {
  return { id: dto.id, name: dto.name, color: toColor(OPTION_COLORS, dto.color ?? '', 'indigo') }
}

function toPlanGroupSummary(dto: PlanGroupSummaryDto): PlanGroupSummary {
  return {
    items: dto.items ?? 0,
    statusCounts: (dto.status_counts ?? []).map((c) => ({ statusId: c.status_id ?? null, count: c.count ?? 0 })),
    startDate: dayOf(dto.start_date),
    endDate: dayOf(dto.end_date),
    estimatedHours: dto.estimated_hours ?? null,
    durationDays: dto.duration_days ?? null,
    progress: dto.progress ?? 0,
    customSums: dto.custom_sums ?? {},
  }
}

export function toPlanGroup(dto: PlanGroupDto): PlanGroup {
  return {
    id: dto.id,
    parentId: dto.parent_id ?? null,
    name: dto.name,
    color: toColor(OPTION_COLORS, dto.color, 'blue'),
    position: dto.position ?? 0,
    number: dto.number ?? null,
    summary: dto.summary ? toPlanGroupSummary(dto.summary) : null,
  }
}

export function toPlanItem(dto: PlanItemDto): PlanItem {
  return {
    id: dto.id,
    groupId: dto.group_id,
    parentId: dto.parent_id ?? null,
    name: dto.name,
    statusId: dto.status_id ?? null,
    startDate: dayOf(dto.start_date),
    endDate: dayOf(dto.end_date),
    dueDate: dayOf(dto.due_date),
    owner: dto.owner ? toUserSummary(dto.owner) : null,
    resourceIds: dto.resource_ids ?? [],
    estimatedHours: dto.estimated_hours ?? null,
    actualHours: dto.actual_hours ?? null,
    durationDays: dto.duration_days ?? null,
    durationManual: dto.duration_manual ?? null,
    progress: { value: dto.progress?.value ?? 0, source: oneOf(PROGRESS_SOURCES, dto.progress?.source ?? '', 'none') },
    progressManual: dto.progress_manual ?? null,
    subitems: dto.subitems ?? 0,
    position: dto.position ?? 0,
    blocked: !!dto.blocked,
    updates: dto.updates ?? 0,
    files: dto.files ?? 0,
    baselineStart: dto.baseline_start ?? null,
    baselineEnd: dto.baseline_end ?? null,
    custom: dto.custom ?? {},
  }
}

export function toPlanLink(dto: PlanLinkDto): PlanLink {
  return { id: dto.id, fromId: dto.from_id, toId: dto.to_id, type: dto.type === 'relates' ? 'relates' : 'blocks' }
}

export function toPlan(dto: PlanDto): Plan {
  return {
    project: { id: dto.project.id, key: dto.project.key, name: dto.project.name, archived: !!dto.project.archived },
    capabilities: { edit: !!dto.capabilities.edit, manage: !!dto.capabilities.manage },
    statuses: (dto.statuses ?? []).map(toPlanStatus),
    resources: (dto.resources ?? []).map(toPlanResource),
    groups: (dto.groups ?? []).map(toPlanGroup),
    items: (dto.items ?? []).map(toPlanItem),
    columns: (dto.columns ?? []).map(toPlanColumn),
    links: (dto.links ?? []).map(toPlanLink),
    settings: { dependencyRule: oneOf(DEPENDENCY_RULES, dto.settings?.dependency_rule ?? '', 'warn'), baselineAt: toDate(dto.settings?.baseline_at ?? null) },
    summary: dto.summary ? toPlanGroupSummary(dto.summary) : null,
    truncated: !!dto.truncated,
  }
}

/* ------------------------------------------------------------------ painel do elemento (GP-3) */

export function toPlanUpdate(dto: PlanUpdateDto): PlanUpdate {
  return {
    id: dto.id,
    itemId: dto.item_id,
    parentId: dto.parent_id ?? null,
    author: dto.author ? toUserSummary(dto.author) : null,
    content: dto.content ?? '',
    mentions: (dto.mentions ?? []).map(toUserSummary),
    deleted: !!dto.deleted,
    createdAt: toDate(dto.created_at),
    editedAt: toDate(dto.edited_at),
    capabilities: { edit: !!dto.capabilities?.edit, delete: !!dto.capabilities?.delete, reply: !!dto.capabilities?.reply },
    files: (dto.files ?? []).map(toPlanFile),
    replies: (dto.replies ?? []).map(toPlanUpdate),
  }
}

export function toPlanFile(dto: PlanFileDto): PlanFile {
  return {
    id: dto.id,
    itemId: dto.item_id,
    updateId: dto.update_id ?? null,
    name: dto.name,
    mime: dto.mime,
    kind: dto.kind === 'image' ? 'image' : 'document',
    size: dto.size,
    uploadedBy: dto.uploaded_by ? toUserSummary(dto.uploaded_by) : null,
    createdAt: toDate(dto.created_at),
    url: dto.url,
    capabilities: { delete: !!dto.capabilities?.delete },
  }
}

/* ------------------------------------------------------------------ quadro — GP-4 (gestão e relatório) */

export function toJournalEntry(dto: JournalEntryDto): JournalEntry {
  return {
    id: dto.id,
    entryDate: dto.entry_date,
    content: dto.content,
    author: dto.author ? toUserSummary(dto.author) : null,
    createdAt: toDate(dto.created_at),
    updatedAt: toDate(dto.updated_at),
    capabilities: { edit: !!dto.capabilities?.edit, delete: !!dto.capabilities?.delete },
  }
}

export function toPlanIssue(dto: PlanIssueDto): PlanIssue {
  return {
    id: dto.id,
    number: dto.number,
    openedOn: dto.opened_on,
    description: dto.description,
    state: oneOf(ISSUE_STATES, dto.state, 'pending'),
    owner: dto.owner ? toUserSummary(dto.owner) : null,
    resolvedOn: dto.resolved_on ?? null,
    createdBy: dto.created_by ? toUserSummary(dto.created_by) : null,
    createdAt: toDate(dto.created_at),
    updatedAt: toDate(dto.updated_at),
    capabilities: { edit: !!dto.capabilities?.edit, delete: !!dto.capabilities?.delete },
  }
}

const HEALTH_LEVELS: readonly HealthLevel[] = ['ok', 'attention', 'critical', 'none']

export function toPlanReport(dto: PlanReportDto): PlanReport {
  return {
    today: dto.today,
    summary: dto.summary,
    schedule: { onTime: dto.schedule.on_time, overdue: dto.schedule.overdue, unscheduled: dto.schedule.unscheduled, done: dto.schedule.done },
    effort: dto.effort,
    resources: dto.resources.map((r) => ({ resourceId: r.resource_id, name: r.name, color: r.color, items: r.items, open: r.open, estimated: r.estimated })),
    groups: dto.groups.map((g) => ({ groupId: g.group_id, number: g.number, name: g.name, color: g.color, items: g.items, done: g.done, overdue: g.overdue, progress: g.progress, estimated: g.estimated, actual: g.actual })),
    health: {
      level: oneOf(HEALTH_LEVELS, dto.health.level, 'none'),
      factors: dto.health.factors
        .filter((f): f is typeof f & { key: HealthFactorKey } => (HEALTH_FACTORS as readonly string[]).includes(f.key))
        .map((f) => ({ ...f, level: oneOf(HEALTH_LEVELS, f.level, 'none') })),
    },
  }
}

/* ------------------------------------------------------------------ quadro — GP-5 (colunas personalizadas) */

export function toPlanColumn(dto: PlanColumnDto): PlanColumn {
  const type = oneOf(COLUMN_TYPES, dto.type, 'text')
  const settings = dto.settings ?? {}
  return {
    id: dto.id,
    name: dto.name,
    type,
    settings: {
      ...(type === 'dropdown' ? { options: (settings.options ?? []).map((o) => ({ id: o.id, name: o.name, color: toColor(OPTION_COLORS, o.color, 'gray') })) } : {}),
      ...(type === 'number' && settings.unit ? { unit: settings.unit } : {}),
    },
    position: dto.position ?? 0,
  }
}

// ---------------------------------------------------------------- Configurador geral

export function toPlatformInfo(dto: PlatformInfoDto): PlatformInfo {
  return {
    name: dto.name || 'Avanza',
    logoLightUrl: dto.logo_light_url ?? null,
    logoDarkUrl: dto.logo_dark_url ?? null,
    faviconUrl: dto.favicon_url ?? null,
    passwordReset: dto.password_reset === true,
  }
}

function toPlatformValues(dto: PlatformValuesDto): PlatformSettingsValues {
  return {
    auditRetentionMonths: dto.audit_retention_months,
    lockoutThreshold: dto.lockout_threshold,
    lockoutBaseMinutes: dto.lockout_base_minutes,
    lockoutMaxMinutes: dto.lockout_max_minutes,
    passwordMinLength: dto.password_min_length,
    passwordRequireMixedCase: dto.password_require_mixed_case,
    passwordRequireSymbol: dto.password_require_symbol,
    platformName: dto.platform_name,
  }
}

/** Valores do formulário -> corpo do PATCH (só o que veio). */
export function fromPlatformValues(values: Partial<PlatformSettingsValues>): Partial<PlatformValuesDto> {
  const keys: Record<keyof PlatformSettingsValues, keyof PlatformValuesDto> = {
    auditRetentionMonths: 'audit_retention_months',
    lockoutThreshold: 'lockout_threshold',
    lockoutBaseMinutes: 'lockout_base_minutes',
    lockoutMaxMinutes: 'lockout_max_minutes',
    passwordMinLength: 'password_min_length',
    passwordRequireMixedCase: 'password_require_mixed_case',
    passwordRequireSymbol: 'password_require_symbol',
    platformName: 'platform_name',
  }
  const out: Partial<PlatformValuesDto> = {}
  ;(Object.keys(values) as (keyof PlatformSettingsValues)[]).forEach((key) => {
    if (values[key] !== undefined) Object.assign(out, { [keys[key]]: values[key] })
  })
  return out
}

export function toPlatformSettings(dto: PlatformSettingsDto): PlatformSettings {
  const branding = Object.fromEntries(BRANDING_SLOTS.map((slot) => [slot, dto.branding?.[slot] ?? null])) as PlatformSettings['branding']
  return {
    values: toPlatformValues(dto.values),
    defaults: toPlatformValues(dto.defaults),
    limits: {
      lockoutThreshold: dto.limits.lockout_threshold,
      lockoutBaseMinutes: dto.limits.lockout_base_minutes,
      lockoutMaxMinutes: dto.limits.lockout_max_minutes,
      passwordMinLength: dto.limits.password_min_length,
      platformNameMax: dto.limits.platform_name.max,
    },
    retentionOptions: dto.retention_options,
    branding,
    updatedAt: dto.updated_at ? new Date(dto.updated_at) : null,
  }
}

export function toPasswordPolicy(dto: PasswordPolicyDto): PasswordPolicy {
  return {
    minLength: dto.min_length,
    maxLength: dto.max_length,
    requireLettersNumbers: dto.require_letters_numbers,
    requireMixedCase: dto.require_mixed_case,
    requireSymbol: dto.require_symbol,
  }
}

// ---------------------------------------------------------------- e-mail (integrações)

export function toEmailSettings(dto: EmailSettingsDto): EmailSettingsView {
  const v = dto.values
  return {
    values: { enabled: v.enabled, host: v.host, port: v.port, username: v.username, tls: v.tls, senderName: v.sender_name, senderAddress: v.sender_address, appUrl: v.app_url },
    hasPassword: dto.has_password,
  }
}

export function fromEmailPatch(patch: EmailSettingsPatch): Record<string, unknown> {
  const keys: Record<string, string> = { senderName: 'sender_name', senderAddress: 'sender_address', appUrl: 'app_url' }
  const out: Record<string, unknown> = {}
  Object.entries(patch).forEach(([key, value]) => {
    if (value !== undefined) out[keys[key] ?? key] = value
  })
  return out
}

const OUTBOX_STATUSES: OutboxStatus[] = ['pending', 'sent', 'failed']
const OUTBOX_KINDS: OutboxKind[] = ['notification', 'password_reset', 'invite', 'test']

export function toOutboxSummary(dto: OutboxSummaryDto): OutboxSummary {
  return {
    counts: dto.counts,
    recent: dto.recent.map((m) => ({
      id: m.id,
      to: m.to,
      kind: oneOf(OUTBOX_KINDS, m.kind, 'notification'),
      subject: m.subject,
      status: oneOf(OUTBOX_STATUSES, m.status, 'pending'),
      attempts: m.attempts,
      lastError: m.last_error,
      createdAt: toDate(m.created_at),
      sentAt: toDate(m.sent_at),
    })),
  }
}

const TOKEN_STATES: ResetTokenState[] = ['valid', 'used', 'expired', 'invalid']

export function toResetTokenCheck(dto: ResetTokenCheckDto): ResetTokenCheck {
  return {
    valid: dto.valid === true,
    state: oneOf(TOKEN_STATES, dto.state, 'invalid'),
    purpose: dto.purpose === 'reset' || dto.purpose === 'invite' ? dto.purpose : null,
    name: dto.name ?? null,
    policy: dto.policy ? toPasswordPolicy(dto.policy) : null,
  }
}

const API_TOKEN_STATES: ApiTokenState[] = ['active', 'expired', 'revoked']

export function toApiToken(dto: ApiTokenDto): ApiToken {
  return {
    id: dto.id,
    name: dto.name,
    prefix: dto.prefix,
    state: oneOf(API_TOKEN_STATES, dto.state, 'active'),
    createdAt: toDate(dto.created_at),
    expiresAt: toDate(dto.expires_at),
    lastUsedAt: toDate(dto.last_used_at),
    lastUsedIp: dto.last_used_ip ?? null,
    revokedAt: toDate(dto.revoked_at),
    revealable: !!dto.revealable,
    user: dto.user ? toUserSummary(dto.user) : null,
  }
}

export function toWebhook(dto: WebhookDto): Webhook {
  return {
    id: dto.id,
    name: dto.name,
    url: dto.url,
    events: dto.events ?? [],
    active: dto.active,
    lastStatus: dto.last_status ?? null,
    lastDeliveryAt: toDate(dto.last_delivery_at),
    consecutiveFailures: dto.consecutive_failures ?? 0,
    createdAt: toDate(dto.created_at),
  }
}

const DELIVERY_STATUSES: WebhookDeliveryStatus[] = ['pending', 'success', 'failed']

export function toWebhookDelivery(dto: WebhookDeliveryDto): WebhookDelivery {
  return {
    id: dto.id,
    webhookId: dto.webhook_id,
    event: dto.event,
    status: oneOf(DELIVERY_STATUSES, dto.status, 'pending'),
    attempts: dto.attempts,
    responseStatus: dto.response_status ?? null,
    responseBody: dto.response_body ?? null,
    error: dto.error ?? null,
    durationMs: dto.duration_ms ?? null,
    nextAttemptAt: toDate(dto.next_attempt_at),
    deliveredAt: toDate(dto.delivered_at),
    createdAt: toDate(dto.created_at),
  }
}

/* ------------------------------------------------------------------ painel executivo */

const projectRef = (dto: ExecutiveProjectRefDto): ExecutiveProjectRef => ({ id: dto.id, key: dto.key, name: dto.name })
const person = (dto: ExecutivePersonDto | null | undefined): ExecutivePerson | null => (dto ? { id: dto.id, name: dto.name, avatarUrl: dto.avatar_url ?? null } : null)

function toExecutiveHealth(dto: ExecutiveDto['portfolio'][number]['health'] | null | undefined): ExecutiveHealth {
  if (!dto) return { level: 'none', factors: [] }
  return {
    level: oneOf(HEALTH_LEVELS, dto.level, 'none'),
    factors: (dto.factors ?? [])
      .filter((f): f is typeof f & { key: HealthFactorKey } => (HEALTH_FACTORS as readonly string[]).includes(f.key))
      .map((f) => ({ ...f, level: oneOf(HEALTH_LEVELS, f.level, 'none') })),
  }
}

export function toExecutiveDashboard(dto: ExecutiveDto): ExecutiveDashboard {
  const s = dto.summary
  const plan = dto.plan
  const k = dto.kanban
  return {
    generatedAt: new Date(dto.generated_at),
    period: { from: toDate(dto.period?.from), to: toDate(dto.period?.to) ?? new Date(dto.generated_at) },
    projects: (dto.projects ?? []).map((p) => ({
      ...projectRef(p),
      cover: toColor(PROJECT_COVERS, p.color, 'violet'),
      icon: toIcon(PROJECT_ICONS, p.icon, 'folder'),
      archived: !!p.archived,
    })),
    summary: {
      activeProjects: s.active_projects,
      health: { ok: s.health.ok ?? 0, attention: s.health.attention ?? 0, critical: s.health.critical ?? 0, none: s.health.none ?? 0 },
      progress: s.progress ?? null,
      deliveries: { tasks: s.deliveries.tasks, planItems: s.deliveries.plan_items, milestones: s.deliveries.milestones },
      overdue: { tasks: s.overdue.tasks, planItems: s.overdue.plan_items },
      openIssues: s.open_issues,
      criticalBugs: s.critical_bugs,
    },
    portfolio: (dto.portfolio ?? []).map((row) => ({
      project: {
        ...projectRef(row.project),
        cover: toColor(PROJECT_COVERS, row.project.color, 'violet'),
        icon: toIcon(PROJECT_ICONS, row.project.icon, 'folder'),
        status: oneOf(PROJECT_STATUSES, row.project.status, 'active'),
        priority: oneOf(PROJECT_PRIORITIES, row.project.priority, 'medium'),
        startDate: row.project.start_date ?? null,
        dueDate: row.project.due_date ?? null,
        owner: person(row.project.owner),
      },
      health: toExecutiveHealth(row.health),
      progress:
        row.progress && typeof row.progress.value === 'number' ? { value: row.progress.value, source: row.progress.source === 'plan' ? 'plan' : 'tasks' } : null,
      plan: row.plan ?? null,
      tasks: row.tasks,
      nextMilestone: row.next_milestone ? { id: row.next_milestone.id, name: row.next_milestone.name, dueDate: row.next_milestone.due_date } : null,
      openIssues: row.open_issues ?? 0,
    })),
    plan: plan
      ? {
          items: plan.items,
          statusDistribution: (plan.status_distribution ?? []).map((d) => ({ category: oneOf([...PLAN_STATUS_CATEGORIES, 'none'] as const, d.category, 'none'), count: d.count })),
          schedule: { onTime: plan.schedule.on_time, overdue: plan.schedule.overdue, unscheduled: plan.schedule.unscheduled, done: plan.schedule.done },
          effort: { estimated: plan.effort.estimated ?? null, actual: plan.effort.actual ?? null, remaining: plan.effort.remaining ?? null },
          issues: (plan.issues ?? []).map((i) => ({
            id: i.id,
            number: i.number,
            description: i.description,
            state: oneOf(ISSUE_STATES, i.state, 'pending'),
            openedOn: i.opened_on ?? null,
            project: projectRef(i.project),
          })),
          openIssuesTotal: plan.open_issues_total ?? 0,
          upcomingMilestones: (plan.upcoming_milestones ?? []).map((m) => ({ id: m.id, name: m.name, dueDate: m.due_date, project: projectRef(m.project) })),
        }
      : null,
    kanban: {
      funnel: { backlog: k.funnel.backlog ?? 0, todo: k.funnel.todo ?? 0, in_progress: k.funnel.in_progress ?? 0, done: k.funnel.done ?? 0, cancelled: k.funnel.cancelled ?? 0 },
      created: k.created,
      completed: k.completed,
      leadTime: duration(k.lead_time),
      cycleTime: duration(k.cycle_time),
      overdue: k.overdue,
      blocked: k.blocked,
      criticalBugs: k.critical_bugs,
      overdueTasks: (k.overdue_tasks ?? []).map((task) => ({
        id: task.id,
        code: task.code ?? null,
        title: task.title,
        project: projectRef(task.project),
        dueDate: task.due_date,
        status: {
          id: task.status.id,
          name: task.status.name,
          color: toColor(OPTION_COLORS, task.status.color, 'gray'),
          category: (STATUS_CATEGORIES as readonly string[]).includes(task.status.category ?? '') ? oneOf(STATUS_CATEGORIES, task.status.category ?? '', 'todo') : undefined,
        },
      })),
    },
    timeline: {
      bucket: dto.timeline?.bucket === 'week' ? 'week' : 'month',
      points: (dto.timeline?.points ?? []).map((p) => ({ start: p.start, tasksCreated: p.tasks_created, tasksCompleted: p.tasks_completed, planItemsCompleted: p.plan_items_completed })),
    },
    achievements: (dto.achievements ?? []).map((a) => ({
      project: { ...projectRef(a.project), archived: !!a.project.archived },
      tasksDone: a.tasks_done,
      planItemsDone: a.plan_items_done,
      milestonesDone: (a.milestones_done ?? []).map((m) => ({ id: m.id, name: m.name, dueDate: m.due_date ?? null })),
      recent: (a.recent ?? []).map((r) => ({ kind: r.kind === 'plan_item' ? 'plan_item' : 'task', id: r.id, code: r.code ?? null, title: r.title, completedAt: toDate(r.completed_at) })),
    })),
  }
}
