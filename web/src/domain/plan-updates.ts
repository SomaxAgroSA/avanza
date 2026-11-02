/**
 * Painel do elemento do quadro (Gerenciamento de Projetos, GP-3): atualizações (conversa com respostas
 * de um nível e @menções) com imagens/arquivos colados ou anexados nelas, e o histórico. As regras (quem publica, edita, exclui) vêm do
 * servidor em `capabilities`.
 */
import type { FileItem } from './attachments'
import type { UserSummary } from './projects'

export interface PlanUpdate {
  id: string
  itemId: string
  /** Resposta: id da atualização principal. */
  parentId: string | null
  author: UserSummary | null
  /** Markdown com menções `@[Nome](id)`; vazio quando excluída. */
  content: string
  mentions: UserSummary[]
  deleted: boolean
  createdAt: Date | null
  editedAt: Date | null
  capabilities: { edit: boolean; delete: boolean; reply: boolean }
  /** Imagens e arquivos colados/anexados (vazio quando excluída). */
  files: PlanFile[]
  /** Só nas principais (da mais antiga para a mais nova). */
  replies: PlanUpdate[]
}

export interface PlanUpdates {
  /** Principais da mais nova para a mais antiga. */
  updates: PlanUpdate[]
  capabilities: { post: boolean }
}

export interface PlanFile extends FileItem {
  itemId: string
  updateId: string | null
}

/** Nova atualização: o texto pode ficar vazio quando leva imagem/arquivo. */
export interface PlanUpdateInput {
  content: string
  parentId?: string
  files?: File[]
}

/** Abas do painel do elemento; `tasks` = tarefas vinculadas (execução do elemento). */
export const PANEL_TABS = ['updates', 'tasks', 'history', 'details'] as const
export type PanelTab = (typeof PANEL_TABS)[number]

/** Limites do envio junto com a atualização (iguais aos do servidor; cada arquivo também passa por fileIssue). */
export const MAX_UPDATE_FILES = 10
export const MAX_UPDATE_BYTES = 50 * 1024 * 1024

/** Código de validation.* ou null. */
export function updateUploadIssue(files: Array<{ size: number }>): 'too_many' | 'upload_too_large' | null {
  if (files.length > MAX_UPDATE_FILES) return 'too_many'
  return files.reduce((sum, f) => sum + f.size, 0) > MAX_UPDATE_BYTES ? 'upload_too_large' : null
}
