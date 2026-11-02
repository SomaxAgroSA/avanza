import { cn } from '@/core/utils/cn'

/**
 * Gatilho de um filtro da barra: parado neutro (só o nome); ativo em verde suave ("Nome: valor"). Mesma
 * altura dos outros controles da barra — vale para os filtros das listagens e os do Kanban.
 */
export function filterTriggerClass(active: boolean): string {
  return cn('w-auto max-w-60 font-medium', active ? 'border-primary-border bg-primary-soft text-primary-soft-fg hover:border-primary' : 'text-muted')
}
