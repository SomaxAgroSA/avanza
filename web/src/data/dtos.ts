/** Formato público da API /api/v1 (snake_case, datas ISO 8601). */

export interface UserDto {
  id: string
  name: string
  email: string
  avatar_url: string | null
  status: string
  role_id: string
  locale: string
  theme: string
  email_notifications?: boolean
  created_at: string | null
  updated_at: string | null
  last_login_at: string | null
}

export interface RoleDto {
  id: string
  code: string
  name: string
  description: string
  is_system: boolean
  permissions?: string[]
  user_count?: number
}

export interface PermissionDto {
  id: string
  code: string
  module: string
}

export interface SessionDto {
  id: string
  ip: string
  user_agent: string
  remember: boolean
  created_at: string | null
  last_seen_at: string | null
  expires_at: string | null
  current: boolean
}

export interface MeDto {
  user: UserDto
  role: RoleDto | null
  permissions: string[]
  session: SessionDto | null
}

export interface AuditEntryDto {
  id: string
  entity_type: string
  entity_id: string
  action: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  user: { id: string; name: string | null; email: string | null } | null
  ip: string
  correlation_id: string
  created_at: string | null
}

export interface UserSummaryDto {
  id: string
  name: string
  email: string
  avatar_url: string | null
}

export interface ProjectDto {
  id: string
  name: string
  key: string
  description: string
  icon: string
  cover: string
  status: string
  priority: string
  owner: UserSummaryDto | null
  start_date: string | null
  due_date: string | null
  archived_at: string | null
  created_at: string | null
  updated_at: string | null
  member_count: number
  my_role: string | null
  capabilities: { edit: boolean; manage_members: boolean; archive: boolean; delete: boolean; transfer: boolean }
}

export interface ProjectMemberDto {
  user: UserSummaryDto & { status: string }
  role: string
  is_owner: boolean
  joined_at: string | null
}

export interface FieldOptionDto {
  id: string
  label: string
  color: string
  order: number
  is_active: boolean
}

export interface CustomFieldDto {
  id: string
  name: string
  label: string
  type: string
  description: string
  config: Record<string, number | boolean>
  default_value: string | number | boolean | string[] | null
  searchable: boolean
  filterable: boolean
  sortable: boolean
  options: FieldOptionDto[]
  used_by: Array<{ id: string; key: string; name: string }>
  created_at: string | null
  updated_at: string | null
}

export interface TaskTypeDto {
  id: string
  key: string
  name: string
  description: string
  translations?: Partial<Record<string, { name?: string; description?: string }>>
  icon: string
  color: string
  order: number
  is_active: boolean
  field_count: number
  created_at: string | null
  updated_at: string | null
}

export interface TaskDto {
  id: string
  code: string
  number: number
  title: string
  project: { id: string; key: string; name: string } | null
  type: { id: string; key: string; name: string; icon: string; color: string } | null
  status: { id: string; key: string; name: string; color: string; category: string } | null
  priority: { id: string; key: string; name: string; color: string } | null
  sprint?: { id: string; name: string; state: string } | null
  creator: UserSummaryDto | null
  assignee: UserSummaryDto | null
  reporter: UserSummaryDto | null
  parent_task_id: string | null
  start_date?: string | null
  due_date: string | null
  estimated_hours: number | null
  actual_hours: number | null
  started_at: string | null
  completed_at: string | null
  created_at: string | null
  updated_at: string | null
  tags?: Array<{ id: string; name: string; color: string }>
  checklist_progress?: { done: number; total: number }
  comment_count?: number
  attachment_count?: number
  subtask_progress?: { done: number; total: number }
  blocked?: boolean
}

export interface PlanStatusDto {
  id: string
  name: string
  color: string
  category: string
  position?: number
}

export interface PlanResourceDto {
  id: string
  name: string
  color?: string
}

export interface PlanGroupSummaryDto {
  items: number
  status_counts?: Array<{ status_id: string | null; count: number }>
  start_date: string | null
  end_date: string | null
  estimated_hours: number | null
  duration_days: number | null
  progress: number
  custom_sums?: Record<string, number | null>
}

export interface PlanGroupDto {
  id: string
  parent_id: string | null
  name: string
  color: string
  position: number
  number: string | null
  summary?: PlanGroupSummaryDto | null
}

export interface PlanItemDto {
  id: string
  group_id: string
  parent_id: string | null
  name: string
  status_id: string | null
  start_date: string | null
  end_date: string | null
  due_date: string | null
  owner: UserSummaryDto | null
  resource_ids?: string[]
  estimated_hours: number | null
  actual_hours: number | null
  duration_days: number | null
  duration_manual: number | null
  progress?: { value: number; source: string }
  progress_manual: number | null
  subitems?: number
  position?: number
  blocked?: boolean
  updates?: number
  files?: number
  baseline_start?: string | null
  baseline_end?: string | null
  custom?: Record<string, string | number | boolean>
}

export interface PlanColumnDto {
  id: string
  name: string
  type: string
  settings?: { options?: Array<{ id: string; name: string; color: string }>; unit?: string } | null
  position?: number
}

export interface PlanLinkDto {
  id: string
  from_id: string
  to_id: string
  type: string
}

export interface PlanDto {
  project: { id: string; key: string; name: string; archived?: boolean }
  capabilities: { edit?: boolean; manage?: boolean }
  statuses?: PlanStatusDto[]
  resources?: PlanResourceDto[]
  groups?: PlanGroupDto[]
  items?: PlanItemDto[]
  links?: PlanLinkDto[]
  columns?: PlanColumnDto[]
  settings?: { dependency_rule?: string; baseline_at?: string | null }
  summary?: PlanGroupSummaryDto | null
  truncated?: boolean
}

export interface AttachmentDto {
  id: string
  task_id: string
  comment_id?: string | null
  name: string
  mime: string
  kind: string
  size: number
  uploaded_by: UserSummaryDto | null
  created_at: string | null
  url: string
  capabilities: { delete: boolean }
}

export interface NotificationDto {
  id: string
  type: string
  task: { id: string; code: string; title: string } | null
  plan_item?: { id: string; project_id: string | null; name: string; project_name: string } | null
  actor: UserSummaryDto | null
  data: Record<string, unknown>
  read: boolean
  created_at: string | null
}

export interface BoardDto {
  project: { id: string; key: string; name: string; archived: boolean }
  capabilities: { move: boolean; create: boolean }
  columns: Array<{
    status: { id: string; key: string; name: string; color: string; category: string; is_default: boolean }
    wip_limit: number
    allowed_next: string[]
    total: number
    truncated: boolean
    tasks: Array<TaskDto & { card_fields?: Array<{ field: CustomFieldDto; value: unknown }> }>
  }>
}

export interface DocSpaceDto {
  id: string
  key: string
  name: string
  description: string
  icon: string
  color: string
  visibility: string
  project: { id: string; key: string; name: string } | null
  home_page_id: string | null
  page_count: number | null
  created_at: string | null
  updated_at: string | null
  capabilities: { edit: boolean; manage: boolean }
}

export interface DocTreePageDto {
  id: string
  parent_id: string | null
  title: string
  status: string
  position: number
  has_draft: boolean
  is_home: boolean
  updated_at: string | null
}

export interface DocPageDto {
  id: string
  space: { id: string; key: string; name: string }
  parent_id: string | null
  title: string
  status: string
  content: Record<string, unknown> | null
  version: number
  published_at: string | null
  published_by: UserSummaryDto | null
  created_by: UserSummaryDto | null
  is_home: boolean
  ancestors: Array<{ id: string; title: string }>
  children: Array<{ id: string; title: string; status: string }>
  draft: { title: string; by: UserSummaryDto | null; at: string | null } | null
  capabilities: { edit: boolean; manage: boolean }
}

export interface MilestoneDto {
  id: string
  project_id: string
  name: string
  description: string
  due_date: string
  state: string
  created_at: string | null
  updated_at: string | null
}

export interface TimelineDto {
  project: { id: string; key: string; name: string; start_date: string | null; due_date: string | null; archived: boolean }
  capabilities: { edit: boolean; manage_milestones: boolean }
  tasks: TaskDto[]
  dependencies: Array<{ id: string; type: string; from: string; to: string; conflict: boolean }>
  milestones: MilestoneDto[]
  sprints: SprintDto[]
  truncated: boolean
}

export interface SprintDto {
  id: string
  project_id: string
  name: string
  goal: string
  start_date: string | null
  end_date: string | null
  state: string
  order?: number
  created_at: string | null
  updated_at: string | null
  returned_count?: number
}

export interface BacklogDto {
  project: { id: string; key: string; name: string; archived: boolean }
  capabilities: { rank: boolean; create: boolean; manage_sprints: boolean }
  statuses: Array<{ id: string; key: string; name: string; color: string; category: string; is_default: boolean }>
  sprints: SprintDto[]
  items: TaskDto[]
  truncated: boolean
}

export interface DurationDto {
  hours: number | null
  count: number
}

/** Tarefa do detalhamento de indicador (GET /reports/tasks). */
export interface ReportTaskDto extends TaskDto {
  metric_hours?: number | null
}

export interface ReportDto {
  period: { from: string; to: string; tz_offset: number }
  generated_at: string
  definitions: { bug_types: Array<{ id: string; name: string }>; critical_priority: { id: string; name: string } | null }
  indicators: {
    total: number
    open: number
    backlog: number
    todo: number
    in_progress: number
    blocked: number
    overdue: number
    critical_bugs: number
    created: number
    completed: number
    cancelled: number
    lead_time: DurationDto
    cycle_time: DurationDto
    bug_resolution: DurationDto
  }
  series: { bucket: string; points: Array<{ date: string; created: number; completed: number }> }
  breakdown: {
    dimension: string
    rows: Array<{
      key: string
      label: Record<string, unknown> | null
      total: number
      open: number
      overdue: number
      blocked: number
      created: number
      completed: number
      lead_time: DurationDto
    }>
  }
  overdue_tasks: TaskDto[]
}

export interface TagDto {
  id: string
  name: string
  color: string
  task_count?: number
}

export interface CommentDto {
  id: string
  task_id: string
  author: UserSummaryDto | null
  content: string
  mentions: UserSummaryDto[]
  attachments?: AttachmentDto[]
  deleted: boolean
  created_at: string | null
  edited_at: string | null
  capabilities: { edit: boolean; delete: boolean }
}

export interface TaskDetailDto extends TaskDto {
  description: string
  checklist?: Array<{ id: string; text: string; done: boolean }>
  custom_values: Record<string, unknown>
  fields: TaskTypeDetailDto['fields']
  capabilities: { edit: boolean; delete: boolean; assign: boolean; comment?: boolean; link?: boolean; fork?: boolean }
  parent?: { id: string; code: string; title: string } | null
  forked_from?: { id: string; code: string; title: string } | null
}

export interface TaskRelationDto {
  id: string
  type: string
  task: TaskDto
  created_by: UserSummaryDto | null
  created_at: string | null
  capabilities?: { delete?: boolean }
}

export interface TaskRelationsDto {
  parent: TaskDto | null
  children: TaskDto[]
  subtask_progress?: { done: number; total: number }
  forked_from: TaskDto | null
  forks: TaskDto[]
  relations: TaskRelationDto[]
  capabilities?: { link?: boolean; fork?: boolean; create_subtask?: boolean; edit?: boolean }
}

/** Status e prioridades (`category` só em status). */
export interface LookupDto {
  id: string
  key: string
  name: string
  description: string
  color: string
  order: number
  is_active: boolean
  is_default: boolean
  category?: string
  wip_limit?: number
  allowed_next?: string[]
  created_at: string | null
  updated_at: string | null
}

export interface TaskTypeDetailDto extends TaskTypeDto {
  fields: Array<{ field: CustomFieldDto; order: number; required: boolean; visible: boolean; show_on_card: boolean; required_status_ids?: string[] }>
}

export interface PageMetaDto {
  page: number
  perPage: number
  total: number
  totalPages: number
}

export interface PlanUpdateDto {
  id: string
  item_id: string
  parent_id: string | null
  author: UserSummaryDto | null
  content: string
  mentions?: UserSummaryDto[]
  deleted?: boolean
  created_at: string | null
  edited_at: string | null
  capabilities?: { edit?: boolean; delete?: boolean; reply?: boolean }
  files?: PlanFileDto[]
  replies?: PlanUpdateDto[]
}

export interface PlanFileDto {
  id: string
  item_id: string
  update_id?: string | null
  name: string
  mime: string
  kind: string
  size: number
  uploaded_by: UserSummaryDto | null
  created_at: string | null
  url: string
  capabilities?: { delete?: boolean }
}

/* ------------------------------------------------------------------ quadro — GP-4 (gestão e relatório) */

export interface JournalEntryDto {
  id: string
  entry_date: string
  content: string
  author: UserSummaryDto | null
  created_at: string | null
  updated_at: string | null
  capabilities?: { edit?: boolean; delete?: boolean }
}

export interface PlanIssueDto {
  id: string
  number: number
  opened_on: string
  description: string
  state: string
  owner: UserSummaryDto | null
  resolved_on: string | null
  created_by: UserSummaryDto | null
  created_at: string | null
  updated_at: string | null
  capabilities?: { edit?: boolean; delete?: boolean }
}

export interface PlanReportDto {
  today: string
  summary: { total: number; done: number; open: number; overdue: number; stuck: number; canceled: number; progress: number }
  schedule: { on_time: number; overdue: number; unscheduled: number; done: number }
  effort: { estimated: number | null; actual: number | null; remaining: number | null; deviation: { hours: number; percent: number } | null }
  resources: Array<{ resource_id: string | null; name: string | null; color: string | null; items: number; open: number; estimated: number | null }>
  groups: Array<{ group_id: string; number: string | null; name: string; color: string; items: number; done: number; overdue: number; progress: number; estimated: number | null; actual: number | null }>
  health: { level: string; factors: Array<{ key: string; level: string; value: number | null; count?: number; of?: number; planned?: number | null; actual?: number | null; hours?: number | null }> }
}

// ---------------------------------------------------------------- Configurador geral

export interface PlatformInfoDto {
  name: string
  logo_light_url: string | null
  logo_dark_url: string | null
  favicon_url: string | null
  password_reset?: boolean
}

export interface PlatformValuesDto {
  audit_retention_months: number
  lockout_threshold: number
  lockout_base_minutes: number
  lockout_max_minutes: number
  password_min_length: number
  password_require_mixed_case: boolean
  password_require_symbol: boolean
  platform_name: string
}

interface RangeDto {
  min: number
  max: number
}

export interface PlatformSettingsDto {
  values: PlatformValuesDto
  defaults: PlatformValuesDto
  limits: { lockout_threshold: RangeDto; lockout_base_minutes: RangeDto; lockout_max_minutes: RangeDto; password_min_length: RangeDto; platform_name: { max: number } }
  retention_options: number[]
  branding: Record<string, { name: string; mime: string; size: number } | null>
  updated_at: string | null
}

export interface PasswordPolicyDto {
  min_length: number
  max_length: number
  require_letters_numbers: boolean
  require_mixed_case: boolean
  require_symbol: boolean
}

// ---------------------------------------------------------------- e-mail (integrações)

export interface EmailSettingsDto {
  values: { enabled: boolean; host: string; port: number; username: string; tls: boolean; sender_name: string; sender_address: string; app_url: string }
  has_password: boolean
}

export interface OutboxSummaryDto {
  counts: { pending: number; sent: number; failed: number }
  recent: Array<{ id: string; to: string; kind: string; subject: string; status: string; attempts: number; last_error: string | null; created_at: string | null; sent_at: string | null }>
}

export interface ResetTokenCheckDto {
  valid: boolean
  state: string
  purpose?: string
  name?: string
  policy?: PasswordPolicyDto
}

export interface ApiTokenDto {
  id: string
  name: string
  prefix: string
  state: string
  created_at: string | null
  expires_at: string | null
  last_used_at: string | null
  last_used_ip: string | null
  revoked_at: string | null
  user?: UserSummaryDto
  token?: string
}

export interface WebhookDto {
  id: string
  name: string
  url: string
  events: string[]
  active: boolean
  last_status: number | null
  last_delivery_at: string | null
  consecutive_failures: number
  created_at: string | null
  secret?: string
}

export interface WebhookDeliveryDto {
  id: string
  webhook_id: string
  event: string
  status: string
  attempts: number
  response_status: number | null
  response_body: string | null
  error: string | null
  duration_ms: number | null
  next_attempt_at: string | null
  delivered_at: string | null
  created_at: string | null
}
