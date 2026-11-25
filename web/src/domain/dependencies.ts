import type { UserSummary } from './projects'

/**
 * Dependências por área (regras §42): o que outras áreas (TI, Finanças…) devem aos projetos e o que espera
 * por elas. Tudo calculado no servidor (`GET /dependencies`); a tela só recorta pelo filtro do painel e formata.
 */

/** Risco pelo prazo da própria tarefa: sem prazo, vencida, em dia. */
export type DepRisk = 'none_due' | 'overdue' | 'ok'

/** Área de quem responde por uma entrega (a TI tem a chave `ti`). */
export interface DepAreaRef {
  key: string
  name: string
}

export interface DepProjectRef {
  id: string
  key: string
  name: string
  /** A caixa das demandas internas (§45): mostra "Demandas internas", sem link de projeto. */
  demands?: boolean
}

export interface DepTaskRef {
  id: string
  code: string
  title: string
  project: DepProjectRef
  /** Prazo como dia AAAA-MM-DD (null = sem prazo). */
  dueDate: string | null
}

/** Uma entrega (ou a entrega por trás de um bloqueio): a tarefa e a área dela. */
export interface DepDeliveryRef extends DepTaskRef {
  area: DepAreaRef
}

/** Tarefa aberta atribuída a alguém de uma área. */
export interface DepDelivery extends DepDeliveryRef {
  assigneeId: string
  waitingDays: number | null
  /** Dias até o prazo (negativo = vencida; null = sem prazo). */
  daysLeft: number | null
  risk: DepRisk
  /** Quantas tarefas abertas esperam por ela. */
  blocks: number
  /** Outros projetos dessas tarefas. */
  blocksProjects: DepProjectRef[]
}

/** Tarefa aberta que "depende de" (ou é "bloqueada por") uma entrega aberta. */
export interface DepBlocked extends DepTaskRef {
  waitingOn: Array<DepDeliveryRef & { relationId: string }>
}

/** Tarefa aberta só "relacionada" a uma entrega: a validar, nunca conta como bloqueio. */
export interface DepPending extends DepTaskRef {
  relatedTo: DepDeliveryRef
  relationId: string
}

export interface DepCounts {
  deliveries: number
  blocked: number
  pending: number
  noneDue: number
  overdue: number
}

export interface DepProject {
  project: DepProjectRef & { dueDate: string | null }
  counts: DepCounts
  deliveries: DepDelivery[]
  blocked: DepBlocked[]
  pending: DepPending[]
}

export interface Dependencies {
  /** Hoje (AAAA-MM-DD) no fuso de quem consultou. */
  today: string
  /** Quem responde pelas entregas. */
  people: UserSummary[]
  /** Áreas configuradas, na ordem, com quantas entregas têm. */
  areas: Array<DepAreaRef & { deliveries: number }>
  projects: DepProject[]
}

/** Uma área de Configurações → Dependências por área (`key` vazio = nova, o servidor gera). */
export interface DependencyArea {
  key: string
  name: string
  userIds: string[]
  users: UserSummary[]
}

/** Configurações → Dependências por área (settings.manage). */
export interface DependencyAreasConfig {
  areas: DependencyArea[]
  /** Usuários ativos que podem ser escolhidos. */
  candidates: UserSummary[]
}

/** Chave fixa da área TI (o Responsável TI de cada projeto conta nela). */
export const TI_AREA_KEY = 'ti'
