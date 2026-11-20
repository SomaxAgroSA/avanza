import type { UserSummary } from './projects'
import type { TaskSummary } from './tasks'

/**
 * Demandas internas (regras de negócio §45): tarefas sem projeto, pedidas a uma pessoa (o responsável),
 * que as distribui à equipe dela. O servidor decide tudo (domain/demand.js do backend); aqui ficam só os
 * tipos e o que a tela precisa para mostrar e habilitar os botões.
 */

/** Passos do fluxo: Sem atribuir → Atribuída → Em andamento → Para validar → Concluída. */
export const DEMAND_STATUSES = ['unassigned', 'assigned', 'in_progress', 'to_validate', 'done'] as const
export type DemandStatus = (typeof DEMAND_STATUSES)[number]

/** Os quatro primeiros passos ganham um cartão de número na caixa Recebidas por mim. */
export const DEMAND_KPI_STATUSES: readonly DemandStatus[] = ['unassigned', 'assigned', 'in_progress', 'to_validate']

/** Caixas da tela Demandas. */
export const DEMAND_BOXES = ['received', 'assigned', 'requested'] as const
export type DemandBox = (typeof DEMAND_BOXES)[number]

export const DEMAND_ACTIONS = ['assign', 'start', 'pass', 'conclude', 'validate', 'return'] as const
export type DemandAction = (typeof DEMAND_ACTIONS)[number]
export type DemandActions = Record<DemandAction, boolean>

export interface DemandInfo {
  status: DemandStatus
  /** Responsável: quem recebeu o pedido (fixo). */
  owner: UserSummary | null
  /** Prazo com data e hora (o responsável define ao atribuir). */
  dueAt: Date | null
  /** Abertura (automática). */
  openedAt: Date | null
  /** O que quem consulta pode fazer (vem no detalhe; nas listas é calculado por `demandActionsFor`). */
  actions?: DemandActions
}

export type DemandCounts = Record<DemandBox, Record<DemandStatus, number>>

export interface TeamLoad {
  user: UserSummary
  openCount: number
  estimatedHours: number
}

export interface DemandOverview {
  counts: DemandCounts
  /** Carga da equipe: atribuídas e em andamento de cada pessoa, com as horas estimadas. */
  team: TeamLoad[]
}

export interface DemandInput {
  taskTypeId: string
  title: string
  description?: string
  ownerId: string
  areaId: string
  priorityId?: string
}

export interface AssignInput {
  assigneeId: string
  /** Data e hora (ISO, já em UTC). */
  dueAt: string
  /** null limpa; ausente mantém. */
  estimatedHours?: number | null
}

export const EMPTY_DEMAND_COUNTS: DemandCounts = {
  received: { unassigned: 0, assigned: 0, in_progress: 0, to_validate: 0, done: 0 },
  assigned: { unassigned: 0, assigned: 0, in_progress: 0, to_validate: 0, done: 0 },
  requested: { unassigned: 0, assigned: 0, in_progress: 0, to_validate: 0, done: 0 },
}

export function isDemandStatus(value: unknown): value is DemandStatus {
  return typeof value === 'string' && (DEMAND_STATUSES as readonly string[]).includes(value)
}

const ACTION_RULES: Record<DemandAction, { role: 'owner' | 'assignee' | 'requester'; from: readonly DemandStatus[] }> = {
  assign: { role: 'owner', from: ['unassigned', 'assigned', 'in_progress'] },
  start: { role: 'assignee', from: ['assigned'] },
  pass: { role: 'assignee', from: ['assigned', 'in_progress'] },
  conclude: { role: 'assignee', from: ['assigned', 'in_progress'] },
  validate: { role: 'requester', from: ['to_validate'] },
  return: { role: 'requester', from: ['to_validate'] },
}

/**
 * Botões de cada linha das caixas (espelha a regra do servidor, que sempre confere): o responsável
 * atribui; quem executa começa, passa e conclui; quem pediu valida e devolve.
 */
export function demandActionsFor(userId: string | undefined, task: Pick<TaskSummary, 'assignee' | 'reporter' | 'demand'>): DemandActions {
  const demand = task.demand
  const roles = {
    owner: !!userId && demand?.owner?.id === userId,
    assignee: !!userId && task.assignee?.id === userId,
    requester: !!userId && task.reporter?.id === userId,
  }
  const out = {} as DemandActions
  DEMAND_ACTIONS.forEach((action) => {
    const rule = ACTION_RULES[action]
    out[action] = !!demand && roles[rule.role] && rule.from.includes(demand.status)
  })
  return out
}

/** Demandas agrupadas por passo, na ordem do fluxo (grupos vazios ficam de fora). */
export function groupByStatus<T extends Pick<TaskSummary, 'demand'>>(list: readonly T[]): Array<{ status: DemandStatus; items: T[] }> {
  return DEMAND_STATUSES.map((status) => ({ status, items: list.filter((task) => task.demand?.status === status) })).filter((group) => group.items.length > 0)
}

/** Largura da barra de carga (0–100), proporcional à maior carga em horas da equipe. */
export function loadPercent(hours: number, team: readonly TeamLoad[]): number {
  const max = Math.max(0, ...team.map((member) => member.estimatedHours))
  if (max <= 0 || hours <= 0) return 0
  return Math.round((hours / max) * 1000) / 10
}

/** Data (AAAA-MM-DD) e hora (HH:mm) locais → ISO em UTC; inválido → null. */
export function deadlineToIso(day: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const [hour, minute] = time.split(':').map(Number) as [number, number]
  const local = new Date(year, month - 1, date, hour, minute, 0, 0)
  return Number.isNaN(local.getTime()) ? null : local.toISOString()
}

/** Prazo salvo → data e hora locais para o formulário. */
export function isoToDeadline(date: Date | null | undefined): { day: string; time: string } {
  if (!date) return { day: '', time: '' }
  const pad = (n: number) => String(n).padStart(2, '0')
  return { day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` }
}
