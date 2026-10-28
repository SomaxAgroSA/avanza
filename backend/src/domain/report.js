/**
 * Indicadores e relatórios (diretriz §24 e §25) — funções puras sobre linhas de tarefa.
 *
 * Linha: { id, projectId, typeId, statusId, priorityId, assigneeId, createdAt, startedAt, completedAt, dueDate, blocked }
 * Contexto: { statuses (id -> { category }), bugTypeIds, criticalPriorityId, from, to, now, tzOffset }
 *
 * - "Agora": aberta = categoria diferente de concluída/cancelada; atrasada = aberta com prazo
 *   antes de hoje (dia local da pessoa); bloqueada = aberta com bloqueador aberto; bug crítico =
 *   aberta, de tipo bug, na prioridade mais alta.
 * - "No período" (de `from` a `to`, inclusive): criadas (criação), concluídas/canceladas (data de
 *   encerramento e categoria atual). Tempos médios só das concluídas no período:
 *   lead time = criação -> conclusão; cycle time = início -> conclusão (quando houve início).
 * - `tzOffset`: minutos de Date#getTimezoneOffset da pessoa (Brasília = 180), para "hoje" e a série.
 */

const DIMENSIONS = Object.freeze(['status', 'priority', 'type', 'assignee', 'project'])
/** Indicadores que podem ser detalhados (lista das tarefas por trás do número). */
const METRICS = Object.freeze(['open', 'backlog', 'todo', 'in_progress', 'blocked', 'overdue', 'critical_bugs', 'created', 'completed', 'cancelled', 'lead_time', 'cycle_time', 'bug_resolution'])
const MAX_PERIOD_DAYS = 366
/** Até este tamanho a série é diária; acima, semanal. */
const DAILY_LIMIT_DAYS = 62

const DAY = 24 * 3600 * 1000
const HOUR = 3600 * 1000

const categoryOf = (row, ctx) => (ctx.statuses[row.statusId] || {}).category
const isClosed = (category) => category === 'done' || category === 'cancelled'

/** Dia local (AAAA-MM-DD) de um instante, dado o offset (minutos) da pessoa. */
function localDay(date, tzOffset) {
  return new Date(date.getTime() - (tzOffset || 0) * 60000).toISOString().slice(0, 10)
}

function inPeriod(date, ctx) {
  return !!date && date >= ctx.from && date <= ctx.to
}

function average(values) {
  if (values.length === 0) return { hours: null, count: 0 }
  const sum = values.reduce((a, b) => a + b, 0)
  return { hours: Math.round((sum / values.length / HOUR) * 10) / 10, count: values.length }
}

/** Classificação de uma linha, usada por indicadores e recortes. */
function classify(row, ctx, today) {
  const category = categoryOf(row, ctx)
  const open = !!category && !isClosed(category)
  const completedInPeriod = category === 'done' && inPeriod(row.completedAt, ctx)
  return {
    category,
    open,
    overdue: open && !!row.dueDate && row.dueDate.toISOString().slice(0, 10) < today,
    blocked: open && !!row.blocked,
    criticalBug: open && ctx.bugTypeIds.indexOf(row.typeId) >= 0 && !!ctx.criticalPriorityId && row.priorityId === ctx.criticalPriorityId,
    created: inPeriod(row.createdAt, ctx),
    completed: completedInPeriod,
    cancelled: category === 'cancelled' && inPeriod(row.completedAt, ctx),
    // nunca negativo: criada já encerrada grava a conclusão instantes antes da data de criação
    lead: completedInPeriod && row.createdAt ? Math.max(0, row.completedAt - row.createdAt) : null,
    cycle: completedInPeriod && row.startedAt ? Math.max(0, row.completedAt - row.startedAt) : null,
  }
}

function indicators(rows, ctx) {
  const today = localDay(ctx.now, ctx.tzOffset)
  const out = { total: rows.length, open: 0, backlog: 0, todo: 0, in_progress: 0, blocked: 0, overdue: 0, critical_bugs: 0, created: 0, completed: 0, cancelled: 0 }
  const leads = []
  const cycles = []
  const bugLeads = []
  rows.forEach((row) => {
    const c = classify(row, ctx, today)
    if (c.open) out.open += 1
    if (c.category === 'backlog') out.backlog += 1
    if (c.category === 'todo') out.todo += 1
    if (c.category === 'in_progress') out.in_progress += 1
    if (c.blocked) out.blocked += 1
    if (c.overdue) out.overdue += 1
    if (c.criticalBug) out.critical_bugs += 1
    if (c.created) out.created += 1
    if (c.completed) out.completed += 1
    if (c.cancelled) out.cancelled += 1
    if (c.lead !== null) {
      leads.push(c.lead)
      if (ctx.bugTypeIds.indexOf(row.typeId) >= 0) bugLeads.push(c.lead)
    }
    if (c.cycle !== null) cycles.push(c.cycle)
  })
  return Object.assign(out, { lead_time: average(leads), cycle_time: average(cycles), bug_resolution: average(bugLeads) })
}

/**
 * Regra de cada indicador sobre a classificação da linha — a MESMA usada na contagem, para o
 * detalhamento bater sempre com o número do card.
 */
const METRIC_RULES = {
  open: (c) => c.open,
  backlog: (c) => c.category === 'backlog',
  todo: (c) => c.category === 'todo',
  in_progress: (c) => c.category === 'in_progress',
  blocked: (c) => c.blocked,
  overdue: (c) => c.overdue,
  critical_bugs: (c) => c.criticalBug,
  created: (c) => c.created,
  completed: (c) => c.completed,
  cancelled: (c) => c.cancelled,
  lead_time: (c) => c.lead !== null,
  cycle_time: (c) => c.cycle !== null,
  bug_resolution: (c, row, ctx) => c.lead !== null && ctx.bugTypeIds.indexOf(row.typeId) >= 0,
}

const time = (date) => (date ? date.getTime() : 0)
/**
 * Ordem de leitura: situação atual = há mais tempo abertas primeiro; atrasadas = prazo mais antigo
 * primeiro; criadas = mais recentes; encerradas e tempos = encerradas mais recentemente.
 */
const METRIC_ORDER = {
  overdue: (a, b) => time(a.row.dueDate) - time(b.row.dueDate),
  created: (a, b) => time(b.row.createdAt) - time(a.row.createdAt),
  completed: (a, b) => time(b.row.completedAt) - time(a.row.completedAt),
}
METRIC_ORDER.cancelled = METRIC_ORDER.completed
METRIC_ORDER.lead_time = METRIC_ORDER.completed
METRIC_ORDER.cycle_time = METRIC_ORDER.completed
METRIC_ORDER.bug_resolution = METRIC_ORDER.completed
const OLDEST_FIRST = (a, b) => time(a.row.createdAt) - time(b.row.createdAt)

const toHours = (ms) => Math.round((ms / HOUR) * 10) / 10

/** Linhas que entram no indicador, ordenadas; `hours` = duração nos indicadores de tempo (senão null). */
function selectForMetric(rows, metric, ctx) {
  const rule = METRIC_RULES[metric]
  if (!rule) throw new Error(`indicador inválido: ${metric}`)
  const today = localDay(ctx.now, ctx.tzOffset)
  const selected = []
  rows.forEach((row) => {
    const c = classify(row, ctx, today)
    if (!rule(c, row, ctx)) return
    const ms = metric === 'cycle_time' ? c.cycle : metric === 'lead_time' || metric === 'bug_resolution' ? c.lead : null
    selected.push({ row, hours: ms === null ? null : toHours(ms) })
  })
  return selected.sort(METRIC_ORDER[metric] || OLDEST_FIRST)
}

const KEY = {
  status: (row) => row.statusId,
  priority: (row) => row.priorityId,
  type: (row) => row.typeId,
  assignee: (row) => row.assigneeId || '',
  project: (row) => row.projectId,
}

/** Recorte por dimensão; ordenado por abertas, depois concluídas (desc). */
function breakdown(rows, dimension, ctx) {
  if (DIMENSIONS.indexOf(dimension) < 0) throw new Error(`dimensão inválida: ${dimension}`)
  const today = localDay(ctx.now, ctx.tzOffset)
  const groups = {}
  const order = []
  rows.forEach((row) => {
    const key = KEY[dimension](row) || ''
    if (!groups[key]) {
      groups[key] = { key, total: 0, open: 0, overdue: 0, blocked: 0, created: 0, completed: 0, leads: [] }
      order.push(key)
    }
    const g = groups[key]
    const c = classify(row, ctx, today)
    g.total += 1
    if (c.open) g.open += 1
    if (c.overdue) g.overdue += 1
    if (c.blocked) g.blocked += 1
    if (c.created) g.created += 1
    if (c.completed) g.completed += 1
    if (c.lead !== null) g.leads.push(c.lead)
  })
  return order
    .map((key, index) => {
      const g = groups[key]
      return { key, total: g.total, open: g.open, overdue: g.overdue, blocked: g.blocked, created: g.created, completed: g.completed, lead_time: average(g.leads), index }
    })
    .sort((a, b) => b.open - a.open || b.completed - a.completed || a.index - b.index)
    .map((g) => {
      const out = Object.assign({}, g)
      delete out.index
      return out
    })
}

/** Segunda-feira (AAAA-MM-DD) da semana do dia. */
function weekStart(day) {
  const date = new Date(`${day}T00:00:00Z`)
  const weekday = (date.getUTCDay() + 6) % 7
  return new Date(date.getTime() - weekday * DAY).toISOString().slice(0, 10)
}

/** Criadas × concluídas por dia (ou semana, em períodos longos), no fuso da pessoa. */
function series(rows, ctx) {
  const first = localDay(ctx.from, ctx.tzOffset)
  const last = localDay(ctx.to, ctx.tzOffset)
  const days = Math.round((new Date(`${last}T00:00:00Z`) - new Date(`${first}T00:00:00Z`)) / DAY) + 1
  const bucket = days > DAILY_LIMIT_DAYS ? 'week' : 'day'
  const keyOf = (day) => (bucket === 'week' ? weekStart(day) : day)
  const points = []
  const index = {}
  for (let i = 0; i < days; i++) {
    const day = new Date(new Date(`${first}T00:00:00Z`).getTime() + i * DAY).toISOString().slice(0, 10)
    const key = keyOf(day)
    if (index[key] === undefined) {
      index[key] = points.length
      points.push({ date: key, created: 0, completed: 0 })
    }
  }
  rows.forEach((row) => {
    if (inPeriod(row.createdAt, ctx)) {
      const i = index[keyOf(localDay(row.createdAt, ctx.tzOffset))]
      if (i !== undefined) points[i].created += 1
    }
    if (categoryOf(row, ctx) === 'done' && inPeriod(row.completedAt, ctx)) {
      const i = index[keyOf(localDay(row.completedAt, ctx.tzOffset))]
      if (i !== undefined) points[i].completed += 1
    }
  })
  return { bucket, points }
}

function periodIssue(from, to) {
  if (to < from) return 'to_before_from'
  if ((to - from) / DAY > MAX_PERIOD_DAYS) return 'too_long'
  return null
}

module.exports = { DIMENSIONS, METRICS, MAX_PERIOD_DAYS, localDay, indicators, selectForMetric, breakdown, series, periodIssue }
