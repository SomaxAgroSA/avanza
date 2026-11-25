import type { UserSummary } from './projects'
import { projectPath } from './project-routes'

export const NOTIFICATION_TYPES = [
  'mention',
  'assigned',
  'comment',
  'status_changed',
  'due_soon',
  'overdue',
  'plan_mention',
  'plan_reply',
  // demandas internas (§45)
  'demand_received',
  'demand_passed',
  'demand_concluded',
  'demand_validated',
  'demand_returned',
  // Documentação (§47): alguém pediu que a pessoa olhe uma página
  'doc_shared',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export interface AppNotification {
  id: string
  type: NotificationType
  /** Notificação de tarefa (null nas do quadro de gerenciamento). */
  task: { id: string; code: string; title: string } | null
  /** Notificação de elemento do quadro (GP-3). */
  planItem: { id: string; projectId: string; name: string; projectName: string } | null
  /** Aviso sobre uma página da Documentação (§47). */
  docPage: { id: string; spaceKey: string; spaceName: string; title: string; projectName: string } | null
  /** Quem fez a ação (null em lembretes automáticos). */
  actor: UserSummary | null
  /** comment (trecho; no aviso de página, o "O que olhar"), status, due_date, assignee (demanda passada) — conforme o tipo. */
  data: { comment?: string; status?: string; due_date?: string; assignee?: string }
  read: boolean
  createdAt: Date | null
}

/** Aba da tarefa que a notificação deve abrir. */
export function notificationTab(type: NotificationType): 'comments' | 'details' {
  return type === 'mention' || type === 'comment' ? 'comments' : 'details'
}

/** Endereço que a notificação abre: a tarefa (na aba certa) ou o painel do elemento no quadro. */
export function notificationLink(notification: AppNotification): string | null {
  // página da Documentação (§47)
  if (notification.docPage) return `/docs/${encodeURIComponent(notification.docPage.spaceKey)}/${encodeURIComponent(notification.docPage.id)}`
  // elemento do quadro: abre o painel dele na aba Gestão do projeto
  if (notification.planItem) return projectPath(notification.planItem.projectId, 'management', { item: notification.planItem.id })
  if (!notification.task) return null
  return `/tasks/${notification.task.id}${notificationTab(notification.type) === 'comments' ? '?tab=comments' : ''}`
}
