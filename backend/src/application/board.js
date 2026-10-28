/**
 * Quadro Kanban (diretriz §14): colunas = status ativos na ordem configurada, cards na ordem manual
 * (`position`), com os campos marcados "no card" no tipo da tarefa.
 *
 * Colunas de encerramento (concluída/cancelada) mostram só as mais recentes, para o quadro
 * continuar leve em projetos longos; as demais mostram tudo (até o limite de segurança).
 *
 * Dois recortes com a mesma forma: o quadro de um projeto (`getBoard`) e o de todos os projetos que a
 * pessoa enxerga (`getAllBoard`, regras de negócio §5) — os status são globais, então as colunas são as
 * mesmas; cada card traz o projeto e se a pessoa pode movê-lo (a permissão é do projeto do card).
 */

const { appError } = require('../core/errors')
const { rules, assertValid } = require('../core/validation')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const taskDomain = require('../domain/task')
const workflow = require('../domain/workflow')
const { createTaskService } = require('./tasks')
const { createCustomFieldService } = require('./custom-fields')

const OPEN_LIMIT = 500
const CLOSED_LIMIT = 30
/** Máximo de projetos em `project_ids` (o quadro de todos os projetos já traz todos sem o filtro). */
const MAX_PROJECT_IDS = 200
const ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/

const ALL_SCHEMA = {
  // ids separados por vírgula
  project_ids: [
    rules.custom((value) => {
      if (typeof value !== 'string') return 'invalid_type'
      const ids = value.split(',').map((id) => id.trim()).filter(Boolean)
      if (ids.length > MAX_PROJECT_IDS) return 'too_many'
      return ids.every((id) => ID_PATTERN.test(id)) ? null : 'invalid_type'
    }),
  ],
}

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

  function assertBoardPermissions(principal) {
    if (!rbac.can(principal, 'kanban.view') || !rbac.can(principal, 'tasks.view')) throw appError('FORBIDDEN')
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

  /**
   * Colunas do quadro. `source`: { count() → { statusId: total }, list(statusId, options) → tarefas };
   * `extra(task)`: campos a mais em cada card (ex.: a permissão de mover no quadro de todos os projetos).
   */
  async function buildColumns(source, extra) {
    const statuses = await deps.statusRepository.list({ includeInactive: false })
    const counts = await source.count()
    const perColumn = []
    for (const status of statuses) {
      const closed = workflow.isClosedCategory(status.category)
      perColumn.push({ status, closed, tasks: await source.list(status.id, { closed, limit: closed ? CLOSED_LIMIT : OPEN_LIMIT }) })
    }

    const allTasks = perColumn.reduce((list, column) => list.concat(column.tasks), [])
    const summaries = {}
    ;(await taskService.summarize(allTasks)).forEach((summary) => {
      summaries[summary.id] = summary
    })
    const typeIds = allTasks.map((t) => t.typeId).filter((id, i, all) => all.indexOf(id) === i)
    const fieldsByType = await cardFieldsByType(typeIds)
    const values = allTasks.length ? await deps.taskValueRepository.listByTasks(allTasks.map((t) => t.id)) : {}

    return perColumn.map((column) => {
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
          Object.assign(
            {},
            summaries[task.id],
            {
              card_fields: (fieldsByType[task.typeId] || []).map((field) => ({
                field: { id: field.id, name: field.name, label: field.label, type: field.type, options: field.options, config: field.config },
                value: ((values[task.id] || {})[field.id]) === undefined ? null : values[task.id][field.id],
              })),
            },
            extra ? extra(task) : {},
          ),
        ),
      }
    })
  }

  async function getBoard(ctx, projectId) {
    rbac.assertAuthenticated(ctx.principal)
    const project = projectId ? await deps.projectRepository.findById(projectId) : null
    if (!project) throw appError('PROJECT_NOT_FOUND')
    const membership = await deps.projectMemberRepository.find(project.id, ctx.principal.userId)
    const access = projectDomain.resolveAccess(ctx.principal, project, membership)
    projectDomain.assertAccess(access, project, 'view')
    assertBoardPermissions(ctx.principal)

    const columns = await buildColumns({
      count: () => deps.taskRepository.countByStatus(project.id),
      list: (statusId, options) => deps.taskRepository.listForBoard(project.id, statusId, options),
    })
    return {
      project: { id: project.id, key: project.key, name: project.name, archived: !!project.archivedAt },
      capabilities: { move: allowed(access, project, 'edit'), create: allowed(access, project, 'create') },
      columns,
    }
  }

  /**
   * Quadro de todos os projetos abertos que a pessoa enxerga (membro, dono ou `projects.view_all`);
   * `project_ids` (separados por vírgula) restringe — id que ela não vê é ignorado, sem erro.
   */
  async function getAllBoard(ctx, query) {
    rbac.assertAuthenticated(ctx.principal)
    assertBoardPermissions(ctx.principal)
    const q = query || {}
    const filters = assertValid({ project_ids: q.project_ids === '' ? undefined : q.project_ids }, ALL_SCHEMA)
    const listed = (filters.project_ids || '')
      .split(',')
      .map((id) => id.trim())
      .filter((id, i, all) => id && all.indexOf(id) === i)
    const ids = listed.length ? listed : null

    const userId = ctx.principal.userId
    const candidates = await deps.projectRepository.listVisible({ userId, viewAll: rbac.can(ctx.principal, 'projects.view_all'), ids })
    const roles = await deps.projectMemberRepository.rolesForUser(userId, candidates.map((p) => p.id))
    const projects = []
    const canMove = {}
    let create = false
    candidates.forEach((project) => {
      const membership = Object.prototype.hasOwnProperty.call(roles, project.id) ? { role: roles[project.id] } : null
      const access = projectDomain.resolveAccess(ctx.principal, project, membership)
      if (!access.canView) return
      projects.push(project)
      canMove[project.id] = allowed(access, project, 'edit')
      create = create || allowed(access, project, 'create')
    })

    const projectIds = projects.map((p) => p.id)
    const columns = await buildColumns(
      {
        count: () => deps.taskRepository.countByStatusIn(projectIds),
        list: (statusId, options) => deps.taskRepository.listForBoardIn(projectIds, statusId, options),
      },
      (task) => ({ capabilities: { move: !!canMove[task.projectId] } }),
    )
    return {
      project: null,
      projects: projects.map((p) => ({ id: p.id, key: p.key, name: p.name })),
      capabilities: { move: projectIds.some((id) => canMove[id]), create },
      columns,
    }
  }

  return { getBoard, getAllBoard }
}

module.exports = { createBoardService }
