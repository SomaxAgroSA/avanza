/**
 * Demandas internas (regras de negócio §45, ADR-057): tarefas sem projeto, pedidas a uma pessoa — o
 * **responsável** —, que as distribui à equipe dela.
 *
 * - Moram no projeto de sistema `kind = 'demands'` (oculto; numeração DEM-n). Projeto de sistema não aparece
 *   em lista nenhuma e ninguém o abre como projeto (domain/project.js#resolveAccess).
 * - Pessoas: quem pediu (`reporterId`), o responsável (`demandOwnerId`, fixo) e quem executa (`assigneeId`,
 *   muda). Quem já esteve atribuído fica em `demandPastAssignees` e continua vendo.
 * - Equipe do responsável = as outras pessoas da área dele em "Dependências por área" (uma pessoa fica numa
 *   área só). Responsável fora de qualquer área: qualquer pessoa ativa pode receber a demanda.
 * - Fluxo (`demandStatus`): unassigned (Sem atribuir) → assigned (Atribuída) → in_progress (Em andamento)
 *   → to_validate (Para validar) → done (Concluída); quem pediu pode devolver (to_validate → in_progress).
 *   Só o responsável atribui; só quem executa começa, passa e conclui; só quem pediu valida e devolve.
 * - O status do fluxo de trabalho da tarefa (`statusId`) acompanha o passo (`workflowStatusFor`): assim a
 *   demanda concluída sai das "abertas", ganha as datas de início e conclusão e os lembretes de prazo valem.
 * - Tarefa de projeto com responsável (extensão aprovada em 20/11/2026): o mesmo fluxo, mas a tarefa
 *   continua no projeto. Quem não é do projeto e participa (quem pediu, o responsável, quem executa agora ou
 *   antes) vê e trabalha só nessa tarefa (`participantAccess`); a equipe do responsável não ganha a tarefa
 *   só por ser da área (isso é das demandas internas).
 */

const rbac = require('./rbac')

const DEMANDS_KIND = 'demands'
const DEMAND_STATUSES = Object.freeze(['unassigned', 'assigned', 'in_progress', 'to_validate', 'done'])
/** Contam na carga de quem executa (Carga da minha equipe): atribuídas e em andamento. */
const LOAD_STATUSES = Object.freeze(['assigned', 'in_progress'])
/** Caixas da tela Demandas: recebidas por mim, atribuídas a mim e pedidas por mim. */
const DEMAND_BOXES = Object.freeze(['received', 'assigned', 'requested'])
/** Comentário obrigatório de passar, concluir e devolver. */
const NOTE_MAX = 5000

/** Ação → quem faz (papel na demanda) e de quais passos sai. */
const ACTION_RULES = Object.freeze({
  assign: { role: 'owner', from: ['unassigned', 'assigned', 'in_progress'] },
  start: { role: 'assignee', from: ['assigned'] },
  pass: { role: 'assignee', from: ['assigned', 'in_progress'] },
  conclude: { role: 'assignee', from: ['assigned', 'in_progress'] },
  validate: { role: 'requester', from: ['to_validate'] },
  return: { role: 'requester', from: ['to_validate'] },
})
const DEMAND_ACTIONS = Object.freeze(Object.keys(ACTION_RULES))

/** Projeto de sistema (não é projeto de ninguém): hoje só a caixa das demandas. */
function isSystemProject(project) {
  return !!project && !!project.kind
}

function isDemandsProject(project) {
  return !!project && project.kind === DEMANDS_KIND
}

function isDemand(task) {
  return !!task && !!task.demandStatus
}

/** Área de "Dependências por área" em que a pessoa está (uma só) ou null. */
function areaOf(areas, userId) {
  if (!userId) return null
  return (areas || []).find((area) => (area.user_ids || []).indexOf(userId) >= 0) || null
}

/**
 * Equipe do responsável: as outras pessoas da área dele (`memberIds`). Fora de qualquer área, `inArea`
 * é falso e a demanda pode ir para qualquer pessoa ativa (a aplicação confere o "ativa").
 */
function teamOf(areas, ownerId) {
  const area = areaOf(areas, ownerId)
  return {
    ownerId: ownerId || null,
    inArea: !!area,
    areaKey: area ? area.key : null,
    areaName: area ? area.name : null,
    memberIds: area ? area.user_ids.filter((id) => id !== ownerId) : [],
  }
}

/** Colegas de área (inclusive a própria pessoa): os responsáveis cujas demandas ela vê como equipe. */
function areaMatesOf(areas, userId) {
  const area = areaOf(areas, userId)
  return area ? area.user_ids.slice() : []
}

/** Papéis da pessoa na demanda. */
function rolesIn(task, userId) {
  const has = (id) => !!userId && id === userId
  return {
    requester: has(task.reporterId),
    owner: has(task.demandOwnerId),
    assignee: has(task.assigneeId),
    past: !!userId && (task.demandPastAssignees || []).indexOf(userId) >= 0,
  }
}

/**
 * Enxerga a demanda: quem pediu, o responsável, quem executa (agora ou antes) e a equipe do responsável
 * (`team` = teamOf do responsável). Quem tem `projects.view_all` vê todas (ver demandAccess).
 */
function seesDemand(task, userId, team) {
  const roles = rolesIn(task, userId)
  if (roles.requester || roles.owner || roles.assignee || roles.past) return true
  return !!team && !!userId && team.memberIds.indexOf(userId) >= 0
}

/** Participa do fluxo da tarefa: quem pediu, o responsável ou quem executa (agora ou antes). */
function isFlowParticipant(task, userId) {
  const roles = rolesIn(task, userId)
  return roles.requester || roles.owner || roles.assignee || roles.past
}

/**
 * Tarefa de projeto com responsável: quem participa do fluxo sem ver o projeto trabalha nessa tarefa como
 * colaborador dela (`scoped`, como o Responsável TI, §33): vê, edita, comenta e anexa; não exclui, não
 * reatribui pela edição, não relaciona nem faz fork, e as referências ao resto do projeto ficam ocultas.
 */
function participantAccess(principal) {
  return { principal, viewAll: false, isOwner: false, role: 'member', isManager: false, limited: false, scoped: true, canView: true, flow: true }
}

/**
 * Passo de uma tarefa de projeto que ganha responsável agora (`category` = categoria do status atual): sem
 * executor, Sem atribuir; com executor, Atribuída (ou Em andamento, se já está em andamento); encerrada, Concluída.
 */
function statusFromTask(task, category) {
  if (category === 'done' || category === 'cancelled') return 'done'
  if (!task.assigneeId) return 'unassigned'
  return category === 'in_progress' ? 'in_progress' : 'assigned'
}

/**
 * Acesso à demanda no formato de domain/project.js#resolveAccess, para as regras de tarefa
 * (domain/task.js#assertTaskAccess): ver/comentar = quem enxerga; editar (título, descrição, tipo,
 * prioridade, departamento) e anexar = quem pediu, o responsável, quem executa e `projects.view_all`;
 * excluir = quem criou ou `projects.view_all`. Relacionar, fazer fork e atribuir pela edição: nunca
 * (a atribuição tem o fluxo próprio).
 */
function demandAccess(principal, task, team) {
  const userId = principal ? principal.userId : null
  const viewAll = rbac.can(principal, 'projects.view_all')
  const roles = rolesIn(task, userId)
  const sees = viewAll || seesDemand(task, userId, team)
  const contributor = viewAll || roles.requester || roles.owner || roles.assignee
  return {
    principal,
    viewAll,
    isOwner: false,
    role: contributor ? 'member' : sees ? 'viewer' : null,
    isManager: viewAll,
    limited: false,
    scoped: false,
    canView: sees,
    demand: { roles, team: team || null },
  }
}

/** null = pode; senão o código do erro: FORBIDDEN (papel) ou DEMAND_STATE_CONFLICT (passo). */
function actionIssue(userId, task, action) {
  const rule = ACTION_RULES[action]
  if (!rule || !isDemand(task) || !rolesIn(task, userId)[rule.role]) return 'FORBIDDEN'
  return rule.from.indexOf(task.demandStatus) >= 0 ? null : 'DEMAND_STATE_CONFLICT'
}

/** O que a pessoa pode fazer agora na demanda (a tela mostra os botões). */
function demandActions(userId, task) {
  const out = {}
  DEMAND_ACTIONS.forEach((action) => {
    out[action] = actionIssue(userId, task, action) === null
  })
  return out
}

/**
 * Pode receber a demanda (atribuir ou passar): o próprio responsável ou alguém da equipe dele; com o
 * responsável fora de área, qualquer pessoa (ativa — a aplicação confere).
 */
function canReceive(team, userId) {
  if (!userId || !team) return false
  if (!team.inArea) return true
  return userId === team.ownerId || team.memberIds.indexOf(userId) >= 0
}

/**
 * Passo depois da ação. Trocar quem executa (atribuir a outra pessoa ou passar) volta para "Atribuída":
 * a nova pessoa começa quando puder. Reatribuir à mesma pessoa só troca prazo e estimativa.
 */
function nextStatus(task, action, assigneeId) {
  if (action === 'assign') return task.demandStatus === 'unassigned' || assigneeId !== task.assigneeId ? 'assigned' : task.demandStatus
  if (action === 'pass') return 'assigned'
  if (action === 'start' || action === 'return') return 'in_progress'
  if (action === 'conclude') return 'to_validate'
  if (action === 'validate') return 'done'
  return task.demandStatus
}

/** Quem já esteve atribuído, somando quem sai agora (continua vendo a demanda). */
function pastAssigneesAfter(task, nextAssigneeId) {
  const list = (task.demandPastAssignees || []).slice()
  const leaving = task.assigneeId
  if (leaving && leaving !== nextAssigneeId && list.indexOf(leaving) < 0) list.push(leaving)
  return list
}

/**
 * Status do fluxo de trabalho que acompanha o passo da demanda (`statuses` = lista configurada):
 * Sem atribuir → o status padrão; Atribuída → o primeiro ativo "a fazer" (sem ele, o padrão); Em andamento
 * e Para validar → o primeiro ativo "em andamento"; Concluída → o primeiro ativo "concluído". Sem status da
 * categoria, fica o atual (`currentId`).
 */
function workflowStatusFor(demandStatus, statuses, currentId) {
  const active = (statuses || []).filter((s) => s.isActive !== false).sort((a, b) => (a.order || 0) - (b.order || 0))
  const first = (category) => active.find((s) => s.category === category) || null
  const fallback = active.find((s) => s.isDefault) || null
  let found = null
  if (demandStatus === 'unassigned') found = fallback
  else if (demandStatus === 'assigned') found = first('todo') || fallback
  else if (demandStatus === 'in_progress' || demandStatus === 'to_validate') found = first('in_progress')
  else if (demandStatus === 'done') found = first('done')
  return found ? found.id : currentId || null
}

/** Comentário obrigatório (passar, concluir, devolver): texto aparado ou o código do erro. */
function noteIssue(note) {
  if (typeof note !== 'string' || !note.trim()) return 'required'
  return note.trim().length > NOTE_MAX ? 'too_long' : null
}

module.exports = {
  DEMANDS_KIND,
  DEMAND_STATUSES,
  LOAD_STATUSES,
  DEMAND_BOXES,
  DEMAND_ACTIONS,
  NOTE_MAX,
  isSystemProject,
  isDemandsProject,
  isDemand,
  areaOf,
  teamOf,
  areaMatesOf,
  rolesIn,
  seesDemand,
  isFlowParticipant,
  participantAccess,
  statusFromTask,
  demandAccess,
  actionIssue,
  demandActions,
  canReceive,
  nextStatus,
  pastAssigneesAfter,
  workflowStatusFor,
  noteIssue,
}
