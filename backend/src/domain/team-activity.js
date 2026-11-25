/**
 * Equipo ahora (regras de negócio §41): o que cada pessoa fez nas tarefas, a partir do histórico da tarefa
 * (`audit_logs` com `entity_type = 'task'`; quem fez = `user_id`). Domínio puro e síncrono.
 *
 * Tipos de ação (a última de cada tarefa aparece no cartão da pessoa):
 * - `status_changed` — mudou o status da tarefa (`from` → `to`, nomes do status);
 * - `step` — um passo do fluxo do responsável (§45): `assigned`, `reassigned`, `started`, `passed`,
 *   `concluded`, `validated` ou `returned`;
 * - `commented` — comentou (`excerpt`: o começo do texto, sem formatação) ou editou o comentário;
 * - `attached` — anexou (`count` arquivos);
 * - `created` — criou a tarefa;
 * - `edited` — qualquer outra mudança (campos, relações, documentos, exclusão de anexo ou comentário…).
 */

const EXCERPT = 80
const STEPS = Object.freeze(['assigned', 'reassigned', 'started', 'passed', 'concluded', 'validated', 'returned'])

function excerptOf(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > EXCERPT ? `${value.slice(0, EXCERPT - 1).trimEnd()}…` : value
}

/**
 * Ação de uma linha do histórico: { action, statusChanged, fromStatus, toStatus, comment, attachments }
 * (`attachments` = os nomes separados por ", ", como o histórico grava).
 */
function actionOf(entry) {
  const action = entry.action || ''
  if (action === 'task.created') return { type: 'created' }
  if (action.indexOf('task.demand_') === 0) {
    const step = action.slice('task.demand_'.length)
    return STEPS.indexOf(step) >= 0 ? { type: 'step', step } : { type: 'edited' }
  }
  if (action === 'task.updated' && entry.statusChanged) return { type: 'status_changed', from: entry.fromStatus || null, to: entry.toStatus || null }
  if (action === 'comment.added' || action === 'comment.edited') return { type: 'commented', excerpt: excerptOf(entry.comment) }
  if (action === 'attachment.added') {
    const names = String(entry.attachments || '')
      .split(', ')
      .filter((name) => name.trim() !== '')
    return { type: 'attached', count: Math.max(1, names.length) }
  }
  return { type: 'edited' }
}

/**
 * Estado da pessoa num projeto, medido pelas ações dela na janela:
 * working = tem tarefa atribuída em andamento e agiu; active = agiu; idle = só tarefas abertas atribuídas.
 */
function stateOf({ inProgress, acted }) {
  if (acted > 0) return inProgress > 0 ? 'working' : 'active'
  return 'idle'
}

module.exports = { EXCERPT, STEPS, actionOf, stateOf, excerptOf }
