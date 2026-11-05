/**
 * Casos de uso de tarefas: criar, consultar, editar, excluir e listar.
 *
 * - Acesso: ver domain/task.js (permissão global + acesso ao projeto; anti-IDOR).
 * - Campos personalizados: definidos pelo tipo da tarefa; entram e saem por nome técnico
 *   (`custom_values: { versao: "2.1" }`) e são gravados por ID do campo.
 * - Histórico: cada mudança grava `audit_logs` com valores legíveis (nomes, rótulos de opção).
 * - Sprint (Fase 6): opcional, do mesmo projeto e não encerrada (ver domain/sprint.js).
 * - Subtarefa (Fase 7): `parent_task_id` do mesmo projeto, sem ciclo (ver domain/relation.js);
 *   excluir o pai solta as subtarefas. Resumos trazem progresso das subtarefas e "bloqueada".
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const { parsePagination, parseSort, buildPageMeta } = require('../core/pagination')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const contentLocale = require('../domain/content-locale')
const timelineDomain = require('../domain/timeline')
const taskDomain = require('../domain/task')
const workflow = require('../domain/workflow')
const sprintDomain = require('../domain/sprint')
const relationDomain = require('../domain/relation')
const { buildAuditEntry, truncate } = require('./audit')
const { iso, toUserSummary } = require('./presenters')
const { createCustomFieldService } = require('./custom-fields')
const { createNotifier } = require('./notifications')

const MAX_HOURS = 100000
const MAX_TAGS = 20
const SEARCHABLE_TYPES = ['text', 'textarea', 'url', 'email', 'phone']

const idRule = rules.custom((value) => (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) ? null : 'invalid_type'))
const hoursRule = rules.custom((value) => {
  if (typeof value !== 'number' || !isFinite(value)) return 'invalid_type'
  // zero = não informado (o campo numérico do banco não tem nulo); para limpar, envie null
  if (value <= 0) return 'too_small'
  return value > MAX_HOURS ? 'too_large' : null
})

const BASE_RULES = {
  title: [rules.required(), rules.maxLength(200)],
  description: [rules.maxLength(50000)],
  task_type_id: [idRule],
  status_id: [idRule],
  priority_id: [idRule],
  assignee_id: [idRule],
  reporter_id: [idRule],
  start_date: [rules.isoDate()],
  due_date: [rules.isoDate()],
  estimated_hours: [hoursRule],
  actual_hours: [hoursRule],
  sprint_id: [idRule],
  parent_task_id: [idRule],
  area_id: [idRule],
}

/** Campos que aceitam `null` para limpar. */
const NULLABLE = ['assignee_id', 'reporter_id', 'start_date', 'due_date', 'estimated_hours', 'actual_hours', 'sprint_id', 'parent_task_id', 'area_id']

const SORTABLE = {
  code: 'code',
  title: 'title',
  created_at: 'created',
  updated_at: 'updated',
  due_date: 'due_date',
  priority: 'priority',
  status: 'status',
}

const LIST_SCHEMA = {
  project_id: [idRule],
  task_type_id: [idRule],
  status_id: [idRule],
  priority_id: [idRule],
  assignee_id: [rules.custom((value) => (value === 'me' || (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value)) ? null : 'invalid_type'))],
  search: [rules.maxLength(100)],
  tag_id: [idRule],
  // `none` = sem sprint
  sprint_id: [rules.custom((value) => (value === 'none' || (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value)) ? null : 'invalid_type'))],
  in_report: [rules.custom((value) => (value === 'true' || value === 'false' ? null : 'invalid_option'))],
  it_visible: [rules.custom((value) => (value === 'true' || value === 'false' ? null : 'invalid_option'))],
  urgency: [rules.oneOf(taskDomain.URGENCY_LEVELS.concat(['none']))],
  // `none` = sem área
  area_id: [rules.custom((value) => (value === 'none' || (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value)) ? null : 'invalid_type'))],
  category: [
    rules.custom((value) =>
      typeof value === 'string' && value.split(',').every((c) => workflow.STATUS_CATEGORIES.indexOf(c.trim()) >= 0) ? null : 'invalid_option',
    ),
  ],
}

function invalid(fields) {
  return appError('VALIDATION_ERROR', undefined, { fields })
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function dayOf(date) {
  return date ? new Date(date).toISOString().slice(0, 10) : null
}

function byId(list) {
  const map = {}
  list.forEach((item) => {
    map[item.id] = item
  })
  return map
}

function createTaskService(deps) {
  const tasks = deps.taskRepository
  const values = deps.taskValueRepository
  const fieldService = createCustomFieldService(deps)
  const notifier = createNotifier(deps)

  // ---------------------------------------------------------------- apoio

  function projectAccess(principal, projectId) {
    const project = projectId ? deps.projectRepository.findById(projectId) : null
    if (!project) return { project: null, access: null }
    const membership = deps.projectMemberRepository.find(project.id, principal.userId)
    return { project, access: projectDomain.resolveAccess(principal, project, membership) }
  }

  /** Carrega a tarefa garantindo que o usuário pode vê-la (TASK_NOT_FOUND caso contrário). */
  function loadTask(ctx, id) {
    rbac.assertAuthenticated(ctx.principal)
    const task = id ? tasks.findById(id) : null
    if (!task) throw appError('TASK_NOT_FOUND')
    const found = projectAccess(ctx.principal, task.projectId)
    if (!found.project) throw appError('TASK_NOT_FOUND')
    const access = taskDomain.scopedAccess(found.access, task)
    taskDomain.assertTaskAccess(access, found.project, 'view', task)
    return { task, project: found.project, access }
  }

  /** Campos configurados no tipo, com a definição completa (mesmo formato do formulário). */
  function typeLinks(typeId) {
    const links = deps.taskTypeFieldRepository.listByType(typeId)
    const definitions = byId(fieldService.presentMany(deps.customFieldRepository.findManyByIds(links.map((l) => l.fieldId))))
    return links
      .filter((link) => definitions[link.fieldId])
      .map((link) => ({
        field: definitions[link.fieldId],
        order: link.order,
        required: !!link.required,
        visible: link.visible !== false,
        show_on_card: !!link.showOnCard,
        required_status_ids: link.requiredStatusIds || [],
      }))
  }

  function lookups() {
    return {
      types: byId(deps.taskTypeRepository.list({ includeInactive: true })),
      statuses: byId(deps.statusRepository.list({ includeInactive: true })),
      priorities: byId(deps.priorityRepository.list({ includeInactive: true })),
      areas: byId(deps.areaRepository.list({ includeInactive: true })),
    }
  }

  function activeOrInvalid(item, field) {
    if (!item || item.isActive === false) throw invalid({ [field]: 'invalid_option' })
    return item
  }

  /** Responsável: usuário ativo que colabora no projeto. Relator: qualquer participante do projeto. */
  function assertParticipant(project, userId, field, allowViewer) {
    const user = deps.userRepository.findById(userId)
    const membership = user ? deps.projectMemberRepository.find(project.id, userId) : null
    const ok =
      user &&
      user.status === 'active' &&
      (allowViewer ? project.ownerId === userId || !!membership : taskDomain.canBeAssignee(project, membership, userId))
    if (!ok) throw invalid({ [field]: 'not_member' })
  }

  /** Sprint do mesmo projeto e não encerrado. */
  function assertSprint(project, sprintId) {
    const sprint = deps.sprintRepository.findById(sprintId)
    if (!sprint || sprint.projectId !== project.id || !sprintDomain.isOpen(sprint)) throw invalid({ sprint_id: 'invalid_option' })
    return sprint
  }

  /** Pai da subtarefa: existe, mesmo projeto, sem ciclo e profundidade limitada. */
  function assertParent(project, taskId, parentId) {
    const parent = tasks.findById(parentId)
    if (!parent) throw invalid({ parent_task_id: 'invalid_option' })
    const issue = relationDomain.parentIssue({
      taskId,
      projectId: project.id,
      parent,
      parentOf: (id) => {
        const found = tasks.findById(id)
        return found ? found.parentTaskId || null : null
      },
    })
    if (issue) throw invalid({ parent_task_id: issue })
    return parent
  }

  function customErrors(errors) {
    const fields = {}
    Object.keys(errors).forEach((name) => {
      fields[`custom_values.${name}`] = errors[name]
    })
    return fields
  }

  /** Erro dos campos personalizados, com o status considerado (a tela diz "para ir para X, preencha…"). */
  function invalidCustom(errors, status) {
    return appError('VALIDATION_ERROR', undefined, { fields: customErrors(errors), status: status ? { id: status.id, name: status.name } : null })
  }

  /** Valida o corpo; campos com `null` explícito (limpar) ficam em `cleared`. */
  function parseInput(raw, partial) {
    const source = raw || {}
    const schema = {}
    Object.keys(BASE_RULES).forEach((key) => {
      if (!partial || source[key] !== undefined) schema[key] = BASE_RULES[key]
    })
    if (partial && source.title === undefined) delete schema.title
    const data = assertValid(source, schema)
    if (data.estimated_hours !== undefined) data.estimated_hours = round2(data.estimated_hours)
    if (data.actual_hours !== undefined) data.actual_hours = round2(data.actual_hours)
    const cleared = NULLABLE.filter((key) => source[key] === null)
    if (source.custom_values !== undefined && (source.custom_values === null || typeof source.custom_values !== 'object' || Array.isArray(source.custom_values))) {
      throw invalid({ custom_values: 'invalid_type' })
    }
    let tagIds
    if (source.tag_ids !== undefined) {
      tagIds = assertValid({ tag_ids: source.tag_ids }, { tag_ids: [rules.stringArray(MAX_TAGS)] }).tag_ids
      tagIds = tagIds.filter((id, i) => tagIds.indexOf(id) === i)
      if (tagIds.length > 0 && deps.tagRepository.findManyByIds(tagIds).length !== tagIds.length) throw invalid({ tag_ids: 'invalid_option' })
    }
    let checklist
    if (source.checklist !== undefined) {
      const result = taskDomain.normalizeChecklist(source.checklist === null ? [] : source.checklist, () => deps.tokens.generate().slice(0, 12))
      if (result.error) throw invalid({ checklist: result.error })
      checklist = result.value
    }
    return { data, cleared, customValues: source.custom_values || null, tagIds, checklist }
  }

  // ---------------------------------------------------------------- apresentação

  function refsFor(list, extraUserIds) {
    const projectIds = []
    const userIds = (extraUserIds || []).slice()
    list.forEach((t) => {
      if (projectIds.indexOf(t.projectId) < 0) projectIds.push(t.projectId)
      ;[t.creatorId, t.assigneeId, t.reporterId].forEach((id) => {
        if (id && userIds.indexOf(id) < 0) userIds.push(id)
      })
    })
    const taskIds = list.map((t) => t.id).filter((id, i, all) => id && all.indexOf(id) === i)
    const sprintIds = list.map((t) => t.sprintId).filter((id, i, all) => id && all.indexOf(id) === i)
    const taskTags = taskIds.length ? deps.taskTagRepository.listByTasks(taskIds) : {}
    const tagIds = []
    list.forEach((t) => {
      ;(t.tagIds || taskTags[t.id] || []).forEach((id) => {
        if (tagIds.indexOf(id) < 0) tagIds.push(id)
      })
    })
    const base = lookups()
    const closedIds = Object.keys(base.statuses).filter((id) => workflow.isClosedCategory(base.statuses[id].category))
    const relatedIds = []
    list.forEach((t) => {
      ;[t.parentTaskId, t.forkedFromTaskId].forEach((id) => {
        if (id && relatedIds.indexOf(id) < 0) relatedIds.push(id)
      })
    })
    // bloqueada = algum bloqueador (bloqueia / depende de) ainda aberto
    const blockers = taskIds.length ? deps.relationRepository.blockersOf(taskIds) : []
    const blockerTasks = byId(blockers.length ? tasks.findManyByIds(blockers.map((b) => b.blockerId).filter((id, i, all) => all.indexOf(id) === i)) : [])
    const blocked = {}
    blockers.forEach((b) => {
      const blocker = blockerTasks[b.blockerId]
      if (blocker && closedIds.indexOf(blocker.statusId) < 0) blocked[b.taskId] = true
    })
    return Object.assign(base, {
      related: byId(relatedIds.length ? tasks.findManyByIds(relatedIds) : []),
      subtasks: taskIds.length ? tasks.subtaskStats(taskIds, closedIds) : {},
      blocked,
      projects: byId(projectIds.length ? deps.projectRepository.findManyByIds(projectIds) : []),
      users: byId(userIds.length ? deps.userRepository.findManyByIds(userIds) : []),
      taskTags,
      tags: byId(tagIds.length ? deps.tagRepository.findManyByIds(tagIds) : []),
      commentCounts: taskIds.length ? deps.commentRepository.countByTasks(taskIds) : {},
      attachmentCounts: taskIds.length ? deps.attachmentRepository.countByTasks(taskIds) : {},
      sprints: byId(sprintIds.length ? deps.sprintRepository.findManyByIds(sprintIds) : []),
    })
  }

  /** Tags da tarefa (em ordem alfabética); `task.tagIds` sobrepõe o que está salvo (usado no histórico). */
  function tagsOf(task, refs) {
    return (task.tagIds || refs.taskTags[task.id] || [])
      .map((id) => refs.tags[id])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  function presentSummary(task, refs) {
    const project = refs.projects[task.projectId]
    const type = refs.types[task.typeId]
    const status = refs.statuses[task.statusId]
    const priority = refs.priorities[task.priorityId]
    const area = task.areaId ? refs.areas[task.areaId] : null
    const sprint = task.sprintId ? refs.sprints[task.sprintId] : null
    const user = (id) => (id && refs.users[id] ? toUserSummary(refs.users[id]) : null)
    return {
      id: task.id,
      code: task.code,
      number: task.number,
      title: task.title,
      project: project ? { id: project.id, key: project.key, name: project.name } : null,
      // nome do tipo no idioma da requisição (o histórico guarda o original)
      type: type ? { id: type.id, key: type.key, name: contentLocale.localize(type, deps.locale, ['name']).name, icon: type.icon || 'check-square', color: type.color || 'blue' } : null,
      status: status ? { id: status.id, key: status.key, name: status.name, color: status.color, category: status.category } : null,
      priority: priority ? { id: priority.id, key: priority.key, name: priority.name, color: priority.color } : null,
      sprint: sprint ? { id: sprint.id, name: sprint.name, state: sprint.state } : null,
      creator: user(task.creatorId),
      assignee: user(task.assigneeId),
      reporter: user(task.reporterId),
      parent_task_id: task.parentTaskId || null,
      start_date: iso(task.startDate),
      due_date: iso(task.dueDate),
      estimated_hours: task.estimatedHours === undefined ? null : task.estimatedHours,
      actual_hours: task.actualHours === undefined ? null : task.actualHours,
      started_at: iso(task.startedAt),
      completed_at: iso(task.completedAt),
      created_at: iso(task.createdAt),
      updated_at: iso(task.updatedAt),
      tags: tagsOf(task, refs).map((tag) => ({ id: tag.id, name: tag.name, color: tag.color || 'gray' })),
      checklist_progress: { done: (task.checklist || []).filter((i) => i.done).length, total: (task.checklist || []).length },
      comment_count: refs.commentCounts[task.id] || 0,
      attachment_count: refs.attachmentCounts[task.id] || 0,
      subtask_progress: refs.subtasks[task.id] || { done: 0, total: 0 },
      blocked: !!refs.blocked[task.id],
      in_report: !task.reportExcluded,
      it_visible: !!task.itVisible,
      urgency: task.urgency || null,
      area: area ? { id: area.id, key: area.key, name: area.name, color: area.color || 'gray' } : null,
    }
  }

  const taskRef = (t) => (t ? { id: t.id, code: t.code, title: t.title } : null)
  const taskLabel = (t) => (t ? `${t.code} · ${t.title}` : null)

  function presentDetail(ctx, task, project, access) {
    const refs = refsFor([task])
    const links = typeLinks(task.typeId)
    const saved = values.listByTasks([task.id])[task.id] || {}
    const customValues = {}
    links.forEach((link) => {
      if (saved[link.field.id] !== undefined) customValues[link.field.name] = saved[link.field.id]
    })
    return Object.assign(presentSummary(task, refs), {
      description: task.description || '',
      custom_values: customValues,
      checklist: task.checklist || [],
      parent: taskRef(refs.related[task.parentTaskId]),
      forked_from: taskRef(refs.related[task.forkedFromTaskId]),
      fields: links,
      capabilities: taskDomain.taskCapabilities(access, project, task),
    })
  }

  // ---------------------------------------------------------------- histórico legível

  function displayCustom(field, value, users) {
    if (value === null || value === undefined) return null
    const optionLabel = (id) => {
      const option = (field.options || []).find((o) => o.id === id)
      return option ? option.label : id
    }
    if (field.type === 'select') return optionLabel(value)
    if (field.type === 'multiselect') return value.map(optionLabel).join(', ')
    if (field.type === 'user') return users[value] ? users[value].name : value
    if (field.type === 'users') return value.map((id) => (users[id] ? users[id].name : id)).join(', ')
    if (field.type === 'image' || field.type === 'file') {
      const ids = Array.isArray(value) ? value : [value]
      const names = {}
      deps.attachmentRepository.findManyByIds(ids).forEach((a) => {
        names[a.id] = a.name
      })
      return ids.map((id) => names[id] || id).join(', ')
    }
    if (field.type === 'project') {
      const project = deps.projectRepository.findById(value)
      return project ? `${project.key} · ${project.name}` : value
    }
    return value
  }

  function snapshot(task, taskValues, links, refs) {
    const name = (map, id) => (id && map[id] ? map[id].name : null)
    const value = {
      title: task.title,
      description: truncate(task.description || '', 1000),
      task_type: name(refs.types, task.typeId),
      task_status: name(refs.statuses, task.statusId),
      task_priority: name(refs.priorities, task.priorityId),
      area: name(refs.areas, task.areaId),
      sprint: name(refs.sprints, task.sprintId),
      parent: task.parentTaskId ? taskLabel(refs.related[task.parentTaskId]) || task.parentTaskId : null,
      assignee: name(refs.users, task.assigneeId),
      reporter: name(refs.users, task.reporterId),
      start_date: dayOf(task.startDate),
      due_date: dayOf(task.dueDate),
      estimated_hours: task.estimatedHours === undefined ? null : task.estimatedHours,
      actual_hours: task.actualHours === undefined ? null : task.actualHours,
      tags: tagsOf(task, refs).map((tag) => tag.name).join(', ') || null,
      checklist: task.checklist && task.checklist.length ? taskDomain.checklistSummary(task.checklist) : null,
    }
    links.forEach((link) => {
      value[`cf:${link.field.label}`] = displayCustom(link.field, taskValues[link.field.id], refs.users)
    })
    return value
  }

  function changes(before, after) {
    const oldValue = {}
    const newValue = {}
    const keys = Object.keys(before).concat(Object.keys(after).filter((k) => !(k in before)))
    keys.forEach((key) => {
      const a = before[key] === undefined ? null : before[key]
      const b = after[key] === undefined ? null : after[key]
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        oldValue[key] = a
        newValue[key] = b
      }
    })
    return Object.keys(newValue).length > 0 ? { oldValue, newValue } : null
  }

  function userIdsInValues(links, taskValues) {
    const ids = []
    links.forEach((link) => {
      const v = taskValues[link.field.id]
      if (link.field.type === 'user' && v) ids.push(v)
      if (link.field.type === 'users' && Array.isArray(v)) v.forEach((id) => ids.push(id))
    })
    return ids
  }

  /** Usuários/projetos referenciados por campos personalizados precisam existir (e o projeto ser visível). */
  /** `taskId`: anexos de campos de imagem/arquivo precisam ser da própria tarefa (null na criação). */
  function assertReferences(ctx, links, newValues, previous, taskId) {
    const errors = {}
    links.forEach((link) => {
      const field = link.field
      const v = newValues[field.id]
      if (v === undefined || JSON.stringify(v) === JSON.stringify(previous[field.id])) return
      if (field.type === 'image' || field.type === 'file') {
        const ids = Array.isArray(v) ? v : [v]
        const found = taskId ? deps.attachmentRepository.findManyByIds(ids).filter((a) => a.taskId === taskId) : []
        const ok = found.length === ids.length && (field.type === 'file' || found.every((a) => a.kind === 'image'))
        if (!ok) errors[field.name] = 'invalid_option'
      }
      if (field.type === 'user' || field.type === 'users') {
        const ids = Array.isArray(v) ? v : [v]
        const found = deps.userRepository.findManyByIds(ids).filter((u) => u.status === 'active')
        if (found.length !== ids.length) errors[field.name] = 'invalid_option'
      }
      if (field.type === 'project') {
        const ref = projectAccess(ctx.principal, v)
        if (!ref.project || !ref.access.canView) errors[field.name] = 'invalid_option'
      }
    })
    if (Object.keys(errors).length > 0) throw invalid(customErrors(errors))
  }

  function audit(repos, ctx, task, action, oldValue, newValue) {
    repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'task', entityId: task.id, action, oldValue, newValue }))
  }

  // ---------------------------------------------------------------- casos de uso

  function listTasks(ctx, query) {
    rbac.assertCan(ctx.principal, 'tasks.view')
    const q = query || {}
    const pick = (key) => (q[key] === undefined || q[key] === '' ? undefined : q[key])
    const filters = assertValid(
      {
        project_id: pick('project_id'),
        task_type_id: pick('task_type_id'),
        status_id: pick('status_id'),
        priority_id: pick('priority_id'),
        assignee_id: pick('assignee_id'),
        search: pick('search'),
        category: pick('category'),
        tag_id: pick('tag_id'),
        sprint_id: pick('sprint_id'),
        in_report: pick('in_report'),
        it_visible: pick('it_visible'),
        urgency: pick('urgency'),
        area_id: pick('area_id'),
      },
      LIST_SCHEMA,
    )
    const pagination = parsePagination(q)
    if (!rbac.can(ctx.principal, 'projects.view')) return { items: [], meta: buildPageMeta(pagination, 0) }

    let statusIds = filters.status_id ? [filters.status_id] : null
    if (filters.category) {
      const categories = filters.category.split(',').map((c) => c.trim())
      const inCategory = deps.statusRepository
        .list({ includeInactive: true })
        .filter((s) => categories.indexOf(s.category) >= 0)
        .map((s) => s.id)
      statusIds = statusIds ? statusIds.filter((id) => inCategory.indexOf(id) >= 0) : inCategory
    }

    let search = null
    if (filters.search) {
      const fieldIds = deps.customFieldRepository
        .list({})
        .filter((f) => f.searchable && SEARCHABLE_TYPES.indexOf(f.type) >= 0)
        .map((f) => f.id)
      search = { text: filters.search, fieldIds }
    }

    const result = tasks.list({
      scope: { userId: ctx.principal.userId, viewAll: rbac.can(ctx.principal, 'projects.view_all') },
      projectId: filters.project_id,
      typeId: filters.task_type_id,
      statusIds,
      priorityId: filters.priority_id,
      assigneeId: filters.assignee_id === 'me' ? ctx.principal.userId : filters.assignee_id,
      tagId: filters.tag_id,
      sprintId: filters.sprint_id,
      inReport: filters.in_report === undefined ? undefined : filters.in_report === 'true',
      itVisible: filters.it_visible === undefined ? undefined : filters.it_visible === 'true',
      urgency: filters.urgency,
      areaId: filters.area_id,
      search,
      sort: parseSort(q.sort, SORTABLE, 'code'),
      pagination,
    })
    const refs = refsFor(result.items)
    return { items: result.items.map((t) => presentSummary(t, refs)), meta: buildPageMeta(pagination, result.total) }
  }

  function getTask(ctx, id) {
    const loaded = loadTask(ctx, id)
    return presentDetail(ctx, loaded.task, loaded.project, loaded.access)
  }

  /** `options.forkedFrom`: tarefa de origem (fork); `options.extras(repos, task, links)`: passos extras na transação. */
  function createTask(ctx, input, options) {
    const opts = options || {}
    const forkedFrom = opts.forkedFrom || null
    rbac.assertAuthenticated(ctx.principal)
    const raw = input || {}
    const parsed = parseInput(raw, false)
    const data = parsed.data
    const projectId = typeof raw.project_id === 'string' ? raw.project_id : ''
    if (!projectId) throw invalid({ project_id: 'required' })
    if (!data.task_type_id) throw invalid({ task_type_id: 'required' })

    const { project, access } = projectAccess(ctx.principal, projectId)
    if (!project) throw appError('PROJECT_NOT_FOUND')
    projectDomain.assertAccess(access, project, 'view')
    taskDomain.assertTaskAccess(access, project, 'create')

    const refs = lookups()
    const type = activeOrInvalid(refs.types[data.task_type_id], 'task_type_id')
    const status = data.status_id
      ? activeOrInvalid(refs.statuses[data.status_id], 'status_id')
      : Object.keys(refs.statuses).map((k) => refs.statuses[k]).find((s) => s.isDefault && s.isActive !== false)
    const priority = data.priority_id
      ? activeOrInvalid(refs.priorities[data.priority_id], 'priority_id')
      : Object.keys(refs.priorities).map((k) => refs.priorities[k]).find((p) => p.isDefault && p.isActive !== false)
    if (!status) throw invalid({ status_id: 'required' })
    if (!priority) throw invalid({ priority_id: 'required' })
    const area = data.area_id ? activeOrInvalid(refs.areas[data.area_id], 'area_id') : null

    if (data.assignee_id) {
      taskDomain.assertTaskAccess(access, project, 'assign')
      assertParticipant(project, data.assignee_id, 'assignee_id', false)
    }
    if (data.reporter_id) assertParticipant(project, data.reporter_id, 'reporter_id', true)
    if (data.sprint_id) assertSprint(project, data.sprint_id)
    if (data.parent_task_id) assertParent(project, null, data.parent_task_id)

    // valores padrão dos campos visíveis que não vieram no corpo
    const links = typeLinks(type.id)
    const rawValues = Object.assign({}, parsed.customValues || {})
    links.forEach((link) => {
      const def = link.field.default_value
      if (link.visible && rawValues[link.field.name] === undefined && def !== null && def !== undefined) rawValues[link.field.name] = def
    })
    const checked = taskDomain.validateCustomValues(links, rawValues, {}, status.id)
    if (Object.keys(checked.errors).length > 0) throw invalidCustom(checked.errors, status)
    assertReferences(ctx, links, checked.values, {}, null)
    const createDatesIssue = timelineDomain.datesIssue(data.start_date || null, data.due_date || null)
    if (createDatesIssue) throw invalid({ start_date: createDatesIssue })

    const now = deps.clock.now()
    const dates = taskDomain.statusDates({}, null, status.category, now)
    const created = deps.unitOfWork.run((repos) => {
      const number = repos.taskRepository.nextNumber(project.id)
      const task = repos.taskRepository.create({
        projectId: project.id,
        number,
        code: taskDomain.taskCode(project.key, number),
        title: data.title,
        description: data.description || '',
        typeId: type.id,
        statusId: status.id,
        priorityId: priority.id,
        creatorId: ctx.principal.userId,
        assigneeId: data.assignee_id || null,
        reporterId: data.reporter_id || ctx.principal.userId,
        parentTaskId: data.parent_task_id || null,
        forkedFromTaskId: forkedFrom ? forkedFrom.id : null,
        sprintId: data.sprint_id || null,
        areaId: area ? area.id : null,
        startDate: data.start_date || null,
        dueDate: data.due_date || null,
        estimatedHours: data.estimated_hours === undefined ? null : data.estimated_hours,
        actualHours: data.actual_hours === undefined ? null : data.actual_hours,
        startedAt: dates.startedAt,
        completedAt: dates.completedAt,
        checklist: parsed.checklist || [],
        // nova tarefa entra no fim da coluna do seu status
        position: (repos.taskRepository.maxPosition(project.id, status.id) || 0) + workflow.POSITION_STEP,
      })
      repos.taskValueRepository.replace(task.id, checked.values, typesOf(links))
      if (parsed.tagIds && parsed.tagIds.length > 0) repos.taskTagRepository.replace(task.id, parsed.tagIds)
      const withTags = Object.assign({}, task, { tagIds: parsed.tagIds || [] })
      const auditRefs = refsFor([withTags], userIdsInValues(links, checked.values))
      const after = snapshot(withTags, checked.values, links, auditRefs)
      audit(repos, ctx, task, 'task.created', null, Object.assign({ code: task.code }, forkedFrom ? { forked_from: taskLabel(forkedFrom) } : {}, compact(after)))
      notifier.notify(repos, { task, project, actorId: ctx.principal.userId, entries: [{ userId: task.assigneeId, type: 'assigned' }] })
      // fork: cópia de anexos/relações e histórico da origem, na mesma transação
      if (opts.extras) opts.extras(repos, task, links)
      return task
    })
    return presentDetail(ctx, created, project, access)
  }

  /** `options.position`: posição na coluna (moveTask e priorização do backlog); sem ela, troca de status vai para o fim. */
  function updateTask(ctx, id, input, options) {
    const { task, project, access } = loadTask(ctx, id)
    taskDomain.assertTaskAccess(access, project, 'edit', task)
    const raw = input || {}
    if (raw.project_id !== undefined && raw.project_id !== task.projectId) throw invalid({ project_id: 'immutable' })
    const parsed = parseInput(raw, true)
    const data = parsed.data
    const cleared = parsed.cleared
    const refs = lookups()

    const patch = {}
    if (data.title !== undefined) patch.title = data.title
    if (data.description !== undefined) patch.description = data.description
    if (data.task_type_id !== undefined && data.task_type_id !== task.typeId) patch.typeId = activeOrInvalid(refs.types[data.task_type_id], 'task_type_id').id
    if (data.status_id !== undefined && data.status_id !== task.statusId) patch.statusId = activeOrInvalid(refs.statuses[data.status_id], 'status_id').id
    if (data.priority_id !== undefined && data.priority_id !== task.priorityId) patch.priorityId = activeOrInvalid(refs.priorities[data.priority_id], 'priority_id').id
    const areaChange = cleared.indexOf('area_id') >= 0 ? null : data.area_id
    if (areaChange !== undefined && areaChange !== (task.areaId || null)) patch.areaId = areaChange ? activeOrInvalid(refs.areas[areaChange], 'area_id').id : null

    const assigneeChange = cleared.indexOf('assignee_id') >= 0 ? null : data.assignee_id
    if (assigneeChange !== undefined && assigneeChange !== (task.assigneeId || null)) {
      taskDomain.assertTaskAccess(access, project, 'assign', task)
      if (assigneeChange) assertParticipant(project, assigneeChange, 'assignee_id', false)
      patch.assigneeId = assigneeChange
    }
    const reporterChange = cleared.indexOf('reporter_id') >= 0 ? null : data.reporter_id
    if (reporterChange !== undefined && reporterChange !== (task.reporterId || null)) {
      if (reporterChange) assertParticipant(project, reporterChange, 'reporter_id', true)
      patch.reporterId = reporterChange
    }
    const sprintChange = cleared.indexOf('sprint_id') >= 0 ? null : data.sprint_id
    if (sprintChange !== undefined && sprintChange !== (task.sprintId || null)) {
      if (sprintChange) assertSprint(project, sprintChange)
      patch.sprintId = sprintChange
    }
    const parentChange = cleared.indexOf('parent_task_id') >= 0 ? null : data.parent_task_id
    if (parentChange !== undefined && parentChange !== (task.parentTaskId || null)) {
      if (parentChange) assertParent(project, task.id, parentChange)
      patch.parentTaskId = parentChange
    }
    if (cleared.indexOf('start_date') >= 0) patch.startDate = null
    else if (data.start_date !== undefined) patch.startDate = data.start_date
    if (cleared.indexOf('due_date') >= 0) patch.dueDate = null
    else if (data.due_date !== undefined) patch.dueDate = data.due_date
    const updateDatesIssue = timelineDomain.datesIssue(
      patch.startDate !== undefined ? patch.startDate : task.startDate || null,
      patch.dueDate !== undefined ? patch.dueDate : task.dueDate || null,
    )
    if (updateDatesIssue) throw invalid({ start_date: updateDatesIssue })
    ;['estimated_hours', 'actual_hours'].forEach((key) => {
      const target = key === 'estimated_hours' ? 'estimatedHours' : 'actualHours'
      if (cleared.indexOf(key) >= 0) patch[target] = null
      else if (data[key] !== undefined) patch[target] = data[key]
    })

    if (parsed.checklist !== undefined && JSON.stringify(parsed.checklist) !== JSON.stringify(task.checklist || [])) patch.checklist = parsed.checklist

    if (patch.statusId) {
      const from = refs.statuses[task.statusId]
      const to = refs.statuses[patch.statusId]
      // Usuário → Permissão → Projeto → Tarefa → Transição permitida (diretriz §32)
      if (!workflow.transitionAllowed(from, to)) throw appError('TRANSITION_NOT_ALLOWED', undefined, { from: from ? from.key : null, to: to.key })
      const dates = taskDomain.statusDates(task, from ? from.category : null, to.category, deps.clock.now())
      patch.startedAt = dates.startedAt
      patch.completedAt = dates.completedAt
      patch.position =
        options && options.position !== undefined ? options.position : (tasks.maxPosition(task.projectId, to.id) || 0) + workflow.POSITION_STEP
    } else if (options && options.position !== undefined) {
      // Backlog: priorizar e trocar de sprint na mesma operação
      patch.position = options.position
    }

    // campos personalizados: os do tipo final; valores de campos fora dele são descartados
    const typeId = patch.typeId || task.typeId
    const links = typeLinks(typeId)
    const previousLinks = patch.typeId ? typeLinks(task.typeId) : links
    const saved = values.listByTasks([task.id])[task.id] || {}
    const kept = {}
    links.forEach((link) => {
      if (saved[link.field.id] !== undefined) kept[link.field.id] = saved[link.field.id]
    })
    // obrigatórios do status em que a tarefa vai ficar (diretriz §9)
    const finalStatus = refs.statuses[patch.statusId || task.statusId] || null
    const checked = taskDomain.validateCustomValues(links, parsed.customValues || {}, kept, finalStatus ? finalStatus.id : null)
    if (Object.keys(checked.errors).length > 0) throw invalidCustom(checked.errors, finalStatus)
    assertReferences(ctx, links, checked.values, saved, task.id)
    const valuesChanged = JSON.stringify(checked.values) !== JSON.stringify(saved)

    const currentTags = deps.taskTagRepository.listByTasks([task.id])[task.id] || []
    const nextTags = parsed.tagIds === undefined ? currentTags : parsed.tagIds
    const tagsChanged = currentTags.slice().sort().join(',') !== nextTags.slice().sort().join(',')

    const before = Object.assign({}, task, { tagIds: currentTags })
    const next = Object.assign({}, task, patch, { tagIds: nextTags })
    const userIds = userIdsInValues(previousLinks, saved).concat(userIdsInValues(links, checked.values))
    const auditRefs = refsFor([before, next], userIds)
    const change = changes(snapshot(before, saved, previousLinks, auditRefs), snapshot(next, checked.values, links, auditRefs))
    if (!change) return presentDetail(ctx, task, project, access)

    const updated = deps.unitOfWork.run((repos) => {
      // atualizar a tarefa mesmo sem mudança de coluna própria renova o "updated" (ordenação por atividade)
      const result = repos.taskRepository.update(task.id, patch)
      if (tagsChanged) repos.taskTagRepository.replace(task.id, nextTags)
      if (valuesChanged) repos.taskValueRepository.replace(task.id, checked.values, typesOf(links))
      audit(repos, ctx, task, 'task.updated', change.oldValue, change.newValue)
      if (patch.assigneeId) notifier.notify(repos, { task: result, project, actorId: ctx.principal.userId, entries: [{ userId: patch.assigneeId, type: 'assigned' }] })
      if (patch.statusId) {
        notifier.notify(repos, {
          task: result,
          project,
          actorId: ctx.principal.userId,
          entries: [
            { userId: result.assigneeId, type: 'status_changed' },
            { userId: result.creatorId, type: 'status_changed' },
          ],
          data: { status: refs.statuses[patch.statusId] ? refs.statuses[patch.statusId].name : '' },
        })
      }
      return result
    })
    return presentDetail(ctx, updated, project, access)
  }

  /**
   * Liga/desliga a tarefa no informe do projeto (aba Informe). Não passa pela edição completa:
   * não exige os obrigatórios do status nem renova o "updated" de outros campos.
   */
  function setTaskReport(ctx, id, input) {
    const { task, project, access } = loadTask(ctx, id)
    taskDomain.assertTaskAccess(access, project, 'edit', task)
    const value = (input || {}).in_report
    if (typeof value !== 'boolean') throw invalid({ in_report: 'invalid_type' })
    if (value === !task.reportExcluded) return presentDetail(ctx, task, project, access)
    const updated = deps.unitOfWork.run((repos) => {
      const result = repos.taskRepository.update(task.id, { reportExcluded: !value })
      audit(repos, ctx, task, 'task.updated', { in_report: !value }, { in_report: value })
      return result
    })
    return presentDetail(ctx, updated, project, access)
  }

  /** Urgência (semáforo alta/média/baixa ou nenhuma): muda direto da lista, sem exigir os campos do status. */
  function setTaskUrgency(ctx, id, input) {
    const { task, project, access } = loadTask(ctx, id)
    taskDomain.assertTaskAccess(access, project, 'edit', task)
    const raw = (input || {}).urgency
    if (raw !== null && taskDomain.URGENCY_LEVELS.indexOf(raw) < 0) throw invalid({ urgency: 'invalid_option' })
    const before = task.urgency || null
    if (raw === before) return presentDetail(ctx, task, project, access)
    const updated = deps.unitOfWork.run((repos) => {
      const result = repos.taskRepository.update(task.id, { urgency: raw })
      audit(repos, ctx, task, 'task.updated', { urgency: before }, { urgency: raw })
      return result
    })
    return presentDetail(ctx, updated, project, access)
  }

  /** Marca a tarefa como visível para o Responsável TI do projeto (§24), direto da lista. */
  function setTaskItVisible(ctx, id, input) {
    const { task, project, access } = loadTask(ctx, id)
    taskDomain.assertTaskAccess(access, project, 'edit', task)
    if (access.scoped) throw appError('FORBIDDEN')
    const value = (input || {}).it_visible
    if (typeof value !== 'boolean') throw invalid({ it_visible: 'invalid_type' })
    if (value === !!task.itVisible) return presentDetail(ctx, task, project, access)
    const updated = deps.unitOfWork.run((repos) => {
      const result = repos.taskRepository.update(task.id, { itVisible: value })
      audit(repos, ctx, task, 'task.updated', { it_visible: !value }, { it_visible: value })
      return result
    })
    return presentDetail(ctx, updated, project, access)
  }

  /** Área responsável: muda direto da lista (como a urgência), sem exigir os campos do status; `null` limpa. */
  function setTaskArea(ctx, id, input) {
    const { task, project, access } = loadTask(ctx, id)
    taskDomain.assertTaskAccess(access, project, 'edit', task)
    const raw = (input || {}).area_id
    if (raw !== null && typeof raw !== 'string') throw invalid({ area_id: 'invalid_type' })
    const before = task.areaId || null
    if ((raw || null) === before) return presentDetail(ctx, task, project, access)
    const areas = lookups().areas
    const next = raw ? activeOrInvalid(areas[raw], 'area_id').id : null
    const label = (areaId) => (areaId && areas[areaId] ? areas[areaId].name : null)
    const updated = deps.unitOfWork.run((repos) => {
      const result = repos.taskRepository.update(task.id, { areaId: next })
      audit(repos, ctx, task, 'task.updated', { area: label(before) }, { area: label(next) })
      return result
    })
    return presentDetail(ctx, updated, project, access)
  }

  function deleteTask(ctx, id) {
    const { task, project, access } = loadTask(ctx, id)
    taskDomain.assertTaskAccess(access, project, 'delete', task)
    deps.unitOfWork.run((repos) => {
      repos.taskRepository.listChildren(task.id).forEach((child) => {
        repos.taskRepository.update(child.id, { parentTaskId: null })
        audit(repos, ctx, child, 'task.updated', { parent: taskLabel(task) }, { parent: null })
      })
      repos.relationRepository.listByTask(task.id).forEach((rel) => {
        const otherId = rel.sourceId === task.id ? rel.targetId : rel.sourceId
        audit(repos, ctx, { id: otherId }, 'task.unlinked', { [`rel:${relationDomain.viewType(rel, otherId)}`]: taskLabel(task) }, null)
      })
      repos.relationRepository.deleteByTask(task.id)
      repos.taskRepository.delete(task.id)
      audit(repos, ctx, task, 'task.deleted', { code: task.code, title: task.title }, null)
    })
    return { deleted: true }
  }

  /**
   * Kanban: move a tarefa para `status_id` entre `prev_id` (card acima) e `next_id` (card abaixo).
   * Mudar de coluna segue as regras de edição (transição, datas, histórico, notificações);
   * reordenar dentro da mesma coluna só muda a posição (sem histórico).
   */
  function moveTask(ctx, id, input) {
    const { task, project, access } = loadTask(ctx, id)
    taskDomain.assertTaskAccess(access, project, 'edit', task)
    const raw = input || {}
    const statusId = typeof raw.status_id === 'string' && raw.status_id ? raw.status_id : task.statusId

    const neighbor = (key) => {
      const neighborId = raw[key]
      if (typeof neighborId !== 'string' || !neighborId || neighborId === task.id) return null
      const found = tasks.findById(neighborId)
      return found && found.projectId === task.projectId && found.statusId === statusId ? found : null
    }
    const place = () => {
      const prev = neighbor('prev_id')
      const next = neighbor('next_id')
      return workflow.positionBetween(prev ? prev.position : null, next ? next.position : null, tasks.maxPosition(task.projectId, statusId))
    }
    let position = place()
    if (position === null) {
      // sem espaço entre os vizinhos: renumera a coluna e calcula de novo
      deps.unitOfWork.run((repos) => repos.taskRepository.renumber(task.projectId, statusId))
      position = place()
    }

    if (statusId !== task.statusId) return updateTask(ctx, id, { status_id: statusId }, { position })
    const moved = deps.unitOfWork.run((repos) => repos.taskRepository.update(task.id, { position }))
    return presentDetail(ctx, moved, project, access)
  }

  /** Resumos de tarefas (usado pelo quadro Kanban). */
  function summarize(list) {
    const refs = refsFor(list)
    return list.map((t) => presentSummary(t, refs))
  }

  return { listTasks, getTask, createTask, updateTask, setTaskReport, setTaskItVisible, setTaskUrgency, setTaskArea, deleteTask, moveTask, summarize }
}

/** Tipo de cada campo (a infraestrutura usa para indexar o valor na coluna certa). */
function typesOf(links) {
  const map = {}
  links.forEach((link) => {
    map[link.field.id] = link.field.type
  })
  return map
}

/** Remove chaves vazias (o registro de criação mostra só o que foi preenchido). */
function compact(value) {
  const out = {}
  Object.keys(value).forEach((key) => {
    const v = value[key]
    if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) out[key] = v
  })
  return out
}

module.exports = { createTaskService }
