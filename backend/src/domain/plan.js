/**
 * Gerenciamento de Projetos — quadro do plano (docs/diretriz_feature_gerenciamento_projetos.md).
 *
 * Módulo à parte das tarefas: o projeto tem um quadro (estilo Monday) com **grupos** (fases:
 * 1.0 Iniciação, 2.0 Planejamento → 2.1 Plano do Projeto) e **elementos** (reuniões, alinhamentos,
 * entregas) com status próprios, cronograma, recursos (etiquetas), esforço estimado, duração em dias
 * e progresso. Cada elemento pode ter **subelementos** (um nível) com responsável, status, data,
 * cronograma, trabalho (h) e realizado (h).
 *
 * Regras puras: validação, numeração dos grupos, duração, progresso e totais do grupo.
 */

const { OPTION_COLORS } = require('./custom-field')

const GROUP_NAME_MAX = 120
const ITEM_NAME_MAX = 255
const STATUS_NAME_MAX = 40
const RESOURCE_NAME_MAX = 60
const MAX_RESOURCES = 20
const MAX_HOURS = 100000
const MAX_DURATION_DAYS = 3650
const POSITION_STEP = 1024
const DAY_MS = 86400000

/** Categoria de cada etiqueta de status: define o progresso (Feito = 100%) e o que conta como aberto. */
const STATUS_CATEGORIES = ['todo', 'in_progress', 'review', 'blocked', 'done', 'canceled']

/** Etiquetas iniciais do quadro (como no Monday); o projeto edita depois. */
const DEFAULT_STATUSES = {
  'pt-BR': [
    ['Planejado', 'blue', 'todo'],
    ['Em progresso', 'amber', 'in_progress'],
    ['Confirmar', 'pink', 'review'],
    ['Parado', 'red', 'blocked'],
    ['Feito', 'green', 'done'],
  ],
  en: [
    ['Planned', 'blue', 'todo'],
    ['Working on it', 'amber', 'in_progress'],
    ['To confirm', 'pink', 'review'],
    ['Stuck', 'red', 'blocked'],
    ['Done', 'green', 'done'],
  ],
  es: [
    ['Planificado', 'blue', 'todo'],
    ['En curso', 'amber', 'in_progress'],
    ['Confirmar', 'pink', 'review'],
    ['Detenido', 'red', 'blocked'],
    ['Listo', 'green', 'done'],
  ],
}

function defaultStatuses(locale) {
  return (DEFAULT_STATUSES[locale] || DEFAULT_STATUSES['pt-BR']).map(([name, color, category], index) => ({ name, color, category, position: (index + 1) * POSITION_STEP }))
}

/* ------------------------------------------------------------------ apoio */

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const isId = (value) => typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value)
const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(`${value}T00:00:00Z`))

/** Chave do nome sem acento/maiúsculas (etiquetas de recurso não se repetem no projeto). */
function nameKey(name) {
  return text(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/* ------------------------------------------------------------------ grupos */

/** Problemas no nome/cor do grupo (`partial`: só valida o que veio). */
function groupIssues(input, partial) {
  const issues = {}
  const data = input || {}
  if (!partial || data.name !== undefined) {
    const name = text(data.name)
    if (!name) issues.name = 'required'
    else if (name.length > GROUP_NAME_MAX) issues.name = 'too_long'
  }
  if ((!partial || data.color !== undefined) && OPTION_COLORS.indexOf(data.color) < 0) issues.color = 'invalid_option'
  return issues
}

const byPosition = (a, b) => (a.position || 0) - (b.position || 0) || String(a.name || '').localeCompare(String(b.name || ''))

/** Grupos na ordem do plano: cada grupo raiz seguido dos seus subgrupos. */
function orderGroups(groups) {
  const out = []
  groups
    .filter((g) => !g.parentId)
    .sort(byPosition)
    .forEach((root) => {
      out.push(root)
      groups
        .filter((g) => g.parentId === root.id)
        .sort(byPosition)
        .forEach((child) => out.push(child))
    })
  return out
}

/** Numeração exibida: raiz = "N.0"; subgrupo = "N.M". */
function numberGroups(groups) {
  const numbers = {}
  let major = 0
  const minors = {}
  orderGroups(groups).forEach((group) => {
    if (!group.parentId) {
      major += 1
      numbers[group.id] = `${major}.0`
      minors[group.id] = { major, count: 0 }
    } else {
      const parent = minors[group.parentId]
      if (!parent) return
      parent.count += 1
      numbers[group.id] = `${parent.major}.${parent.count}`
    }
  })
  return numbers
}

/** Pode `groupId` ficar dentro de `parentId`? (null = ok). Até 2 níveis, sem ciclo. */
function groupParentIssue(groups, parentId, groupId) {
  if (!parentId) return null
  if (parentId === groupId) return 'cycle'
  const parent = groups.find((g) => g.id === parentId)
  if (!parent) return 'invalid_option'
  if (parent.parentId) return 'too_deep'
  if (groupId && groups.some((g) => g.parentId === groupId)) return 'too_deep'
  return null
}

/* ------------------------------------------------------------------ etiquetas */

function statusIssues(input, partial) {
  const issues = {}
  const data = input || {}
  if (!partial || data.name !== undefined) {
    const name = text(data.name)
    if (!name) issues.name = 'required'
    else if (name.length > STATUS_NAME_MAX) issues.name = 'too_long'
  }
  if ((!partial || data.color !== undefined) && OPTION_COLORS.indexOf(data.color) < 0) issues.color = 'invalid_option'
  if ((!partial || data.category !== undefined) && STATUS_CATEGORIES.indexOf(data.category) < 0) issues.category = 'invalid_option'
  return issues
}

function resourceIssues(input, partial) {
  const issues = {}
  const data = input || {}
  if (!partial || data.name !== undefined) {
    const name = text(data.name)
    if (!name) issues.name = 'required'
    else if (name.length > RESOURCE_NAME_MAX) issues.name = 'too_long'
  }
  if (data.color !== undefined && OPTION_COLORS.indexOf(data.color) < 0) issues.color = 'invalid_option'
  return issues
}

/* ------------------------------------------------------------------ elementos */

const hoursIssue = (value) => {
  if (typeof value !== 'number' || !isFinite(value)) return 'invalid_type'
  if (value < 0) return 'too_small'
  return value > MAX_HOURS ? 'too_large' : null
}

function progressIssue(value) {
  if (typeof value !== 'number' || !isFinite(value)) return 'invalid_type'
  if (Math.floor(value) !== value) return 'not_integer'
  if (value < 0) return 'too_small'
  return value > 100 ? 'too_large' : null
}

/**
 * Valida o corpo do elemento/subelemento. `partial`: só o que veio (edição). `null` limpa os campos
 * opcionais. Devolve `{ issues, data }` com valores normalizados (horas com 2 casas).
 */
function itemInput(input, partial) {
  const source = input || {}
  const issues = {}
  const data = {}
  const has = (key) => source[key] !== undefined
  if (!partial || has('name')) {
    const name = text(source.name)
    if (!name) issues.name = 'required'
    else if (name.length > ITEM_NAME_MAX) issues.name = 'too_long'
    else data.name = name
  }
  ;['group_id', 'parent_id', 'status_id', 'owner_id'].forEach((key) => {
    if (!has(key)) return
    if (source[key] === null || source[key] === '') data[key] = null
    else if (isId(source[key])) data[key] = source[key]
    else issues[key] = 'invalid_type'
  })
  ;['start_date', 'end_date', 'due_date'].forEach((key) => {
    if (!has(key)) return
    if (source[key] === null || source[key] === '') data[key] = null
    else if (isDay(source[key])) data[key] = source[key]
    else issues[key] = 'invalid_date'
  })
  ;['estimated_hours', 'actual_hours'].forEach((key) => {
    if (!has(key)) return
    if (source[key] === null) data[key] = null
    else {
      const issue = hoursIssue(source[key])
      if (issue) issues[key] = issue
      else data[key] = Math.round((source[key] + Number.EPSILON) * 100) / 100
    }
  })
  if (has('duration_days')) {
    const v = source.duration_days
    if (v === null) data.duration_days = null
    else if (typeof v !== 'number' || Math.floor(v) !== v) issues.duration_days = 'not_integer'
    else if (v < 0) issues.duration_days = 'too_small'
    else if (v > MAX_DURATION_DAYS) issues.duration_days = 'too_large'
    else data.duration_days = v
  }
  if (has('progress')) {
    if (source.progress === null) data.progress = null
    else {
      const issue = progressIssue(source.progress)
      if (issue) issues.progress = issue
      else data.progress = source.progress
    }
  }
  if (has('resource_ids')) {
    const list = source.resource_ids === null ? [] : source.resource_ids
    if (!Array.isArray(list) || list.some((id) => !isId(id))) issues.resource_ids = 'invalid_type'
    else if (list.length > MAX_RESOURCES) issues.resource_ids = 'too_many'
    else data.resource_ids = list.filter((id, i) => list.indexOf(id) === i)
  }
  return { issues, data }
}

/** Início ≤ fim (com o que já está salvo). */
function datesIssue(start, end) {
  return start && end && start > end ? 'end_before_start' : null
}

/** Pai do subelemento: do mesmo grupo/projeto e de primeiro nível (subelemento não tem subelemento). */
function parentIssue(parent, projectId, itemId) {
  if (!parent || parent.projectId !== projectId) return 'invalid_option'
  if (parent.id === itemId) return 'cycle'
  if (parent.parentId) return 'too_deep'
  return null
}

const day = (value) => {
  if (!value) return null
  const d = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : new Date(value)
  return isNaN(d.getTime()) ? null : d.getTime()
}

/** Duração em dias de calendário: pelo cronograma (início e fim contam; uma data = 1 dia) ou a informada. */
function durationOf(item) {
  const a = day(item.startDate)
  const b = day(item.endDate)
  if (a !== null || b !== null) return a === null || b === null ? 1 : Math.max(1, Math.round((b - a) / DAY_MS) + 1)
  const manual = item.metrics ? item.metrics.duration_days : null
  return typeof manual === 'number' ? manual : null
}

const metric = (item, key) => (item.metrics && typeof item.metrics[key] === 'number' ? item.metrics[key] : null)

/** Progresso ponderado pelo peso (horas); sem peso nenhum, a média. */
function weighted(list) {
  if (list.length === 0) return 0
  const total = list.reduce((sum, i) => sum + (i.weight || 0), 0)
  if (total > 0) return Math.round(list.reduce((sum, i) => sum + (i.weight || 0) * i.value, 0) / total)
  return Math.round(list.reduce((sum, i) => sum + i.value, 0) / list.length)
}

/**
 * Progresso (`{ value, source }`):
 * - status "feito" → 100 (`done`);
 * - com subelementos não cancelados → Σ(trabalho × progresso) / Σ(trabalho), ou a média (`subitems`);
 * - senão o informado (`manual`) ou 0 (`none`).
 */
function computeProgress(items, categoryOf) {
  const children = {}
  items.forEach((item) => {
    if (item.parentId) (children[item.parentId] = children[item.parentId] || []).push(item)
  })
  const own = (item) => {
    if (categoryOf(item) === 'done') return { value: 100, source: 'done' }
    if (item.progressSet) return { value: Math.max(0, Math.min(100, Math.round(item.progress || 0))), source: 'manual' }
    return { value: 0, source: 'none' }
  }
  const out = {}
  items.forEach((item) => {
    if (item.parentId) {
      out[item.id] = own(item)
      return
    }
    if (categoryOf(item) === 'done') {
      out[item.id] = { value: 100, source: 'done' }
      return
    }
    const kids = (children[item.id] || []).filter((k) => categoryOf(k) !== 'canceled')
    out[item.id] = kids.length ? { value: weighted(kids.map((k) => ({ value: own(k).value, weight: metric(k, 'estimated_hours') }))), source: 'subitems' } : own(item)
  })
  return out
}

/**
 * Totais do grupo (linha do rodapé, como no Monday), sobre os elementos de primeiro nível:
 * distribuição de status (statusOf = id da etiqueta), período (menor início → maior fim), soma do
 * esforço e da duração e progresso ponderado pelo esforço (sem esforço, a média; cancelados fora).
 * `numberColumns`: ids das colunas personalizadas numéricas (GP-5) — soma em `custom_sums`.
 */
function groupSummary(items, progress, statusOf, categoryOf, numberColumns) {
  const category = categoryOf || (() => null)
  const top = items.filter((i) => !i.parentId)
  const counts = {}
  const order = []
  top.forEach((item) => {
    const key = statusOf(item) || ''
    if (!(key in counts)) order.push(key)
    counts[key] = (counts[key] || 0) + 1
  })
  const starts = []
  const ends = []
  top.forEach((item) => {
    const a = day(item.startDate)
    const b = day(item.endDate)
    if (a !== null) starts.push(a)
    if (b !== null) ends.push(b)
    if (a !== null && b === null) ends.push(a)
    if (b !== null && a === null) starts.push(b)
  })
  const sum = (values) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100 : null)
  const efforts = top.map((i) => metric(i, 'estimated_hours')).filter((v) => v !== null)
  const durations = top.map(durationOf).filter((v) => v !== null)
  return {
    items: top.length,
    status_counts: order.map((key) => ({ status_id: key || null, count: counts[key] })),
    start_date: starts.length ? new Date(Math.min.apply(null, starts)) : null,
    end_date: ends.length ? new Date(Math.max.apply(null, ends)) : null,
    estimated_hours: sum(efforts),
    duration_days: sum(durations),
    progress: weighted(top.filter((i) => category(i) !== 'canceled').map((i) => ({ value: (progress[i.id] || { value: 0 }).value, weight: metric(i, 'estimated_hours') }))),
    custom_sums: customSums(top, numberColumns || []),
  }
}

/** Soma de cada coluna numérica (null quando nenhum elemento tem valor). */
function customSums(items, columnIds) {
  const out = {}
  columnIds.forEach((id) => {
    const values = items.map((i) => (i.custom && typeof i.custom[id] === 'number' ? i.custom[id] : null)).filter((v) => v !== null)
    out[id] = values.length ? Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100 : null
  })
  return out
}

/* ------------------------------------------------------------------ arrastar e soltar (GP-2) */

/**
 * Posição para entrar entre os irmãos (sem o próprio elemento): depois de `prevId`, antes de
 * `nextId`, ou no fim. Sem folga entre os vizinhos → null (renumerar).
 */
function placeAmong(siblings, target) {
  const list = siblings.slice().sort((a, b) => (a.position || 0) - (b.position || 0))
  const index = (id) => list.findIndex((s) => s.id === id)
  const pos = (i) => (list[i] ? list[i].position || 0 : null)
  const between = (a, b) => (b - a > 1e-6 ? (a + b) / 2 : null)
  const t = target || {}
  const prev = t.prevId ? index(t.prevId) : -1
  if (prev >= 0) return pos(prev + 1) === null ? pos(prev) + POSITION_STEP : between(pos(prev), pos(prev + 1))
  const next = t.nextId ? index(t.nextId) : -1
  if (next >= 0) return next === 0 ? pos(0) - POSITION_STEP : between(pos(next - 1), pos(next))
  return (list.length ? pos(list.length - 1) : 0) + POSITION_STEP
}

/* ------------------------------------------------------------------ seleção em massa e mover (GP-2) */

const BULK_ACTIONS = ['update', 'move', 'duplicate', 'delete']
const MAX_BULK = 200

function idList(value) {
  if (!Array.isArray(value) || value.some((id) => !isId(id))) return { issue: 'invalid_type' }
  return { list: value.filter((id, i) => value.indexOf(id) === i) }
}

/**
 * Ação sobre vários elementos: `{ ids, action, ... }`. `update` muda o status (`status_id`, null =
 * em branco) e/ou acrescenta/tira recursos (`add_resource_ids`, `remove_resource_ids`); `move` leva
 * para `group_id`; `duplicate` e `delete` não têm dados.
 */
function bulkInput(input) {
  const source = input || {}
  const issues = {}
  const data = {}
  if (source.ids === undefined) issues.ids = 'required'
  else {
    const ids = idList(source.ids)
    if (ids.issue) issues.ids = ids.issue
    else if (ids.list.length === 0) issues.ids = 'required'
    else if (ids.list.length > MAX_BULK) issues.ids = 'too_many'
    else data.ids = ids.list
  }
  if (source.action === undefined) issues.action = 'required'
  else if (BULK_ACTIONS.indexOf(source.action) < 0) issues.action = 'invalid_option'
  else data.action = source.action

  if (data.action === 'move') {
    if (!isId(source.group_id)) issues.group_id = source.group_id ? 'invalid_type' : 'required'
    else data.group_id = source.group_id
  }
  if (data.action === 'update') {
    if (source.status_id !== undefined) {
      if (source.status_id === null || source.status_id === '') data.status_id = null
      else if (isId(source.status_id)) data.status_id = source.status_id
      else issues.status_id = 'invalid_type'
    }
    ;['add_resource_ids', 'remove_resource_ids'].forEach((key) => {
      if (source[key] === undefined) return
      const ids = idList(source[key])
      if (ids.issue) issues[key] = ids.issue
      else if (ids.list.length > MAX_RESOURCES) issues[key] = 'too_many'
      else if (ids.list.length) data[key] = ids.list
    })
    if (data.status_id === undefined && !data.add_resource_ids && !data.remove_resource_ids && Object.keys(issues).length === 0) issues.data = 'required'
  }
  return { issues, data }
}

/** Mover: `{ group_id?, prev_id? | next_id? }` (sem vizinho = fim do grupo ou do elemento pai). */
function moveInput(input) {
  const source = input || {}
  const issues = {}
  const data = {}
  ;['group_id', 'prev_id', 'next_id'].forEach((key) => {
    if (source[key] === undefined || source[key] === null || source[key] === '') return
    if (isId(source[key])) data[key] = source[key]
    else issues[key] = 'invalid_type'
  })
  return { issues, data }
}

module.exports = {
  BULK_ACTIONS,
  MAX_BULK,
  bulkInput,
  moveInput,
  GROUP_NAME_MAX,
  ITEM_NAME_MAX,
  STATUS_NAME_MAX,
  RESOURCE_NAME_MAX,
  MAX_RESOURCES,
  POSITION_STEP,
  STATUS_CATEGORIES,
  defaultStatuses,
  nameKey,
  groupIssues,
  orderGroups,
  numberGroups,
  groupParentIssue,
  statusIssues,
  resourceIssues,
  progressIssue,
  itemInput,
  datesIssue,
  parentIssue,
  durationOf,
  weighted,
  computeProgress,
  groupSummary,
  placeAmong,
}
