/**
 * Casos de uso do tempo real (regras de negócio §19): autorizar as assinaturas de uma conexão e
 * transformar uma mudança gravada no aviso para o tópico certo.
 *
 * As assinaturas valem pela regra de visibilidade do projeto (membro, dono ou `projects.view_all`, com
 * `projects.view`) e o tópico da própria pessoa; o resto é descartado em silêncio (a conexão continua).
 */

const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const realtimeDomain = require('../domain/realtime')

function createRealtimeService(deps) {
  /**
   * Ids dos projetos (entre os pedidos) que a pessoa vê — duas consultas para todos, não duas por
   * tópico (o Kanban de todos os projetos assina dezenas de uma vez).
   */
  async function visibleProjects(principal, projectIds) {
    const visible = {}
    if (projectIds.length === 0) return visible
    const projects = await deps.projectRepository.findManyByIds(projectIds)
    const roles = await deps.projectMemberRepository.rolesForUser(principal.userId, projects.map((p) => p.id))
    projects.forEach((project) => {
      const membership = Object.prototype.hasOwnProperty.call(roles, project.id) ? { role: roles[project.id] } : null
      if (projectDomain.resolveAccess(principal, project, membership).canView) visible[project.id] = true
    })
    return visible
  }

  /** Tópicos pedidos → { allowed, rejected }; sem sessão → UNAUTHENTICATED. */
  async function authorize(ctx, topics) {
    rbac.assertAuthenticated(ctx.principal)
    const requested = realtimeDomain.normalizeTopics(topics).map((topic) => ({ topic, parsed: realtimeDomain.parseTopic(topic) }))
    const projectIds = requested.filter((r) => r.parsed && r.parsed.kind === 'project').map((r) => r.parsed.id)
    const visible = await visibleProjects(ctx.principal, projectIds)
    const allowed = []
    const rejected = []
    requested.forEach(({ topic, parsed }) => {
      const ok = !!parsed && (parsed.kind === 'user' ? parsed.id === ctx.principal.userId : !!visible[parsed.id])
      ;(ok ? allowed : rejected).push(topic)
    })
    return { allowed, rejected }
  }

  /**
   * Mudança gravada → { topic, payload } ou null. `change`: { collection, action, id, projectId?,
   * taskId?, itemId?, userId? } — sem projeto, ele vem da tarefa (comentários, anexos, relações).
   */
  async function eventFor(change) {
    let projectId = change.projectId || null
    if (!projectId && change.taskId) {
      const task = await deps.taskRepository.findById(change.taskId)
      projectId = task ? task.projectId : null
    }
    return realtimeDomain.buildEvent(Object.assign({}, change, { projectId }))
  }

  return { authorize, eventFor }
}

module.exports = { createRealtimeService }
