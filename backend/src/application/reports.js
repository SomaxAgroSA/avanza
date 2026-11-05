/**
 * Relatórios e indicadores (diretriz §24 e §25).
 *
 * - Acesso: `reports.view`; escopo = projetos visíveis ao usuário (membro, dono ou `projects.view_all`),
 *   sem os arquivados — a não ser que o projeto arquivado seja escolhido no filtro. Nos projetos em que
 *   a pessoa é Responsável TI (§33), só as tarefas visíveis a ela (atribuídas ou marcadas para TI).
 * - Período: `from`/`to` (ISO); padrão, os últimos 30 dias. Sempre devolvido na resposta.
 * - Definições devolvidas junto (transparência): tipos considerados bug (chave BUG) e a
 *   prioridade considerada crítica (a primeira da lista de prioridades).
 * - Cálculos em domain/report.js.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const { parsePagination, buildPageMeta } = require('../core/pagination')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const workflow = require('../domain/workflow')
const report = require('../domain/report')
const contentLocale = require('../domain/content-locale')
const { toUserSummary } = require('./presenters')
const { createTaskService } = require('./tasks')

const DEFAULT_DAYS = 30
const OVERDUE_LIMIT = 50
const CHUNK = 400
const BUG_TYPE_KEYS = ['BUG']

const idRule = rules.custom((value) => (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) ? null : 'invalid_type'))
const SCHEMA = {
  project_id: [idRule],
  assignee_id: [rules.custom((value) => (value === 'me' || value === 'none' || (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value)) ? null : 'invalid_type'))],
  task_type_id: [idRule],
  priority_id: [idRule],
  status_id: [idRule],
  from: [rules.isoDate()],
  to: [rules.isoDate()],
  group_by: [rules.oneOf(report.DIMENSIONS)],
  tz_offset: [rules.custom((value) => (/^-?\d{1,3}$/.test(String(value)) && Math.abs(Number(value)) <= 840 ? null : 'invalid_type'))],
}

const METRIC_SCHEMA = { metric: [rules.required(), rules.oneOf(report.METRICS)] }

function invalid(fields) {
  return appError('VALIDATION_ERROR', undefined, { fields })
}

function chunks(list) {
  const out = []
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK))
  return out
}

function byId(list) {
  const map = {}
  list.forEach((item) => {
    map[item.id] = item
  })
  return map
}

function createReportService(deps) {
  const tasks = deps.taskRepository
  const taskService = createTaskService(deps)

  function parse(query) {
    const q = query || {}
    const pick = (key) => (q[key] === undefined || q[key] === '' ? undefined : q[key])
    const source = {}
    Object.keys(SCHEMA).forEach((key) => {
      source[key] = pick(key)
    })
    const data = assertValid(source, SCHEMA)
    const now = deps.clock.now()
    const to = data.to || now
    const from = data.from || new Date(to.getTime() - DEFAULT_DAYS * 24 * 3600 * 1000)
    const issue = report.periodIssue(from, to)
    if (issue === 'to_before_from') throw invalid({ to: issue })
    if (issue) throw invalid({ from: issue })
    return Object.assign(data, { from, to, now, groupBy: data.group_by || 'status', tzOffset: data.tz_offset === undefined ? 0 : Number(data.tz_offset) })
  }

  /** Marca como bloqueadas as linhas abertas com algum bloqueador ainda aberto. */
  async function markBlocked(rows, openIds, closedIds) {
    const blocked = {}
    for (const ids of chunks(openIds)) {
      const pairs = await deps.relationRepository.blockersOf(ids)
      const blockerIds = pairs.map((p) => p.blockerId).filter((id, i, all) => all.indexOf(id) === i)
      const blockers = {}
      for (const part of chunks(blockerIds)) Object.assign(blockers, byId(await tasks.findManyByIds(part)))
      pairs.forEach((p) => {
        const blocker = blockers[p.blockerId]
        if (blocker && closedIds.indexOf(blocker.statusId) < 0) blocked[p.taskId] = true
      })
    }
    rows.forEach((row) => {
      row.blocked = !!blocked[row.id]
    })
  }

  /** Base comum do relatório e do detalhamento: parâmetros, linhas no escopo (com "bloqueada") e contexto. */
  async function load(ctx, query) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'reports.view')
    const params = parse(query)

    if (params.project_id) {
      const project = await deps.projectRepository.findById(params.project_id)
      const access = project ? projectDomain.resolveAccess(ctx.principal, project, await deps.projectMemberRepository.find(project.id, ctx.principal.userId)) : null
      // o Responsável TI filtra pelo projeto dele; as linhas já vêm só com as tarefas visíveis a ele
      if (!project || !(access.canView || access.limited)) throw appError('PROJECT_NOT_FOUND')
    }

    const statusList = await deps.statusRepository.list({ includeInactive: true })
    const statuses = byId(statusList)
    const closedIds = statusList.filter((s) => workflow.isClosedCategory(s.category)).map((s) => s.id)
    const types = await deps.taskTypeRepository.list({ includeInactive: true })
    const bugTypes = types.filter((t) => BUG_TYPE_KEYS.indexOf(t.key) >= 0)
    const priorities = await deps.priorityRepository.list({ includeInactive: false })
    const critical = priorities.slice().sort((a, b) => a.order - b.order)[0] || null

    const rows = rbac.can(ctx.principal, 'projects.view')
      ? await tasks.listForReport({
          scope: { userId: ctx.principal.userId, viewAll: rbac.can(ctx.principal, 'projects.view_all') },
          includeArchived: !!params.project_id,
          projectId: params.project_id,
          assigneeId: params.assignee_id === 'me' ? ctx.principal.userId : params.assignee_id,
          typeId: params.task_type_id,
          priorityId: params.priority_id,
          statusId: params.status_id,
        })
      : []
    await markBlocked(
      rows,
      rows.filter((r) => closedIds.indexOf(r.statusId) < 0).map((r) => r.id),
      closedIds,
    )

    const context = {
      statuses,
      bugTypeIds: bugTypes.map((t) => t.id),
      criticalPriorityId: critical ? critical.id : null,
      from: params.from,
      to: params.to,
      now: params.now,
      tzOffset: params.tzOffset,
    }
    return { params, rows, context, statuses, types, closedIds, bugTypes, critical }
  }

  async function getReport(ctx, query) {
    const base = await load(ctx, query)
    const { params, rows, context, statuses, types, closedIds, bugTypes, critical } = base

    // atrasadas: abertas com prazo antes de hoje (dia local), das mais antigas para as mais novas
    const today = report.localDay(params.now, params.tzOffset)
    const overdue = rows
      .filter((r) => closedIds.indexOf(r.statusId) < 0 && r.dueDate && r.dueDate.toISOString().slice(0, 10) < today)
      .sort((a, b) => a.dueDate - b.dueDate)
      .slice(0, OVERDUE_LIMIT)
    const overdueTasks = overdue.length ? byId(await tasks.findManyByIds(overdue.map((r) => r.id))) : {}
    const overdueSummaries = await taskService.summarize(overdue.map((r) => overdueTasks[r.id]).filter(Boolean), ctx)

    return {
      period: { from: params.from.toISOString(), to: params.to.toISOString(), tz_offset: params.tzOffset },
      generated_at: params.now.toISOString(),
      filters: {
        project_id: params.project_id || null,
        assignee_id: params.assignee_id || null,
        task_type_id: params.task_type_id || null,
        priority_id: params.priority_id || null,
        status_id: params.status_id || null,
      },
      definitions: {
        bug_types: bugTypes.map((t) => ({ id: t.id, name: contentLocale.localize(t, deps.locale, ['name']).name })),
        critical_priority: critical ? { id: critical.id, name: critical.name } : null,
      },
      indicators: report.indicators(rows, context),
      series: report.series(rows, context),
      breakdown: { dimension: params.groupBy, rows: await labelled(report.breakdown(rows, params.groupBy, context), params.groupBy, { statuses, types: byId(types), priorities: byId(await deps.priorityRepository.list({ includeInactive: true })) }) },
      overdue_tasks: overdueSummaries,
    }
  }

  /** Rótulo de cada grupo (nome, cor, ícone…) para a interface. */
  async function labelled(groups, dimension, refs) {
    const keys = groups.map((g) => g.key).filter(Boolean)
    const users = dimension === 'assignee' && keys.length ? byId(await deps.userRepository.findManyByIds(keys)) : {}
    const projects = dimension === 'project' && keys.length ? byId(await deps.projectRepository.findManyByIds(keys)) : {}
    return groups.map((g) => {
      let label = null
      if (dimension === 'status' && refs.statuses[g.key]) {
        const s = refs.statuses[g.key]
        label = { id: s.id, name: s.name, color: s.color, category: s.category }
      } else if (dimension === 'priority' && refs.priorities[g.key]) {
        const p = refs.priorities[g.key]
        label = { id: p.id, name: p.name, color: p.color }
      } else if (dimension === 'type' && refs.types[g.key]) {
        const t = refs.types[g.key]
        label = { id: t.id, name: contentLocale.localize(t, deps.locale, ['name']).name, icon: t.icon || 'check-square', color: t.color || 'blue' }
      } else if (dimension === 'assignee' && users[g.key]) {
        label = toUserSummary(users[g.key])
      } else if (dimension === 'project' && projects[g.key]) {
        const p = projects[g.key]
        label = { id: p.id, key: p.key, name: p.name }
      }
      return Object.assign({ label }, g)
    })
  }

  /**
   * Detalhamento de um indicador: as tarefas por trás do número, paginadas, com o mesmo período,
   * escopo e filtros do relatório (a seleção usa a regra da contagem — o total sempre bate).
   * Nos indicadores de tempo, cada tarefa traz `metric_hours` (a própria duração).
   */
  async function listIndicatorTasks(ctx, query) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'reports.view')
    const q = query || {}
    const metric = assertValid({ metric: q.metric === '' ? undefined : q.metric }, METRIC_SCHEMA).metric
    const base = await load(ctx, q)
    const pagination = parsePagination(q)
    const selected = report.selectForMetric(base.rows, metric, base.context)
    const pageItems = selected.slice(pagination.offset, pagination.offset + pagination.perPage)
    const found = pageItems.length ? byId(await tasks.findManyByIds(pageItems.map((item) => item.row.id))) : {}
    const hours = {}
    pageItems.forEach((item) => {
      hours[item.row.id] = item.hours
    })
    const items = (await taskService.summarize(pageItems.map((item) => found[item.row.id]).filter(Boolean), ctx)).map((summary) => Object.assign({}, summary, { metric_hours: hours[summary.id] }))
    return { items, meta: buildPageMeta(pagination, selected.length) }
  }

  return { getReport, listIndicatorTasks }
}

module.exports = { createReportService }
