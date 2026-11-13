/**
 * Painel executivo (regras de negócio §26): a visão da diretoria sobre a Gestão de projetos e o
 * Kanban de atividades de vários projetos ao mesmo tempo. Só junta e resume o que os dois módulos já
 * calculam — a saúde de cada projeto vem do relatório do quadro (domain/plan-report.js) e os números
 * das tarefas dos indicadores (domain/report.js); nenhuma regra nova de saúde.
 *
 * - Portfólio, Gestão e Kanban: só projetos ativos. Arquivados entram apenas no que foi entregue
 *   (resumo de entregas, série no tempo e "o que já foi feito").
 * - Progresso do projeto: o do quadro da Gestão quando ele tem elementos; senão, a fração das tarefas
 *   concluídas (sem as canceladas). Sem nenhum dos dois, nulo.
 * - Período: `from` nulo = desde o início. Conta como entrega a tarefa concluída e o elemento (de
 *   primeiro nível) concluído no período; o marco "feito" conta pela data dele.
 * - Série no tempo (Seguimento de projetos): além do que foi criado e concluído em cada balde, quantas
 *   tarefas dos projetos ativos estavam em andamento e vencidas no fim dele, reconstruído pelas datas
 *   (início, conclusão, prazo e criação) — sem foto semanal, o prazo é o atual da tarefa.
 */

const report = require('./report')

const DAY_MS = 86400000
const HEALTH_RANK = { critical: 0, attention: 1, ok: 2, none: 3 }
const PLAN_CATEGORIES = ['todo', 'in_progress', 'review', 'blocked', 'done', 'canceled']
const FUNNEL = ['backlog', 'todo', 'in_progress', 'done', 'cancelled']
const TOP_ISSUES = 5
const TOP_OVERDUE = 5
const TOP_MILESTONES = 8
const MILESTONE_WINDOW_DAYS = 30
const RECENT_PER_PROJECT = 5
/** Acima disso a série é mensal; até, semanal. */
const WEEKLY_LIMIT_DAYS = 120

/** Data de projeto (Date ou texto) como AAAA-MM-DD. */
const dayOf = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null)
const isoOf = (value) => (value instanceof Date ? value.toISOString() : value || null)
const sumOrNull = (values) => {
  const list = values.filter((v) => typeof v === 'number')
  return list.length ? Math.round(list.reduce((a, b) => a + b, 0) * 100) / 100 : null
}
const addDays = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
const inPeriod = (date, period) => !!date && (!period.from || date >= period.from) && date <= period.to

function projectRef(project) {
  return { id: project.id, key: project.key, name: project.name }
}

/** Início do balde (semana começando na segunda ou mês) de um dia AAAA-MM-DD. */
function bucketStart(day, bucket) {
  if (bucket === 'month') return `${day.slice(0, 7)}-01`
  const date = new Date(`${day}T00:00:00Z`)
  return new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10)
}

function nextBucket(start, bucket) {
  if (bucket === 'week') return addDays(start, 7)
  const date = new Date(`${start}T00:00:00Z`)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
}

/**
 * Série de entregas no tempo: tarefas criadas e concluídas e elementos concluídos por semana (até
 * 120 dias) ou mês. Sem `from`, começa no registro mais antigo.
 */
function timeline(input) {
  const { taskRows, isTaskDone, planDone, period, tzOffset } = input
  const stockRows = input.stockRows || []
  const toDay = (date) => report.localDay(date, tzOffset)
  const dates = []
  taskRows.forEach((row) => {
    if (row.createdAt) dates.push(row.createdAt)
  })
  planDone.forEach((item) => dates.push(item.completedAt))
  const first = period.from || (dates.length ? new Date(Math.min.apply(null, dates.map((d) => d.getTime()))) : null)
  if (!first) return { bucket: 'week', points: [] }
  const startDay = toDay(first)
  const endDay = toDay(period.to)
  const bucket = (Date.parse(endDay) - Date.parse(startDay)) / DAY_MS > WEEKLY_LIMIT_DAYS ? 'month' : 'week'

  const points = []
  const index = {}
  for (let start = bucketStart(startDay, bucket); start <= endDay; start = nextBucket(start, bucket)) {
    index[start] = points.length
    points.push({ start, tasks_created: 0, tasks_completed: 0, plan_items_completed: 0, tasks_in_progress: 0, tasks_overdue: 0 })
  }
  const add = (date, key) => {
    if (!inPeriod(date, { from: first, to: period.to })) return
    const at = index[bucketStart(toDay(date), bucket)]
    if (at !== undefined) points[at][key] += 1
  }
  taskRows.forEach((row) => {
    add(row.createdAt, 'tasks_created')
    if (isTaskDone(row)) add(row.completedAt, 'tasks_completed')
  })
  planDone.forEach((item) => add(item.completedAt, 'plan_items_completed'))

  // estoque no fim de cada balde (o último termina hoje): em andamento = começou e não fechou;
  // vencida = prazo antes do fim do balde e ainda aberta nele
  const dayOrNull = (date) => (date ? toDay(date) : null)
  const stock = stockRows.map((row) => ({
    created: dayOrNull(row.createdAt),
    started: dayOrNull(row.startedAt),
    closed: dayOrNull(row.completedAt),
    due: row.dueDate ? dayOf(row.dueDate) : null,
  }))
  points.forEach((point, i) => {
    const next = i + 1 < points.length ? points[i + 1].start : nextBucket(point.start, bucket)
    const lastDay = addDays(next, -1)
    const end = lastDay < endDay ? lastDay : endDay
    stock.forEach((t) => {
      if (t.created && t.created > end) return
      const open = !t.closed || t.closed > end
      if (!open) return
      if (t.started && t.started <= end) point.tasks_in_progress += 1
      if (t.due && t.due < end) point.tasks_overdue += 1
    })
  })
  return { bucket, points }
}

/**
 * @param {object} input
 * @param {Array} input.projects projetos no escopo (ativos e arquivados), na ordem da chave
 * @param {object} input.owners { userId: resumo da pessoa }
 * @param {object} input.plans { projectId: resultado de planReport } — só ativos com elementos
 * @param {Array} input.planItems elementos e subelementos dos projetos no escopo
 * @param {Function} input.planCategoryOf (elemento) → categoria da etiqueta de status
 * @param {Array} input.issues problemas da Gestão dos projetos no escopo
 * @param {Array} input.milestones marcos dos projetos no escopo
 * @param {Array} input.taskRows linhas de tarefa (com code, title e blocked) dos projetos no escopo
 * @param {object} input.statuses { statusId: status } do fluxo das tarefas
 * @param {object} input.taskContext contexto de domain/report.js#indicators (bugTypeIds, criticalPriorityId…)
 * @param {object} input.period { from: Date|null, to: Date }
 * @param {string} input.today AAAA-MM-DD no fuso de quem consulta
 * @param {number} input.tzOffset minutos (Date#getTimezoneOffset)
 */
function buildDashboard(input) {
  const { projects, owners, plans, planCategoryOf, statuses, period, today } = input
  const active = projects.filter((p) => !p.archivedAt)
  const activeIds = {}
  active.forEach((p) => {
    activeIds[p.id] = true
  })
  const byProject = (list) => {
    const out = {}
    list.forEach((item) => {
      ;(out[item.projectId] = out[item.projectId] || []).push(item)
    })
    return out
  }

  const categoryOfTask = (row) => (statuses[row.statusId] || {}).category
  const isTaskDone = (row) => categoryOfTask(row) === 'done'
  const isTaskOpen = (row) => {
    const category = categoryOfTask(row)
    return !!category && category !== 'done' && category !== 'cancelled'
  }
  const isTaskOverdue = (row) => isTaskOpen(row) && !!row.dueDate && row.dueDate.toISOString().slice(0, 10) < today
  const taskContext = Object.assign({}, input.taskContext, { statuses, from: period.from || new Date(0), to: period.to, tzOffset: input.tzOffset })

  const tasksByProject = byProject(input.taskRows)
  const topItems = input.planItems.filter((i) => !i.parentId)
  const planDone = topItems.filter((i) => planCategoryOf(i) === 'done' && inPeriod(i.completedAt, period))
  const planDoneByProject = byProject(planDone)
  const milestonesByProject = byProject(input.milestones)
  const openIssues = input.issues.filter((i) => i.state !== 'resolved' && activeIds[i.projectId])
  const issuesByProject = byProject(openIssues)
  const milestoneDone = (m) => m.state === 'done' && !!m.dueDate && (!period.from || m.dueDate >= report.localDay(period.from, input.tzOffset)) && m.dueDate <= report.localDay(period.to, input.tzOffset)

  // ---------------------------------------------------------------- portfólio
  const portfolio = active.map((project) => {
    const plan = plans[project.id] || null
    const rows = tasksByProject[project.id] || []
    const notCancelled = rows.filter((r) => categoryOfTask(r) !== 'cancelled')
    const tasksDone = rows.filter((r) => isTaskDone(r))
    let progress = null
    if (plan && plan.summary.total - plan.summary.canceled > 0) progress = { value: plan.summary.progress, source: 'plan' }
    else if (notCancelled.length > 0) progress = { value: Math.round((tasksDone.length / notCancelled.length) * 100), source: 'tasks' }
    const next = (milestonesByProject[project.id] || []).filter((m) => m.state !== 'done' && m.dueDate && m.dueDate >= today)[0] || null
    return {
      project: {
        id: project.id,
        key: project.key,
        name: project.name,
        color: project.cover || null,
        icon: project.icon || null,
        status: project.status,
        priority: project.priority,
        urgency: project.urgency || null,
        area: (project.areaId && input.areas && input.areas[project.areaId]) || null,
        start_date: dayOf(project.startDate),
        due_date: dayOf(project.dueDate),
        // responsável do projeto (sem ele, o dono)
        owner: ((project.leadId || project.ownerId) && owners[project.leadId || project.ownerId]) || null,
      },
      health: plan ? plan.health : { level: 'none', factors: [] },
      progress,
      plan: plan ? { total: plan.summary.total, done: plan.summary.done, open: plan.summary.open, overdue: plan.summary.overdue, stuck: plan.summary.stuck } : null,
      tasks: {
        total: rows.length,
        open: rows.filter(isTaskOpen).length,
        in_progress: rows.filter((r) => categoryOfTask(r) === 'in_progress').length,
        blocked: rows.filter((r) => isTaskOpen(r) && r.blocked).length,
        overdue: rows.filter(isTaskOverdue).length,
        done: rows.filter((r) => isTaskDone(r) && inPeriod(r.completedAt, period)).length,
      },
      next_milestone: next ? { id: next.id, name: next.name, due_date: next.dueDate } : null,
      open_issues: (issuesByProject[project.id] || []).length,
    }
  })
  portfolio.sort((a, b) => HEALTH_RANK[a.health.level] - HEALTH_RANK[b.health.level] || (a.project.key < b.project.key ? -1 : a.project.key > b.project.key ? 1 : 0))

  // ---------------------------------------------------------------- Gestão de projetos
  const activePlans = active.map((p) => plans[p.id]).filter(Boolean)
  const activeTopItems = topItems.filter((i) => activeIds[i.projectId])
  const distribution = {}
  activeTopItems.forEach((item) => {
    const category = planCategoryOf(item) || 'none'
    distribution[category] = (distribution[category] || 0) + 1
  })
  const sumOf = (pick) => activePlans.reduce((total, plan) => total + (pick(plan) || 0), 0)
  const projectOf = {}
  projects.forEach((p) => {
    projectOf[p.id] = p
  })
  const upcomingLimit = addDays(today, MILESTONE_WINDOW_DAYS)
  const planSection = {
    items: {
      total: sumOf((p) => p.summary.total),
      done: sumOf((p) => p.summary.done),
      open: sumOf((p) => p.summary.open),
      overdue: sumOf((p) => p.summary.overdue),
      stuck: sumOf((p) => p.summary.stuck),
      canceled: sumOf((p) => p.summary.canceled),
    },
    status_distribution: PLAN_CATEGORIES.concat(['none'])
      .filter((c) => distribution[c])
      .map((category) => ({ category, count: distribution[category] })),
    schedule: {
      on_time: sumOf((p) => p.schedule.on_time),
      overdue: sumOf((p) => p.schedule.overdue),
      unscheduled: sumOf((p) => p.schedule.unscheduled),
      done: sumOf((p) => p.schedule.done),
    },
    effort: {
      estimated: sumOrNull(activePlans.map((p) => p.effort.estimated)),
      actual: sumOrNull(activePlans.map((p) => p.effort.actual)),
      remaining: sumOrNull(activePlans.map((p) => p.effort.remaining)),
    },
    issues: openIssues
      .slice()
      .sort((a, b) => ((a.openedOn || '9999') < (b.openedOn || '9999') ? -1 : (a.openedOn || '9999') > (b.openedOn || '9999') ? 1 : a.number - b.number))
      .slice(0, TOP_ISSUES)
      .map((issue) => ({
        id: issue.id,
        number: issue.number,
        description: issue.description,
        state: issue.state,
        opened_on: issue.openedOn || null,
        project: projectRef(projectOf[issue.projectId]),
        owner: (issue.ownerId && owners[issue.ownerId]) || null,
      })),
    open_issues_total: openIssues.length,
    upcoming_milestones: input.milestones
      .filter((m) => activeIds[m.projectId] && m.state !== 'done' && m.dueDate && m.dueDate >= today && m.dueDate <= upcomingLimit)
      .slice(0, TOP_MILESTONES)
      .map((m) => ({ id: m.id, name: m.name, due_date: m.dueDate, project: projectRef(projectOf[m.projectId]) })),
  }

  // ---------------------------------------------------------------- Kanban de atividades
  const activeRows = input.taskRows.filter((r) => activeIds[r.projectId])
  const indicators = report.indicators(activeRows, taskContext)
  const funnel = {}
  FUNNEL.forEach((category) => {
    funnel[category] = 0
  })
  activeRows.forEach((row) => {
    const category = categoryOfTask(row)
    if (funnel[category] !== undefined) funnel[category] += 1
  })
  const kanban = {
    funnel,
    created: indicators.created,
    completed: indicators.completed,
    lead_time: indicators.lead_time,
    cycle_time: indicators.cycle_time,
    overdue: indicators.overdue,
    blocked: indicators.blocked,
    critical_bugs: indicators.critical_bugs,
    overdue_tasks: activeRows
      .filter(isTaskOverdue)
      .sort((a, b) => a.dueDate - b.dueDate)
      .slice(0, TOP_OVERDUE)
      .map((row) => {
        const status = statuses[row.statusId] || {}
        return {
          id: row.id,
          code: row.code || null,
          title: row.title || '',
          project: projectRef(projectOf[row.projectId]),
          due_date: row.dueDate.toISOString().slice(0, 10),
          status: { id: row.statusId, name: status.name || '', color: status.color || null, category: status.category || null },
        }
      }),
  }

  // ---------------------------------------------------------------- o que já foi feito
  const achievements = projects
    .map((project) => {
      const tasks = (tasksByProject[project.id] || []).filter((r) => isTaskDone(r) && inPeriod(r.completedAt, period))
      const items = planDoneByProject[project.id] || []
      const milestones = (milestonesByProject[project.id] || []).filter(milestoneDone)
      const recent = tasks
        .map((r) => ({ kind: 'task', id: r.id, code: r.code || null, title: r.title || '', completed_at: isoOf(r.completedAt) }))
        .concat(items.map((i) => ({ kind: 'plan_item', id: i.id, code: null, title: i.name, completed_at: isoOf(i.completedAt) })))
        .sort((a, b) => (a.completed_at < b.completed_at ? 1 : a.completed_at > b.completed_at ? -1 : 0))
        .slice(0, RECENT_PER_PROJECT)
      return {
        project: Object.assign(projectRef(project), { archived: !!project.archivedAt }),
        tasks_done: tasks.length,
        plan_items_done: items.length,
        milestones_done: milestones.map((m) => ({ id: m.id, name: m.name, due_date: m.dueDate })),
        recent,
      }
    })
    .filter((a) => a.tasks_done + a.plan_items_done + a.milestones_done.length > 0)
    .sort((a, b) => b.tasks_done + b.plan_items_done + b.milestones_done.length - (a.tasks_done + a.plan_items_done + a.milestones_done.length) || (a.project.key < b.project.key ? -1 : 1))

  // ---------------------------------------------------------------- resumo
  const health = { ok: 0, attention: 0, critical: 0, none: 0 }
  portfolio.forEach((row) => {
    health[row.health.level] += 1
  })
  const progressValues = portfolio.map((row) => (row.progress ? row.progress.value : null)).filter((v) => typeof v === 'number')
  const summary = {
    active_projects: active.length,
    health,
    progress: progressValues.length ? Math.round(progressValues.reduce((a, b) => a + b, 0) / progressValues.length) : null,
    deliveries: {
      tasks: input.taskRows.filter((r) => isTaskDone(r) && inPeriod(r.completedAt, period)).length,
      plan_items: planDone.length,
      milestones: input.milestones.filter(milestoneDone).length,
    },
    overdue: { tasks: kanban.overdue, plan_items: planSection.items.overdue },
    open_issues: openIssues.length,
    critical_bugs: kanban.critical_bugs,
  }

  return {
    summary,
    portfolio,
    plan: planSection,
    kanban,
    timeline: timeline({
      taskRows: input.taskRows,
      stockRows: input.taskRows.filter((r) => activeIds[r.projectId] && categoryOfTask(r) !== 'cancelled'),
      isTaskDone,
      planDone: topItems.filter((i) => planCategoryOf(i) === 'done' && i.completedAt),
      period,
      tzOffset: input.tzOffset,
    }),
    achievements,
  }
}

module.exports = { HEALTH_RANK, FUNNEL, WEEKLY_LIMIT_DAYS, MILESTONE_WINDOW_DAYS, bucketStart, timeline, buildDashboard }
