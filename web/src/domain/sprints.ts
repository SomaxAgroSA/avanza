/**
 * Sprints do projeto (planejamento do backlog). Espelha backend/src/domain/sprint.js:
 * só planejamento — sem velocidade, burndown ou compromisso de sprint.
 */

export const SPRINT_STATES = ['planned', 'active', 'closed'] as const
export type SprintState = (typeof SPRINT_STATES)[number]

export const SPRINT_NAME_MAX = 80
export const SPRINT_GOAL_MAX = 1000

export interface SprintRef {
  id: string
  name: string
  state: SprintState
}

export interface Sprint extends SprintRef {
  projectId: string
  goal: string
  /** AAAA-MM-DD */
  startDate: string | null
  endDate: string | null
  /** Ordem manual (encerradas aparecem por último). */
  order: number
  createdAt: Date | null
  updatedAt: Date | null
}

export interface SprintInput {
  name?: string
  goal?: string | null
  startDate?: string | null
  endDate?: string | null
  state?: SprintState
}

/** Mesmas regras do servidor (nome obrigatório, fim não antes do início). */
export function sprintIssues(input: { name: string; goal: string; startDate: string; endDate: string }): Record<string, string> {
  const issues: Record<string, string> = {}
  const name = input.name.trim()
  if (!name) issues.name = 'required'
  else if (name.length > SPRINT_NAME_MAX) issues.name = 'too_long'
  if (input.goal.length > SPRINT_GOAL_MAX) issues.goal = 'too_long'
  if (input.startDate && input.endDate && input.endDate < input.startDate) issues.end_date = 'end_before_start'
  return issues
}

export const isOpenSprint = (sprint: Pick<SprintRef, 'state'>) => sprint.state !== 'closed'
