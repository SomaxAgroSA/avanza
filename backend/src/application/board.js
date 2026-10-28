/**
 * Quadro Kanban do projeto (diretriz §14): colunas = status ativos na ordem configurada,
 * cards na ordem manual (`position`), com os campos marcados "no card" no tipo da tarefa.
 *
 * Colunas de encerramento (concluída/cancelada) mostram só as mais recentes, para o quadro
 * continuar leve em projetos longos; as demais mostram tudo (até o limite de segurança).
 */

const { appError } = require('../core/errors')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const taskDomain = require('../domain/task')
const workflow = require('../domain/workflow')
const { createTaskService } = require('./tasks')
const { createCustomFieldService } = require('./custom-fields')

const OPEN_LIMIT = 500
const CLOSED_LIMIT = 30

function createBoardService(deps) {
  const taskService = createTaskService(deps)
  const fieldService = createCustomFieldService(deps)

  function allowed(access, project, action) {
    try {
      taskDomain.assertTaskAccess(access, project, action)
      return true
    } catch (_) {
      return false
    }
  }

  /** Campos "no card" por tipo (definição completa, para o front exibir o valor). */
  async function cardFieldsByType(typeIds) {
    const map = {}
    for (const typeId of typeIds) {
      const links = (await deps.taskTypeFieldRepository.listByType(typeId)).filter((l) => l.showOnCard && l.visible !== false)
      const definitions = {}
      ;(await fieldService.presentMany(await deps.customFieldRepository.findManyByIds(links.map((l) => l.fieldId)))).forEach((dto) => {
        definitions[dto.id] = dto
      })
      map[typeId] = links.map((l) => definitions[l.fieldId]).filter(Boolean)
    }
    return map
  }

  async function getBoard(ctx, projectId) {
    rbac.assertAuthenticated(ctx.principal)
    const project = projectId ? await deps.projectRepository.findById(projectId) : null
    if (!project) throw appError('PROJECT_NOT_FOUND')
    const membership = await deps.projectMemberRepository.find(project.id, ctx.principal.userId)
    const access = projectDomain.resolveAccess(ctx.principal, project, membership)
    projectDomain.assertAccess(access, project, 'view')
    if (!rbac.can(ctx.principal, 'kanban.view') || !rbac.can(ctx.principal, 'tasks.view')) throw appError('FORBIDDEN')

    const statuses = await deps.statusRepository.list({ includeInactive: false })
    const counts = await deps.taskRepository.countByStatus(project.id)
    const perColumn = []
    for (const status of statuses) {
      const closed = workflow.isClosedCategory(status.category)
      perColumn.push({ status, closed, tasks: await deps.taskRepository.listForBoard(project.id, status.id, { closed, limit: closed ? CLOSED_LIMIT : OPEN_LIMIT }) })
    }

    const allTasks = perColumn.reduce((list, column) => list.concat(column.tasks), [])
    const summaries = {}
    ;(await taskService.summarize(allTasks)).forEach((summary) => {
      summaries[summary.id] = summary
    })
    const typeIds = allTasks.map((t) => t.typeId).filter((id, i, all) => all.indexOf(id) === i)
    const fieldsByType = await cardFieldsByType(typeIds)
    const values = allTasks.length ? await deps.taskValueRepository.listByTasks(allTasks.map((t) => t.id)) : {}

    return {
      project: { id: project.id, key: project.key, name: project.name, archived: !!project.archivedAt },
      capabilities: { move: allowed(access, project, 'edit'), create: allowed(access, project, 'create') },
      columns: perColumn.map((column) => {
        const total = counts[column.status.id] || 0
        return {
          status: {
            id: column.status.id,
            key: column.status.key,
            name: column.status.name,
            color: column.status.color,
            category: column.status.category,
            is_default: !!column.status.isDefault,
          },
          wip_limit: column.status.wipLimit || 0,
          allowed_next: column.status.allowedNext || [],
          total,
          truncated: total > column.tasks.length,
          tasks: column.tasks.map((task) =>
            Object.assign({}, summaries[task.id], {
              card_fields: (fieldsByType[task.typeId] || []).map((field) => ({
                field: { id: field.id, name: field.name, label: field.label, type: field.type, options: field.options, config: field.config },
                value: ((values[task.id] || {})[field.id]) === undefined ? null : values[task.id][field.id],
              })),
            }),
          ),
        }
      }),
    }
  }

  return { getBoard }
}

module.exports = { createBoardService }
