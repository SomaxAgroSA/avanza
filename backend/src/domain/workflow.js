/**
 * Status e prioridades de tarefas (listas configuráveis pelo administrador).
 *
 * As duas listas compartilham as mesmas regras: chave imutável, ordem, cor, ativo e
 * exatamente um item padrão (usado ao criar tarefas), sempre ativo.
 * O status tem ainda uma categoria, que dá significado ao fluxo independentemente do nome
 * escolhido (ex.: "Produção" e "Concluído" podem ser da categoria `done`).
 */

const STATUS_CATEGORIES = Object.freeze(['backlog', 'todo', 'in_progress', 'done', 'cancelled'])

/** Categorias em que a tarefa é considerada encerrada (preenche `completed_at`). */
const CLOSED_CATEGORIES = Object.freeze(['done', 'cancelled'])

const LOOKUP_KINDS = Object.freeze({
  status: {
    entityType: 'status',
    repository: 'statusRepository',
    hasCategory: true,
    errors: { notFound: 'STATUS_NOT_FOUND', keyInUse: 'STATUS_KEY_IN_USE', inUse: 'STATUS_IN_USE', isDefault: 'STATUS_IS_DEFAULT' },
  },
  priority: {
    entityType: 'priority',
    repository: 'priorityRepository',
    hasCategory: false,
    errors: { notFound: 'PRIORITY_NOT_FOUND', keyInUse: 'PRIORITY_KEY_IN_USE', inUse: 'PRIORITY_IN_USE', isDefault: 'PRIORITY_IS_DEFAULT' },
  },
})

function isClosedCategory(category) {
  return CLOSED_CATEGORIES.indexOf(category) >= 0
}

/**
 * Verifica a mudança de ativo/padrão de um item. Retorna { field, code } ou null.
 * `current` é o estado atual; `next` o estado desejado (ativo e padrão).
 */
function defaultIssue(current, next) {
  if (current.isDefault && next.isDefault === false) return { field: 'is_default', code: 'default_required' }
  if (next.isDefault && next.isActive === false) {
    return { field: current.isDefault ? 'is_active' : 'is_default', code: 'default_must_be_active' }
  }
  return null
}

/**
 * Transição entre status (Kanban, diretriz §32): sem lista de destinos = qualquer destino;
 * com lista, só os destinos dela. Permanecer no mesmo status sempre é permitido.
 */
function transitionAllowed(from, to) {
  if (!from || !to || from.id === to.id) return true
  const next = from.allowedNext || []
  return next.length === 0 || next.indexOf(to.id) >= 0
}

/** Espaço entre posições ao inserir cards (ordem manual dentro da coluna). */
const POSITION_STEP = 1024

/**
 * Posição entre os vizinhos (acima = prev, abaixo = next). Retorna null quando não cabe mais
 * nenhum número entre os dois (hora de renumerar a coluna).
 */
function positionBetween(prev, next, last) {
  if (prev !== null && next !== null) {
    const middle = (prev + next) / 2
    return next - prev > 1e-6 && middle > prev && middle < next ? middle : null
  }
  if (prev !== null) return prev + POSITION_STEP
  if (next !== null) return next - POSITION_STEP
  return (last === null ? 0 : last) + POSITION_STEP
}

module.exports = {
  STATUS_CATEGORIES,
  CLOSED_CATEGORIES,
  LOOKUP_KINDS,
  POSITION_STEP,
  isClosedCategory,
  defaultIssue,
  transitionAllowed,
  positionBetween,
}
