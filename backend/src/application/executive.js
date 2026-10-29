/**
 * Painel executivo (regras de negócio §26): Gestão de projetos + Kanban de atividades de todos os
 * projetos, para a diretoria.
 *
 * - Acesso: `executive.view`. Quem tem a permissão vê **todos** os projetos no painel (mesmo sem ser
 *   membro), só para leitura — o detalhe de cada projeto continua com a regra de acesso de sempre.
 * - Filtro: `project_ids` (separados por vírgula; vazio = todos). Período: `from`/`to` (AAAA-MM-DD no
 *   fuso de quem consulta, ou ISO); sem `from` = desde o início; sem `to` = agora.
 * - Leitura em lote (sem uma consulta por projeto) e os cálculos em domain/executive.js, com a saúde
 *   de domain/plan-report.js e os indicadores de domain/report.js.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const planDomain = require('../domain/plan')
const { planReport } = require('../domain/plan-report')
const report = require('../domain/report')
const workflow = require('../domain/workflow')
const executive = require('../domain/executive')
const { toUserSummary } = require('./presenters')

const MAX_PROJECT_IDS = 200
const ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const CHUNK = 400
const BUG_TYPE_KEYS = ['BUG']

const SCHEMA = {
  project_ids: [
    rules.custom((value) => {
      if (typeof value !== 'string') return 'invalid_type'
      const ids = value.split(',').map((id) => id.trim()).filter(Boolean)
      if (ids.length > MAX_PROJECT_IDS) return 'too_many'
      return ids.every((id) => ID_PATTERN.test(id)) ? null : 'invalid_type'
    }),
  ],
  from: [rules.isoDate()],
  to: [rules.isoDate()],
  tz_offset: [rules.custom((value) => (/^-?\d{1,3}$/.test(String(value)) && Math.abs(Number(value)) <= 840 ? null : 'invalid_type'))],
}

function chunks(list) {
  const out = []
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK))
  return out
}

function indexBy(list) {
  const map = {}
  list.forEach((item) => {
    map[item.id] = item
  })
  return map
}

function createExecutiveService(deps) {
  /** Dia AAAA-MM-DD vira o começo (ou o fim) desse dia no fuso de quem consulta; ISO com hora vale como veio. */
  function boundary(raw, date, tzOffset, end) {
    if (!DAY_PATTERN.test(raw)) return date
    return new Date(Date.parse(`${raw}T${end ? '23:59:59.999' : '00:00:00.000'}Z`) + tzOffset * 60000)
  }

  function parse(query) {
    const q = query || {}
    const source = {}
    Object.keys(SCHEMA).forEach((key) => {
      source[key] = q[key] === undefined || q[key] === '' ? undefined : q[key]
    })
    const data = assertValid(source, SCHEMA)
    const tzOffset = data.tz_offset === undefined ? 0 : Number(data.tz_offset)
    const now = deps.clock.now()
    const from = data.from ? boundary(source.from, data.from, tzOffset, false) : null
    const to = data.to ? boundary(source.to, data.to, tzOffset, true) : now
    if (from && to < from) throw appError('VALIDATION_ERROR', undefined, { fields: { to: 'to_before_from' } })
    const ids = (data.project_ids || '')
      .split(',')
      .map((id) => id.trim())
      .filter((id, i, all) => id && all.indexOf(id) === i)
    return { projectIds: ids, from, to, now, tzOffset }
  }

  /** Tarefas abertas com algum bloqueador ainda aberto (mesma regra dos relatórios). */
  async function markBlocked(rows, closedIds) {
    const open = rows.filter((r) => closedIds.indexOf(r.statusId) < 0).map((r) => r.id)
    const blocked = {}
    for (const ids of chunks(open)) {
      const pairs = await deps.relationRepository.blockersOf(ids)
      const blockerIds = pairs.map((p) => p.blockerId).filter((id, i, all) => all.indexOf(id) === i)
      const blockers = {}
      for (const part of chunks(blockerIds)) Object.assign(blockers, indexBy(await deps.taskRepository.findManyByIds(part)))
      pairs.forEach((p) => {
        const blocker = blockers[p.blockerId]
        if (blocker && closedIds.indexOf(blocker.statusId) < 0) blocked[p.taskId] = true
      })
    }
    rows.forEach((row) => {
      row.blocked = !!blocked[row.id]
    })
  }

  async function getDashboard(ctx, query) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'executive.view')
    const params = parse(query)
    const today = report.localDay(params.now, params.tzOffset)

    const all = await deps.projectRepository.listAll()
    const projects = params.projectIds.length ? all.filter((p) => params.projectIds.indexOf(p.id) >= 0) : all
    const ids = projects.map((p) => p.id)
    const activeIds = projects.filter((p) => !p.archivedAt).map((p) => p.id)

    // Gestão de projetos: tudo em lote
    const planStatuses = indexBy(await deps.planStatusRepository.listByProjects(ids))
    const planItems = await deps.planItemRepository.listByProjects(ids)
    const links = await deps.planLinkRepository.listByProjects(activeIds)
    const issues = await deps.planIssueRepository.listByProjects(ids)
    const planCategoryOf = (item) => (item.statusId && planStatuses[item.statusId] ? planStatuses[item.statusId].category : null)

    const itemsByProject = {}
    planItems.forEach((item) => {
      ;(itemsByProject[item.projectId] = itemsByProject[item.projectId] || []).push(item)
    })
    const plans = {}
    activeIds.forEach((projectId) => {
      const items = itemsByProject[projectId] || []
      if (!items.some((i) => !i.parentId)) return
      const byId = indexBy(items)
      const pending = {}
      links.forEach((l) => {
        if (l.projectId === projectId && l.type === 'blocks' && byId[l.toId] && byId[l.fromId] && ['done', 'canceled'].indexOf(planCategoryOf(byId[l.fromId])) < 0) pending[l.toId] = true
      })
      plans[projectId] = planReport({
        items,
        categoryOf: planCategoryOf,
        progress: planDomain.computeProgress(items, planCategoryOf),
        groups: [],
        resources: [],
        issues: issues.filter((i) => i.projectId === projectId),
        pending,
        today,
      })
    })

    // Kanban de atividades
    const statusList = await deps.statusRepository.list({ includeInactive: true })
    const closedIds = statusList.filter((s) => workflow.isClosedCategory(s.category)).map((s) => s.id)
    const taskRows = ids.length ? await deps.taskRepository.listForReport({ includeArchived: true, projectIds: ids, withTitles: true }) : []
    await markBlocked(
      taskRows.filter((r) => activeIds.indexOf(r.projectId) >= 0),
      closedIds,
    )
    const types = await deps.taskTypeRepository.list({ includeInactive: true })
    const priorities = (await deps.priorityRepository.list({ includeInactive: false })).slice().sort((a, b) => a.order - b.order)

    const milestones = await deps.milestoneRepository.listByProjects(ids)
    const ownerIds = projects
      .map((p) => p.ownerId)
      .concat(issues.map((i) => i.ownerId))
      .filter((id, i, list) => id && list.indexOf(id) === i)
    const owners = {}
    if (ownerIds.length) {
      ;(await deps.userRepository.findManyByIds(ownerIds)).forEach((user) => {
        owners[user.id] = toUserSummary(user)
      })
    }

    const dashboard = executive.buildDashboard({
      projects,
      owners,
      plans,
      planItems,
      planCategoryOf,
      issues,
      milestones,
      taskRows,
      statuses: indexBy(statusList),
      taskContext: {
        bugTypeIds: types.filter((t) => BUG_TYPE_KEYS.indexOf(t.key) >= 0).map((t) => t.id),
        criticalPriorityId: priorities[0] ? priorities[0].id : null,
        now: params.now,
      },
      period: { from: params.from, to: params.to },
      today,
      tzOffset: params.tzOffset,
    })

    return Object.assign(
      {
        generated_at: params.now.toISOString(),
        period: { from: params.from ? params.from.toISOString() : null, to: params.to.toISOString() },
        filters: { project_ids: params.projectIds },
        projects: all.map((p) => ({ id: p.id, key: p.key, name: p.name, color: p.cover || null, icon: p.icon || null, archived: !!p.archivedAt })),
      },
      dashboard,
    )
  }

  return { getDashboard }
}

module.exports = { createExecutiveService }
