import type { UserSummary } from './projects'
import type { FieldValue } from './task-config'
import type { TaskSummary } from './tasks'
import type { Urgency } from './urgency'

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

/**
 * Caixas da tela Demandas: as três de quem participa e Todas (`all`: todas as demandas, só para quem tem
 * `projects.view_all`; o servidor recusa as demais pessoas).
 */
export const DEMAND_BOXES = ['received', 'assigned', 'requested', 'all'] as const
export type DemandBox = (typeof DEMAND_BOXES)[number]

/** Filtros da lista de uma caixa (a caixa Todas usa Responsável e Atribuída a). */
export interface DemandListFilters {
  statuses?: DemandStatus[]
  /** Só as demandas desse responsável. */
  ownerId?: string
  /** Só as demandas atribuídas a essa pessoa. */
  assigneeId?: string
  /** Só as demandas dessa empresa (§46). */
  companyId?: string
}

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
  /** `all` só vem preenchido para quem tem `projects.view_all` (para os demais, zeros). */
  counts: DemandCounts
  /**
   * Selo da aba Caixa de entrada e do menu Tarefas: o que espera por quem consulta (recebidas sem
   * atribuir + atribuídas a ela não concluídas + pedidas por ela para validar) — o servidor calcula.
   */
  pending: number
  /** Carga da equipe: atribuídas e em andamento de cada pessoa, com as horas estimadas. */
  team: TeamLoad[]
  /** Carga das equipes (caixa Todas): todas as pessoas com demandas abertas; vazia sem `projects.view_all`. */
  allTeam: TeamLoad[]
}

export interface DemandInput {
  taskTypeId: string
  title: string
  description?: string
  ownerId: string
  areaId: string
  priorityId?: string
  /** Urgência (§31, semáforo); sem ela, nasce sem urgência. */
  urgency?: Urgency
  /** Empresa ativa (§46): obrigatória quando existe alguma ativa. */
  companyId?: string
  /** Campos do tipo, por nome técnico (os mesmos da tarefa de projeto). */
  customValues?: Record<string, FieldValue>
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
  all: { unassigned: 0, assigned: 0, in_progress: 0, to_validate: 0, done: 0 },
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
 * atribui; quem executa começa, passa e conclui; quem pediu valida e devolve. `options.viewAll` (quem tem
 * `projects.view_all`, na caixa Todas): também atribui e reatribui qualquer demanda.
 */
export function demandActionsFor(userId: string | undefined, task: Pick<TaskSummary, 'assignee' | 'reporter' | 'demand'>, options: { viewAll?: boolean } = {}): DemandActions {
  const demand = task.demand
  const roles = {
    owner: !!userId && demand?.owner?.id === userId,
    assignee: !!userId && task.assignee?.id === userId,
    requester: !!userId && task.reporter?.id === userId,
  }
  const out = {} as DemandActions
  DEMAND_ACTIONS.forEach((action) => {
    const rule = ACTION_RULES[action]
    const allowed = roles[rule.role] || (action === 'assign' && !!options.viewAll)
    out[action] = !!demand && allowed && rule.from.includes(demand.status)
  })
  return out
}

/**
 * Nome de um projeto nos painéis (Relatórios, Em andamento): a caixa das demandas internas (`demands`) aparece
 * como "Demandas internas", no idioma de quem vê.
 */
export function projectDisplayName(t: (key: string) => string, project: { name: string; demands?: boolean }): string {
  return project.demands ? t('demands.internalProject') : project.name
}

/**
 * Atribuídas a mim (ajuste 23/11): o que está comigo (por passo), as concluídas recentes (o servidor já manda
 * só as dos últimos 30 dias) e as que passei a outra pessoa (continuam visíveis, sem ações).
 */
export function splitAssignedBox<T extends Pick<TaskSummary, 'demand' | 'assignee'>>(list: readonly T[], me: string | undefined): { active: T[]; done: T[]; passed: T[] } {
  const mine = (task: T) => !!me && task.assignee?.id === me
  return {
    active: list.filter((task) => mine(task) && task.demand?.status !== 'done'),
    done: list.filter((task) => mine(task) && task.demand?.status === 'done'),
    passed: list.filter((task) => !mine(task)),
  }
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
