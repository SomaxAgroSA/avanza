/**
 * Backlog do projeto (diretriz §15, tela Planejamento): tarefas ainda não encerradas — status das
 * categorias "backlog", "a fazer" e "em andamento" —, na ordem de prioridade do time (`position`, a mesma
 * ordem das colunas no Kanban), com as sprints abertas para planejamento.
 *
 * - Priorizar: reordena entre vizinhos da lista e, opcionalmente, troca a sprint (com histórico).
 * - "Transformar em tarefa ativa" = mover para outro status (POST /tasks/{id}/move).
 */

const { appError } = require('../core/errors')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const taskDomain = require('../domain/task')
const workflow = require('../domain/workflow')
const sprintDomain = require('../domain/sprint')
const { createTaskService } = require('./tasks')
const { presentSprint } = require('./sprints')

const LIMIT = 1000

function createBacklogService(deps) {
  const taskService = createTaskService(deps)

  async function accessTo(ctx, project) {
    return projectDomain.resolveAccess(ctx.principal, project, await deps.projectMemberRepository.find(project.id, ctx.principal.userId))
  }

  function allowed(access, project, action) {
    try {
      taskDomain.assertTaskAccess(access, project, action)
      return true
    } catch (_) {
      return false
    }
  }

  /** Status planejáveis (inativos incluídos na lista: tarefas antigas continuam aparecendo). */
  async function planningStatuses(includeInactive) {
    return (await deps.statusRepository.list({ includeInactive })).filter((s) => sprintDomain.PLANNING_CATEGORIES.indexOf(s.category) >= 0)
  }

  async function getBacklog(ctx, projectId) {
    rbac.assertAuthenticated(ctx.principal)
    const project = projectId ? await deps.projectRepository.findById(projectId) : null
    if (!project) throw appError('PROJECT_NOT_FOUND')
    const access = await accessTo(ctx, project)
    projectDomain.assertAccess(access, project, 'view')
    if (!rbac.can(ctx.principal, 'tasks.view')) throw appError('FORBIDDEN')

    const ids = (await planningStatuses(true)).map((s) => s.id)
    const items = ids.length ? await deps.taskRepository.listBacklog(project.id, ids, LIMIT + 1) : []
    return {
      project: { id: project.id, key: project.key, name: project.name, archived: !!project.archivedAt },
      capabilities: { rank: allowed(access, project, 'edit'), create: allowed(access, project, 'create'), manage_sprints: access.canEdit },
      statuses: (await planningStatuses(false)).map((s) => ({ id: s.id, key: s.key, name: s.name, color: s.color, category: s.category, is_default: !!s.isDefault })),
      sprints: (await deps.sprintRepository.listByProject(project.id, { includeClosed: false })).map(presentSprint),
      items: await taskService.summarize(items.slice(0, LIMIT)),
      truncated: items.length > LIMIT,
    }
  }

  /** Prioriza: coloca a tarefa entre `prev_id` e `next_id`; `sprint_id` (ou null) troca a sprint. */
  async function rankTask(ctx, id, input) {
    rbac.assertAuthenticated(ctx.principal)
    const task = id ? await deps.taskRepository.findById(id) : null
    const project = task ? await deps.projectRepository.findById(task.projectId) : null
    if (!task || !project) throw appError('TASK_NOT_FOUND')
    const access = await accessTo(ctx, project)
    taskDomain.assertTaskAccess(access, project, 'edit', task)

    const ids = (await planningStatuses(true)).map((s) => s.id)
    if (ids.indexOf(task.statusId) < 0) throw appError('NOT_IN_BACKLOG')
    const raw = input || {}

    const neighbor = async (key) => {
      const neighborId = raw[key]
      if (typeof neighborId !== 'string' || !neighborId || neighborId === task.id) return null
      const found = await deps.taskRepository.findById(neighborId)
      return found && found.projectId === task.projectId && ids.indexOf(found.statusId) >= 0 ? found : null
    }
    const place = async () => {
      const prev = await neighbor('prev_id')
      const next = await neighbor('next_id')
      return workflow.positionBetween(prev ? prev.position : null, next ? next.position : null, await deps.taskRepository.maxPositionIn(task.projectId, ids))
    }
    let position = await place()
    if (position === null) {
      // sem espaço entre os vizinhos: renumera a lista inteira e calcula de novo
      await deps.unitOfWork.run(async (repos) => repos.taskRepository.renumberMany(task.projectId, ids))
      position = await place()
    }

    const sprintChange = raw.sprint_id === undefined ? undefined : raw.sprint_id || null
    if (sprintChange !== undefined && sprintChange !== (task.sprintId || null)) {
      return taskService.updateTask(ctx, task.id, { sprint_id: sprintChange }, { position })
    }
    await deps.unitOfWork.run(async (repos) => repos.taskRepository.update(task.id, { position }))
    return taskService.getTask(ctx, task.id)
  }

  return { getBacklog, rankTask }
}

module.exports = { createBacklogService }
