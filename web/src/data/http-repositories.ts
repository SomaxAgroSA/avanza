import type { ApiClient } from '@/core/networking/api-client'
import { isAppError } from '@/core/errors/app-error'
import { toSortParam, type ListQuery, type Page } from '@/domain/pagination'
import type {
  AuditRepository,
  AuthRepository,
  CreateUserData,
  ProjectData,
  ProjectRepository,
  Repositories,
  RoleData,
  RoleRepository,
  UpdateUserData,
  UserRepository,
} from '@/domain/repositories'
import type { Permission } from '@/domain/entities'
import type { ExecutiveDto } from './dtos'
import { toExecutiveDashboard } from './mappers'
import type { BacklogDto, BoardDto, MilestoneDto, ReportDto, ReportTaskDto, SprintDto, NotificationDto, TaskRelationDto, TaskRelationsDto, TimelineDto } from './dtos'
import type { MilestoneInput } from '@/domain/timeline'
import type { CharterItemInput } from '@/domain/charter'
import type { Urgency } from '@/domain/urgency'
import type { CharterDto, CharterItemDto, CharterMeasurementDto, ProjectBriefDto } from './dtos'
import { toCharterItem, toCharterMeasurement, toProjectBrief, toProjectCharter } from './mappers'
import { toDocPage, toDocSpace, toDocTreePage, toMilestone, toPlan, toPlanFile, toPlanGroup, toPlanItem, toPlanLink, toPlanResource, toPlanStatus, toPlanUpdate, toTimeline } from './mappers'
import type { JournalEntryDto, PlanColumnDto, PlanDto, PlanFileDto, PlanGroupDto, PlanIssueDto, PlanItemDto, PlanLinkDto, PlanReportDto, PlanResourceDto, PlanStatusDto, PlanUpdateDto } from './dtos'
import { toJournalEntry, toPlanColumn, toPlanIssue, toPlanReport } from './mappers'
import type { ColumnTypePreview } from '@/domain/plan-columns'
import type { PasswordPolicyDto, PlatformInfoDto, PlatformSettingsDto } from './dtos'
import { fromPlatformValues, toPasswordPolicy, toPlatformInfo, toPlatformSettings } from './mappers'
import type { ApiTokenRepository, EmailRepository, PlatformRepository, WebhookRepository } from '@/domain/repositories'
import type { WebhookDto, WebhookDeliveryDto } from './dtos'
import { toWebhook, toWebhookDelivery } from './mappers'
import type { WebhookCatalog } from '@/domain/webhooks'
import type { ApiTokenDto } from './dtos'
import { toApiToken } from './mappers'
import type { EmailSettingsDto, OutboxSummaryDto, ResetTokenCheckDto } from './dtos'
import { fromEmailPatch, toEmailSettings, toOutboxSummary, toResetTokenCheck } from './mappers'
import type { FlushResult } from '@/domain/email'
import type { IssueInput, JournalInput } from '@/domain/plan-management'
import type { PlanBulkInput, PlanBulkResult, PlanGroupInput, PlanImportResult, PlanImportRow, PlanItemInput } from '@/domain/plan'
import type { DocPageDto, DocSpaceDto, DocTreePageDto } from './dtos'
import type { DocFile, DocSpaceInput, RichContent } from '@/domain/docs'
import type { SprintInput } from '@/domain/sprints'
import type { TaskRelation } from '@/domain/relations'
import type { AttachmentDto, CommentDto, CustomFieldDto, FieldOptionDto, LookupDto, ProjectFileDto, TagDto, TaskDetailDto, TaskDto, TaskTypeDetailDto, TaskTypeDto } from './dtos'
import { toBacklog, toBoard, toReport, toReportTask, toSprint, toNotification, toTaskRelations } from './mappers'
import type { LibraryIconDto } from './dtos'
import { toLibraryIcon } from './mappers'
import type { PreferenceDto, ProjectFilterDto } from './dtos'
import { fromProjectFilterSettings, toProjectFilterSettings } from './mappers'
import { projectFilterKey } from '@/domain/project-filter'
import type { PreferenceRepository } from '@/domain/repositories'
import { toArea, toAttachment, toComment, toCustomField, toFieldOption, toPriority, toProjectFile, toStatus, toTag, toTaskDetail, toTaskSummary, toTaskType, toTaskTypeDetail } from './mappers'
import type {
  AttachmentRepository,
  ProjectFileRepository,
  CommentRepository,
  NotificationRepository,
  BoardRepository,
  BacklogRepository,
  RelationRepository,
  ReportRepository,
  ExecutiveRepository,
  TimelineRepository,
  PlanRepository,
  MilestoneRepository,
  CharterRepository,
  DocsRepository,
  SprintRepository,
  TagRepository,
  IconLibraryRepository,
  CustomFieldInput,
  CustomFieldRepository,
  LookupInput,
  LookupRepository,
  TaskRepository,
  TaskTypeInput,
  TaskTypeRepository,
} from '@/domain/repositories'
import type { TaskInput } from '@/domain/tasks'
import type { LookupItem } from '@/domain/workflow'
import type {
  AuditEntryDto,
  MeDto,
  PageMetaDto,
  PermissionDto,
  ProjectDto,
  ProjectMemberDto,
  RoleDto,
  SessionDto,
  UserDto,
  UserSummaryDto,
} from './dtos'
import {
  toAuditEntry,
  toCurrentUser,
  toPermission,
  toProject,
  toProjectMember,
  toRole,
  toSession,
  toUser,
  toUserSummary,
} from './mappers'

/** Implementações dos repositórios sobre a API REST /api/v1. */

export function createHttpAuthRepository(api: ApiClient): AuthRepository {
  return {
    async login(credentials) {
      await api.post('/auth/login', credentials)
    },
    async logout() {
      await api.post('/auth/logout')
    },
    async me() {
      try {
        const { data } = await api.get<MeDto>('/auth/me')
        return toCurrentUser(data)
      } catch (error) {
        if (isAppError(error) && error.status === 401) return null
        throw error
      }
    },
    async listSessions() {
      const { data } = await api.get<SessionDto[]>('/auth/sessions')
      return data.map(toSession)
    },
    async revokeSession(id) {
      const { data } = await api.del<{ current: boolean }>(`/auth/sessions/${encodeURIComponent(id)}`)
      return { current: !!data?.current }
    },
    async revokeOtherSessions() {
      const { data } = await api.post<{ revoked: number }>('/auth/sessions/revoke-others')
      return { revoked: data.revoked }
    },
    async changePassword(currentPassword, newPassword) {
      const { data } = await api.post<{ other_sessions_revoked: number }>('/auth/password', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      return { otherSessionsRevoked: data.other_sessions_revoked }
    },
    async passwordPolicy() {
      const { data } = await api.get<PasswordPolicyDto>('/auth/password-policy')
      return toPasswordPolicy(data)
    },
    async requestPasswordReset(email) {
      await api.post('/auth/password-reset/request', { email })
    },
    async checkResetToken(token) {
      const { data } = await api.get<ResetTokenCheckDto>('/auth/password-reset/check', { query: { token } })
      return toResetTokenCheck(data)
    },
    async confirmPasswordReset(token, password) {
      const { data } = await api.post<{ purpose: 'reset' | 'invite' }>('/auth/password-reset/confirm', { token, password })
      return { purpose: data.purpose }
    },
  }
}

/** Preferências da pessoa (`/auth/preferences/{key}`); a chave do configurador é `project_filter.<tela>`. */
export function createHttpPreferenceRepository(api: ApiClient): PreferenceRepository {
  const path = (key: string) => `/auth/preferences/${encodeURIComponent(key)}`
  return {
    async getProjectFilter(screen) {
      const { data } = await api.get<PreferenceDto<ProjectFilterDto>>(path(projectFilterKey(screen)))
      return toProjectFilterSettings(data?.value)
    },
    async saveProjectFilter(screen, settings) {
      const { data } = await api.put<PreferenceDto<ProjectFilterDto>>(path(projectFilterKey(screen)), { value: fromProjectFilterSettings(settings) })
      return toProjectFilterSettings(data?.value)
    },
  }
}

export function createHttpWebhookRepository(api: ApiClient): WebhookRepository {
  const path = (id: string) => `/settings/webhooks/${encodeURIComponent(id)}`
  return {
    async list() {
      return (await api.get<WebhookDto[]>('/settings/webhooks')).data.map(toWebhook)
    },
    async catalog() {
      return (await api.get<WebhookCatalog>('/settings/webhooks/events')).data
    },
    async create(input) {
      const { data } = await api.post<WebhookDto>('/settings/webhooks', input)
      return { ...toWebhook(data), secret: data.secret ?? '' }
    },
    async update(id, input) {
      return toWebhook((await api.patch<WebhookDto>(path(id), input)).data)
    },
    async remove(id) {
      await api.del(path(id))
    },
    async rotateSecret(id) {
      return (await api.post<{ secret: string }>(`${path(id)}/rotate-secret`)).data
    },
    async test(id) {
      return toWebhookDelivery((await api.post<WebhookDeliveryDto>(`${path(id)}/test`)).data)
    },
    async deliveries(id) {
      return (await api.get<WebhookDeliveryDto[]>(`${path(id)}/deliveries`)).data.map(toWebhookDelivery)
    },
    async redeliver(deliveryId) {
      return toWebhookDelivery((await api.post<WebhookDeliveryDto>(`/settings/webhook-deliveries/${encodeURIComponent(deliveryId)}/redeliver`)).data)
    },
  }
}

export function createHttpApiTokenRepository(api: ApiClient): ApiTokenRepository {
  return {
    async listMine() {
      return (await api.get<ApiTokenDto[]>('/auth/tokens')).data.map(toApiToken)
    },
    async create(name, expiresInDays) {
      const { data } = await api.post<ApiTokenDto>('/auth/tokens', { name, expires_in_days: expiresInDays })
      return { ...toApiToken(data), token: data.token ?? '' }
    },
    async revoke(id) {
      return toApiToken((await api.del<ApiTokenDto>(`/auth/tokens/${encodeURIComponent(id)}`)).data)
    },
    async reveal(id) {
      const { data } = await api.post<ApiTokenDto>(`/auth/tokens/${encodeURIComponent(id)}/reveal`, {})
      return { ...toApiToken(data), token: data.token ?? '' }
    },
    async listAll() {
      return (await api.get<ApiTokenDto[]>('/settings/api-tokens')).data.map(toApiToken)
    },
    async revokeAny(id) {
      return toApiToken((await api.del<ApiTokenDto>(`/settings/api-tokens/${encodeURIComponent(id)}`)).data)
    },
  }
}

export function createHttpEmailRepository(api: ApiClient): EmailRepository {
  return {
    async getSettings() {
      return toEmailSettings((await api.get<EmailSettingsDto>('/settings/email')).data)
    },
    async updateSettings(patch) {
      return toEmailSettings((await api.patch<EmailSettingsDto>('/settings/email', fromEmailPatch(patch))).data)
    },
    async sendTest(to) {
      const { data } = await api.post<{ to: string }>('/settings/email/test', to ? { to } : {})
      return { to: data.to }
    },
    async outbox() {
      return toOutboxSummary((await api.get<OutboxSummaryDto>('/settings/email/outbox')).data)
    },
    async flush() {
      return (await api.post<FlushResult>('/settings/email/outbox/flush')).data
    },
  }
}

export function createHttpPlatformRepository(api: ApiClient): PlatformRepository {
  const branding = (slot: string) => `/settings/platform/branding/${encodeURIComponent(slot)}`
  return {
    async getInfo() {
      const { data } = await api.get<PlatformInfoDto>('/platform')
      return toPlatformInfo(data)
    },
    async getSettings() {
      const { data } = await api.get<PlatformSettingsDto>('/settings/platform')
      return toPlatformSettings(data)
    },
    async updateSettings(patch) {
      const { data } = await api.patch<PlatformSettingsDto>('/settings/platform', fromPlatformValues(patch))
      return toPlatformSettings(data)
    },
    async previewRetention(months) {
      const { data } = await api.patch<{ audit_to_delete: number }>('/settings/platform', { audit_retention_months: months, dry_run: true })
      return { auditToDelete: data.audit_to_delete }
    },
    async uploadBranding(slot, file) {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.postForm<PlatformSettingsDto>(branding(slot), form)
      return toPlatformSettings(data)
    },
    async removeBranding(slot) {
      const { data } = await api.del<PlatformSettingsDto>(branding(slot))
      return toPlatformSettings(data)
    },
    async runRetention() {
      const { data } = await api.post<{ removed: number }>('/settings/platform/purge-audit')
      return { removed: data.removed }
    },
  }
}

export function createHttpUserRepository(api: ApiClient): UserRepository {
  const path = (id: string) => `/users/${encodeURIComponent(id)}`
  return {
    async list(query: ListQuery): Promise<Page<ReturnType<typeof toUser>>> {
      const { data, meta } = await api.get<UserDto[], PageMetaDto>('/users', {
        query: {
          page: query.page,
          perPage: query.perPage,
          sort: toSortParam(query.sort),
          search: query.search.trim() || undefined,
          status: query.filters.status,
          role_id: query.filters.role_id,
        },
      })
      return { items: data.map(toUser), ...meta }
    },
    async get(id) {
      const { data } = await api.get<UserDto>(path(id))
      return toUser(data)
    },
    async create(input: CreateUserData) {
      const { data } = await api.post<UserDto>('/users', {
        name: input.name,
        email: input.email,
        ...(input.sendInvite ? { send_invite: true } : { password: input.password }),
        role_id: input.roleId,
        locale: input.locale,
      })
      return toUser(data)
    },
    async update(id, input: UpdateUserData) {
      const body: Record<string, unknown> = {}
      if (input.name !== undefined) body.name = input.name
      if (input.email !== undefined) body.email = input.email
      if (input.roleId !== undefined) body.role_id = input.roleId
      if (input.locale !== undefined) body.locale = input.locale
      if (input.theme !== undefined) body.theme = input.theme
      if (input.emailNotifications !== undefined) body.email_notifications = input.emailNotifications
      const { data } = await api.patch<UserDto>(path(id), body)
      return toUser(data)
    },
    async setStatus(id, status) {
      const { data } = await api.patch<UserDto>(`${path(id)}/status`, { status })
      return toUser(data)
    },
    async resetPassword(id, password) {
      await api.post(`${path(id)}/password`, { password })
    },
    async resendInvite(id) {
      await api.post(`${path(id)}/invite`)
    },
    async uploadAvatar(id, file) {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.postForm<UserDto>(`${path(id)}/avatar`, form)
      return toUser(data)
    },
    async removeAvatar(id) {
      const { data } = await api.del<UserDto>(`${path(id)}/avatar`)
      return toUser(data)
    },
    async history(id, query) {
      const { data, meta } = await api.get<AuditEntryDto[], PageMetaDto>(`${path(id)}/history`, {
        query: { page: query.page, perPage: query.perPage },
      })
      return { items: data.map(toAuditEntry), ...meta }
    },
  }
}

export function createHttpRoleRepository(api: ApiClient): RoleRepository {
  const path = (id: string) => `/roles/${encodeURIComponent(id)}`
  return {
    async list() {
      const { data } = await api.get<RoleDto[]>('/roles')
      return data.map(toRole)
    },
    async listPermissions() {
      const { data } = await api.get<PermissionDto[]>('/permissions')
      return data.map(toPermission).filter((p): p is Permission => p !== null)
    },
    async create(input: RoleData) {
      const { data } = await api.post<RoleDto>('/roles', input)
      return toRole(data)
    },
    async update(id, input) {
      const { data } = await api.patch<RoleDto>(path(id), input)
      return toRole(data)
    },
    async updatePermissions(id, permissions) {
      const { data } = await api.put<RoleDto>(`${path(id)}/permissions`, { permissions })
      return toRole(data)
    },
    async remove(id) {
      await api.del(path(id))
    },
  }
}

export function createHttpAuditRepository(api: ApiClient): AuditRepository {
  return {
    async list(query) {
      const { data, meta } = await api.get<AuditEntryDto[], PageMetaDto>('/audit-logs', {
        query: { page: query.page, perPage: query.perPage, ...query.filters },
      })
      return { items: data.map(toAuditEntry), ...meta }
    },
  }
}

/** Converte os campos do formulário para o corpo público (snake_case). */
/** Diário do quadro: só o que veio. */
function journalBody(input: JournalInput): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (input.entryDate !== undefined) body.entry_date = input.entryDate
  if (input.content !== undefined) body.content = input.content
  return body
}

/** Problema do quadro: só o que veio (`ownerId` null limpa). */
function issueBody(input: IssueInput): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (input.openedOn !== undefined) body.opened_on = input.openedOn
  if (input.description !== undefined) body.description = input.description
  if (input.state !== undefined) body.state = input.state
  if (input.ownerId !== undefined) body.owner_id = input.ownerId
  return body
}

function projectBody(data: Partial<ProjectData> & { key?: string }): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  const map: Record<string, string> = { startDate: 'start_date', dueDate: 'due_date', areaId: 'area_id', parentId: 'parent_id' }
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) body[map[key] ?? key] = value
  })
  return body
}

export function createHttpProjectRepository(api: ApiClient): ProjectRepository {
  const path = (id: string) => `/projects/${encodeURIComponent(id)}`
  const memberPath = (id: string, userId: string) => `${path(id)}/members/${encodeURIComponent(userId)}`
  const one = async (request: Promise<{ data: ProjectDto }>) => toProject((await request).data)
  const members = async (request: Promise<{ data: ProjectMemberDto[] }>) => (await request).data.map(toProjectMember)

  return {
    async list(query) {
      const { data, meta } = await api.get<ProjectDto[], PageMetaDto>('/projects', {
        query: {
          view: query.view,
          page: query.page,
          perPage: query.perPage,
          sort: toSortParam(query.sort),
          search: query.search.trim() || undefined,
          status: query.filters.status,
          priority: query.filters.priority,
          urgency: query.filters.urgency,
          area_id: query.filters.area,
          parent_id: query.filters.parent,
          owner_id: query.filters.owner_id,
        },
      })
      return { items: data.map(toProject), ...meta }
    },
    get: (id) => one(api.get<ProjectDto>(path(id))),
    create: (data) => one(api.post<ProjectDto>('/projects', projectBody(data))),
    update: (id, data) => one(api.patch<ProjectDto>(path(id), projectBody(data))),
    archive: (id) => one(api.post<ProjectDto>(`${path(id)}/archive`)),
    unarchive: (id) => one(api.post<ProjectDto>(`${path(id)}/unarchive`)),
    async remove(id) {
      await api.del(path(id))
    },
    transferOwnership: (id, userId) => one(api.put<ProjectDto>(`${path(id)}/owner`, { user_id: userId })),
    listMembers: (id) => members(api.get<ProjectMemberDto[]>(`${path(id)}/members`)),
    addMember: (id, userId, role) => members(api.post<ProjectMemberDto[]>(`${path(id)}/members`, { user_id: userId, role })),
    updateMemberRole: (id, userId, role) => members(api.patch<ProjectMemberDto[]>(memberPath(id, userId), { role })),
    async removeMember(id, userId) {
      await api.del(memberPath(id, userId))
    },
    async memberCandidates(id, search) {
      const { data } = await api.get<UserSummaryDto[]>(`${path(id)}/member-candidates`, { query: { search: search.trim() || undefined } })
      return data.map(toUserSummary)
    },
    async history(id, query) {
      const { data, meta } = await api.get<AuditEntryDto[], PageMetaDto>(`${path(id)}/history`, {
        query: { page: query.page, perPage: query.perPage },
      })
      return { items: data.map(toAuditEntry), ...meta }
    },
  }
}

function customFieldBody(data: Partial<CustomFieldInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (data.label !== undefined) body.label = data.label
  if (data.name !== undefined) body.name = data.name
  if (data.type !== undefined) body.type = data.type
  if (data.description !== undefined) body.description = data.description
  if (data.config !== undefined) body.config = data.config
  if (data.defaultValue !== undefined) body.default_value = data.defaultValue
  if (data.searchable !== undefined) body.searchable = data.searchable
  if (data.filterable !== undefined) body.filterable = data.filterable
  if (data.sortable !== undefined) body.sortable = data.sortable
  if (data.options !== undefined) {
    body.options = data.options.map((o) => ({ id: o.id, label: o.label, color: o.color, is_active: o.isActive, is_default: o.isDefault }))
  }
  return body
}

export function createHttpCustomFieldRepository(api: ApiClient): CustomFieldRepository {
  const path = (id: string) => `/custom-fields/${encodeURIComponent(id)}`
  return {
    async list(query) {
      const { data } = await api.get<CustomFieldDto[]>('/custom-fields', { query: { search: query?.search, type: query?.type } })
      return data.map(toCustomField)
    },
    async get(id) {
      return toCustomField((await api.get<CustomFieldDto>(path(id))).data)
    },
    async create(data) {
      return toCustomField((await api.post<CustomFieldDto>('/custom-fields', customFieldBody(data))).data)
    },
    async update(id, data) {
      return toCustomField((await api.patch<CustomFieldDto>(path(id), customFieldBody(data))).data)
    },
    async remove(id) {
      await api.del(path(id))
    },
    async addOption(fieldId, label) {
      return toFieldOption((await api.post<FieldOptionDto>(`${path(fieldId)}/options`, { label })).data)
    },
  }
}

function taskTypeBody(data: Partial<TaskTypeInput> & { key?: string }): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (data.key !== undefined) body.key = data.key
  if (data.name !== undefined) body.name = data.name
  if (data.description !== undefined) body.description = data.description
  if (data.icon !== undefined) body.icon = data.icon
  if (data.color !== undefined) body.color = data.color
  if (data.isActive !== undefined) body.is_active = data.isActive
  if (data.translations !== undefined) body.translations = data.translations
  return body
}

export function createHttpTaskTypeRepository(api: ApiClient): TaskTypeRepository {
  const path = (id: string) => `/task-types/${encodeURIComponent(id)}`
  return {
    async list(options) {
      const { data } = await api.get<TaskTypeDto[]>('/task-types', { query: { include_inactive: options?.includeInactive ? '1' : undefined } })
      return data.map(toTaskType)
    },
    async get(id) {
      return toTaskTypeDetail((await api.get<TaskTypeDetailDto>(path(id))).data)
    },
    async create(data) {
      return toTaskTypeDetail((await api.post<TaskTypeDetailDto>('/task-types', taskTypeBody(data))).data)
    },
    async update(id, data) {
      return toTaskTypeDetail((await api.patch<TaskTypeDetailDto>(path(id), taskTypeBody(data))).data)
    },
    async remove(id) {
      await api.del(path(id))
    },
    async reorder(ids) {
      return (await api.put<TaskTypeDto[]>('/task-types/order', { ids })).data.map(toTaskType)
    },
    async setFields(id, fields) {
      const body = { fields: fields.map((f) => ({ field_id: f.fieldId, required: f.required, visible: f.visible, show_on_card: f.showOnCard, required_status_ids: f.requiredStatusIds })) }
      return toTaskTypeDetail((await api.put<TaskTypeDetailDto>(`${path(id)}/fields`, body)).data)
    },
    async history(id) {
      const { data, meta } = await api.get<AuditEntryDto[], PageMetaDto>(`${path(id)}/history`, { query: { perPage: 50 } })
      return { items: data.map(toAuditEntry), ...meta }
    },
  }
}

export function createHttpRepositories(api: ApiClient): Repositories {
  return {
    auth: createHttpAuthRepository(api),
    users: createHttpUserRepository(api),
    roles: createHttpRoleRepository(api),
    audit: createHttpAuditRepository(api),
    projects: createHttpProjectRepository(api),
    customFields: createHttpCustomFieldRepository(api),
    taskTypes: createHttpTaskTypeRepository(api),
    statuses: createHttpLookupRepository(api, '/statuses', toStatus),
    priorities: createHttpLookupRepository(api, '/priorities', toPriority),
    areas: createHttpLookupRepository(api, '/areas', toArea),
    tasks: createHttpTaskRepository(api),
    tags: createHttpTagRepository(api),
    icons: createHttpIconLibraryRepository(api),
    comments: createHttpCommentRepository(api),
    attachments: createHttpAttachmentRepository(api),
    projectFiles: createHttpProjectFileRepository(api),
    notifications: createHttpNotificationRepository(api),
    board: createHttpBoardRepository(api),
    backlog: createHttpBacklogRepository(api),
    relations: createHttpRelationRepository(api),
    reports: createHttpReportRepository(api),
    executive: createHttpExecutiveRepository(api),
    timeline: createHttpTimelineRepository(api),
    milestones: createHttpMilestoneRepository(api),
    charter: createHttpCharterRepository(api),
    plan: createHttpPlanRepository(api),
    docs: createHttpDocsRepository(api),
    sprints: createHttpSprintRepository(api),
    platform: createHttpPlatformRepository(api),
    email: createHttpEmailRepository(api),
    apiTokens: createHttpApiTokenRepository(api),
    webhooks: createHttpWebhookRepository(api),
    preferences: createHttpPreferenceRepository(api),
  }
}

function taskBody(data: TaskInput) {
  return {
    project_id: data.projectId,
    task_type_id: data.taskTypeId,
    title: data.title,
    description: data.description,
    status_id: data.statusId,
    priority_id: data.priorityId,
    assignee_id: data.assigneeId,
    reporter_id: data.reporterId,
    start_date: data.startDate,
    due_date: data.dueDate,
    estimated_hours: data.estimatedHours,
    actual_hours: data.actualHours,
    custom_values: data.customValues,
    tag_ids: data.tagIds,
    sprint_id: data.sprintId,
    parent_task_id: data.parentTaskId,
    plan_item_id: data.planItemId,
    area_id: data.areaId,
    checklist: data.checklist?.map((item) => ({ id: item.id, text: item.text, done: item.done })),
  }
}

export function createHttpIconLibraryRepository(api: ApiClient): IconLibraryRepository {
  return {
    async list() {
      return (await api.get<LibraryIconDto[]>('/icons')).data.map(toLibraryIcon)
    },
    async importIcons(names) {
      return (await api.post<LibraryIconDto[]>('/settings/icons', { names })).data.map(toLibraryIcon)
    },
    async remove(name) {
      await api.del(`/settings/icons/${encodeURIComponent(name)}`)
    },
  }
}

export function createHttpTagRepository(api: ApiClient): TagRepository {
  const path = (id: string) => `/tags/${encodeURIComponent(id)}`
  return {
    async list() {
      return (await api.get<TagDto[]>('/tags')).data.map(toTag)
    },
    async create(data) {
      return toTag((await api.post<TagDto>('/tags', data)).data)
    },
    async update(id, data) {
      return toTag((await api.patch<TagDto>(path(id), data)).data)
    },
    async remove(id) {
      await api.del(path(id))
    },
  }
}

export function createHttpProjectFileRepository(api: ApiClient): ProjectFileRepository {
  return {
    async list(projectId) {
      return (await api.get<ProjectFileDto[]>(`/projects/${encodeURIComponent(projectId)}/files`)).data.map(toProjectFile)
    },
    async upload(projectId, file) {
      const form = new FormData()
      form.append('files', file, file.name)
      return (await api.postForm<ProjectFileDto[]>(`/projects/${encodeURIComponent(projectId)}/files`, form)).data.map(toProjectFile)
    },
    async remove(id) {
      await api.del(`/project-files/${encodeURIComponent(id)}`)
    },
  }
}

export function createHttpAttachmentRepository(api: ApiClient): AttachmentRepository {
  return {
    async list(taskId) {
      return (await api.get<AttachmentDto[]>(`/tasks/${encodeURIComponent(taskId)}/attachments`)).data.map(toAttachment)
    },
    async upload(taskId, file, options) {
      const form = new FormData()
      form.append('files', file, file.name)
      if (options?.field) form.append('field', options.field)
      if (options?.commentId) form.append('comment_id', options.commentId)
      return (await api.postForm<AttachmentDto[]>(`/tasks/${encodeURIComponent(taskId)}/attachments`, form)).data.map(toAttachment)
    },
    async remove(id) {
      await api.del(`/attachments/${encodeURIComponent(id)}`)
    },
  }
}

export function createHttpBoardRepository(api: ApiClient): BoardRepository {
  return {
    async get(projectId) {
      return toBoard((await api.get<BoardDto>(`/projects/${encodeURIComponent(projectId)}/board`)).data)
    },
    async getAll(projectIds) {
      const query = projectIds?.length ? { project_ids: projectIds.join(',') } : undefined
      return toBoard((await api.get<BoardDto>('/board', query ? { query } : undefined)).data)
    },
    async move(taskId, target) {
      const body = { status_id: target.statusId, prev_id: target.prevId, next_id: target.nextId }
      return toTaskDetail((await api.post<TaskDetailDto>(`/tasks/${encodeURIComponent(taskId)}/move`, body)).data)
    },
  }
}

export function createHttpReportRepository(api: ApiClient): ReportRepository {
  // período, fuso e filtros: os mesmos no relatório e no detalhamento (o total sempre bate)
  const params = (query: Parameters<ReportRepository['get']>[0]) => ({
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    tz_offset: String(query.tzOffset),
    project_id: query.projectId,
    assignee_id: query.assigneeId,
    task_type_id: query.typeId,
    priority_id: query.priorityId,
    status_id: query.statusId,
  })
  return {
    async get(query) {
      const { data } = await api.get<ReportDto>('/reports', { query: { ...params(query), group_by: query.groupBy } })
      return toReport(data)
    },
    async listTasks(query, metric, page) {
      const { data, meta } = await api.get<ReportTaskDto[], PageMetaDto>('/reports/tasks', {
        query: { ...params(query), metric, page: page.page, perPage: page.perPage },
      })
      return { items: data.map(toReportTask), ...meta }
    },
  }
}

/** Painel executivo: sem `project_ids`/`statuses` = todos; sem `from` = desde o início; sem `to` = até hoje. */
export function createHttpExecutiveRepository(api: ApiClient): ExecutiveRepository {
  return {
    async get(query) {
      const { data } = await api.get<ExecutiveDto>('/executive', {
        query: {
          project_ids: query.projectIds.length ? query.projectIds.join(',') : undefined,
          statuses: query.statuses.length ? query.statuses.join(',') : undefined,
          from: query.from ?? undefined,
          to: query.to ?? undefined,
          tz_offset: String(query.tzOffset),
        },
      })
      return toExecutiveDashboard(data)
    },
  }
}

export function createHttpRelationRepository(api: ApiClient): RelationRepository {
  const task = (id: string) => `/tasks/${encodeURIComponent(id)}`
  return {
    async list(taskId) {
      return toTaskRelations((await api.get<TaskRelationsDto>(`${task(taskId)}/relations`)).data)
    },
    async create(taskId, input) {
      const dto = (await api.post<TaskRelationDto>(`${task(taskId)}/relations`, { type: input.type, target_id: input.targetId })).data
      return toTaskRelations({ parent: null, children: [], forked_from: null, forks: [], relations: [dto] }).relations[0] as TaskRelation
    },
    async remove(relationId) {
      await api.del(`/relations/${encodeURIComponent(relationId)}`)
    },
    async fork(taskId, input) {
      const body = {
        title: input.title,
        project_id: input.projectId,
        copy: {
          description: input.copy.description,
          tags: input.copy.tags,
          custom_values: input.copy.customValues,
          checklist: input.copy.checklist,
          attachments: input.copy.attachments,
          relations: input.copy.relations,
        },
      }
      return toTaskDetail((await api.post<TaskDetailDto>(`${task(taskId)}/fork`, body)).data)
    },
  }
}

export function createHttpBacklogRepository(api: ApiClient): BacklogRepository {
  return {
    async get(projectId) {
      return toBacklog((await api.get<BacklogDto>(`/projects/${encodeURIComponent(projectId)}/backlog`)).data)
    },
    async rank(taskId, target) {
      const body: Record<string, unknown> = { prev_id: target.prevId, next_id: target.nextId }
      if (target.sprintId !== undefined) body.sprint_id = target.sprintId
      return toTaskDetail((await api.post<TaskDetailDto>(`/tasks/${encodeURIComponent(taskId)}/rank`, body)).data)
    },
  }
}

function sprintBody(data: SprintInput) {
  return { name: data.name, goal: data.goal, start_date: data.startDate, end_date: data.endDate, state: data.state }
}

function groupBody(input: PlanGroupInput) {
  return { name: input.name, color: input.color, parent_id: input.parentId }
}

function bulkBody(input: PlanBulkInput): Record<string, unknown> {
  if (input.action === 'update') return { ids: input.ids, action: input.action, status_id: input.statusId, add_resource_ids: input.addResourceIds, remove_resource_ids: input.removeResourceIds }
  if (input.action === 'move') return { ids: input.ids, action: input.action, group_id: input.groupId }
  return { ids: input.ids, action: input.action }
}

function importRowBody(row: PlanImportRow) {
  return {
    group: row.group,
    name: row.name,
    parent: row.parent ?? undefined,
    status: row.status ?? undefined,
    start_date: row.startDate ?? undefined,
    end_date: row.endDate ?? undefined,
    resources: row.resources ?? [],
    estimated_hours: row.estimatedHours ?? undefined,
    actual_hours: row.actualHours ?? undefined,
    duration_days: row.durationDays ?? undefined,
    progress: row.progress ?? undefined,
  }
}

/** Só os campos informados (undefined não vai no corpo; null limpa). */
function planItemBody(input: PlanItemInput) {
  const map: Record<keyof PlanItemInput, string> = {
    groupId: 'group_id',
    parentId: 'parent_id',
    name: 'name',
    statusId: 'status_id',
    startDate: 'start_date',
    endDate: 'end_date',
    dueDate: 'due_date',
    ownerId: 'owner_id',
    resourceIds: 'resource_ids',
    estimatedHours: 'estimated_hours',
    actualHours: 'actual_hours',
    durationDays: 'duration_days',
    progress: 'progress',
    custom: 'custom',
  }
  const body: Record<string, unknown> = {}
  ;(Object.keys(map) as Array<keyof PlanItemInput>).forEach((key) => {
    if (input[key] !== undefined) body[map[key]] = input[key]
  })
  return body
}

export function createHttpPlanRepository(api: ApiClient): PlanRepository {
  const project = (id: string) => `/projects/${encodeURIComponent(id)}`
  const group = (id: string) => `/groups/${encodeURIComponent(id)}`
  const planItem = (id: string) => `/plan/items/${encodeURIComponent(id)}`
  const status = (id: string) => `/plan/statuses/${encodeURIComponent(id)}`
  const resource = (id: string) => `/plan/resources/${encodeURIComponent(id)}`
  return {
    async get(projectId) {
      return toPlan((await api.get<PlanDto>(`${project(projectId)}/plan`)).data)
    },
    async createGroup(projectId, input) {
      return toPlanGroup((await api.post<PlanGroupDto>(`${project(projectId)}/groups`, groupBody(input))).data)
    },
    async updateGroup(id, input) {
      return toPlanGroup((await api.patch<PlanGroupDto>(group(id), groupBody(input))).data)
    },
    async moveGroup(id, target) {
      return toPlanGroup((await api.put<PlanGroupDto>(`${group(id)}/move`, { parent_id: target.parentId, prev_id: target.prevId, next_id: target.nextId })).data)
    },
    async duplicateGroup(id) {
      return toPlanGroup((await api.post<PlanGroupDto>(`${group(id)}/duplicate`, {})).data)
    },
    async deleteGroup(id) {
      return (await api.del<{ deleted: number; items: number }>(group(id))).data
    },
    async createItem(projectId, input) {
      return toPlanItem((await api.post<PlanItemDto>(`${project(projectId)}/plan/items`, planItemBody(input))).data)
    },
    async updateItem(id, input) {
      return toPlanItem((await api.patch<PlanItemDto>(planItem(id), planItemBody(input))).data)
    },
    async deleteItem(id) {
      return (await api.del<{ deleted: number }>(planItem(id))).data
    },
    async createStatus(projectId, input) {
      return toPlanStatus((await api.post<PlanStatusDto>(`${project(projectId)}/plan/statuses`, input)).data)
    },
    async updateStatus(id, input) {
      return toPlanStatus((await api.patch<PlanStatusDto>(status(id), input)).data)
    },
    async deleteStatus(id) {
      return (await api.del<{ deleted: boolean; items: number }>(status(id))).data
    },
    async createResource(projectId, input) {
      return toPlanResource((await api.post<PlanResourceDto>(`${project(projectId)}/plan/resources`, input)).data)
    },
    async updateResource(id, input) {
      return toPlanResource((await api.patch<PlanResourceDto>(resource(id), input)).data)
    },
    async deleteResource(id) {
      return (await api.del<{ deleted: boolean; items: number }>(resource(id))).data
    },
    async moveItem(id, target) {
      return toPlanItem((await api.put<PlanItemDto>(`${planItem(id)}/move`, { group_id: target.groupId, prev_id: target.prevId, next_id: target.nextId })).data)
    },
    async duplicateItem(id) {
      return toPlanItem((await api.post<PlanItemDto>(`${planItem(id)}/duplicate`, {})).data)
    },
    async bulk(projectId, input) {
      return (await api.post<PlanBulkResult>(`${project(projectId)}/plan/items/bulk`, bulkBody(input))).data
    },
    async createLink(itemId, input) {
      return toPlanLink((await api.post<PlanLinkDto>(`${planItem(itemId)}/links`, { type: input.kind, item_id: input.itemId })).data)
    },
    async deleteLink(id) {
      await api.del(`/plan/links/${encodeURIComponent(id)}`)
    },
    async updateSettings(projectId, input) {
      const data = (await api.patch<{ dependency_rule: string }>(`${project(projectId)}/plan/settings`, { dependency_rule: input.dependencyRule })).data
      return { dependencyRule: data.dependency_rule === 'block' ? ('block' as const) : ('warn' as const) }
    },
    async importItems(projectId, rows) {
      return (await api.post<{ created: PlanImportResult }>(`${project(projectId)}/plan/import`, { rows: rows.map(importRowBody) })).data.created
    },
    async listUpdates(itemId) {
      const { data } = await api.get<{ updates: PlanUpdateDto[]; capabilities: { post?: boolean } }>(`${planItem(itemId)}/updates`)
      return { updates: data.updates.map(toPlanUpdate), capabilities: { post: !!data.capabilities.post } }
    },
    async createUpdate(itemId, input) {
      const files = input.files ?? []
      if (files.length === 0) return toPlanUpdate((await api.post<PlanUpdateDto>(`${planItem(itemId)}/updates`, { content: input.content, parent_id: input.parentId })).data)
      const form = new FormData()
      form.append('content', input.content)
      if (input.parentId) form.append('parent_id', input.parentId)
      files.forEach((file) => form.append('files', file, file.name))
      return toPlanUpdate((await api.postForm<PlanUpdateDto>(`${planItem(itemId)}/updates`, form)).data)
    },
    async editUpdate(id, content) {
      return toPlanUpdate((await api.patch<PlanUpdateDto>(`/plan/updates/${encodeURIComponent(id)}`, { content })).data)
    },
    async deleteUpdate(id) {
      await api.del(`/plan/updates/${encodeURIComponent(id)}`)
    },
    async mentionCandidates(itemId) {
      return (await api.get<UserSummaryDto[]>(`${planItem(itemId)}/mention-candidates`)).data.map(toUserSummary)
    },
    async addUpdateFiles(updateId, files) {
      const form = new FormData()
      files.forEach((file) => form.append('files', file, file.name))
      return (await api.postForm<PlanFileDto[]>(`/plan/updates/${encodeURIComponent(updateId)}/files`, form)).data.map(toPlanFile)
    },
    async deleteFile(id) {
      await api.del(`/plan/files/${encodeURIComponent(id)}`)
    },
    async history(itemId) {
      const { data, meta } = await api.get<AuditEntryDto[], PageMetaDto>(`${planItem(itemId)}/history`, { query: { perPage: 100 } })
      return { items: data.map(toAuditEntry), ...meta }
    },
    async saveBaseline(projectId) {
      const { data } = await api.put<{ saved_at: string | null; items: number }>(`${project(projectId)}/plan/baseline`, {})
      return { savedAt: data.saved_at ? new Date(data.saved_at) : null, items: data.items }
    },
    async clearBaseline(projectId) {
      await api.del(`${project(projectId)}/plan/baseline`)
    },
    async listJournal(projectId) {
      const { data } = await api.get<{ entries: JournalEntryDto[]; capabilities: { create?: boolean } }>(`${project(projectId)}/plan/journal`)
      return { entries: data.entries.map(toJournalEntry), capabilities: { create: !!data.capabilities.create } }
    },
    async createJournalEntry(projectId, input) {
      return toJournalEntry((await api.post<JournalEntryDto>(`${project(projectId)}/plan/journal`, journalBody(input))).data)
    },
    async updateJournalEntry(id, input) {
      return toJournalEntry((await api.patch<JournalEntryDto>(`/plan/journal/${encodeURIComponent(id)}`, journalBody(input))).data)
    },
    async deleteJournalEntry(id) {
      await api.del(`/plan/journal/${encodeURIComponent(id)}`)
    },
    async listIssues(projectId) {
      const { data } = await api.get<{ issues: PlanIssueDto[]; capabilities: { create?: boolean } }>(`${project(projectId)}/plan/issues`)
      return { issues: data.issues.map(toPlanIssue), capabilities: { create: !!data.capabilities.create } }
    },
    async createIssue(projectId, input) {
      return toPlanIssue((await api.post<PlanIssueDto>(`${project(projectId)}/plan/issues`, issueBody(input))).data)
    },
    async updateIssue(id, input) {
      return toPlanIssue((await api.patch<PlanIssueDto>(`/plan/issues/${encodeURIComponent(id)}`, issueBody(input))).data)
    },
    async deleteIssue(id) {
      await api.del(`/plan/issues/${encodeURIComponent(id)}`)
    },
    async createColumn(projectId, input) {
      return toPlanColumn((await api.post<PlanColumnDto>(`${project(projectId)}/plan/columns`, input)).data)
    },
    async updateColumn(id, input) {
      return toPlanColumn((await api.patch<PlanColumnDto>(`/plan/columns/${encodeURIComponent(id)}`, input)).data)
    },
    async previewColumnType(id, input) {
      return (await api.post<ColumnTypePreview>(`/plan/columns/${encodeURIComponent(id)}/type`, { ...input, dry_run: true })).data
    },
    async changeColumnType(id, input) {
      return toPlanColumn((await api.post<PlanColumnDto>(`/plan/columns/${encodeURIComponent(id)}/type`, input)).data)
    },
    async duplicateColumn(id) {
      return toPlanColumn((await api.post<PlanColumnDto>(`/plan/columns/${encodeURIComponent(id)}/duplicate`, {})).data)
    },
    async deleteColumn(id) {
      const { data } = await api.del<{ values?: number }>(`/plan/columns/${encodeURIComponent(id)}`)
      return { values: data?.values ?? 0 }
    },
    async report(projectId, tzOffset) {
      return toPlanReport((await api.get<PlanReportDto>(`${project(projectId)}/plan/report`, { query: { tz_offset: String(tzOffset) } })).data)
    },
  }
}

export function createHttpTimelineRepository(api: ApiClient): TimelineRepository {
  return {
    async get(projectId) {
      return toTimeline((await api.get<TimelineDto>(`/projects/${encodeURIComponent(projectId)}/timeline`)).data)
    },
  }
}

function milestoneBody(input: MilestoneInput): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (input.name !== undefined) body.name = input.name
  if (input.description !== undefined) body.description = input.description
  if (input.dueDate !== undefined) body.due_date = input.dueDate
  if (input.state !== undefined) body.state = input.state
  return body
}

export function createHttpMilestoneRepository(api: ApiClient): MilestoneRepository {
  return {
    async list(projectId) {
      return (await api.get<MilestoneDto[]>(`/projects/${encodeURIComponent(projectId)}/milestones`)).data.map(toMilestone)
    },
    async create(projectId, input) {
      return toMilestone((await api.post<MilestoneDto>(`/projects/${encodeURIComponent(projectId)}/milestones`, milestoneBody(input))).data)
    },
    async update(id, input) {
      return toMilestone((await api.patch<MilestoneDto>(`/milestones/${encodeURIComponent(id)}`, milestoneBody(input))).data)
    },
    async remove(id) {
      await api.del(`/milestones/${encodeURIComponent(id)}`)
    },
  }
}

function charterItemBody(input: CharterItemInput): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (input.kind !== undefined) body.kind = input.kind
  if (input.title !== undefined) body.title = input.title
  if (input.description !== undefined) body.description = input.description
  if (input.state !== undefined) body.state = input.state
  if (input.ownerId !== undefined) body.owner_id = input.ownerId
  if (input.linkIds !== undefined) body.link_ids = input.linkIds
  if (input.taskIds !== undefined) body.task_ids = input.taskIds
  if (input.unit !== undefined) body.unit = input.unit
  if (input.baseline !== undefined) body.baseline = input.baseline
  if (input.target !== undefined) body.target = input.target
  if (input.startDate !== undefined) body.start_date = input.startDate
  if (input.dueDate !== undefined) body.due_date = input.dueDate
  if (input.frequency !== undefined) body.frequency = input.frequency
  return body
}

/** Ficha do projeto: `/projects/{id}/charter` (objetivo, itens, ordem) e `/charter-items/{id}` (item e medições). */
export function createHttpCharterRepository(api: ApiClient): CharterRepository {
  const project = (id: string) => `/projects/${encodeURIComponent(id)}/charter`
  const item = (id: string) => `/charter-items/${encodeURIComponent(id)}`
  return {
    async get(projectId) {
      return toProjectCharter((await api.get<CharterDto>(project(projectId))).data)
    },
    async brief(projectId) {
      return toProjectBrief((await api.get<ProjectBriefDto>(`/projects/${encodeURIComponent(projectId)}/brief`)).data)
    },
    async saveObjective(projectId, objective) {
      return toProjectCharter((await api.put<CharterDto>(project(projectId), { objective })).data)
    },
    async createItem(projectId, input) {
      return toCharterItem((await api.post<CharterItemDto>(`${project(projectId)}/items`, charterItemBody(input))).data)
    },
    async updateItem(id, input) {
      return toCharterItem((await api.patch<CharterItemDto>(item(id), charterItemBody(input))).data)
    },
    async removeItem(id) {
      await api.del(item(id))
    },
    async reorder(projectId, kind, ids) {
      return toProjectCharter((await api.put<CharterDto>(`${project(projectId)}/order`, { kind, ids })).data)
    },
    async measurements(itemId) {
      return (await api.get<CharterMeasurementDto[]>(`${item(itemId)}/measurements`)).data.map(toCharterMeasurement)
    },
    async addMeasurement(itemId, input) {
      const body: Record<string, unknown> = { value: input.value }
      if (input.note !== undefined) body.note = input.note
      if (input.measuredAt !== undefined) body.measured_at = input.measuredAt
      return toCharterItem((await api.post<CharterItemDto>(`${item(itemId)}/measurements`, body)).data)
    },
  }
}

function docSpaceBody(input: DocSpaceInput): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (input.key !== undefined) body.key = input.key
  if (input.name !== undefined) body.name = input.name
  if (input.description !== undefined) body.description = input.description
  if (input.icon !== undefined) body.icon = input.icon
  if (input.color !== undefined) body.color = input.color
  if (input.projectId !== undefined) body.project_id = input.projectId
  if (input.visibility !== undefined) body.visibility = input.visibility
  return body
}

type UserDtoLike = Parameters<typeof toUserSummary>[0]
const userOrNull = (dto: UserDtoLike | null | undefined) => (dto ? toUserSummary(dto) : null)
const dateOrNull = (value: string | null | undefined) => (value ? new Date(value) : null)

export function createHttpDocsRepository(api: ApiClient): DocsRepository {
  const space = (id: string) => `/docs/spaces/${encodeURIComponent(id)}`
  const page = (id: string) => `/docs/pages/${encodeURIComponent(id)}`
  return {
    async listSpaces() {
      return (await api.get<DocSpaceDto[]>('/docs/spaces')).data.map(toDocSpace)
    },
    async getSpace(key) {
      const { data } = await api.get<{ space: DocSpaceDto; pages: DocTreePageDto[]; capabilities: { edit: boolean; manage: boolean } }>(space(key))
      return { space: toDocSpace(data.space), pages: data.pages.map(toDocTreePage), capabilities: { edit: !!data.capabilities.edit, manage: !!data.capabilities.manage } }
    },
    async createSpace(input) {
      return toDocSpace((await api.post<DocSpaceDto>('/docs/spaces', docSpaceBody(input))).data)
    },
    async updateSpace(id, input) {
      return toDocSpace((await api.patch<DocSpaceDto>(space(id), docSpaceBody(input))).data)
    },
    async deleteSpace(id) {
      await api.del(space(id))
    },
    async createPage(spaceId, input) {
      return toDocPage((await api.post<DocPageDto>(`${space(spaceId)}/pages`, { title: input.title, parent_id: input.parentId ?? null })).data)
    },
    async getPage(id) {
      return toDocPage((await api.get<DocPageDto>(page(id))).data)
    },
    async deletePage(id) {
      return (await api.del<{ deleted: number }>(page(id))).data.deleted
    },
    async getDraft(id) {
      const { data } = await api.get<{ title: string; content: RichContent; saved_at: string | null; by: UserDtoLike | null }>(`${page(id)}/draft`)
      return { title: data.title, content: data.content, savedAt: dateOrNull(data.saved_at), by: userOrNull(data.by) }
    },
    async saveDraft(id, input) {
      return dateOrNull((await api.put<{ saved_at: string | null }>(`${page(id)}/draft`, { title: input.title, content: input.content })).data.saved_at)
    },
    async discardDraft(id) {
      await api.del(`${page(id)}/draft`)
    },
    async publish(id, input) {
      return toDocPage((await api.post<DocPageDto>(`${page(id)}/publish`, input ?? {})).data)
    },
    async move(id, target) {
      return toDocPage((await api.put<DocPageDto>(`${page(id)}/move`, { parent_id: target.parentId, prev_id: target.prevId, next_id: target.nextId })).data)
    },
    async listVersions(id) {
      const { data } = await api.get<Array<{ version: number; title: string; author: UserDtoLike | null; created_at: string | null }>>(`${page(id)}/versions`)
      return data.map((v) => ({ version: v.version, title: v.title, author: userOrNull(v.author), createdAt: dateOrNull(v.created_at) }))
    },
    async getVersion(id, version) {
      const { data } = await api.get<{ version: number; title: string; content: RichContent; author: UserDtoLike | null; created_at: string | null }>(`${page(id)}/versions/${version}`)
      return { version: data.version, title: data.title, content: data.content, author: userOrNull(data.author), createdAt: dateOrNull(data.created_at) }
    },
    async restoreVersion(id, version) {
      return toDocPage((await api.post<DocPageDto>(`${page(id)}/versions/${version}/restore`)).data)
    },
    async uploadFiles(pageId, files) {
      const form = new FormData()
      files.forEach((file) => form.append('files', file))
      return (await api.postForm<DocFile[]>(`${page(pageId)}/files`, form)).data
    },
    async search(q) {
      const { data } = await api.get<Array<{ page_id: string; title: string; space: { id: string; key: string; name: string }; snippet: string; published_at: string | null }>>('/docs/search', { query: { q } })
      return data.map((r) => ({ pageId: r.page_id, title: r.title, space: r.space, snippet: r.snippet, publishedAt: dateOrNull(r.published_at) }))
    },
    async recent() {
      const { data } = await api.get<Array<{ page_id: string; title: string; space: { id: string; key: string; name: string }; published_at: string | null; published_by: UserDtoLike | null }>>('/docs/recent')
      return data.map((r) => ({ pageId: r.page_id, title: r.title, space: r.space, publishedAt: dateOrNull(r.published_at), publishedBy: userOrNull(r.published_by) }))
    },
  }
}

export function createHttpSprintRepository(api: ApiClient): SprintRepository {
  const path = (id: string) => `/sprints/${encodeURIComponent(id)}`
  return {
    async list(projectId, options) {
      const { data } = await api.get<SprintDto[]>(`/projects/${encodeURIComponent(projectId)}/sprints`, {
        query: { include_closed: options?.includeClosed ? '1' : undefined },
      })
      return data.map(toSprint)
    },
    async create(projectId, data) {
      return toSprint((await api.post<SprintDto>(`/projects/${encodeURIComponent(projectId)}/sprints`, sprintBody(data))).data)
    },
    async reorder(projectId, ids) {
      const { data } = await api.put<SprintDto[]>(`/projects/${encodeURIComponent(projectId)}/sprints/order`, { ids })
      return data.map(toSprint)
    },
    async update(id, data) {
      const dto = (await api.patch<SprintDto>(path(id), sprintBody(data))).data
      return { ...toSprint(dto), returnedCount: dto.returned_count }
    },
    async remove(id) {
      await api.del(path(id))
    },
  }
}

export function createHttpNotificationRepository(api: ApiClient): NotificationRepository {
  return {
    async list(query) {
      const { data, meta } = await api.get<NotificationDto[], PageMetaDto>('/notifications', {
        query: { page: query.page, perPage: query.perPage, unread: query.unreadOnly ? '1' : undefined },
      })
      return { items: data.map(toNotification), ...meta }
    },
    async unreadCount() {
      return (await api.get<{ count: number }>('/notifications/unread-count')).data.count
    },
    async markRead(id) {
      await api.post(`/notifications/${encodeURIComponent(id)}/read`)
    },
    async markAllRead() {
      return (await api.post<{ updated: number }>('/notifications/read-all')).data.updated
    },
  }
}

export function createHttpCommentRepository(api: ApiClient): CommentRepository {
  const taskPath = (id: string) => `/tasks/${encodeURIComponent(id)}`
  const path = (id: string) => `/comments/${encodeURIComponent(id)}`
  return {
    async list(taskId) {
      return (await api.get<CommentDto[]>(`${taskPath(taskId)}/comments`)).data.map(toComment)
    },
    async create(taskId, content) {
      return toComment((await api.post<CommentDto>(`${taskPath(taskId)}/comments`, { content })).data)
    },
    async update(id, content) {
      return toComment((await api.patch<CommentDto>(path(id), { content })).data)
    },
    async remove(id) {
      await api.del(path(id))
    },
    async mentionCandidates(taskId) {
      return (await api.get<UserSummaryDto[]>(`${taskPath(taskId)}/mention-candidates`)).data.map(toUserSummary)
    },
  }
}

/** Filtro da tabela (id da coluna) -> parâmetro da API em `/tasks`. */
const TASK_FILTERS: Record<string, string> = {
  project: 'project_id',
  type: 'task_type_id',
  status: 'status_id',
  priority: 'priority_id',
  assignee: 'assignee_id',
  category: 'category',
  tags: 'tag_id',
  sprint: 'sprint_id',
  in_report: 'in_report',
  it_visible: 'it_visible',
  urgency: 'urgency',
  area: 'area_id',
}

export function createHttpTaskRepository(api: ApiClient): TaskRepository {
  const path = (id: string) => `/tasks/${encodeURIComponent(id)}`
  return {
    async list(query, options) {
      const filters: Record<string, string | undefined> = {}
      Object.entries(TASK_FILTERS).forEach(([column, param]) => {
        filters[param] = query.filters[column] || undefined
      })
      if (options?.projectId) filters.project_id = options.projectId
      if (options?.planItemId) filters.plan_item_id = options.planItemId
      const { data, meta } = await api.get<TaskDto[], PageMetaDto>('/tasks', {
        query: { page: query.page, perPage: query.perPage, sort: toSortParam(query.sort), search: query.search.trim() || undefined, ...filters },
      })
      return { items: data.map(toTaskSummary), ...meta }
    },
    async get(id) {
      return toTaskDetail((await api.get<TaskDetailDto>(path(id))).data)
    },
    async create(data) {
      return toTaskDetail((await api.post<TaskDetailDto>('/tasks', taskBody(data))).data)
    },
    async update(id, data) {
      return toTaskDetail((await api.patch<TaskDetailDto>(path(id), taskBody(data))).data)
    },
    async setInReport(id, inReport) {
      return toTaskDetail((await api.put<TaskDetailDto>(`${path(id)}/report`, { in_report: inReport })).data)
    },
    async setItVisible(id, itVisible) {
      return toTaskDetail((await api.put<TaskDetailDto>(`${path(id)}/it-visible`, { it_visible: itVisible })).data)
    },
    async setUrgency(id, urgency: Urgency | null) {
      return toTaskDetail((await api.put<TaskDetailDto>(`${path(id)}/urgency`, { urgency })).data)
    },
    async setArea(id, areaId: string | null) {
      return toTaskDetail((await api.put<TaskDetailDto>(`${path(id)}/area`, { area_id: areaId })).data)
    },
    async remove(id) {
      await api.del(path(id))
    },
    async history(id) {
      const { data, meta } = await api.get<AuditEntryDto[], PageMetaDto>(`${path(id)}/history`, { query: { perPage: 100 } })
      return { items: data.map(toAuditEntry), ...meta }
    },
  }
}

function lookupBody(data: Partial<LookupInput> & { key?: string }) {
  return {
    key: data.key,
    name: data.name,
    description: data.description,
    color: data.color,
    category: data.category,
    wip_limit: data.wipLimit,
    allowed_next: data.allowedNext,
    is_active: data.isActive,
    is_default: data.isDefault,
  }
}

/** Status e prioridades compartilham o contrato; muda só a rota e o mapper. */
export function createHttpLookupRepository<T extends LookupItem>(api: ApiClient, base: string, map: (dto: LookupDto) => T): LookupRepository<T> {
  const path = (id: string) => `${base}/${encodeURIComponent(id)}`
  return {
    async list(options) {
      const { data } = await api.get<LookupDto[]>(base, { query: { include_inactive: options?.includeInactive ? '1' : undefined } })
      return data.map(map)
    },
    async create(data) {
      return map((await api.post<LookupDto>(base, lookupBody(data))).data)
    },
    async update(id, data) {
      return map((await api.patch<LookupDto>(path(id), lookupBody(data))).data)
    },
    async remove(id) {
      await api.del(path(id))
    },
    async reorder(ids) {
      return (await api.put<LookupDto[]>(`${base}/order`, { ids })).data.map(map)
    },
  }
}
