import type { Project, UserSummary } from '@/domain/projects'
import type { TiCounts, TiDelivery, TiDependencies, TiProject, TiRisk } from '@/domain/ti-dependencies'

/**
 * Dependências de TI no painel Direção e gerência (regras §42). O servidor já calcula entregas, bloqueios e
 * riscos; aqui só o recorte pelo filtro do painel e a forma de mostrar o prazo.
 */

export interface TiScope {
  projects: TiProject[]
  totals: TiCounts & { projects: number }
}

const ZERO: TiCounts = { deliveries: 0, blocked: 0, pending: 0, noneDue: 0, afterProjectDue: 0, overdue: 0, dueSoon: 0 }

/** Só os projetos afetados que estão no recorte do painel (vazio = a faixa some). */
export function tiInScope(ti: TiDependencies | undefined, scope: readonly Pick<Project, 'id'>[], only?: string | null): TiScope {
  const ids = new Set(scope.map((p) => p.id))
  const projects = (ti?.projects ?? []).filter((row) => ids.has(row.project.id) && (!only || row.project.id === only))
  const totals = { ...ZERO, projects: projects.length }
  projects.forEach((row) => (Object.keys(ZERO) as Array<keyof TiCounts>).forEach((key) => (totals[key] += row.counts[key])))
  return { projects, totals }
}

/** Projetos com o ⚠ na linha do tempo. */
export const tiAffected = (ti: TiDependencies | undefined): Set<string> => new Set((ti?.projects ?? []).map((row) => row.project.id))

/** Quem responde pelas entregas mostradas (uma vez, no topo); sem entregas no recorte, todas as pessoas. */
export function tiPeopleOf(ti: TiDependencies | undefined, projects: readonly TiProject[]): UserSummary[] {
  const ids = new Set(projects.flatMap((row) => row.deliveries.map((d) => d.assigneeId)))
  const people = ti?.people ?? []
  const shown = people.filter((person) => ids.has(person.id))
  return shown.length > 0 ? shown : people
}

export type DueTone = 'crit' | 'warn' | 'ok'
export type DueKind = 'none' | 'afterClose' | 'overdue' | 'today' | 'tomorrow' | 'inDays'

export interface DueLabel {
  tone: DueTone
  kind: DueKind
  /** Dias até o prazo (só em inDays). */
  days: number
  /** O ano entra na data (prazo depois do encerramento: geralmente o ano seguinte). */
  withYear: boolean
}

const DUE_SOON_DAYS = 3
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/**
 * Coluna "Prazo": rótulo curto e o tom. Para entregas vale o risco do servidor; para as demais tarefas,
 * só os dias até o prazo (vencida, hoje, amanhã, até 3 dias = crítico).
 */
export function dueLabel(dueDate: string | null, today: string, risk?: TiRisk): DueLabel {
  if (!dueDate || risk === 'none_due') return { tone: 'warn', kind: 'none', days: 0, withYear: false }
  if (risk === 'after_project_due') return { tone: 'crit', kind: 'afterClose', days: 0, withYear: true }
  const days = daysBetween(today, dueDate)
  if (days < 0) return { tone: 'crit', kind: 'overdue', days, withYear: false }
  if (days === 0) return { tone: 'crit', kind: 'today', days, withYear: false }
  if (days === 1) return { tone: 'crit', kind: 'tomorrow', days, withYear: false }
  return { tone: days <= DUE_SOON_DAYS ? 'crit' : 'ok', kind: 'inDays', days, withYear: false }
}

/** Outros projetos das tarefas que a entrega bloqueia, pelo nome. */
export const blockedElsewhere = (delivery: TiDelivery): string[] => delivery.blocksProjects.map((p) => p.name)
