/**
 * Painel executivo — visão consolidada da Gestão de projetos (quadros com a saúde) e do Kanban de
 * atividades (tarefas). Os números vêm prontos do servidor (backend/src/domain/executive.js); aqui ficam
 * os tipos, o período (atalhos → dias locais) e as regras de apresentação (o motivo da saúde).
 * Sem números por pessoa (decisão do usuário).
 */
import type { ProjectCover, ProjectIcon, ProjectPriority, ProjectStatus } from './projects'
import type { HealthFactor, HealthLevel, IssueState } from './plan-management'
import type { PlanStatusCategory } from './plan'
import type { OptionColor } from './task-config'
import type { StatusCategory } from './workflow'
import type { Duration } from './reports'

/* ------------------------------------------------------------------ filtros */

export const EXECUTIVE_PERIODS = ['all', 'year', '90d', 'month', 'custom'] as const
export type ExecutivePeriod = (typeof EXECUTIVE_PERIODS)[number]
export const DEFAULT_EXECUTIVE_PERIOD: ExecutivePeriod = 'all'

export function isExecutivePeriod(value: string): value is ExecutivePeriod {
  return (EXECUTIVE_PERIODS as readonly string[]).includes(value)
}

export interface ExecutiveQuery {
  /** Vazio = todos os projetos que a pessoa vê. */
  projectIds: string[]
  /** AAAA-MM-DD (dia local); null = desde o início. */
  from: string | null
  /** AAAA-MM-DD (dia local); null = até hoje. */
  to: string | null
  /** Minutos (Date#getTimezoneOffset): "hoje" e os dias no fuso de quem consulta. */
  tzOffset: number
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Date local → AAAA-MM-DD. */
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Dias do período (locais). "Desde o início" não manda datas (o servidor conta tudo até agora);
 * os atalhos terminam hoje; o personalizado exige as duas datas e o fim não antes do início (null = inválido).
 */
export function executivePeriodRange(period: ExecutivePeriod, now: Date, custom?: { from: string; to: string }): { from: string | null; to: string | null } | null {
  const today = localDay(now)
  switch (period) {
    case 'all':
      return { from: null, to: null }
    case 'year':
      return { from: `${now.getFullYear()}-01-01`, to: today }
    case 'month':
      return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, to: today }
    case '90d':
      return { from: localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89)), to: today }
    default: {
      const from = custom?.from ?? ''
      const to = custom?.to ?? ''
      if (!DAY_PATTERN.test(from) || !DAY_PATTERN.test(to) || to < from) return null
      return { from, to }
    }
  }
}

/* ------------------------------------------------------------------ resposta */

export interface ExecutiveProjectRef {
  id: string
  key: string
  name: string
}

export interface ExecutivePerson {
  id: string
  name: string
  avatarUrl: string | null
}

/** Projeto da lista do filtro (inclui os arquivados, marcados). */
export interface ExecutiveProjectOption extends ExecutiveProjectRef {
  cover: ProjectCover
  icon: ProjectIcon
  archived: boolean
}

export interface ExecutiveHealth {
  level: HealthLevel
  /** Vazio quando o projeto não tem quadro de gestão (`level: 'none'`). */
  factors: HealthFactor[]
}

export type ProgressSourceKind = 'plan' | 'tasks'

export interface PortfolioRow {
  project: ExecutiveProjectRef & {
    cover: ProjectCover
    icon: ProjectIcon
    status: ProjectStatus
    priority: ProjectPriority
    /** AAAA-MM-DD */
    startDate: string | null
    dueDate: string | null
    owner: ExecutivePerson | null
  }
  health: ExecutiveHealth
  /** null = sem elementos nem tarefas para medir. */
  progress: { value: number; source: ProgressSourceKind } | null
  plan: { total: number; done: number; open: number; overdue: number; stuck: number } | null
  tasks: { total: number; open: number; overdue: number; done: number }
  nextMilestone: { id: string; name: string; dueDate: string } | null
  openIssues: number
}

export interface ExecutiveIssue {
  id: string
  number: number
  description: string
  state: IssueState
  openedOn: string | null
  project: ExecutiveProjectRef
}

export interface ExecutiveMilestone {
  id: string
  name: string
  dueDate: string
  project: ExecutiveProjectRef
}

export interface ExecutivePlanSection {
  items: { total: number; done: number; open: number; overdue: number; stuck: number; canceled: number }
  /** `none` = elemento sem situação. */
  statusDistribution: Array<{ category: PlanStatusCategory | 'none'; count: number }>
  schedule: { onTime: number; overdue: number; unscheduled: number; done: number }
  effort: { estimated: number | null; actual: number | null; remaining: number | null }
  issues: ExecutiveIssue[]
  openIssuesTotal: number
  upcomingMilestones: ExecutiveMilestone[]
}

export const FUNNEL_CATEGORIES = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'] as const satisfies readonly StatusCategory[]

export interface ExecutiveOverdueTask {
  id: string
  code: string | null
  title: string
  project: ExecutiveProjectRef
  dueDate: string
  status: { id: string; name: string; color: OptionColor; category: StatusCategory | undefined }
}

export interface ExecutiveKanbanSection {
  funnel: Record<(typeof FUNNEL_CATEGORIES)[number], number>
  created: number
  completed: number
  leadTime: Duration
  cycleTime: Duration
  overdue: number
  blocked: number
  criticalBugs: number
  overdueTasks: ExecutiveOverdueTask[]
}

export interface ExecutiveTimelinePoint {
  /** AAAA-MM-DD (início da semana ou do mês). */
  start: string
  tasksCreated: number
  tasksCompleted: number
  planItemsCompleted: number
}

export interface ExecutiveCompletion {
  kind: 'task' | 'plan_item'
  id: string
  code: string | null
  title: string
  completedAt: Date | null
}

export interface ExecutiveAchievement {
  project: ExecutiveProjectRef & { archived: boolean }
  tasksDone: number
  planItemsDone: number
  milestonesDone: Array<{ id: string; name: string; dueDate: string | null }>
  recent: ExecutiveCompletion[]
}

export interface ExecutiveDashboard {
  generatedAt: Date
  period: { from: Date | null; to: Date }
  projects: ExecutiveProjectOption[]
  summary: {
    activeProjects: number
    health: Record<HealthLevel, number>
    progress: number | null
    deliveries: { tasks: number; planItems: number; milestones: number }
    overdue: { tasks: number; planItems: number }
    openIssues: number
    criticalBugs: number
  }
  portfolio: PortfolioRow[]
  /** null = nenhum quadro de gestão no escopo. */
  plan: ExecutivePlanSection | null
  kanban: ExecutiveKanbanSection
  timeline: { bucket: 'week' | 'month'; points: ExecutiveTimelinePoint[] }
  achievements: ExecutiveAchievement[]
}

/* ------------------------------------------------------------------ apresentação */

const LEVEL_RANK: Record<HealthLevel, number> = { critical: 0, attention: 1, ok: 2, none: 3 }

/**
 * O motivo principal da saúde: o pior fator (crítico antes de atenção; no empate, o primeiro na ordem
 * do servidor). Projeto saudável ou sem quadro não tem motivo.
 */
export function mainHealthFactor(health: ExecutiveHealth): HealthFactor | null {
  if (health.level !== 'critical' && health.level !== 'attention') return null
  return health.factors.reduce<HealthFactor | null>((worst, factor) => (LEVEL_RANK[factor.level] < LEVEL_RANK[worst?.level ?? 'ok'] ? factor : worst), null)
}

/** Tempo médio legível no painel: horas abaixo de 24 h; depois, dias (1 casa). */
export function executiveDuration(hours: number | null): { value: number; unit: 'hours' | 'days' } | null {
  if (hours === null) return null
  if (hours < 24) return { value: Math.round(hours * 10) / 10, unit: 'hours' }
  return { value: Math.round((hours / 24) * 10) / 10, unit: 'days' }
}

/** Total de entregas do período (tarefas + elementos + marcos). */
export function totalDeliveries(deliveries: ExecutiveDashboard['summary']['deliveries']): number {
  return deliveries.tasks + deliveries.planItems + deliveries.milestones
}

/* ------------------------------------------------------------------ leitura rápida (diretoria) */

/** Exceção do portfólio na lista "Precisa de atenção". */
export type AttentionItem =
  | { kind: 'project'; id: string; project: ExecutiveProjectRef; level: 'critical' | 'attention'; factor: HealthFactor | null }
  | { kind: 'issue'; id: string; project: ExecutiveProjectRef; number: number; description: string; openedOn: string | null }
  | { kind: 'task'; id: string; project: ExecutiveProjectRef; code: string | null; title: string; dueDate: string }
  | { kind: 'milestone'; id: string; project: ExecutiveProjectRef; name: string; dueDate: string }

const byDay = <T,>(day: (item: T) => string | null) => (a: T, b: T) => (day(a) ?? '9999').localeCompare(day(b) ?? '9999')

/**
 * "Precisa de atenção", em ordem de prioridade: os projetos críticos (na ordem do servidor) e depois,
 * um de cada tipo por vez — projeto em atenção, problema mais antigo, tarefa mais atrasada, marco mais
 * próximo —, para que nenhum tipo suma da parte visível da lista. Vazio = tudo em dia.
 */
export function attentionItems(data: Pick<ExecutiveDashboard, 'portfolio' | 'plan' | 'kanban'>): AttentionItem[] {
  const project = (row: PortfolioRow): AttentionItem => ({
    kind: 'project',
    id: row.project.id,
    project: { id: row.project.id, key: row.project.key, name: row.project.name },
    level: row.health.level === 'critical' ? 'critical' : 'attention',
    factor: mainHealthFactor(row.health),
  })
  const critical = data.portfolio.filter((row) => row.health.level === 'critical').map(project)
  const queues: AttentionItem[][] = [
    data.portfolio.filter((row) => row.health.level === 'attention').map(project),
    [...(data.plan?.issues ?? [])]
      .sort(byDay((issue) => issue.openedOn))
      .map((issue) => ({ kind: 'issue', id: issue.id, project: issue.project, number: issue.number, description: issue.description, openedOn: issue.openedOn })),
    [...data.kanban.overdueTasks]
      .sort(byDay((task) => task.dueDate))
      .map((task) => ({ kind: 'task', id: task.id, project: task.project, code: task.code, title: task.title, dueDate: task.dueDate })),
    [...(data.plan?.upcomingMilestones ?? [])]
      .sort(byDay((milestone) => milestone.dueDate))
      .map((milestone) => ({ kind: 'milestone', id: milestone.id, project: milestone.project, name: milestone.name, dueDate: milestone.dueDate })),
  ]
  const rest: AttentionItem[] = []
  for (let round = 0; queues.some((queue) => round < queue.length); round++) {
    queues.forEach((queue) => {
      const item = queue[round]
      if (item) rest.push(item)
    })
  }
  return [...critical, ...rest]
}

/** Etapas do fluxo do Kanban no painel (as canceladas ficam de fora). */
export const FLOW_CATEGORIES = ['backlog', 'todo', 'in_progress', 'done'] as const satisfies readonly StatusCategory[]

export function kanbanFlow(funnel: ExecutiveKanbanSection['funnel']): Array<{ category: (typeof FLOW_CATEGORIES)[number]; count: number }> {
  return FLOW_CATEGORIES.map((category) => ({ category, count: funnel[category] }))
}

/** Tempo médio de entrega para exibir; null sem amostra (o painel esconde em vez de mostrar "0 h"). */
export function averageDelivery(duration: Duration): ReturnType<typeof executiveDuration> {
  return duration.count > 0 ? executiveDuration(duration.hours) : null
}

/** Entregas (tarefas + elementos concluídos) de cada ponto da série. */
export function deliverySeries(points: ExecutiveTimelinePoint[]): number[] {
  return points.map((p) => p.tasksCompleted + p.planItemsCompleted)
}

export function hasDeliveries(points: ExecutiveTimelinePoint[]): boolean {
  return deliverySeries(points).some((value) => value > 0)
}

/** Portfólio filtrado pelo nível de saúde escolhido no painel (null = todos), na ordem do servidor. */
export function portfolioByHealth(rows: PortfolioRow[], level: HealthLevel | null): PortfolioRow[] {
  return level ? rows.filter((row) => row.health.level === level) : rows
}
