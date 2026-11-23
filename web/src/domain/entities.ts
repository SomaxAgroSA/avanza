import type { PermissionCode } from './permissions'
import type { TaskViews } from './task-views'
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

/** Vista da lista "Em andamento" de um perfil (§41): '' = Gestão (padrão); 'executive' = Direção e gerência (consulta); 'both' = as duas, com seletor na tela. */
export const ONGOING_VIEWS = ['', 'executive', 'both'] as const
export type OngoingView = (typeof ONGOING_VIEWS)[number]

/** Perfil de acesso; com as Tarefas do perfil (ajuste 23/11: onde o menu abre, a Lista e a caixa Todas). */
export interface Role extends TaskViews {
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

export type RoleSummary = Pick<Role, 'id' | 'code' | 'name' | 'description' | 'isSystem' | 'ongoingView' | keyof TaskViews>

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

/** O que a plataforma liga ou desliga para todos em Configurações → Geral (vem em GET /auth/me). */
export interface PlatformFeatures {
  /** Panorama (§26.2): desligado, some do menu, da paleta e da página inicial de todos. */
  panoramaEnabled: boolean
}

/** Contexto do usuário autenticado (GET /auth/me). */
export interface CurrentUser {
  user: User
  role: RoleSummary | null
  permissions: PermissionCode[]
  session: Session | null
  platform: PlatformFeatures
}
