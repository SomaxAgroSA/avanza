import { cn } from '@/core/utils/cn'

/**
 * Gatilho de um filtro da barra: parado neutro (só o nome, com a cor normal do texto); ativo em verde suave ("Nome: valor"). Mesma
 * altura dos outros controles da barra — vale para os filtros das listagens e os do Kanban. Numa barra apertada ele encolhe
 * (o texto ganha reticências), mas nunca abaixo de ~132px: o nome nunca fica reduzido a duas letras.
 */
export function filterTriggerClass(active: boolean): string {
  return cn('w-full min-w-[8.25rem] max-w-60 font-medium', active ? 'border-primary-border bg-primary-soft text-primary-soft-fg hover:border-primary' : 'text-fg')
}
