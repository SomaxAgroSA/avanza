import type { UserSummary } from './projects'

/**
 * Dependências de TI (regras §42): o que a TI deve aos projetos e o que espera por ela. Tudo calculado no
 * servidor (`GET /ti-dependencies`); a tela só recorta pelo filtro do painel e formata.
 */

/** Risco do prazo de uma entrega: sem prazo, depois da entrega do projeto, vencida, vence em até 3 dias, em dia. */
export type TiRisk = 'none_due' | 'after_project_due' | 'overdue' | 'due_soon' | 'ok'

export interface TiProjectRef {
  id: string
  key: string
  name: string
}

export interface TiTaskRef {
  id: string
  code: string
  title: string
  project: TiProjectRef
  /** Prazo como dia AAAA-MM-DD (null = sem prazo). */
  dueDate: string | null
}

/** Tarefa aberta atribuída a uma pessoa de TI. */
export interface TiDelivery extends TiTaskRef {
  assigneeId: string
  waitingDays: number | null
  /** Dias até o prazo (negativo = vencida; null = sem prazo). */
  daysLeft: number | null
  risk: TiRisk
  /** Quantas tarefas abertas esperam por ela. */
  blocks: number
  /** Outros projetos dessas tarefas. */
  blocksProjects: TiProjectRef[]
}

/** Tarefa aberta que "depende de" (ou é "bloqueada por") uma entrega de TI aberta. */
export interface TiBlocked extends TiTaskRef {
  waitingOn: Array<TiTaskRef & { relationId: string }>
}

/** Tarefa aberta só "relacionada" a uma entrega: a validar, nunca conta como bloqueio. */
export interface TiPending extends TiTaskRef {
  relatedTo: TiTaskRef
  relationId: string
  /** A pessoa pode relacionar tarefas no projeto (botão "Confirmar bloqueio"). */
  canConfirm: boolean
}

export interface TiCounts {
  deliveries: number
  blocked: number
  pending: number
  noneDue: number
  afterProjectDue: number
  overdue: number
  dueSoon: number
}

export interface TiProject {
  project: TiProjectRef & { dueDate: string | null }
  counts: TiCounts
  deliveries: TiDelivery[]
  blocked: TiBlocked[]
  pending: TiPending[]
}

export interface TiDependencies {
  /** Hoje (AAAA-MM-DD) no fuso de quem consultou. */
  today: string
  /** Quem responde pelas entregas. */
  people: UserSummary[]
  projects: TiProject[]
}

/** Pessoas de TI da plataforma (Configurações, settings.manage). */
export interface ItPeople {
  userIds: string[]
  users: UserSummary[]
  /** Usuários ativos que podem ser escolhidos. */
  candidates: UserSummary[]
}
