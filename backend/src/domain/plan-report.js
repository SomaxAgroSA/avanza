/**
 * Quadro do projeto — GP-4: relatórios e indicadores (docs/diretriz_feature_gerenciamento_projetos.md
 * §16). Sobre os elementos de primeiro nível; cancelados ficam fora das contas (só contam em
 * `canceled`). "Aberto" = nem feito nem cancelado. "Hoje" vem no fuso de quem consulta.
 *
 * - Resumo: total, feitos, pendentes, atrasados (fim antes de hoje), parados (etiqueta da categoria
 *   parado/bloqueado ou dependência pendente) e progresso (ponderado pelo esforço, como no rodapé).
 * - Cronograma dos abertos: no prazo, atrasados e sem datas.
 * - Esforço: estimado, realizado (o do elemento ou, sem ele, a soma dos subelementos), restante
 *   (estimado − realizado, mínimo 0) e desvio dos feitos (realizado − estimado).
 * - Recursos e grupos: elementos e esforço de cada um.
 * - Saúde do projeto: o pior dos fatores com dados, sempre com cada fator e o seu valor.
 */

const { weighted } = require('./plan')

const DAY_MS = 86400000
const HEALTH_FACTORS = ['schedule', 'progress', 'stuck', 'effort', 'issues']
/** Limites de cada fator: até `ok` está bem; até `attention`, atenção; acima, crítico. */
const LIMITS = {
  schedule: { ok: 0, attention: 20 }, // % dos abertos com data que estão atrasados
  progress: { ok: 10, attention: 25 }, // pontos de progresso abaixo do planejado
  stuck: { ok: 0, attention: 10 }, // % dos abertos parados
  effort: { ok: 10, attention: 25 }, // % de realizado acima do estimado (feitos)
  issues: { ok: 0, attention: 2 }, // problemas em aberto na Gestão
}
const RANK = { none: -1, ok: 0, attention: 1, critical: 2 }

const metric = (item, key) => (item.metrics && typeof item.metrics[key] === 'number' ? item.metrics[key] : null)
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100
const sum = (values) => {
  const list = values.filter((v) => v !== null && v !== undefined)
  return list.length ? round2(list.reduce((a, b) => a + b, 0)) : null
}
const percent = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0)
const toTime = (day) => Date.parse(`${day}T00:00:00Z`)

function levelOf(value, okMax, attentionMax) {
  if (value <= okMax) return 'ok'
  return value <= attentionMax ? 'attention' : 'critical'
}

/** Fim do elemento (uma data só vale como fim). */
const endOf = (item) => item.endDate || item.startDate || null
const startOf = (item) => item.startDate || item.endDate || null

/** % esperado pelo tempo decorrido: antes do início 0; depois do fim 100; no meio, a fração dos dias. */
function expectedProgress(item, today) {
  const start = toTime(startOf(item))
  const end = toTime(endOf(item))
  const now = toTime(today)
  if (now < start) return 0
  if (now >= end) return 100
  return Math.round(((Math.round((now - start) / DAY_MS) + 1) / (Math.round((end - start) / DAY_MS) + 1)) * 100)
}

/**
 * `options`: { items (entidades, com subelementos), categoryOf(item), progress ({ id: { value } }),
 * groups (na ordem, com number), resources, issues (da Gestão), pending ({ id: true }: dependência
 * pendente), today (AAAA-MM-DD) }.
 */
function planReport(options) {
  const today = options.today
  const categoryOf = options.categoryOf
  const progressOf = (item) => (options.progress[item.id] || { value: 0 }).value
  const children = {}
  options.items.forEach((i) => {
    if (i.parentId) (children[i.parentId] = children[i.parentId] || []).push(i)
  })
  const top = options.items.filter((i) => !i.parentId)
  const active = top.filter((i) => categoryOf(i) !== 'canceled')
  const isDone = (i) => categoryOf(i) === 'done'
  const done = active.filter(isDone)
  const open = active.filter((i) => !isDone(i))
  const isOverdue = (i) => !isDone(i) && !!endOf(i) && endOf(i) < today
  const isStuck = (i) => !isDone(i) && (categoryOf(i) === 'blocked' || !!options.pending[i.id])
  const actualOf = (i) => {
    const own = metric(i, 'actual_hours')
    return own !== null ? own : sum((children[i.id] || []).map((c) => metric(c, 'actual_hours')))
  }
  const progressAvg = (list) => weighted(list.map((i) => ({ value: progressOf(i), weight: metric(i, 'estimated_hours') })))

  const overdue = open.filter(isOverdue)
  const stuck = open.filter(isStuck)
  const summary = { total: top.length, done: done.length, open: open.length, overdue: overdue.length, stuck: stuck.length, canceled: top.length - active.length, progress: progressAvg(active) }
  const schedule = { on_time: open.filter((i) => endOf(i) && !isOverdue(i)).length, overdue: overdue.length, unscheduled: open.filter((i) => !endOf(i)).length, done: done.length }

  const estimated = sum(active.map((i) => metric(i, 'estimated_hours')))
  const actual = sum(active.map(actualOf))
  const measured = done.filter((i) => metric(i, 'estimated_hours') !== null && actualOf(i) !== null)
  const measuredEstimate = sum(measured.map((i) => metric(i, 'estimated_hours'))) || 0
  const measuredActual = sum(measured.map(actualOf)) || 0
  const deviation = measured.length && measuredEstimate > 0 ? { hours: round2(measuredActual - measuredEstimate), percent: Math.round(((measuredActual - measuredEstimate) / measuredEstimate) * 100) } : null
  const effort = { estimated, actual, remaining: estimated === null ? null : round2(Math.max(0, estimated - (actual || 0))), deviation }

  const resourceRow = (id, list) => ({ resource_id: id, items: list.length, open: list.filter((i) => !isDone(i)).length, estimated: sum(list.map((i) => metric(i, 'estimated_hours'))) })
  const resources = options.resources.map((r) => Object.assign({ name: r.name, color: r.color }, resourceRow(r.id, active.filter((i) => (i.resourceIds || []).indexOf(r.id) >= 0)))).filter((r) => r.items > 0)
  const known = {}
  options.resources.forEach((r) => {
    known[r.id] = true
  })
  const withoutResource = active.filter((i) => !(i.resourceIds || []).some((id) => known[id]))
  if (withoutResource.length) resources.push(Object.assign({ name: null, color: null }, resourceRow(null, withoutResource)))

  const groups = options.groups.map((g) => {
    const list = active.filter((i) => i.groupId === g.id)
    return {
      group_id: g.id,
      number: g.number || null,
      name: g.name,
      color: g.color,
      items: list.length,
      done: list.filter(isDone).length,
      overdue: list.filter(isOverdue).length,
      progress: progressAvg(list),
      estimated: sum(list.map((i) => metric(i, 'estimated_hours'))),
      actual: sum(list.map(actualOf)),
    }
  })

  return { today, summary, schedule, effort, resources, groups, health: health({ open, overdue, stuck, active, today, deviation, issues: options.issues, progressOf }) }
}

function health(data) {
  const factor = (key, value, extra) => Object.assign({ key, value, level: value === null ? 'none' : levelOf(value, LIMITS[key].ok, LIMITS[key].attention) }, extra || {})
  const dated = data.open.filter(endOf)
  const scheduled = data.active.filter(startOf)
  const planned = scheduled.length ? weighted(scheduled.map((i) => ({ value: expectedProgress(i, data.today), weight: metric(i, 'estimated_hours') }))) : null
  const actual = scheduled.length ? weighted(scheduled.map((i) => ({ value: data.progressOf(i), weight: metric(i, 'estimated_hours') }))) : null
  const openIssues = (data.issues || []).filter((i) => i.state !== 'resolved').length
  const factors = [
    factor('schedule', dated.length ? percent(data.overdue.filter(endOf).length, dated.length) : null, { count: data.overdue.length, of: dated.length }),
    factor('progress', planned === null ? null : Math.max(0, planned - actual), { planned, actual }),
    factor('stuck', data.open.length ? percent(data.stuck.length, data.open.length) : null, { count: data.stuck.length, of: data.open.length }),
    factor('effort', data.deviation ? Math.max(0, data.deviation.percent) : null, { hours: data.deviation ? data.deviation.hours : null }),
    factor('issues', openIssues),
  ]
  const level = factors.reduce((worst, f) => (RANK[f.level] > RANK[worst] ? f.level : worst), 'none')
  return { level, factors }
}

module.exports = { HEALTH_FACTORS, LIMITS, levelOf, expectedProgress, planReport }
