/**
 * Quadro do projeto — GP-4: Gestão (Diário do projeto e Gestão dos problemas) e relatório com a saúde
 * do projeto (diretriz §15 e §16). As regras (quem registra, edita, exclui; cálculos do relatório e
 * da saúde) ficam no servidor (backend/src/domain/plan-management.js e plan-report.js);
 * aqui ficam os tipos e os limites da tela.
 */
import type { UserSummary } from './projects'

export const JOURNAL_MAX = 5000
export const ISSUE_DESCRIPTION_MAX = 2000

export const ISSUE_STATES = ['in_progress', 'pending', 'resolved'] as const
export type IssueState = (typeof ISSUE_STATES)[number]

export interface JournalEntry {
  id: string
  /** AAAA-MM-DD */
  entryDate: string
  content: string
  author: UserSummary | null
  createdAt: Date | null
  updatedAt: Date | null
  capabilities: { edit: boolean; delete: boolean }
}

export interface PlanJournal {
  /** Do dia mais recente para o mais antigo. */
  entries: JournalEntry[]
  capabilities: { create: boolean }
}

export interface JournalInput {
  entryDate?: string
  content?: string
}

export interface PlanIssue {
  id: string
  /** #1, #2… por projeto (não se repete). */
  number: number
  /** AAAA-MM-DD */
  openedOn: string
  description: string
  state: IssueState
  owner: UserSummary | null
  resolvedOn: string | null
  createdBy: UserSummary | null
  createdAt: Date | null
  updatedAt: Date | null
  capabilities: { edit: boolean; delete: boolean }
}

export interface PlanIssues {
  issues: PlanIssue[]
  capabilities: { create: boolean }
}

export interface IssueInput {
  openedOn?: string
  description?: string
  state?: IssueState
  ownerId?: string | null
}

/* ------------------------------------------------------------------ relatório e saúde */

/** Os problemas da Gestão não entram na saúde: ficam só na aba Problemas. */
export const HEALTH_FACTORS = ['schedule', 'progress', 'stuck', 'effort'] as const
export type HealthFactorKey = (typeof HEALTH_FACTORS)[number]
export type HealthLevel = 'ok' | 'attention' | 'critical' | 'none'

export interface HealthFactor {
  key: HealthFactorKey
  level: HealthLevel
  /** schedule/stuck/effort: %; progress: pontos abaixo do planejado; issues: quantidade. null = sem dados. */
  value: number | null
  count?: number
  of?: number
  planned?: number | null
  actual?: number | null
  hours?: number | null
}

export interface PlanReport {
  today: string
  summary: { total: number; done: number; open: number; overdue: number; stuck: number; canceled: number; progress: number }
  schedule: { onTime: number; overdue: number; unscheduled: number; done: number }
  effort: { estimated: number | null; actual: number | null; remaining: number | null; deviation: { hours: number; percent: number } | null }
  resources: Array<{ resourceId: string | null; name: string | null; color: string | null; items: number; open: number; estimated: number | null }>
  groups: Array<{ groupId: string; number: string | null; name: string; color: string; items: number; done: number; overdue: number; progress: number; estimated: number | null; actual: number | null }>
  health: { level: HealthLevel; factors: HealthFactor[] }
  /** O que está por trás de cada fator (o card da saúde abre a lista). */
  details: PlanReportDetails
  /** Projetos somados (o principal e, com scope=family, os subprojetos que a pessoa vê). */
  scope: { mode: PlanReportScope; projects: Array<PlanReportProject & { items: number }> }
}

export type PlanReportScope = 'project' | 'family'

export interface PlanReportProject {
  id: string
  key: string
  name: string
}

export interface PlanReportItem {
  id: string
  name: string
  project: PlanReportProject
  status: { name: string; color: string; category: string } | null
  startDate: string | null
  endDate: string | null
  progress: number
}

export interface PlanReportIssue {
  id: string
  number: number
  description: string
  state: string
  openedOn: string | null
  project: PlanReportProject
}

export interface PlanReportDetails {
  overdue: PlanReportItem[]
  stuck: PlanReportItem[]
  behind: PlanReportItem[]
  overEffort: PlanReportItem[]
  issues: PlanReportIssue[]
}
