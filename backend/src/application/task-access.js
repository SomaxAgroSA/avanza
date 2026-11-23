/**
 * Acesso a uma tarefa — a mesma regra para tarefas, comentários, anexos, histórico, relações e
 * documentação vinculada:
 * - tarefa de projeto: o vínculo com o projeto (domain/project.js#resolveAccess) e, para o Responsável
 *   TI, só as tarefas visíveis a ele (domain/task.js#scopedAccess, §33/§36);
 * - demanda interna (§45): quem pediu, o responsável, quem executa (agora ou antes) e a equipe do
 *   responsável (domain/demand.js#demandAccess); a equipe vem de "Dependências por área";
 * - tarefa de projeto com responsável (§45): quem vê o projeto, como sempre; quem participa do fluxo sem
 *   ver o projeto trabalha só nessa tarefa (domain/demand.js#participantAccess).
 */

const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const taskDomain = require('../domain/task')
const demandDomain = require('../domain/demand')
const settingsDomain = require('../domain/platform-settings')
const { currentSettings } = require('./platform-settings')

function createTaskAccess(deps) {
  /** Áreas vigentes de "Dependências por área" (§42). */
  async function areas() {
    return settingsDomain.resolveDependencyAreas(await currentSettings(deps))
  }

  /** Equipe do responsável (as outras pessoas da área dele). */
  async function teamOf(ownerId) {
    return demandDomain.teamOf(await areas(), ownerId)
  }

  /** Acesso do principal à tarefa (`project` = projeto da tarefa, já carregado). */
  async function forTask(principal, task, project) {
    if (demandDomain.isDemandsProject(project) && demandDomain.isDemand(task)) {
      return asGuest(principal, task, demandDomain.demandAccess(principal, task, await teamOf(task.demandOwnerId)))
    }
    const membership = await deps.projectMemberRepository.find(project.id, principal.userId)
    const access = taskDomain.scopedAccess(projectDomain.resolveAccess(principal, project, membership), task)
    if (access.canView || demandDomain.isSystemProject(project)) return access
    // tarefa de projeto com responsável: quem participa do fluxo trabalha nessa tarefa, sem ver o projeto
    if (demandDomain.isDemand(task) && demandDomain.isFlowParticipant(task, principal.userId) && rbac.can(principal, 'tasks.view')) {
      return demandDomain.participantAccess(principal)
    }
    return asGuest(principal, task, access)
  }

  /** Quem não enxerga a tarefa mas foi mencionado num comentário dela vê e comenta só essa tarefa (ajuste 23/11). */
  async function asGuest(principal, task, access) {
    if (access.canView || !principal || !task || !rbac.can(principal, 'tasks.view')) return access
    const repo = deps.commentRepository
    if (!repo || !repo.hasMention || !(await repo.hasMention(task.id, principal.userId))) return access
    return demandDomain.guestAccess(principal)
  }

  /**
   * Só com o id da pessoa (notificações e menções): ela enxerga a demanda? Na demanda interna, também a
   * equipe do responsável; na tarefa de projeto com responsável, quem participa do fluxo.
   */
  async function userSeesDemand(userId, task, project) {
    if (project && !demandDomain.isDemandsProject(project)) return demandDomain.isFlowParticipant(task, userId)
    return demandDomain.seesDemand(task, userId, await teamOf(task.demandOwnerId))
  }

  /** Principal de uma pessoa (perfil e permissões), para as regras que só têm o usuário (notificações, menções). */
  async function principalOf(user) {
    const role = user ? await deps.roleRepository.findById(user.roleId) : null
    if (!role) return null
    return rbac.createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: await deps.roleRepository.getPermissionCodes(role.id) })
  }

  /** A pessoa vê todos os projetos e demandas (`projects.view_all` ou SUPER_ADMIN)? */
  async function seesAll(user) {
    return rbac.can(await principalOf(user), 'projects.view_all')
  }

  /** Pessoas ativas que veem tudo (podem ser mencionadas em qualquer tarefa). */
  async function viewAllUsers() {
    const roles = await deps.roleRepository.list()
    const codes = await Promise.all(roles.map((role) => deps.roleRepository.getPermissionCodes(role.id)))
    const ids = roles
      .filter((role, i) => rbac.can(rbac.createPrincipal({ userId: '', roleId: role.id, roleCode: role.code, permissions: codes[i] }), 'projects.view_all'))
      .map((role) => role.id)
    if (ids.length === 0) return []
    return (await deps.userRepository.searchActive({ search: '', excludeIds: [] })).filter((u) => ids.indexOf(u.roleId) >= 0)
  }

  /**
   * Demandas internas (linhas com reporterId, demandOwnerId, assigneeId e demandPastAssignees) que o
   * principal enxerga: todas com `projects.view_all`; senão quem pediu, o responsável, quem executa (agora ou
   * antes) e a equipe do responsável (Relatórios e Em andamento).
   */
  async function visibleDemands(principal, rows) {
    if (rbac.can(principal, 'projects.view_all')) return rows
    if (!rows.length) return rows
    const list = await areas()
    return rows.filter((row) => demandDomain.seesDemand(row, principal.userId, demandDomain.teamOf(list, row.demandOwnerId)))
  }

  return { areas, teamOf, forTask, userSeesDemand, principalOf, seesAll, viewAllUsers, visibleDemands }
}

module.exports = { createTaskAccess }
