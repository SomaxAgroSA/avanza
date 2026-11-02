/**
 * Ficha do projeto (regras de negócio §21): objetivos, funcionalidades, escopo e resultados esperados,
 * com o avanço medido pelo que já existe no sistema.
 *
 * - Funcionalidade: vinculada a tarefas do projeto. Estado `auto` = calculado pelas tarefas
 *   (nenhuma começou → planejada; alguma começou → em desenvolvimento; todas concluídas → entregue).
 *   Tarefas canceladas não contam. Qualquer outro estado gravado é a escolha manual de quem edita.
 * - Objetivo: vinculado a funcionalidades e resultados. Estado `auto` = calculado pelos vínculos
 *   (algum resultado atrasado → em risco; tudo entregue/cumprido → atingido; algo andando → em curso).
 * - Resultado esperado: indicador com partida, meta, prazo e o valor atual (medições). Situação:
 *   cumprido (chegou à meta), no caminho (no ritmo de uma reta entre o início e o prazo) ou atrasado;
 *   sem medição = sem dados. Com frequência de medição, fica "sem medir" quando passa do intervalo.
 * - Completude: quatro seções (objetivos, funcionalidades, escopo incluído, resultados).
 */

const KINDS = Object.freeze(['objective', 'feature', 'scope_in', 'scope_out', 'result'])
const OBJECTIVE_STATES = Object.freeze(['auto', 'pending', 'in_progress', 'achieved', 'at_risk'])
const FEATURE_STATES = Object.freeze(['auto', 'planned', 'in_progress', 'delivered', 'cancelled'])
const FREQUENCIES = Object.freeze(['none', 'weekly', 'monthly', 'quarterly'])
const FREQUENCY_DAYS = Object.freeze({ weekly: 7, monthly: 31, quarterly: 92 })
const SECTIONS = Object.freeze(['objectives', 'features', 'scope', 'results'])

const OBJECTIVE_MAX = 2000
const TITLE_MAX = 200
const DESCRIPTION_MAX = 1000
const UNIT_MAX = 20
const NOTE_MAX = 500
const MAX_ITEMS = 200
const MAX_TASKS = 200
const MAX_LINKS = 50

const DAY_MS = 24 * 3600 * 1000

/** Dia AAAA-MM-DD → número de dias desde 1970 (UTC); null sem data. */
function dayNumber(value) {
  if (!value) return null
  const text = typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10)
  const time = Date.parse(`${text}T00:00:00.000Z`)
  return isNaN(time) ? null : Math.round(time / DAY_MS)
}

/** Tarefas vinculadas: { done, total, started } sem as canceladas. `categories` = categorias de status. */
function taskProgress(categories) {
  let done = 0
  let total = 0
  let started = 0
  ;(categories || []).forEach((category) => {
    if (category === 'cancelled') return
    total += 1
    if (category === 'done') done += 1
    if (category === 'done' || category === 'in_progress') started += 1
  })
  return { done, total, started }
}

function featureState(item, categories) {
  if (item.state && item.state !== 'auto') return item.state
  const progress = taskProgress(categories)
  if (progress.total === 0) return 'planned'
  if (progress.done === progress.total) return 'delivered'
  return progress.started > 0 ? 'in_progress' : 'planned'
}

const finite = (value) => typeof value === 'number' && isFinite(value)

/** Meta acima da partida = quanto mais, melhor; abaixo = quanto menos, melhor. */
function resultPercent(item) {
  if (!finite(item.current) || !finite(item.target)) return 0
  const baseline = finite(item.baseline) ? item.baseline : 0
  if (item.target === baseline) return item.current === item.target ? 100 : 0
  const ratio = (item.current - baseline) / (item.target - baseline)
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100)
}

/** 'achieved' | 'on_track' | 'late' | 'no_data'. `today` = AAAA-MM-DD. */
function resultSituation(item, today) {
  if (!finite(item.current) || !finite(item.target)) return 'no_data'
  const baseline = finite(item.baseline) ? item.baseline : 0
  const rising = item.target >= baseline
  const reached = rising ? item.current >= item.target : item.current <= item.target
  if (reached) return 'achieved'
  const due = dayNumber(item.dueDate)
  const now = dayNumber(today)
  if (due === null || now === null) return 'on_track'
  if (now > due) return 'late'
  const start = dayNumber(item.startDate) !== null ? dayNumber(item.startDate) : dayNumber(item.createdAt)
  const fraction = start === null || start >= due ? 1 : Math.max(0, Math.min(1, (now - start) / (due - start)))
  const expected = baseline + (item.target - baseline) * fraction
  return (rising ? item.current >= expected : item.current <= expected) ? 'on_track' : 'late'
}

/** Passou do intervalo da frequência sem medição nova (conta da criação, se nunca mediu)? */
function isStale(item, today) {
  const days = FREQUENCY_DAYS[item.frequency]
  if (!days) return false
  const last = dayNumber(item.measuredAt) !== null ? dayNumber(item.measuredAt) : dayNumber(item.createdAt)
  const now = dayNumber(today)
  if (last === null || now === null) return false
  return now - last > days
}

/** `linked` = [{ kind, state }] dos vínculos já resolvidos (estado efetivo / situação). */
function objectiveState(item, linked) {
  if (item.state && item.state !== 'auto') return item.state
  const relevant = (linked || []).filter((l) => !(l.kind === 'feature' && l.state === 'cancelled'))
  if (relevant.length === 0) return 'pending'
  if (relevant.some((l) => l.kind === 'result' && l.state === 'late')) return 'at_risk'
  const finished = (l) => (l.kind === 'feature' ? l.state === 'delivered' : l.state === 'achieved')
  if (relevant.every(finished)) return 'achieved'
  const moving = (l) => (l.kind === 'feature' ? l.state === 'in_progress' || l.state === 'delivered' : l.state !== 'no_data')
  return relevant.some(moving) ? 'in_progress' : 'pending'
}

function completeness(objective, items) {
  const has = (kind) => items.some((i) => i.kind === kind)
  const sections = {
    objectives: !!(objective && objective.trim()) || has('objective'),
    features: has('feature'),
    scope: has('scope_in'),
    results: has('result'),
  }
  const done = SECTIONS.filter((s) => sections[s]).length
  return { sections, done, total: SECTIONS.length, percent: Math.round((done / SECTIONS.length) * 100) }
}

/**
 * Calcula tudo da ficha. `items` = itens gravados; `categoriesOf(taskIds)` = categorias de status das
 * tarefas vinculadas (as que não existem mais ficam de fora). Devolve os itens com `effectiveState`,
 * `progress`, `situation`, `percent`, `stale`, além da completude e do resumo.
 */
function evaluate(objective, items, categoriesOf, today) {
  const computed = items.map((item) => {
    const out = Object.assign({}, item)
    if (item.kind === 'feature') {
      const categories = categoriesOf(item.taskIds || [])
      out.progress = taskProgress(categories)
      out.effectiveState = featureState(item, categories)
    } else if (item.kind === 'result') {
      out.situation = resultSituation(item, today)
      out.percent = resultPercent(item)
      out.stale = isStale(item, today)
    }
    return out
  })
  const byId = {}
  computed.forEach((item) => {
    byId[item.id] = item
  })
  computed.forEach((item) => {
    if (item.kind !== 'objective') return
    const linked = (item.linkIds || [])
      .map((id) => byId[id])
      .filter((l) => l && (l.kind === 'feature' || l.kind === 'result'))
      .map((l) => ({ kind: l.kind, state: l.kind === 'feature' ? l.effectiveState : l.situation }))
    item.effectiveState = objectiveState(item, linked)
  })

  const features = computed.filter((i) => i.kind === 'feature' && i.effectiveState !== 'cancelled')
  const results = computed.filter((i) => i.kind === 'result')
  const summary = {
    features_total: features.length,
    features_delivered: features.filter((i) => i.effectiveState === 'delivered').length,
    tasks_total: features.reduce((sum, i) => sum + i.progress.total, 0),
    tasks_done: features.reduce((sum, i) => sum + i.progress.done, 0),
    results_total: results.length,
    results_on_track: results.filter((i) => i.situation === 'on_track' || i.situation === 'achieved').length,
    results_late: results.filter((i) => i.situation === 'late').length,
    results_stale: results.filter((i) => i.stale).length,
  }
  return { items: computed, completeness: completeness(objective, items), summary }
}

module.exports = {
  KINDS,
  OBJECTIVE_STATES,
  FEATURE_STATES,
  FREQUENCIES,
  FREQUENCY_DAYS,
  SECTIONS,
  OBJECTIVE_MAX,
  TITLE_MAX,
  DESCRIPTION_MAX,
  UNIT_MAX,
  NOTE_MAX,
  MAX_ITEMS,
  MAX_TASKS,
  MAX_LINKS,
  taskProgress,
  featureState,
  resultPercent,
  resultSituation,
  isStale,
  objectiveState,
  completeness,
  evaluate,
}
