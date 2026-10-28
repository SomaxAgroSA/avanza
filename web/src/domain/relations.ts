/**
 * Relacionamentos entre tarefas (espelha backend/src/domain/relation.js).
 * Cada relação chega no ponto de vista da tarefa aberta: "bloqueia" de um lado é
 * "bloqueado por" do outro. Pai/filho são subtarefas; "fork de" é a origem do fork.
 */
import type { TaskSummary } from './tasks'
import type { UserSummary } from './projects'

export const RELATION_TYPES = ['blocks', 'blocked_by', 'depends_on', 'dependency_of', 'relates', 'duplicates', 'duplicated_by'] as const
export type RelationType = (typeof RELATION_TYPES)[number]

/** Opções do diálogo "Adicionar relação": relações gravadas + definir pai / adicionar subtarefa. */
export const LINK_OPTIONS = [...RELATION_TYPES, 'parent', 'child'] as const
export type LinkOption = (typeof LINK_OPTIONS)[number]

export interface TaskRelation {
  id: string
  type: RelationType
  task: TaskSummary
  createdBy: UserSummary | null
  createdAt: Date | null
  capabilities: { delete: boolean }
}

export interface TaskRelations {
  parent: TaskSummary | null
  children: TaskSummary[]
  subtaskProgress: { done: number; total: number }
  forkedFrom: TaskSummary | null
  forks: TaskSummary[]
  relations: TaskRelation[]
  capabilities: { link: boolean; fork: boolean; createSubtask: boolean; edit: boolean }
}

/** Grupos na ordem de exibição (só os que têm itens). */
export function groupRelations(relations: readonly TaskRelation[]): Array<{ type: RelationType; items: TaskRelation[] }> {
  return RELATION_TYPES.map((type) => ({ type, items: relations.filter((r) => r.type === type) })).filter((g) => g.items.length > 0)
}

/** Quantos vínculos a tarefa tem (para o rótulo da aba). */
export function relationCount(data: Pick<TaskRelations, 'parent' | 'children' | 'forkedFrom' | 'forks' | 'relations'>): number {
  return data.relations.length + data.children.length + data.forks.length + (data.parent ? 1 : 0) + (data.forkedFrom ? 1 : 0)
}

export const FORK_COPY_KEYS = ['description', 'tags', 'customValues', 'checklist', 'attachments', 'relations'] as const
export type ForkCopyKey = (typeof FORK_COPY_KEYS)[number]
export type ForkCopy = Record<ForkCopyKey, boolean>

/** Padrões do fork (os mesmos do servidor): o conteúdo vem junto; anexos e relações, só se pedido. */
export const FORK_COPY_DEFAULTS: ForkCopy = { description: true, tags: true, customValues: true, checklist: true, attachments: false, relations: false }

export interface ForkInput {
  title: string
  projectId?: string
  copy: ForkCopy
}
