/**
 * Timeline do projeto (expansão, Onda 1 — docs/roadmap-expansao.md).
 *
 * Uma chamada traz tudo o que a tela precisa: tarefas (resumos, com início planejado e prazo),
 * setas de dependência (com aviso de conflito), sprints e marcos, além do que a pessoa pode fazer.
 * - Acesso: quem vê o projeto e tem `tasks.view`; mover barras segue a edição da tarefa;
 *   marcos seguem a regra de gestor do projeto.
 * - Regras de datas e conflitos em domain/timeline.js.
 */

const { appError } = require('../core/errors')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const taskDomain = require('../domain/task')
const timelineDomain = require('../domain/timeline')
const { iso } = require('./presenters')
const { createTaskService } = require('./tasks')
const { presentSprint } = require('./sprints')
const { presentMilestone } = require('./milestones')

/** Acima disso a tela avisa que mostra só as primeiras (pela numeração). */
const MAX_TASKS = 2000
const CHUNK = 400

function chunks(list) {
  const out = []
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK))
  return out
}

function createTimelineService(deps) {
  const taskService = createTaskService(deps)

  function allowed(access, project, action) {
    try {
      taskDomain.assertTaskAccess(access, project, action)
      return true
    } catch (_) {
      return false
    }
  }

  async function getTimeline(ctx, projectId) {
    rbac.assertAuthenticated(ctx.principal)
    const project = projectId ? await deps.projectRepository.findById(projectId) : null
    if (!project) throw appError('PROJECT_NOT_FOUND')
    const access = projectDomain.resolveAccess(ctx.principal, project, await deps.projectMemberRepository.find(project.id, ctx.principal.userId))
    projectDomain.assertAccess(access, project, 'view')
    if (!rbac.can(ctx.principal, 'tasks.view')) throw appError('FORBIDDEN')

    const loaded = await deps.taskRepository.listByProject(project.id, MAX_TASKS + 1)
    const tasks = loaded.slice(0, MAX_TASKS)
    const ids = tasks.map((t) => t.id)
    const byId = {}
    tasks.forEach((t) => {
      byId[t.id] = t
    })
    const relations = []
    for (const part of chunks(ids)) {
      ;(await deps.relationRepository.precedenceFrom(part)).forEach((rel) => relations.push(rel))
    }
    const dependencies = timelineDomain
      .dependencyEdges(relations, ids)
      .map((edge) => Object.assign({}, edge, { conflict: timelineDomain.isConflict(byId[edge.from], byId[edge.to]) }))

    return {
      project: { id: project.id, key: project.key, name: project.name, start_date: iso(project.startDate), due_date: iso(project.dueDate), archived: !!project.archivedAt },
      capabilities: { edit: allowed(access, project, 'edit'), manage_milestones: access.canEdit },
      tasks: await taskService.summarize(tasks),
      dependencies,
      milestones: (await deps.milestoneRepository.listByProject(project.id)).map(presentMilestone),
      sprints: (await deps.sprintRepository.listByProject(project.id, { includeClosed: true })).map(presentSprint),
      truncated: loaded.length > MAX_TASKS,
    }
  }

  return { getTimeline }
}

module.exports = { createTimelineService, MAX_TASKS }
