import type { TFunction } from 'i18next'
import type { AuditEntry } from '@/domain/entities'

export interface AuditChange {
  field: string
  label: string
  before: string
  after: string
}

/** Ações conhecidas (usadas no filtro da página de auditoria). */
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.login_locked',
  'auth.logout',
  'auth.session_revoked',
  'auth.other_sessions_revoked',
  'auth.password_changed',
  'user.created',
  'user.updated',
  'user.disabled',
  'user.enabled',
  'user.password_reset',
  'role.created',
  'role.updated',
  'role.permissions_updated',
  'role.deleted',
  'project.created',
  'project.updated',
  'project.archived',
  'project.unarchived',
  'project.deleted',
  'project.owner_changed',
  'project.member_added',
  'project.member_role_changed',
  'project.member_removed',
  'project.member_left',
  'task_type.created',
  'task_type.updated',
  'task_type.deleted',
  'task_type.reordered',
  'task_type.fields_updated',
  'custom_field.created',
  'custom_field.updated',
  'custom_field.deleted',
  'custom_field.option_added',
  'status.created',
  'status.updated',
  'status.deleted',
  'status.reordered',
  'priority.created',
  'priority.updated',
  'priority.deleted',
  'priority.reordered',
  'task.created',
  'task.updated',
  'task.deleted',
  'task.linked',
  'task.unlinked',
  'task.forked',
  'comment.added',
  'comment.edited',
  'comment.deleted',
  'tag.created',
  'tag.updated',
  'tag.deleted',
  'attachment.added',
  'attachment.deleted',
  'milestone.created',
  'milestone.updated',
  'milestone.deleted',
  'sprint.created',
  'sprint.updated',
  'sprint.deleted',
  'sprint.reordered',
  'doc_space.created',
  'doc_space.updated',
  'doc_space.deleted',
  'doc_page.created',
  'doc_page.published',
  'doc_page.moved',
  'doc_page.deleted',
  'doc_page.restored',
  'project_group.created',
  'project_group.updated',
  'project_group.moved',
  'project_group.deleted',
  'project_group.duplicated',
  'plan_item.created',
  'plan_item.updated',
  'plan_item.deleted',
  'plan_item.duplicated',
  'plan_item.linked',
  'plan_item.unlinked',
  'plan_item.imported',
  'plan_item.update_added',
  'plan_item.update_edited',
  'plan_item.update_deleted',
  'plan_item.file_added',
  'plan_item.file_deleted',
  'plan_settings.updated',
  'plan_settings.baseline_saved',
  'plan_settings.baseline_cleared',
  'plan_journal.created',
  'plan_journal.updated',
  'plan_journal.deleted',
  'plan_issue.created',
  'plan_issue.updated',
  'plan_issue.deleted',
  'plan_column.created',
  'plan_column.updated',
  'plan_column.type_changed',
  'plan_column.duplicated',
  'plan_column.deleted',
  'plan_status.created',
  'plan_status.updated',
  'plan_status.deleted',
  'plan_resource.created',
  'plan_resource.updated',
  'plan_resource.deleted',
  'platform_settings.update',
  'platform_settings.branding_update',
  'platform_settings.branding_remove',
  'audit_log.purge',
  'email_settings.update',
  'email_settings.test_sent',
  'auth.password_reset_requested',
  'auth.password_reset',
  'auth.invite_accepted',
  'user.invited',
  'api_token.created',
  'api_token.revoked',
  'webhook.created',
  'webhook.updated',
  'webhook.deleted',
  'webhook.secret_rotated',
  'webhook.disabled',
] as const

export const AUDIT_ENTITY_TYPES = ['user', 'role', 'project', 'task_type', 'custom_field', 'status', 'priority', 'task', 'tag', 'sprint', 'doc_space', 'doc_page', 'plan_item', 'platform_settings', 'audit_log', 'email_settings', 'api_token', 'webhook'] as const

export function actionLabel(t: TFunction, action: string): string {
  return t(`audit.actions.${action}`, { defaultValue: action })
}

export function entityTypeLabel(t: TFunction, entityType: string): string {
  return t(`audit.entityTypes.${entityType}`, { defaultValue: entityType })
}

function formatValue(t: TFunction, field: string, value: unknown, resolve?: (field: string, value: string) => string | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) {
    if (field === 'permissions') return value.map((code) => t(`permissions.codes.${String(code)}`, { defaultValue: String(code) })).join(', ') || '—'
    return value.map(String).join(', ')
  }
  if (typeof value === 'boolean') return value ? t('audit.yes') : t('audit.no')
  const text = String(value)
  if (field === 'status') return t(`users.status.${text}`, { defaultValue: t(`projects.status.${text}`, { defaultValue: text }) })
  if (field === 'priority') return t(`projects.priority.${text}`, { defaultValue: text })
  if (field === 'role') return t(`projects.roles.${text}`, { defaultValue: text })
  if (field === 'icon') return t(`projects.icons.${text}`, { defaultValue: text })
  if (field === 'cover') return t(`projects.covers.${text}`, { defaultValue: text })
  if (field === 'state') return t(`sprints.states.${text}`, { defaultValue: text })
  if (field === 'color') return t(`colors.${text}`, { defaultValue: text })
  if (field === 'link_type') return t(`plan.linkTypes.${text}`, { defaultValue: text })
  if (field === 'dependency_rule') return t(`plan.dependencyRule.${text}`, { defaultValue: text })
  if (field === 'issue_state') return t(`plan.management.issues.states.${text}`, { defaultValue: text })
  if (field === 'column_type') return t(`plan.customColumns.types.${text}`, { defaultValue: text })
  if (field === 'category') return t(`workflow.categories.${text}`, { defaultValue: t(`plan.categories.${text}`, { defaultValue: text }) })
  if (field === 'visibility') return t(`docs.visibility.${text}`, { defaultValue: text })
  if ((field === 'start_date' || field === 'due_date' || field === 'end_date' || field === 'entry_date' || field === 'opened_on') && /^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10).split('-').reverse().join('/')
  if (field === 'locale') return t(`language.${String(value)}`, { defaultValue: String(value) })
  if (field === 'theme') return t(`theme.${String(value)}`, { defaultValue: String(value) })
  return resolve?.(field, String(value)) ?? String(value)
}

/** Ordem de exibição dos campos mais relevantes (os demais vêm depois, na ordem recebida). */
const FIELD_ORDER = [
  'code',
  'key',
  'name',
  'title',
  'task_type',
  'task_status',
  'task_priority',
  'sprint',
  'parent',
  'forked_from',
  'fork',
  'state',
  'status',
  'priority',
  'assignee',
  'reporter',
  'owner',
  'role',
  'start_date',
  'end_date',
  'due_date',
  'estimated_hours',
  'actual_hours',
  'tags',
  'comment',
  'mentions',
  'checklist',
  'attachments',
  'field',
  'description',
]

/**
 * Lista de alterações legíveis (campo: antes → depois) a partir de old_value/new_value.
 * `resolve` permite traduzir IDs (ex.: role_id -> nome do perfil).
 */
export function describeChanges(
  t: TFunction,
  entry: AuditEntry,
  resolve?: (field: string, value: string) => string | undefined,
): AuditChange[] {
  const before = entry.oldValue ?? {}
  const after = entry.newValue ?? {}
  // o banco devolve as chaves em ordem alfabética; exibimos as principais primeiro e os campos personalizados por último
  const rank = (field: string) => {
    const index = FIELD_ORDER.indexOf(field)
    return index >= 0 ? index : field.startsWith('cf:') ? FIELD_ORDER.length + 1 : FIELD_ORDER.length
  }
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((a, b) => rank(a) - rank(b))
  return fields.map((field) => ({
    field,
    // campos personalizados chegam como "cf:<rótulo>" (o rótulo já é o texto exibido)
    // relações chegam como "rel:<tipo>" (tipo do ponto de vista desta tarefa)
    label: field.startsWith('cf:')
      ? field.slice(3)
      : field.startsWith('rel:')
        ? t(`relations.types.${field.slice(4)}`, { defaultValue: field.slice(4) })
        : t(`audit.fields.${field}`, { defaultValue: field }),
    before: field in before ? formatValue(t, field, before[field], resolve) : '',
    after: field in after ? formatValue(t, field, after[field], resolve) : '',
  }))
}
