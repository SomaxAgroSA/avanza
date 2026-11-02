/**
 * Ficha do projeto (regras de negócio §30): objetivo geral, objetivos, funcionalidades, escopo e
 * resultados esperados, com o avanço calculado em domain/charter.js.
 *
 * - Ver: quem vê o projeto (os dados das tarefas vinculadas só com `tasks.view`).
 * - Editar a estrutura: gestor ou dono (`projects.edit` + gestor, projeto não arquivado), como os marcos.
 * - Registrar medição de um resultado: quem edita ou o responsável pelo resultado.
 * - Anti-IDOR: item de projeto que a pessoa não vê responde CHARTER_ITEM_NOT_FOUND.
 * - Histórico: no próprio projeto (entity_type = project), ações charter.* e charter_item.*.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const charter = require('../domain/charter')
const { buildAuditEntry } = require('./audit')
const { iso, toUserSummary } = require('./presenters')
const { createTaskService } = require('./tasks')

const MAX_MEASUREMENTS = 500

const number = () => (value) => (typeof value === 'number' && isFinite(value) ? { value } : { error: 'invalid_type' })
const dayOf = (date) => date.toISOString().slice(0, 10)

/** Campos que cada tipo de item aceita (os demais são ignorados). */
const FIELDS_BY_KIND = {
  objective: ['title', 'description', 'state', 'owner_id', 'link_ids'],
  feature: ['title', 'description', 'state', 'owner_id', 'task_ids'],
  scope_in: ['title', 'description'],
  scope_out: ['title', 'description'],
  result: ['title', 'description', 'owner_id', 'unit', 'baseline', 'target', 'start_date', 'due_date', 'frequency'],
}
const NULLABLE = ['owner_id', 'start_date', 'due_date']

function rulesFor(kind) {
  return {
    title: [rules.required(), rules.string(), rules.maxLength(charter.TITLE_MAX)],
    description: [rules.string(), rules.maxLength(charter.DESCRIPTION_MAX)],
    state: [rules.oneOf(kind === 'objective' ? charter.OBJECTIVE_STATES : charter.FEATURE_STATES)],
    owner_id: [rules.string()],
    link_ids: [rules.stringArray(charter.MAX_LINKS)],
    task_ids: [rules.stringArray(charter.MAX_TASKS)],
    unit: [rules.string(), rules.maxLength(charter.UNIT_MAX)],
    baseline: [number()],
    target: kind === 'result' ? [rules.required(), number()] : [number()],
    start_date: [rules.isoDate()],
    due_date: [rules.isoDate()],
    frequency: [rules.oneOf(charter.FREQUENCIES)],
  }
}

const invalid = (fields) => appError('VALIDATION_ERROR', undefined, { fields })
const unique = (list) => list.filter((value, index) => list.indexOf(value) === index)

function createCharterService(deps) {
  const items = deps.charterItemRepository
  const taskService = createTaskService(deps)

  async function accessOf(ctx, project) {
    return projectDomain.resolveAccess(ctx.principal, project, await deps.projectMemberRepository.find(project.id, ctx.principal.userId))
  }

  async function projectAccess(ctx, projectId) {
    rbac.assertAuthenticated(ctx.principal)
    const project = projectId ? await deps.projectRepository.findById(projectId) : null
    if (!project) throw appError('PROJECT_NOT_FOUND')
    const access = await accessOf(ctx, project)
    projectDomain.assertAccess(access, project, 'view')
    return { project, access }
  }

  async function load(ctx, id) {
    rbac.assertAuthenticated(ctx.principal)
    const item = id ? await items.findById(id) : null
    const project = item ? await deps.projectRepository.findById(item.projectId) : null
    if (!item || !project) throw appError('CHARTER_ITEM_NOT_FOUND')
    const access = await accessOf(ctx, project)
    if (!access.canView) throw appError('CHARTER_ITEM_NOT_FOUND')
    return { item, project, access }
  }

  const today = () => dayOf(deps.clock.now())

  async function audit(repos, ctx, project, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'project', entityId: project.id, action, oldValue, newValue }))
  }

  /** Responsável precisa ser o dono ou membro do projeto. */
  async function assertOwner(project, userId) {
    if (!userId || userId === project.ownerId) return
    if (!(await deps.projectMemberRepository.find(project.id, userId))) throw invalid({ owner_id: 'not_member' })
  }

  /** Tarefas vinculadas: todas existem e são do projeto (uma consulta só). */
  async function assertTasks(project, ids) {
    if (ids.length === 0) return
    const found = (await deps.taskRepository.findManyByIds(ids)).filter((task) => task.projectId === project.id)
    if (found.length !== ids.length) throw invalid({ task_ids: 'not_in_project' })
  }

  /** Vínculos do objetivo: funcionalidades e resultados do mesmo projeto (nunca o próprio item). */
  async function assertLinks(project, ids, selfId) {
    if (ids.length === 0) return
    const byId = {}
    ;(await items.listByProject(project.id)).forEach((item) => {
      byId[item.id] = item
    })
    ids.forEach((id) => {
      const target = byId[id]
      if (!target || id === selfId || (target.kind !== 'feature' && target.kind !== 'result')) throw invalid({ link_ids: 'invalid_link' })
    })
  }

  /** Valida o corpo para o tipo do item; `partial` = só os campos enviados (edição). */
  function parse(kind, input, partial) {
    const source = input || {}
    const allowed = FIELDS_BY_KIND[kind]
    const all = rulesFor(kind)
    const schema = {}
    const cleared = {}
    allowed.forEach((key) => {
      if (NULLABLE.indexOf(key) >= 0 && (source[key] === null || source[key] === '')) {
        if (source[key] !== undefined) cleared[key] = true
        return
      }
      if (!partial || source[key] !== undefined) schema[key] = all[key]
    })
    const data = assertValid(source, schema)
    const out = {}
    if (data.title !== undefined) out.title = data.title
    if (data.description !== undefined) out.description = data.description
    if (data.state !== undefined) out.state = data.state
    if (data.owner_id !== undefined) out.ownerId = data.owner_id || null
    if (cleared.owner_id) out.ownerId = null
    if (data.link_ids !== undefined) out.linkIds = unique(data.link_ids)
    if (data.task_ids !== undefined) out.taskIds = unique(data.task_ids)
    if (data.unit !== undefined) out.unit = data.unit
    if (data.baseline !== undefined) out.baseline = data.baseline
    if (data.target !== undefined) out.target = data.target
    if (data.start_date !== undefined) out.startDate = dayOf(data.start_date)
    if (cleared.start_date) out.startDate = null
    if (data.due_date !== undefined) out.dueDate = dayOf(data.due_date)
    if (cleared.due_date) out.dueDate = null
    if (data.frequency !== undefined) out.frequency = data.frequency
    return out
  }

  async function checkRefs(project, patch, selfId) {
    if (patch.ownerId) await assertOwner(project, patch.ownerId)
    if (patch.taskIds) await assertTasks(project, patch.taskIds)
    if (patch.linkIds) await assertLinks(project, patch.linkIds, selfId)
    const start = patch.startDate
    const due = patch.dueDate
    if (start && due && start > due) throw invalid({ start_date: 'after_due_date' })
  }

  const snapshot = (item) => {
    const out = { kind: item.kind, title: item.title }
    ;['description', 'state', 'unit', 'frequency'].forEach((key) => {
      if (item[key]) out[key] = item[key]
    })
    if (item.ownerId) out.owner_id = item.ownerId
    if (item.taskIds && item.taskIds.length) out.task_ids = item.taskIds
    if (item.linkIds && item.linkIds.length) out.link_ids = item.linkIds
    ;['baseline', 'target'].forEach((key) => {
      if (typeof item[key] === 'number') out[key] = item[key]
    })
    if (item.startDate) out.start_date = item.startDate
    if (item.dueDate) out.due_date = item.dueDate
    return out
  }

  function presentItem(item, refs) {
    const owner = item.ownerId ? refs.users[item.ownerId] : null
    const base = {
      id: item.id,
      project_id: item.projectId,
      kind: item.kind,
      title: item.title,
      description: item.description || '',
      position: item.position || 0,
      owner: owner ? toUserSummary(owner) : null,
      created_at: iso(item.createdAt),
      updated_at: iso(item.updatedAt),
    }
    if (item.kind === 'objective') {
      base.state = item.state || 'auto'
      base.effective_state = item.effectiveState
      base.link_ids = (item.linkIds || []).filter((id) => refs.itemIds[id])
    }
    if (item.kind === 'feature') {
      base.state = item.state || 'auto'
      base.effective_state = item.effectiveState
      base.progress = { done: item.progress.done, total: item.progress.total }
      base.task_ids = (item.taskIds || []).filter((id) => refs.tasks[id])
      base.tasks = refs.canViewTasks ? base.task_ids.map((id) => refs.tasks[id].summary) : []
    }
    if (item.kind === 'result') {
      Object.assign(base, {
        unit: item.unit || '',
        baseline: typeof item.baseline === 'number' ? item.baseline : 0,
        target: item.target,
        current: typeof item.current === 'number' ? item.current : null,
        start_date: item.startDate || null,
        due_date: item.dueDate || null,
        frequency: item.frequency || 'none',
        measured_at: item.measuredAt || null,
        situation: item.situation,
        percent: item.percent,
        stale: !!item.stale,
      })
    }
    return base
  }

  async function getCharter(ctx, projectId) {
    const { project, access } = await projectAccess(ctx, projectId)
    const record = await deps.charterRepository.findByProject(project.id)
    const list = await items.listByProject(project.id)

    // tarefas vinculadas que ainda existem no projeto, lidas de uma vez (as demais ficam de fora)
    const linkedIds = unique([].concat(...list.map((item) => item.taskIds || [])))
    const tasks = {}
    if (linkedIds.length) {
      const found = (await deps.taskRepository.findManyByIds(linkedIds)).filter((t) => t.projectId === project.id)
      ;(await taskService.summarize(found)).forEach((summary) => {
        tasks[summary.id] = { summary, category: summary.status ? summary.status.category : null, due: summary.due_date ? summary.due_date.slice(0, 10) : null }
      })
    }
    const objective = record ? record.objective || '' : ''
    const now = today()
    // tarefa atrasada: aberta (nem concluída nem cancelada) com o prazo antes de hoje
    const overdue = (task) => task.category !== 'done' && task.category !== 'cancelled' && !!task.due && task.due < now
    const overdueOf = (ids) => ids.filter((id) => tasks[id] && overdue(tasks[id])).length
    const evaluated = charter.evaluate(objective, list, (ids) => ids.filter((id) => tasks[id]).map((id) => tasks[id].category), now, overdueOf)

    const userIds = unique(list.map((i) => i.ownerId).concat(record && record.updatedBy ? [record.updatedBy] : []).filter(Boolean))
    const users = {}
    ;(userIds.length ? await deps.userRepository.findManyByIds(userIds) : []).forEach((u) => {
      users[u.id] = u
    })
    const itemIds = {}
    list.forEach((i) => {
      if (i.kind === 'feature' || i.kind === 'result') itemIds[i.id] = true
    })
    const refs = { users, tasks, itemIds, canViewTasks: rbac.can(ctx.principal, 'tasks.view') }
    const updatedBy = record && record.updatedBy ? users[record.updatedBy] : null
    const lastChange = [record ? record.updatedAt : null]
      .concat(list.map((i) => i.updatedAt))
      .filter(Boolean)
      .sort((a, b) => b - a)[0]

    return {
      project_id: project.id,
      objective,
      updated_at: iso(lastChange || null),
      updated_by: updatedBy ? toUserSummary(updatedBy) : null,
      capabilities: { edit: access.canEdit },
      completeness: evaluated.completeness,
      summary: evaluated.summary,
      items: evaluated.items.map((item) => presentItem(item, refs)),
    }
  }

  async function updateCharter(ctx, projectId, input) {
    const { project, access } = await projectAccess(ctx, projectId)
    projectDomain.assertAccess(access, project, 'edit')
    const data = assertValid(input || {}, { objective: [rules.required(), rules.string(), rules.maxLength(charter.OBJECTIVE_MAX)] })
    const record = await deps.charterRepository.findByProject(project.id)
    const before = record ? record.objective || '' : ''
    if (before !== data.objective) {
      await deps.unitOfWork.run(async (repos) => {
        await repos.charterRepository.upsert(project.id, { objective: data.objective, updatedBy: ctx.principal.userId })
        await audit(repos, ctx, project, 'charter.updated', { objective: before }, { objective: data.objective })
      })
    }
    return getCharter(ctx, project.id)
  }

  async function findItem(ctx, id) {
    const { item, project } = await load(ctx, id)
    return (await getCharter(ctx, project.id)).items.filter((i) => i.id === item.id)[0]
  }

  async function createItem(ctx, projectId, input) {
    const { project, access } = await projectAccess(ctx, projectId)
    projectDomain.assertAccess(access, project, 'edit')
    const kind = (input || {}).kind
    if (charter.KINDS.indexOf(kind) < 0) throw invalid({ kind: kind ? 'invalid_option' : 'required' })
    const data = parse(kind, input, false)
    await checkRefs(project, data, null)
    const existing = await items.listByProject(project.id)
    if (existing.length >= charter.MAX_ITEMS) throw invalid({ kind: 'too_many' })
    const position = existing.filter((i) => i.kind === kind).reduce((max, i) => Math.max(max, i.position || 0), 0) + 1
    const created = await deps.unitOfWork.run(async (repos) => {
      const item = await repos.charterItemRepository.create(
        Object.assign(
          { projectId: project.id, kind, description: '', state: kind === 'objective' || kind === 'feature' ? 'auto' : '', position, createdBy: ctx.principal.userId },
          kind === 'result' ? { baseline: 0, frequency: 'none', unit: '' } : {},
          data,
        ),
      )
      await audit(repos, ctx, project, 'charter_item.created', null, snapshot(item))
      return item
    })
    return findItem(ctx, created.id)
  }

  async function updateItem(ctx, id, input) {
    const { item, project, access } = await load(ctx, id)
    projectDomain.assertAccess(access, project, 'edit')
    const patch = parse(item.kind, input, true)
    const merged = Object.assign({}, item, patch)
    await checkRefs(project, Object.assign({}, patch, { startDate: merged.startDate, dueDate: merged.dueDate }), item.id)
    const before = snapshot(item)
    const after = snapshot(merged)
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await deps.unitOfWork.run(async (repos) => {
        await repos.charterItemRepository.update(item.id, patch)
        await audit(repos, ctx, project, 'charter_item.updated', before, after)
      })
    }
    return findItem(ctx, item.id)
  }

  async function deleteItem(ctx, id) {
    const { item, project, access } = await load(ctx, id)
    projectDomain.assertAccess(access, project, 'edit')
    await deps.unitOfWork.run(async (repos) => {
      await repos.charterItemRepository.delete(item.id)
      await audit(repos, ctx, project, 'charter_item.deleted', snapshot(item), null)
    })
    return { deleted: true }
  }

  /** Muda a ordem dos itens de um tipo: `ids` na ordem nova (só itens do projeto e do mesmo tipo). */
  async function reorderItems(ctx, projectId, input) {
    const { project, access } = await projectAccess(ctx, projectId)
    projectDomain.assertAccess(access, project, 'edit')
    const data = assertValid(input || {}, { kind: [rules.required(), rules.oneOf(charter.KINDS)], ids: [rules.required(), rules.stringArray(charter.MAX_ITEMS)] })
    const current = (await items.listByProject(project.id)).filter((i) => i.kind === data.kind)
    const known = {}
    current.forEach((i) => {
      known[i.id] = i
    })
    const ids = unique(data.ids)
    if (ids.length !== current.length || ids.some((id) => !known[id])) throw invalid({ ids: 'invalid_order' })
    await deps.unitOfWork.run(async (repos) => {
      for (const [index, id] of ids.entries()) {
        if (known[id].position !== index + 1) await repos.charterItemRepository.update(id, { position: index + 1 })
      }
      await audit(repos, ctx, project, 'charter_item.reordered', null, { kind: data.kind })
    })
    return getCharter(ctx, project.id)
  }

  function presentMeasurement(m, users) {
    const author = m.createdBy ? users[m.createdBy] : null
    return { id: m.id, item_id: m.itemId, value: m.value, note: m.note || '', measured_at: m.measuredAt, created_by: author ? toUserSummary(author) : null, created_at: iso(m.createdAt) }
  }

  async function loadResult(ctx, id) {
    const loaded = await load(ctx, id)
    if (loaded.item.kind !== 'result') throw appError('CHARTER_ITEM_NOT_FOUND')
    return loaded
  }

  async function listMeasurements(ctx, id) {
    const { item } = await loadResult(ctx, id)
    const list = await deps.charterMeasurementRepository.listByItem(item.id, MAX_MEASUREMENTS)
    const authorIds = unique(list.map((m) => m.createdBy).filter(Boolean))
    const users = {}
    ;(authorIds.length ? await deps.userRepository.findManyByIds(authorIds) : []).forEach((u) => {
      users[u.id] = u
    })
    return list.map((m) => presentMeasurement(m, users))
  }

  async function addMeasurement(ctx, id, input) {
    const { item, project, access } = await loadResult(ctx, id)
    const isOwner = !!item.ownerId && item.ownerId === ctx.principal.userId && !project.archivedAt
    if (!isOwner) projectDomain.assertAccess(access, project, 'edit')
    const data = assertValid(input || {}, {
      value: [rules.required(), number()],
      note: [rules.string(), rules.maxLength(charter.NOTE_MAX)],
      measured_at: [rules.isoDate()],
    })
    const measuredAt = data.measured_at ? dayOf(data.measured_at) : today()
    if (measuredAt > today()) throw invalid({ measured_at: 'in_future' })
    const latest = !item.measuredAt || measuredAt >= item.measuredAt
    await deps.unitOfWork.run(async (repos) => {
      await repos.charterMeasurementRepository.create({ projectId: project.id, itemId: item.id, value: data.value, note: data.note || '', measuredAt, createdBy: ctx.principal.userId })
      if (latest) await repos.charterItemRepository.update(item.id, { current: data.value, measuredAt })
      await audit(
        repos,
        ctx,
        project,
        'charter_item.measured',
        { title: item.title, current: typeof item.current === 'number' ? item.current : null },
        { title: item.title, value: data.value, measured_at: measuredAt },
      )
    })
    return findItem(ctx, item.id)
  }

  return { getCharter, updateCharter, createItem, updateItem, deleteItem, reorderItems, listMeasurements, addMeasurement }
}

module.exports = { createCharterService }
