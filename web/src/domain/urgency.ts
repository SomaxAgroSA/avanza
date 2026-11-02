/**
 * Urgência (semáforo) de tarefas e projetos: alta = vermelho, média = amarelo, baixa = verde; null = sem
 * urgência. Independe da prioridade (o que pesa mais) — diz o que precisa de atenção agora.
 */
export const URGENCIES = ['high', 'medium', 'low'] as const
export type Urgency = (typeof URGENCIES)[number]

/** Valor do filtro para "sem urgência" (no filtro das listagens e na API: `urgency=none`). */
export const NO_URGENCY = 'none'

/** Opções do filtro de urgência, na ordem da tela: Alta, Média, Baixa, Sem urgência. */
export const URGENCY_FILTER_VALUES = [...URGENCIES, NO_URGENCY] as const
export type UrgencyFilterValue = (typeof URGENCY_FILTER_VALUES)[number]

export const isUrgency = (value: unknown): value is Urgency => typeof value === 'string' && (URGENCIES as readonly string[]).includes(value)

/** A urgência passa no filtro? ('' = qualquer; 'none' = só sem urgência.) */
export function matchesUrgency(urgency: Urgency | null | undefined, filter: string): boolean {
  if (!filter) return true
  if (filter === NO_URGENCY) return !urgency
  return urgency === filter
}
