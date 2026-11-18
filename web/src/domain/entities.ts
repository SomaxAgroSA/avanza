import type { PermissionCode } from './permissions'
import type { ThemePreference } from '@/core/theme/theme'
import type { Language } from '@/core/i18n'

export type UserStatus = 'active' | 'disabled'

export interface User {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  status: UserStatus
  roleId: string
  locale: Language
  theme: ThemePreference
  /** Recebe as notificações também por e-mail (quando o envio está ligado). */
  emailNotifications: boolean
  /** Tela aberta ao entrar no Avanza (§38); '' = automática. */
  homePage: string
  createdAt: Date | null
  updatedAt: Date | null
  lastLoginAt: Date | null
}

/** Vista da lista "Em andamento" de um perfil (§41): '' = Gestão (padrão); 'executive' = Direção e gerência (consulta). */
export const ONGOING_VIEWS = ['', 'executive'] as const
export type OngoingView = (typeof ONGOING_VIEWS)[number]

export interface Role {
  id: string
  code: string
  name: string
  description: string
  isSystem: boolean
  /** Vista da lista Em andamento de quem tem este perfil (§41). */
  ongoingView: OngoingView
  permissions: PermissionCode[]
  userCount: number
}

export type RoleSummary = Pick<Role, 'id' | 'code' | 'name' | 'description' | 'isSystem' | 'ongoingView'>

export interface Permission {
  id: string
  code: PermissionCode
  module: string
}

export interface Session {
  id: string
  ip: string
  userAgent: string
  remember: boolean
  createdAt: Date | null
  lastSeenAt: Date | null
  expiresAt: Date | null
  current: boolean
}

export interface AuditActor {
  id: string
  name: string | null
  email: string | null
}

/** Registro imutável do histórico de auditoria. */
export interface AuditEntry {
  id: string
  entityType: string
  entityId: string
  action: string
  oldValue: Record<string, unknown> | null
  newValue: Record<string, unknown> | null
  user: AuditActor | null
  ip: string
  correlationId: string
  createdAt: Date | null
}

/** Contexto do usuário autenticado (GET /auth/me). */
export interface CurrentUser {
  user: User
  role: RoleSummary | null
  permissions: PermissionCode[]
  session: Session | null
}
