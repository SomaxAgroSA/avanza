/**
 * Base compartilhada do quadro do projeto (Gerenciamento de Projetos): acesso e permissões,
 * apresentação, histórico legível e validação das referências do elemento (inclusive os valores das
 * colunas personalizadas da GP-5). Usada pelos casos de uso do quadro (plan.js, plan-interaction.js,
 * plan-collaboration.js, plan-management.js e plan-columns.js).
 */

const { appError } = require('../core/errors')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const planDomain = require('../domain/plan')
const linkDomain = require('../domain/plan-links')
const columnsDomain = require('../domain/plan-columns')
const { buildAuditEntry } = require('./audit')
const { iso, toUserSummary } = require('./presenters')

/** Acima disso a tela avisa que mostra só os primeiros. */
const MAX_ITEMS = 3000
const DEFAULT_RESOURCE_COLOR = 'indigo'

function invalid(fields) {
  return appError('VALIDATION_ERROR', undefined, { fields })
}

const idOf = (value) => (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : null)

function presentStatus(s) {
  return { id: s.id, name: s.name, color: s.color, category: s.category, position: s.position }
}

function presentResource(r) {
  return { id: r.id, name: r.name, color: r.color || DEFAULT_RESOURCE_COLOR }
}

/** Dependência entre elementos: `blocks` = from bloqueia to; `relates` = relacionados. */
function presentLink(l) {
  return { id: l.id, from_id: l.fromId, to_id: l.toId, type: l.type }
}

function indexBy(list) {
  const map = {}
  list.forEach((x) => {
    map[x.id] = x
  })
  return map
}

const metric = (item, key) => (item.metrics && typeof item.metrics[key] === 'number' ? item.metrics[key] : null)

/** Coluna personalizada do quadro (GP-5). */
function presentColumn(c) {
  return { id: c.id, name: c.name, type: c.type, settings: c.settings || {}, position: c.position }
}

/** Totais (do grupo ou do quadro inteiro) com as datas em ISO. */
function presentSummary(summary) {
  return summary ? Object.assign({}, summary, { start_date: iso(summary.start_date), end_date: iso(summary.end_date) }) : null
}

function createPlanSupport(deps) {
  const groups = deps.projectGroupRepository
  const statuses = deps.planStatusRepository
  const resources = deps.planResourceRepository
  const items = deps.planItemRepository

  /* ------------------------------------------------------------------ acesso */

  async function capabilities(access, project, principal) {
    const view = access.canView && rbac.can(principal, 'plan.view')
    const contributor = access.isManager || access.role === 'member'
    const open = !project.archivedAt
    return {
      view,
      edit: view && open && contributor && rbac.can(principal, 'plan.edit'),
      manage: view && open && access.isManager && rbac.can(principal, 'plan.manage'),
    }
  }

  async function canFor(ctx, project) {
    const access = projectDomain.resolveAccess(ctx.principal, project, await deps.projectMemberRepository.find(project.id, ctx.principal.userId))
    return await capabilities(access, project, ctx.principal)
  }

  async function loadProject(ctx, projectId) {
    rbac.assertAuthenticated(ctx.principal)
    const project = projectId ? await deps.projectRepository.findById(projectId) : null
    if (!project) throw appError('PROJECT_NOT_FOUND')
    const can = await canFor(ctx, project)
    if (!can.view) throw appError('PROJECT_NOT_FOUND')
    return { project, can }
  }

  /** Um registro do quadro que a pessoa vê (senão `notFound`). */
  async function loadOwned(ctx, repo, id, notFound) {
    rbac.assertAuthenticated(ctx.principal)
    const record = id ? await repo.findById(id) : null
    const project = record ? await deps.projectRepository.findById(record.projectId) : null
    if (!record || !project) throw appError(notFound)
    const can = await canFor(ctx, project)
    if (!can.view) throw appError(notFound)
    return { record, project, can }
  }

  async function assertCan(can, project, action) {
    if (can[action]) return
    throw appError(project.archivedAt ? 'PROJECT_ARCHIVED' : 'FORBIDDEN')
  }

  async function audit(repos, ctx, entityType, entityId, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType, entityId, action, oldValue, newValue }))
  }

  /** Quadro novo nasce com as etiquetas de status iniciais (como no Monday). */
  async function ensureStatuses(project) {
    const list = await statuses.listByProject(project.id)
    if (list.length > 0) return list
    return await deps.unitOfWork.run(async (repos) => {
      const created = []
      for (const s of planDomain.defaultStatuses(deps.locale)) created.push(await repos.planStatusRepository.create(Object.assign({ projectId: project.id }, s)))
      return created
    })
  }

  /* ------------------------------------------------------------------ dependências (GP-2) */

  /** Configuração do quadro (sem registro = padrão): regra de dependência e linha de base (GP-4). */
  async function settingsOf(project) {
    const saved = await deps.planSettingsRepository.findByProject(project.id)
    return {
      dependencyRule: saved && saved.dependencyRule ? saved.dependencyRule : linkDomain.DEFAULT_DEPENDENCY_RULE,
      baseline: saved && saved.baseline ? saved.baseline : null,
    }
  }

  /** Elementos com dependência pendente (quem os bloqueia ainda não foi encerrado): { id: true }. */
  async function pendingMap(list, links, categoryOf) {
    const byId = indexBy(list)
    const closed = (id) => !!byId[id] && linkDomain.isClosedCategory(categoryOf(byId[id]))
    const out = {}
    links.forEach((l) => {
      if (l.type === 'blocks' && byId[l.toId] && !closed(l.fromId)) out[l.toId] = true
    })
    return out
  }

  /**
   * Regra "impedir" do quadro: iniciar ou concluir (status novo) elemento que depende de outro ainda
   * aberto → PLAN_DEPENDENCY_PENDING com os nomes. Com a regra "só sinalizar", nada acontece.
   */
  async function assertDependencies(project, list, statusId) {
    if (!statusId || list.length === 0 || (await settingsOf(project)).dependencyRule !== 'block') return
    const links = await deps.planLinkRepository.listByProject(project.id)
    const ids = list.map((i) => i.id)
    if (!links.some((l) => l.type === 'blocks' && ids.indexOf(l.toId) >= 0)) return
    const statusById = indexBy(await statuses.listByProject(project.id))
    const categoryOf = (item) => (item && item.statusId && statusById[item.statusId] ? statusById[item.statusId].category : null)
    const target = statusById[statusId] ? statusById[statusId].category : null
    const blocked = []
    for (const item of list) {
      if (!linkDomain.gatesDependency(categoryOf(item), target)) continue
      // quem bloqueia o elemento é lido antes (a consulta do domínio é síncrona)
      const closed = {}
      for (const l of links) {
        if (l.type === 'blocks' && l.toId === item.id && !(l.fromId in closed)) closed[l.fromId] = linkDomain.isClosedCategory(categoryOf(await items.findById(l.fromId)))
      }
      if (linkDomain.pendingBlockers(item.id, links, (id) => closed[id]).length > 0) blocked.push(item)
    }
    if (blocked.length) throw appError('PLAN_DEPENDENCY_PENDING', undefined, { items: blocked.map((i) => i.name) })
  }

  /* ------------------------------------------------------------------ apresentação */

  async function usersOf(list) {
    const ids = list.map((i) => i.ownerId).filter((id, i, all) => id && all.indexOf(id) === i)
    return indexBy(ids.length ? await deps.userRepository.findManyByIds(ids) : [])
  }

  /** `columns`: colunas personalizadas do quadro (os valores só valem para elementos). */
  async function presentItem(item, progress, users, childCount, columns) {
    const owner = item.ownerId && users[item.ownerId] ? toUserSummary(users[item.ownerId]) : null
    return {
      id: item.id,
      group_id: item.groupId,
      parent_id: item.parentId || null,
      name: item.name,
      status_id: item.statusId || null,
      start_date: item.startDate || null,
      end_date: item.endDate || null,
      due_date: item.dueDate || null,
      owner,
      resource_ids: item.resourceIds || [],
      estimated_hours: metric(item, 'estimated_hours'),
      actual_hours: metric(item, 'actual_hours'),
      // duração efetiva (cronograma ou informada) e a informada (editável quando não há cronograma)
      duration_days: planDomain.durationOf(item),
      duration_manual: metric(item, 'duration_days'),
      progress: progress[item.id] ? { value: progress[item.id].value, source: progress[item.id].source } : { value: 0, source: 'none' },
      // tarefas ligadas ao elemento (ADR-050): canceladas fora do total
      tasks: progress[item.id] && progress[item.id].tasks ? progress[item.id].tasks : { total: 0, done: 0 },
      progress_manual: item.progressSet ? item.progress || 0 : null,
      subitems: childCount || 0,
      custom: item.parentId ? {} : columnsDomain.presentValues(item.custom, columns || []),
      position: item.position,
      created_at: iso(item.createdAt),
      updated_at: iso(item.updatedAt),
    }
  }

  async function presentGroup(group, numbers, summary) {
    return {
      id: group.id,
      parent_id: group.parentId || null,
      name: group.name,
      color: group.color,
      position: group.position,
      number: numbers[group.id] || null,
      summary: presentSummary(summary),
    }
  }

  /** Tarefas ligadas por elemento: { itemId: { total (sem canceladas), done } }. */
  async function taskCountsOf(itemIds) {
    const stats = await deps.taskRepository.planItemStats(itemIds)
    if (stats.length === 0) return {}
    const category = {}
    ;(await deps.statusRepository.list({ includeInactive: true })).forEach((s) => {
      category[s.id] = s.category
    })
    return planDomain.taskCountsFrom(stats, (statusId) => category[statusId] || null)
  }

  /** Progresso de todos os elementos (subelementos contam para o pai; tarefas ligadas mandam no elemento). */
  async function progressOf(list, statusById) {
    const counts = await taskCountsOf(list.map((i) => i.id))
    return planDomain.computeProgress(list, (i) => (i.statusId && statusById[i.statusId] ? statusById[i.statusId].category : null), counts)
  }

  async function loadGroup(ctx, id) {
    const found = await loadOwned(ctx, groups, id, 'GROUP_NOT_FOUND')
    return { group: found.record, project: found.project, can: found.can }
  }

  async function loadItem(ctx, id) {
    const found = await loadOwned(ctx, items, id, 'PLAN_ITEM_NOT_FOUND')
    return { item: found.record, project: found.project, can: found.can }
  }

  /** Histórico legível do elemento (nomes no lugar de ids; colunas personalizadas como "cf:<nome>"). */
  async function snapshot(item, columns) {
    const status = item.statusId ? await statuses.findById(item.statusId) : null
    const group = item.groupId ? await groups.findById(item.groupId) : null
    const parent = item.parentId ? await items.findById(item.parentId) : null
    const owner = item.ownerId ? await deps.userRepository.findById(item.ownerId) : null
    const resourceNames = (await Promise.all((item.resourceIds || []).map((rid) => resources.findById(rid))))
      .filter(Boolean)
      .map((r) => r.name)
    const out = {
      name: item.name,
      plan_group: group ? group.name : null,
      parent_item: parent ? parent.name : null,
      plan_status: status ? status.name : null,
      start_date: item.startDate || null,
      end_date: item.endDate || null,
      due_date: item.dueDate || null,
      plan_owner: owner ? owner.name : null,
      resources: resourceNames.join(', ') || null,
      estimated_hours: metric(item, 'estimated_hours'),
      actual_hours: metric(item, 'actual_hours'),
      duration_days: metric(item, 'duration_days'),
      progress: item.progressSet ? `${item.progress || 0}%` : null,
    }
    for (const c of columns || []) {
      out[`cf:${c.name}`] = await readableValue(c, (item.custom || {})[c.id])
    }
    return out
  }

  /** Valor legível da coluna personalizada (opção pelo nome, pessoa pelo nome). */
  async function readableValue(column, value) {
    if (value === null || value === undefined || value === '') return null
    if (column.type === 'dropdown') {
      const option = ((column.settings && column.settings.options) || []).find((o) => o.id === value)
      return option ? option.name : null
    }
    if (column.type === 'people') {
      const user = await deps.userRepository.findById(value)
      return user ? user.name : null
    }
    return value
  }

  const listColumns = async (projectId) => await deps.planColumnRepository.listByProject(projectId)

  /**
   * Valores das colunas personalizadas no corpo (`custom: { coluna: valor|null }`): só em elemento,
   * só colunas do quadro, valor válido para o tipo; pessoa = quem participa do projeto. Devolve o
   * objeto completo já mesclado (null tira o valor).
   */
  async function readCustom(project, item, raw, columns) {
    if (raw === undefined) return undefined
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid({ custom: 'invalid_type' })
    if (item && item.parentId) throw invalid({ custom: 'subitems_not_supported' })
    const byId = indexBy(columns)
    const next = Object.assign({}, (item && item.custom) || {})
    for (const id of Object.keys(raw)) {
      const column = byId[id]
      if (!column) throw invalid({ custom: 'invalid_option' })
      const result = columnsDomain.normalizeValue(column, raw[id])
      if (result.issue) throw invalid({ custom: result.issue })
      if (column.type === 'people' && result.value) {
        const user = await deps.userRepository.findById(result.value)
        const member = user ? await deps.projectMemberRepository.find(project.id, user.id) : null
        if (!user || user.status !== 'active' || (project.ownerId !== user.id && !member)) throw invalid({ custom: 'not_member' })
      }
      if (result.value === null) delete next[id]
      else next[id] = result.value
    }
    return next
  }

  async function changes(before, after) {
    const oldValue = {}
    const newValue = {}
    Object.keys(after).forEach((key) => {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        oldValue[key] = before[key] === undefined ? null : before[key]
        newValue[key] = after[key] === undefined ? null : after[key]
      }
    })
    return Object.keys(newValue).length ? { oldValue, newValue } : null
  }

  /** Confere as referências do corpo já validado (status, responsável, recursos do mesmo projeto). */
  async function assertRefs(project, data) {
    if (data.status_id) {
      const status = await statuses.findById(data.status_id)
      if (!status || status.projectId !== project.id) throw invalid({ status_id: 'invalid_option' })
    }
    if (data.owner_id) {
      const user = await deps.userRepository.findById(data.owner_id)
      const member = user ? await deps.projectMemberRepository.find(project.id, user.id) : null
      if (!user || user.status !== 'active' || (project.ownerId !== user.id && !member)) throw invalid({ owner_id: 'not_member' })
    }
    if (data.resource_ids && data.resource_ids.length) {
      const found = await Promise.all(data.resource_ids.map((rid) => resources.findById(rid)))
      const ok = found.every((r) => r && r.projectId === project.id)
      if (!ok) throw invalid({ resource_ids: 'invalid_option' })
    }
  }

  /** Corpo validado → campos da entidade. */
  async function fieldsFrom(data, current) {
    const out = {}
    if (data.name !== undefined) out.name = data.name
    if (data.status_id !== undefined) out.statusId = data.status_id
    if (data.start_date !== undefined) out.startDate = data.start_date
    if (data.end_date !== undefined) out.endDate = data.end_date
    if (data.due_date !== undefined) out.dueDate = data.due_date
    if (data.owner_id !== undefined) out.ownerId = data.owner_id
    if (data.resource_ids !== undefined) out.resourceIds = data.resource_ids
    const metrics = Object.assign({}, (current && current.metrics) || {})
    let metricsChanged = false
    ;['estimated_hours', 'actual_hours', 'duration_days'].forEach((key) => {
      if (data[key] === undefined) return
      metrics[key] = data[key]
      metricsChanged = true
    })
    if (metricsChanged) out.metrics = metrics
    if (data.progress !== undefined) {
      out.progress = data.progress === null ? 0 : data.progress
      out.progressSet = data.progress !== null
    }
    return out
  }

  return {
    capabilities,
    canFor,
    loadProject,
    loadOwned,
    assertCan,
    audit,
    ensureStatuses,
    settingsOf,
    pendingMap,
    assertDependencies,
    usersOf,
    presentItem,
    presentGroup,
    progressOf,
    loadGroup,
    loadItem,
    snapshot,
    readableValue,
    listColumns,
    readCustom,
    changes,
    assertRefs,
    fieldsFrom,
  }
}

module.exports = { createPlanSupport, invalid, idOf, presentStatus, presentResource, presentLink, presentColumn, presentSummary, indexBy, metric, MAX_ITEMS, DEFAULT_RESOURCE_COLOR }
