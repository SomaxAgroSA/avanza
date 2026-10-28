/**
 * Sprints do projeto (diretriz §15 "sprint/sprint futuro"): agrupam itens do backlog planejados
 * para um período. Não é um módulo de sprints (sem velocidade, burndown ou compromisso):
 * só planejamento. Estados: planejado → ativo → encerrado.
 *
 * - Planejar (criar, editar, encerrar, excluir) = quem administra o projeto (ver domain/project.js).
 * - Sprint encerrada não recebe tarefas; ao encerrar, o que não terminou volta ao backlog sem sprint.
 */

const SPRINT_STATES = Object.freeze(['planned', 'active', 'closed'])

/**
 * Categorias de status planejáveis (tela Planejamento): tudo que ainda não foi encerrado —
 * ideias (backlog), já analisadas/priorizadas (a fazer) e em andamento. Encerradas (concluída,
 * inclusive status como “Produção” quando marcados como concluídos, e cancelada) ficam fora.
 */
const PLANNING_CATEGORIES = Object.freeze(['backlog', 'todo', 'in_progress'])
const NAME_MAX = 80
const GOAL_MAX = 1000

/** Datas no formato AAAA-MM-DD; o fim não pode ser antes do início. */
function datesIssue(start, end) {
  if (start && end && end < start) return 'end_before_start'
  return null
}

function isOpen(sprint) {
  return !!sprint && sprint.state !== 'closed'
}

module.exports = { SPRINT_STATES, PLANNING_CATEGORIES, NAME_MAX, GOAL_MAX, datesIssue, isOpen }
