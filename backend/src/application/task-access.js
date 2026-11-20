/**
 * Acesso a uma tarefa — a mesma regra para tarefas, comentários, anexos, histórico, relações e
 * documentação vinculada:
 * - tarefa de projeto: o vínculo com o projeto (domain/project.js#resolveAccess) e, para o Responsável
 *   TI, só as tarefas visíveis a ele (domain/task.js#scopedAccess, §33/§36);
 * - demanda interna (§45): quem pediu, o responsável, quem executa (agora ou antes) e a equipe do
 *   responsável (domain/demand.js#demandAccess); a equipe vem de "Dependências por área".
 */

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
      return demandDomain.demandAccess(principal, task, await teamOf(task.demandOwnerId))
    }
    const membership = await deps.projectMemberRepository.find(project.id, principal.userId)
    return taskDomain.scopedAccess(projectDomain.resolveAccess(principal, project, membership), task)
  }

  /** Só com o id da pessoa (notificações e menções): ela enxerga a demanda? */
  async function userSeesDemand(userId, task) {
    return demandDomain.seesDemand(task, userId, await teamOf(task.demandOwnerId))
  }

  return { areas, teamOf, forTask, userSeesDemand }
}

module.exports = { createTaskAccess }
