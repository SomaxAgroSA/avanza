/**
 * Tarefas vinculadas aos elementos da Gestão de projetos: a Gestão é o plano macro (fases e
 * entregas) e as tarefas são a execução do dia a dia. Uma tarefa aponta para no máximo um elemento
 * ou subelemento do mesmo projeto; o elemento ainda não concluído que tem tarefas vinculadas tem o
 * progresso calculado pelo servidor (concluídas ÷ total, sem as canceladas — `progress.source = 'tasks'`).
 */
import type { Plan, PlanItem, PlanTaskCount } from './plan'
import type { TaskSummary } from './tasks'
import { boardSections, groupTitle } from './plan-view'

const NO_TASKS: PlanTaskCount = { total: 0, done: 0 }

/** Tarefas vinculadas ao elemento (sem o campo = nenhuma). */
export const linkedTasks = (item: Pick<PlanItem, 'tasks'>): PlanTaskCount => item.tasks ?? NO_TASKS

/** Parte concluída das tarefas vinculadas, de 0 a 100 (sem tarefas = 0) — a mesma conta do servidor. */
export function tasksPercent(count: PlanTaskCount): number {
  return count.total > 0 ? Math.round((count.done / count.total) * 100) : 0
}

/** O progresso vem das tarefas vinculadas (não se digita no quadro). */
export const isProgressFromTasks = (item: Pick<PlanItem, 'progress'>): boolean => item.progress.source === 'tasks'

/** Opção do campo "Elemento da Gestão" da tarefa. */
export interface PlanItemChoice {
  id: string
  name: string
  /** Título do grupo ("1.0 Iniciação"), cabeçalho da seção na lista. */
  group: string
  /** Subelemento: id do elemento pai. */
  parentId: string | null
}

/** Elementos e subelementos do quadro na ordem dele: grupo a grupo, cada subelemento logo depois do pai. */
export function planItemChoices(plan: Plan): PlanItemChoice[] {
  return boardSections(plan).flatMap((section) => {
    const group = groupTitle(section.group)
    return section.items.flatMap((item) => [
      { id: item.id, name: item.name, group, parentId: null },
      ...(section.subitems.get(item.id) ?? []).map((sub) => ({ id: sub.id, name: sub.name, group, parentId: item.id })),
    ])
  })
}

/** Resultados da busca para vincular ao elemento: as que já estão nele saem da lista. */
export function linkableTasks<T extends Pick<TaskSummary, 'planItem'>>(tasks: T[], itemId: string): T[] {
  return tasks.filter((task) => task.planItem?.id !== itemId)
}
