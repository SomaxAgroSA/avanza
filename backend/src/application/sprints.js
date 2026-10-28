/**
 * Casos de uso de sprints do projeto (planejamento do backlog — ver domain/sprint.js).
 *
 * - Ver: quem enxerga o projeto.
 * - Planejar (criar, editar, encerrar, excluir): quem administra o projeto (`projects.edit` + gestor/dono).
 * - Encerrar: tarefas da sprint que não terminaram voltam ao backlog sem sprint (com histórico em cada uma).
 * - Excluir: as tarefas ficam sem sprint (com histórico).
 * - Ordem: manual, definida por quem planeja (novas entram no fim; encerradas aparecem por último).
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const sprintDomain = require('../domain/sprint')
const workflow = require('../domain/workflow')
const { buildAuditEntry } = require('./audit')
const { iso } = require('./presenters')

const RULES = {
  name: [rules.required(), rules.maxLength(sprintDomain.NAME_MAX)],
  goal: [rules.maxLength(sprintDomain.GOAL_MAX)],
  start_date: [rules.isoDate()],
  end_date: [rules.isoDate()],
  state: [rules.oneOf(sprintDomain.SPRINT_STATES)],
}

function invalid(fields) {
  return appError('VALIDATION_ERROR', undefined, { fields })
}

const dayOf = (value) => (value ? String(value).slice(0, 10) : null)

function presentSprint(sprint) {
  return {
    id: sprint.id,
    project_id: sprint.projectId,
    name: sprint.name,
    goal: sprint.goal || '',
    start_date: sprint.startDate || null,
    end_date: sprint.endDate || null,
    state: sprint.state,
    order: sprint.order || 0,
    created_at: iso(sprint.createdAt),
    updated_at: iso(sprint.updatedAt),
  }
}

/** Valores legíveis no histórico. */
function snapshot(sprint) {
  return { name: sprint.name, goal: sprint.goal || null, start_date: sprint.startDate || null, end_date: sprint.endDate || null, state: sprint.state }
}

function createSprintService(deps) {
  async function projectAccess(ctx, projectId) {
    rbac.assertAuthenticated(ctx.principal)
    const project = projectId ? await deps.projectRepository.findById(projectId) : null
    if (!project) throw appError('PROJECT_NOT_FOUND')
    const access = projectDomain.resolveAccess(ctx.principal, project, await deps.projectMemberRepository.find(project.id, ctx.principal.userId))
    projectDomain.assertAccess(access, project, 'view')
    return { project, access }
  }

  /** Sprint visível ao usuário (SPRINT_NOT_FOUND caso contrário — anti-IDOR). */
  async function loadSprint(ctx, id) {
    rbac.assertAuthenticated(ctx.principal)
    const sprint = id ? await deps.sprintRepository.findById(id) : null
    if (!sprint) throw appError('SPRINT_NOT_FOUND')
    const project = await deps.projectRepository.findById(sprint.projectId)
    const access = project ? projectDomain.resolveAccess(ctx.principal, project, await deps.projectMemberRepository.find(project.id, ctx.principal.userId)) : null
    if (!project || !access.canView) throw appError('SPRINT_NOT_FOUND')
    return { sprint, project, access }
  }

  function parse(raw, partial) {
    const source = raw || {}
    const schema = {}
    Object.keys(RULES).forEach((key) => {
      if (!partial || (source[key] !== undefined && source[key] !== null)) schema[key] = RULES[key]
    })
    if (!partial) delete schema.state
    const data = assertValid(source, schema)
    ;['start_date', 'end_date'].forEach((key) => {
      if (data[key]) data[key] = data[key].toISOString().slice(0, 10)
    })
    const cleared = ['goal', 'start_date', 'end_date'].filter((key) => source[key] === null)
    return { data, cleared }
  }

  async function audit(repos, ctx, entityType, entityId, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType, entityId, action, oldValue, newValue }))
  }

  /** Tira a sprint das tarefas indicadas, registrando no histórico de cada uma. */
  async function detachTasks(repos, ctx, sprint, list) {
    for (const task of list) {
      await repos.taskRepository.update(task.id, { sprintId: null })
      await audit(repos, ctx, 'task', task.id, 'task.updated', { sprint: sprint.name }, { sprint: null })
    }
  }

  async function listSprints(ctx, projectId, query) {
    const { project } = await projectAccess(ctx, projectId)
    const includeClosed = !!query && query.include_closed === '1'
    return (await deps.sprintRepository.listByProject(project.id, { includeClosed })).map(presentSprint)
  }

  async function createSprint(ctx, projectId, input) {
    const { project, access } = await projectAccess(ctx, projectId)
    projectDomain.assertAccess(access, project, 'edit')
    const { data } = parse(input, false)
    const issue = sprintDomain.datesIssue(data.start_date, data.end_date)
    if (issue) throw invalid({ end_date: issue })
    return deps.unitOfWork.run(async (repos) => {
      const sprint = await repos.sprintRepository.create({
        projectId: project.id,
        name: data.name,
        goal: data.goal || '',
        startDate: data.start_date || null,
        endDate: data.end_date || null,
        state: 'planned',
        // nova sprint entra no fim da lista
        order: (await repos.sprintRepository.listByProject(project.id, { includeClosed: true })).reduce((max, x) => Math.max(max, x.order || 0), 0) + 1,
        createdBy: ctx.principal.userId,
      })
      await audit(repos, ctx, 'sprint', sprint.id, 'sprint.created', null, Object.assign({ project: project.key }, snapshot(sprint)))
      return presentSprint(sprint)
    })
  }

  async function updateSprint(ctx, id, input) {
    const { sprint, project, access } = await loadSprint(ctx, id)
    projectDomain.assertAccess(access, project, 'edit')
    const { data, cleared } = parse(input, true)
    const patch = {}
    if (data.name !== undefined) patch.name = data.name
    if (data.goal !== undefined) patch.goal = data.goal
    if (cleared.indexOf('goal') >= 0) patch.goal = ''
    if (data.start_date !== undefined) patch.startDate = data.start_date
    if (cleared.indexOf('start_date') >= 0) patch.startDate = null
    if (data.end_date !== undefined) patch.endDate = data.end_date
    if (cleared.indexOf('end_date') >= 0) patch.endDate = null
    if (data.state !== undefined) patch.state = data.state
    const next = Object.assign({}, sprint, patch)
    const issue = sprintDomain.datesIssue(dayOf(next.startDate), dayOf(next.endDate))
    if (issue) throw invalid({ end_date: issue })

    const before = snapshot(sprint)
    const after = snapshot(next)
    const oldValue = {}
    const newValue = {}
    Object.keys(after).forEach((key) => {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        oldValue[key] = before[key]
        newValue[key] = after[key]
      }
    })
    if (Object.keys(newValue).length === 0) return presentSprint(sprint)

    const closing = sprintDomain.isOpen(sprint) && next.state === 'closed'
    return deps.unitOfWork.run(async (repos) => {
      let returned = []
      if (closing) {
        const closedStatuses = (await deps.statusRepository.list({ includeInactive: true }))
          .filter((s) => workflow.isClosedCategory(s.category))
          .map((s) => s.id)
        // o que não terminou volta ao backlog sem sprint; o encerrado fica registrado na sprint
        returned = (await repos.taskRepository.listBySprint(sprint.id)).filter((t) => closedStatuses.indexOf(t.statusId) < 0)
        await detachTasks(repos, ctx, sprint, returned)
        newValue.returned_count = returned.length
      }
      const saved = await repos.sprintRepository.update(sprint.id, patch)
      await audit(repos, ctx, 'sprint', sprint.id, 'sprint.updated', oldValue, newValue)
      return Object.assign(presentSprint(saved), closing ? { returned_count: returned.length } : {})
    })
  }

  async function deleteSprint(ctx, id) {
    const { sprint, project, access } = await loadSprint(ctx, id)
    projectDomain.assertAccess(access, project, 'edit')
    await deps.unitOfWork.run(async (repos) => {
      await detachTasks(repos, ctx, sprint, await repos.taskRepository.listBySprint(sprint.id))
      await repos.sprintRepository.delete(sprint.id)
      await audit(repos, ctx, 'sprint', sprint.id, 'sprint.deleted', snapshot(sprint), null)
    })
    return { deleted: true }
  }

  /** Reordena as sprints abertas do projeto; exige a lista completa (evita perder alguma). */
  async function reorderSprints(ctx, projectId, ids) {
    const { project, access } = await projectAccess(ctx, projectId)
    projectDomain.assertAccess(access, project, 'edit')
    const open = await deps.sprintRepository.listByProject(project.id, { includeClosed: false })
    const valid =
      Array.isArray(ids) &&
      ids.length === open.length &&
      ids.every((id, i) => typeof id === 'string' && ids.indexOf(id) === i && open.some((x) => x.id === id))
    if (!valid) throw invalid({ ids: 'invalid_option' })
    const before = open.map((x) => x.name)
    const after = ids.map((id) => open.find((x) => x.id === id).name)
    if (before.join('|') === after.join('|')) return open.map(presentSprint)
    await deps.unitOfWork.run(async (repos) => {
      for (const [index, id] of ids.entries()) await repos.sprintRepository.update(id, { order: index + 1 })
      await audit(repos, ctx, 'sprint', project.id, 'sprint.reordered', { order: before }, { order: after })
    })
    return (await deps.sprintRepository.listByProject(project.id, { includeClosed: false })).map(presentSprint)
  }

  return { listSprints, createSprint, updateSprint, deleteSprint, reorderSprints }
}

module.exports = { createSprintService, presentSprint }
