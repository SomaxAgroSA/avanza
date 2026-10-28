/**
 * Relacionamentos, subtarefas (consulta) e fork de tarefas (diretriz §12 e §13).
 *
 * - Ver: quem vê a tarefa; relações com tarefas que a pessoa não enxerga ficam ocultas.
 * - Relacionar/desfazer: `tasks.link` + colaborador no projeto da tarefa (o outro lado precisa
 *   estar visível). Bloqueios e dependências não podem formar ciclo.
 * - Fork: `tasks.fork` + colaborador na origem e permissão de criar no projeto destino; copia o
 *   que foi escolhido (ver domain/relation.js#forkCopy) e guarda a origem.
 * - Histórico: criar/desfazer relação aparece nas duas tarefas (`rel:<tipo>`); o fork aparece na
 *   origem (`fork`) e na nova tarefa (`forked_from`).
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const taskDomain = require('../domain/task')
const workflow = require('../domain/workflow')
const relationDomain = require('../domain/relation')
const { buildAuditEntry } = require('./audit')
const { iso, toUserSummary } = require('./presenters')
const { createTaskService } = require('./tasks')

const FILE_TYPES = ['image', 'file']

function invalid(fields) {
  return appError('VALIDATION_ERROR', undefined, { fields })
}

const label = (task) => `${task.code} · ${task.title}`
const unique = (ids) => ids.filter((id, i, all) => id && all.indexOf(id) === i)

function createRelationService(deps) {
  const tasks = deps.taskRepository
  const relations = deps.relationRepository
  const taskService = createTaskService(deps)

  async function accessTo(ctx, task) {
    const project = await deps.projectRepository.findById(task.projectId)
    if (!project) return { project: null, access: null }
    return { project, access: projectDomain.resolveAccess(ctx.principal, project, await deps.projectMemberRepository.find(project.id, ctx.principal.userId)) }
  }

  async function canDo(ctx, task, action) {
    const { project, access } = await accessTo(ctx, task)
    if (!project) return false
    try {
      taskDomain.assertTaskAccess(access, project, action, task)
      return true
    } catch (_) {
      return false
    }
  }

  /** Tarefa visível ao usuário (TASK_NOT_FOUND caso contrário — anti-IDOR). */
  async function load(ctx, id) {
    rbac.assertAuthenticated(ctx.principal)
    const task = id ? await tasks.findById(id) : null
    if (!task) throw appError('TASK_NOT_FOUND')
    const { project, access } = await accessTo(ctx, task)
    if (!project) throw appError('TASK_NOT_FOUND')
    taskDomain.assertTaskAccess(access, project, 'view', task)
    return { task, project, access }
  }

  async function audit(repos, ctx, taskId, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'task', entityId: taskId, action, oldValue, newValue }))
  }

  /** Resumos das tarefas visíveis ao usuário, por id. */
  async function visibleSummaries(ctx, list) {
    const visible = []
    for (const t of list) {
      if (await canDo(ctx, t, 'view')) visible.push(t)
    }
    const map = {}
    ;(await taskService.summarize(visible)).forEach((summary) => {
      map[summary.id] = summary
    })
    return map
  }

  async function presentRelation(ctx, rel, taskId, other, canLink) {
    const creator = rel.createdBy ? await deps.userRepository.findById(rel.createdBy) : null
    return {
      id: rel.id,
      type: relationDomain.viewType(rel, taskId),
      task: other,
      created_by: creator ? toUserSummary(creator) : null,
      created_at: iso(rel.createdAt),
      capabilities: { delete: canLink },
    }
  }

  /**
   * Arestas "vem antes" alcançáveis a partir de `startId` (id -> ids seguintes), buscadas por nível:
   * o domínio (createsCycle) percorre o grafo de forma síncrona, com o que já está em memória.
   */
  async function precedenceGraph(startId) {
    const following = {}
    let frontier = [startId]
    while (frontier.length > 0) {
      frontier.forEach((id) => {
        following[id] = []
      })
      ;(await relations.precedenceFrom(frontier)).forEach((r) => {
        const pair = relationDomain.precedenceOf(r)
        if (following[pair[0]]) following[pair[0]].push(pair[1])
      })
      frontier = unique(frontier.reduce((list, id) => list.concat(following[id]), [])).filter((id) => !following[id])
    }
    return following
  }

  // ---------------------------------------------------------------- consulta

  async function listRelations(ctx, id) {
    const { task } = await load(ctx, id)
    const rels = await relations.listByTask(task.id)
    const children = await tasks.listChildren(task.id)
    const forks = await tasks.listForks(task.id)
    const otherIds = rels.map((r) => (r.sourceId === task.id ? r.targetId : r.sourceId))
    const extra = unique([task.parentTaskId, task.forkedFromTaskId])
    const loaded = await tasks.findManyByIds(unique(otherIds.concat(extra)))
    const summaries = await visibleSummaries(ctx, loaded.concat(children, forks))
    const canLink = await canDo(ctx, task, 'link')
    const order = relationDomain.VIEW_TYPES

    const closed = (await deps.statusRepository.list({ includeInactive: true }))
      .filter((s) => workflow.isClosedCategory(s.category))
      .map((s) => s.id)
    const visibleChildren = children.filter((c) => summaries[c.id])
    const presented = []
    for (const rel of rels) {
      const other = summaries[rel.sourceId === task.id ? rel.targetId : rel.sourceId]
      presented.push(other ? await presentRelation(ctx, rel, task.id, other, canLink) : null)
    }

    return {
      parent: task.parentTaskId ? summaries[task.parentTaskId] || null : null,
      children: visibleChildren.map((c) => summaries[c.id]),
      subtask_progress: { done: visibleChildren.filter((c) => closed.indexOf(c.statusId) >= 0).length, total: visibleChildren.length },
      forked_from: task.forkedFromTaskId ? summaries[task.forkedFromTaskId] || null : null,
      forks: forks.filter((f) => summaries[f.id]).map((f) => summaries[f.id]),
      relations: presented.filter(Boolean).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.task.number - b.task.number),
      capabilities: {
        link: canLink,
        fork: await canDo(ctx, task, 'fork'),
        create_subtask: await canDo(ctx, task, 'create'),
        edit: await canDo(ctx, task, 'edit'),
      },
    }
  }

  // ---------------------------------------------------------------- relações

  /** Cria a relação `type` (do ponto de vista da tarefa `id`) com `target_id`. */
  async function createRelation(ctx, id, input) {
    const { task, project, access } = await load(ctx, id)
    taskDomain.assertTaskAccess(access, project, 'link', task)
    const raw = input || {}
    if (relationDomain.VIEW_TYPES.indexOf(raw.type) < 0) throw invalid({ type: 'invalid_option' })
    const target = typeof raw.target_id === 'string' && raw.target_id ? await tasks.findById(raw.target_id) : null
    if (!target || !(await canDo(ctx, target, 'view'))) throw invalid({ target_id: 'invalid_option' })
    const rel = relationDomain.normalize(raw.type, task.id, target.id)
    if (!rel) throw invalid({ target_id: 'invalid_option' })
    if (relationDomain.isDuplicate(await relations.listBetween(task.id, target.id), rel)) throw appError('RELATION_EXISTS')
    const edge = relationDomain.precedenceOf(rel)
    if (edge) {
      const following = await precedenceGraph(edge[1])
      const next = (ids) => ids.reduce((list, nextId) => list.concat(following[nextId] || []), [])
      if (relationDomain.createsCycle(edge, next)) throw appError('RELATION_CYCLE')
    }
    const created = await deps.unitOfWork.run(async (repos) => {
      const saved = await repos.relationRepository.create({ type: rel.type, sourceId: rel.sourceId, targetId: rel.targetId, createdBy: ctx.principal.userId })
      await audit(repos, ctx, task.id, 'task.linked', null, { [`rel:${raw.type}`]: label(target) })
      await audit(repos, ctx, target.id, 'task.linked', null, { [`rel:${relationDomain.viewType(rel, target.id)}`]: label(task) })
      return saved
    })
    const other = (await taskService.summarize([target]))[0]
    return presentRelation(ctx, created, task.id, other, true)
  }

  async function deleteRelation(ctx, relationId) {
    rbac.assertAuthenticated(ctx.principal)
    const rel = relationId ? await relations.findById(relationId) : null
    const source = rel ? await tasks.findById(rel.sourceId) : null
    const target = rel ? await tasks.findById(rel.targetId) : null
    if (!rel || !source || !target) throw appError('RELATION_NOT_FOUND')
    if (!(await canDo(ctx, source, 'view')) && !(await canDo(ctx, target, 'view'))) throw appError('RELATION_NOT_FOUND')
    if (!(await canDo(ctx, source, 'link')) && !(await canDo(ctx, target, 'link'))) throw appError('FORBIDDEN')
    await deps.unitOfWork.run(async (repos) => {
      await repos.relationRepository.delete(rel.id)
      await audit(repos, ctx, source.id, 'task.unlinked', { [`rel:${relationDomain.viewType(rel, source.id)}`]: label(target) }, null)
      await audit(repos, ctx, target.id, 'task.unlinked', { [`rel:${relationDomain.viewType(rel, target.id)}`]: label(source) }, null)
    })
    return { deleted: true }
  }

  // ---------------------------------------------------------------- fork

  async function forkTask(ctx, id, input) {
    const { task, project, access } = await load(ctx, id)
    taskDomain.assertTaskAccess(access, project, 'fork', task)
    const raw = input || {}
    const copy = relationDomain.forkCopy(raw.copy)
    const title = raw.title === undefined || raw.title === null ? task.title : assertValid({ title: raw.title }, { title: [rules.required(), rules.maxLength(200)] }).title
    const projectId = typeof raw.project_id === 'string' && raw.project_id ? raw.project_id : task.projectId

    // campos personalizados por nome técnico (imagem/arquivo só com os anexos copiados)
    const links = await deps.taskTypeFieldRepository.listByType(task.typeId)
    const fields = {}
    ;(await deps.customFieldRepository.findManyByIds(links.map((l) => l.fieldId))).forEach((field) => {
      fields[field.id] = field
    })
    const saved = (await deps.taskValueRepository.listByTasks([task.id]))[task.id] || {}
    const customValues = {}
    const fileValues = {}
    if (copy.custom_values) {
      Object.keys(saved).forEach((fieldId) => {
        const field = fields[fieldId]
        if (!field) return
        if (FILE_TYPES.indexOf(field.type) >= 0) fileValues[fieldId] = saved[fieldId]
        else customValues[field.name] = saved[fieldId]
      })
    }
    const tagIds = copy.tags ? (await deps.taskTagRepository.listByTasks([task.id]))[task.id] || [] : []

    const createInput = {
      project_id: projectId,
      task_type_id: task.typeId,
      title,
      description: copy.description ? task.description || '' : '',
      priority_id: task.priorityId,
      custom_values: customValues,
      tag_ids: tagIds,
      // o trabalho do fork começa do zero: itens voltam a ficar pendentes
      checklist: copy.checklist ? (task.checklist || []).map((item) => ({ text: item.text, done: false })) : [],
    }

    const extras = async (repos, created) => {
      if (copy.attachments) {
        const mapping = {}
        for (const attachment of await repos.attachmentRepository.listByTask(task.id)) {
          mapping[attachment.id] = (await repos.attachmentRepository.copyTo(attachment.id, { taskId: created.id, uploadedBy: ctx.principal.userId })).id
        }
        // campos de imagem/arquivo passam a apontar para as cópias
        const remapped = {}
        const types = {}
        Object.keys(fileValues).forEach((fieldId) => {
          const value = fileValues[fieldId]
          const ids = (Array.isArray(value) ? value : [value]).map((attachmentId) => mapping[attachmentId]).filter(Boolean)
          if (ids.length === 0) return
          remapped[fieldId] = Array.isArray(value) ? ids : ids[0]
          types[fieldId] = fields[fieldId].type
        })
        if (Object.keys(remapped).length > 0) {
          const current = (await repos.taskValueRepository.listByTasks([created.id]))[created.id] || {}
          const allTypes = {}
          Object.keys(current).forEach((fieldId) => {
            if (fields[fieldId]) allTypes[fieldId] = fields[fieldId].type
          })
          await repos.taskValueRepository.replace(created.id, Object.assign({}, current, remapped), Object.assign(allTypes, types))
        }
      }
      if (copy.relations) {
        for (const rel of await repos.relationRepository.listByTask(task.id)) {
          const sourceId = rel.sourceId === task.id ? created.id : rel.sourceId
          const targetId = rel.targetId === task.id ? created.id : rel.targetId
          await repos.relationRepository.create({ type: rel.type, sourceId, targetId, createdBy: ctx.principal.userId })
          const otherId = rel.sourceId === task.id ? rel.targetId : rel.sourceId
          await audit(repos, ctx, otherId, 'task.linked', null, { [`rel:${relationDomain.viewType({ type: rel.type, sourceId, targetId }, otherId)}`]: label(created) })
        }
      }
      await audit(repos, ctx, task.id, 'task.forked', null, { fork: label(created) })
    }

    return taskService.createTask(ctx, createInput, { forkedFrom: task, extras })
  }

  return { listRelations, createRelation, deleteRelation, forkTask }
}

module.exports = { createRelationService }
