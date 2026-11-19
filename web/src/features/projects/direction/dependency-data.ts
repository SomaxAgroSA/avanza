import type { Project } from '@/domain/projects'
import type { DepAreaRef, DepCounts, Dependencies, DepProject } from '@/domain/dependencies'

/**
 * Dependências por área no painel Direção e gerência (regras §42). O servidor já calcula entregas, bloqueios
 * e riscos; aqui só o recorte (filtro do painel, projeto do ⚠ e área escolhida) e a forma de mostrar o prazo.
 */

export interface DepScope {
  projects: DepProject[]
  totals: DepCounts & { projects: number }
}

const ZERO: DepCounts = { deliveries: 0, blocked: 0, pending: 0, noneDue: 0, overdue: 0 }

/** Recorta um projeto numa área: entregas dela, bloqueios que esperam por ela e as a validar ligadas a ela. */
function inArea(row: DepProject, area: string): DepProject {
  const deliveries = row.deliveries.filter((d) => d.area.key === area)
  const blocked = row.blocked.map((b) => ({ ...b, waitingOn: b.waitingOn.filter((w) => w.area.key === area) })).filter((b) => b.waitingOn.length > 0)
  const pending = row.pending.filter((p) => p.relatedTo.area.key === area)
  return {
    ...row,
    deliveries,
    blocked,
    pending,
    counts: {
      deliveries: deliveries.length,
      blocked: blocked.length,
      pending: pending.length,
      noneDue: deliveries.filter((d) => d.risk === 'none_due').length,
      overdue: deliveries.filter((d) => d.risk === 'overdue').length,
    },
  }
}

const hasItems = (row: DepProject) => row.deliveries.length + row.blocked.length + row.pending.length > 0

/**
 * Só os projetos afetados que estão no recorte do painel (vazio = a faixa some); `only` = um projeto (⚠);
 * `area` = só o que é daquela área.
 */
export function depInScope(data: Dependencies | undefined, scope: readonly Pick<Project, 'id'>[], only?: string | null, area?: string | null): DepScope {
  const ids = new Set(scope.map((p) => p.id))
  const projects = (data?.projects ?? [])
    .filter((row) => ids.has(row.project.id) && (!only || row.project.id === only))
    .map((row) => (area ? inArea(row, area) : row))
    .filter(hasItems)
  const totals = { ...ZERO, projects: projects.length }
  projects.forEach((row) => (Object.keys(ZERO) as Array<keyof DepCounts>).forEach((key) => (totals[key] += row.counts[key])))
  return { projects, totals }
}

/** Projetos com o ⚠ na linha do tempo. */
export const depAffected = (data: Dependencies | undefined): Set<string> => new Set((data?.projects ?? []).map((row) => row.project.id))

/** Chips do painel: total de entregas e uma chip por área que tem entregas nos projetos dados (na ordem das áreas). */
export function areaChips(data: Dependencies | undefined, projects: readonly DepProject[]): { total: number; areas: Array<DepAreaRef & { count: number }> } {
  const count = new Map<string, number>()
  const names = new Map<string, string>()
  projects.forEach((row) =>
    row.deliveries.forEach((d) => {
      count.set(d.area.key, (count.get(d.area.key) ?? 0) + 1)
      names.set(d.area.key, d.area.name)
    }),
  )
  const order = (data?.areas ?? []).map((a) => a.key)
  const keys = [...count.keys()].sort((a, b) => (order.indexOf(a) < 0 ? 999 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 999 : order.indexOf(b)))
  return {
    total: [...count.values()].reduce((sum, n) => sum + n, 0),
    areas: keys.map((key) => ({ key, name: names.get(key) ?? key, count: count.get(key) ?? 0 })),
  }
}

export type DueTone = 'crit' | 'warn' | 'ok'
export type DueKind = 'none' | 'overdue' | 'today' | 'tomorrow' | 'inDays'

export interface DueLabel {
  tone: DueTone
  kind: DueKind
  /** Dias até o prazo (inDays, tomorrow) ou desde o vencimento (overdue). */
  days: number
  /** O ano entra na data (prazo fora do ano atual). */
  withYear: boolean
}

const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/**
 * Coluna "Prazo", só pelo prazo da própria tarefa: sem prazo = âmbar; vencida = vermelho ("vencida há N
 * dias"); o resto, verde (hoje, amanhã, em N dias). O encerramento do projeto não entra.
 */
export function dueLabel(dueDate: string | null, today: string): DueLabel {
  if (!dueDate) return { tone: 'warn', kind: 'none', days: 0, withYear: false }
  const withYear = dueDate.slice(0, 4) !== today.slice(0, 4)
  const days = daysBetween(today, dueDate)
  if (days < 0) return { tone: 'crit', kind: 'overdue', days: -days, withYear }
  if (days === 0) return { tone: 'ok', kind: 'today', days, withYear }
  if (days === 1) return { tone: 'ok', kind: 'tomorrow', days, withYear }
  return { tone: 'ok', kind: 'inDays', days, withYear }
}
