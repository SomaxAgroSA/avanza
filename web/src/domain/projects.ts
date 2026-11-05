import type { HexColor } from './colors'
import type { Urgency } from './urgency'
import type { AreaRef } from './workflow'
/**
 * Projetos — tipos e regras de apresentação (espelham backend/src/domain/project.js).
 */

export const PROJECT_STATUSES = ['planning', 'active', 'paused', 'completed', 'cancelled'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number]

/** `it` = Responsável TI (regras §33): só vê o resumo do projeto e as tarefas dele (atribuídas ou marcadas para TI). */
export const MEMBER_ROLES = ['manager', 'member', 'viewer', 'it'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]
export type ProjectRole = MemberRole | 'owner'

export const PROJECT_ICONS = [
  'folder', 'rocket', 'briefcase', 'code', 'database', 'globe', 'shield', 'users', 'chart', 'settings',
  'layers', 'zap', 'star', 'box', 'truck', 'building', 'cpu', 'headphones', 'book', 'target',
] as const
export type BuiltinProjectIcon = (typeof PROJECT_ICONS)[number]
/** Ícone padrão ou um da biblioteca (nome do Lucide) — domain/icons.ts. */
export type ProjectIcon = BuiltinProjectIcon | (string & {})

export const PROJECT_COVERS = ['violet', 'indigo', 'blue', 'cyan', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'slate'] as const
export type PaletteCover = (typeof PROJECT_COVERS)[number]
/** Capa da paleta ou cor livre ("#rrggbb") — domain/colors.ts. */
export type ProjectCover = PaletteCover | HexColor

export type ProjectView = 'all' | 'mine' | 'archived'

/**
 * Seções do projeto que o perfil libera (regras §35: `projects.charter`, `projects.history`,
 * `projects.members`, `projects.report`); a Visão geral sempre aparece e o dono do projeto vê todas.
 * O servidor decide e manda em `capabilities.sections`.
 */
export const PROJECT_PROFILE_SECTIONS = ['charter', 'history', 'members', 'report'] as const
export type ProjectProfileSection = (typeof PROJECT_PROFILE_SECTIONS)[number]

export interface ProjectCapabilities {
  edit: boolean
  manageMembers: boolean
  archive: boolean
  delete: boolean
  transfer: boolean
  /** Enviar arquivos ao projeto (aba Arquivos). */
  uploadFiles: boolean
  /** Seções que a pessoa vê neste projeto (o servidor decide pelo perfil; o dono vê todas). */
  sections: ProjectProfileSection[]
}

export interface UserSummary {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

/** Referência curta a outro projeto (o projeto pai). */
export interface ProjectRef {
  id: string
  key: string
  name: string
  icon: ProjectIcon
  cover: ProjectCover
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
  urgency: Urgency | null
  /** Área responsável; null = sem área. */
  area: AreaRef | null
  /** Projeto pai (regras §34); null = projeto sem pai. */
  parent: ProjectRef | null
  /** Quantidade de subprojetos. */
  childCount: number
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

/** A pessoa vê a seção do projeto (Ficha, Histórico, Membros ou Informe)? */
export function seesSection(project: Pick<Project, 'capabilities'>, section: ProjectProfileSection): boolean {
  return project.capabilities.sections.includes(section)
}

/** Responsável TI (regras §33): o projeto abre só o resumo do que precisam dele. */
export function isItRole(project: Pick<Project, 'myRole'>): boolean {
  return project.myRole === 'it'
}

/**
 * Projeto pai, um só nível (regras §34; o servidor valida): quem já tem subprojetos não pode ter pai.
 * Sem projeto (criação), pode.
 */
export function canHaveParent(project: Pick<Project, 'childCount'> | null | undefined): boolean {
  return !project || project.childCount === 0
}

/** Pais possíveis: projetos sem pai, não arquivados, que a pessoa edita, e nunca o próprio projeto. */
export function parentCandidates(all: readonly Project[], project: Pick<Project, 'id'> | null | undefined): Project[] {
  return all.filter((p) => !p.parent && !p.archivedAt && p.capabilities.edit && p.id !== project?.id)
}

/** Pode criar um subprojeto a partir deste: quem cria projetos e edita este, que não é subprojeto nem arquivado. */
export function canAddSubproject(project: Project, canCreateProjects: boolean): boolean {
  return canCreateProjects && project.capabilities.edit && !project.parent && !project.archivedAt
}
