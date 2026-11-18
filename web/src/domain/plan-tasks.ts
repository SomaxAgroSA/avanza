/**
 * Tarefas vinculadas aos elementos da Gestão de projetos: a Gestão é o plano macro (fases e
 * entregas) e as tarefas são a execução do dia a dia. Uma tarefa aponta para no máximo um elemento
 * ou subelemento do mesmo projeto; o elemento ainda não concluído que tem tarefas vinculadas tem o
 * progresso calculado pelo servidor (concluídas ÷ total, sem as canceladas — `progress.source = 'tasks'`).
 */
import type { Plan, PlanItem, PlanTaskCount } from './plan'
import type { TaskSummary } from './tasks'
import { groupTitle } from './plan-view'

const NO_TASKS: PlanTaskCount = { total: 0, done: 0 }

/** Tarefas vinculadas ao elemento (sem o campo = nenhuma). */
export const linkedTasks = (item: Pick<PlanItem, 'tasks'>): PlanTaskCount => item.tasks ?? NO_TASKS

/** Parte concluída das tarefas vinculadas, de 0 a 100 (sem tarefas = 0) — a mesma conta do servidor. */
export function tasksPercent(count: PlanTaskCount): number {
  return count.total > 0 ? Math.round((count.done / count.total) * 100) : 0
}

/** O progresso vem das tarefas vinculadas (não se digita no quadro). */
export const isProgressFromTasks = (item: Pick<PlanItem, 'progress'>): boolean => item.progress.source === 'tasks'

/** Opção do campo "Etapa da gestão" da tarefa: uma etapa (grupo) do quadro. */
export interface PlanStageChoice {
  id: string
  /** Número e nome: "1.0 Base de clientes", "2.1 Plano do projeto". */
  label: string
  /** Subetapa (2.1…): aparece recuada, logo depois da etapa pai. */
  sub: boolean
}

/** Etapas do quadro na ordem dele: cada etapa seguida das suas subetapas. */
export function planStageChoices(plan: Pick<Plan, 'groups'>): PlanStageChoice[] {
  return plan.groups
    .filter((g) => !g.parentId)
    .flatMap((root) => [
      { id: root.id, label: groupTitle(root), sub: false },
      ...plan.groups.filter((g) => g.parentId === root.id).map((sub) => ({ id: sub.id, label: groupTitle(sub), sub: true })),
    ])
}

/**
 * Onde a tarefa ligada está na Gestão: a etapa do elemento ("1.0 Base de clientes") e o caminho até a
 * linha ("1.0 Base de clientes › Unir a base", com o elemento pai no meio quando é subelemento).
 * Elemento fora do quadro carregado (ex.: quadro truncado) = null.
 */
export function planItemStage(plan: Pick<Plan, 'groups' | 'items'>, itemId: string): { stage: string; path: string } | null {
  const item = plan.items.find((i) => i.id === itemId)
  const group = item ? plan.groups.find((g) => g.id === item.groupId) : undefined
  if (!item || !group) return null
  const parent = item.parentId ? plan.items.find((i) => i.id === item.parentId) : undefined
  const stage = groupTitle(group)
  return { stage, path: [stage, parent?.name, item.name].filter(Boolean).join(' › ') }
}

/** Resultados da busca para vincular ao elemento: as que já estão nele saem da lista. */
export function linkableTasks<T extends Pick<TaskSummary, 'planItem'>>(tasks: T[], itemId: string): T[] {
  return tasks.filter((task) => task.planItem?.id !== itemId)
}
