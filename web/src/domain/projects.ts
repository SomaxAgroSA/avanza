import type { TaskUrgency } from './tasks'
/**
 * Projetos — tipos e regras de apresentação (espelham backend/pb_hooks/src/domain/project.js).
 */

export const PROJECT_STATUSES = ['planning', 'active', 'paused', 'completed', 'cancelled'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number]

export const MEMBER_ROLES = ['manager', 'member', 'viewer'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]
export type ProjectRole = MemberRole | 'owner'

export const PROJECT_ICONS = [
  'folder', 'rocket', 'briefcase', 'code', 'database', 'globe', 'shield', 'users', 'chart', 'settings',
  'layers', 'zap', 'star', 'box', 'truck', 'building', 'cpu', 'headphones', 'book', 'target',
] as const
export type ProjectIcon = (typeof PROJECT_ICONS)[number]

export const PROJECT_COVERS = ['violet', 'indigo', 'blue', 'cyan', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'slate'] as const
export type ProjectCover = (typeof PROJECT_COVERS)[number]

export type ProjectView = 'all' | 'mine' | 'archived'

export interface ProjectCapabilities {
  edit: boolean
  manageMembers: boolean
  archive: boolean
  delete: boolean
  transfer: boolean
}

export interface UserSummary {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

export interface Project {
  id: string
  name: string
  key: string
  description: string
  icon: ProjectIcon
  cover: ProjectCover
  status: ProjectStatus
  priority: ProjectPriority
  /** Urgência (semáforo); null = sem urgência. */
  urgency: TaskUrgency | null
  owner: UserSummary | null
  startDate: Date | null
  dueDate: Date | null
  archivedAt: Date | null
  createdAt: Date | null
  updatedAt: Date | null
  memberCount: number
  myRole: ProjectRole | null
  capabilities: ProjectCapabilities
}

export interface ProjectMember {
  user: UserSummary & { status: 'active' | 'disabled' }
  role: MemberRole
  isOwner: boolean
  joinedAt: Date | null
}

const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/

export function normalizeKey(value: string): string {
  return value.trim().toUpperCase()
}

export function isValidKey(value: string): boolean {
  return KEY_PATTERN.test(value)
}

/**
 * Sugere uma chave a partir do nome: a sigla inicial ("CRM Corporativo" -> "CRM"),
 * as iniciais das palavras ("Projetos Internos" -> "PI") ou as primeiras letras
 * quando há uma só palavra ("Integrações" -> "INTEG").
 */
export function suggestKey(name: string): string {
  // Nome que começa com uma sigla ("CRM Corporativo", "SAP B1") usa a própria sigla.
  const firstWord = name.trim().split(/\s+/)[0] ?? ''
  if (/^[A-Z][A-Z0-9]{1,9}$/.test(firstWord)) return firstWord
  const words = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return ''
  const raw = words.length === 1 ? (words[0] ?? '').slice(0, 5) : words.map((w) => w[0]).join('').slice(0, 10)
  const key = raw.replace(/^[0-9]+/, '')
  return key.length >= 2 ? key : (words.join('').replace(/^[0-9]+/, '').slice(0, 5))
}

/** Prazo vencido: tem data de entrega no passado e o projeto não foi concluído/cancelado. */
export function isOverdue(project: Pick<Project, 'dueDate' | 'status'>, now: Date = new Date()): boolean {
  if (!project.dueDate || project.status === 'completed' || project.status === 'cancelled') return false
  const endOfDue = new Date(project.dueDate.getTime())
  endOfDue.setUTCHours(23, 59, 59, 999)
  return endOfDue.getTime() < now.getTime()
}
