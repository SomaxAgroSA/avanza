/**
 * Quadro do projeto — GP-5: colunas personalizadas (docs/diretriz_feature_gerenciamento_projetos.md
 * §5.5 e §22). O gestor adiciona colunas ao quadro (texto, número, data, caixa de seleção, lista de
 * opções, pessoa e link), renomeia, duplica, altera o tipo e exclui; quem edita o quadro preenche as
 * células dos elementos. Os valores ficam no elemento (`custom`: { coluna: valor }).
 *
 * Regras puras: validação da coluna e dos valores e a conversão ao alterar o tipo.
 */

const { OPTION_COLORS } = require('./custom-field')

const COLUMN_TYPES = ['text', 'number', 'date', 'checkbox', 'dropdown', 'people', 'link']
const MAX_COLUMNS = 30
const NAME_MAX = 60
const OPTION_NAME_MAX = 40
const MAX_OPTIONS = 30
const UNIT_MAX = 8
const TEXT_MAX = 500
const LINK_MAX = 2000
const NUMBER_MAX = 1e12

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const isId = (value) => typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value)
const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(`${value}T00:00:00Z`))
const nameKey = (value) =>
  text(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
const isEmpty = (value) => value === null || value === undefined || value === ''

/* ------------------------------------------------------------------ definição */

/**
 * Opções da lista: nome (≤ 40, sem repetir), cor; as que já existem mantêm o `id` (os valores dos
 * elementos apontam para ele). `newId()` gera o id das novas.
 */
function readOptions(raw, newId) {
  if (!Array.isArray(raw)) return { issue: 'invalid_type' }
  if (raw.length > MAX_OPTIONS) return { issue: 'too_many' }
  const seen = {}
  const options = []
  for (let i = 0; i < raw.length; i++) {
    const option = raw[i] || {}
    const name = text(option.name)
    if (!name || name.length > OPTION_NAME_MAX || OPTION_COLORS.indexOf(option.color) < 0) return { issue: 'invalid_option' }
    if (seen[nameKey(name)]) return { issue: 'duplicate_option' }
    seen[nameKey(name)] = true
    options.push({ id: isId(option.id) ? option.id : newId(), name, color: option.color })
  }
  return { options }
}

function readSettings(type, raw, newId) {
  const source = raw && typeof raw === 'object' ? raw : {}
  if (type === 'dropdown') {
    const result = readOptions(source.options === undefined ? [] : source.options, newId)
    return result.issue ? { issue: result.issue } : { settings: { options: result.options } }
  }
  if (type === 'number') {
    if (source.unit === undefined || source.unit === null || source.unit === '') return { settings: {} }
    const unit = text(source.unit)
    return unit.length > UNIT_MAX ? { issue: 'too_long' } : { settings: { unit } }
  }
  return { settings: {} }
}

/**
 * `{ name*, type*, settings }` (`partial`: só o que veio — na edição o tipo muda por `changeType`).
 * `settings` depende do tipo: lista → `{ options: [{ id?, name, color }] }`; número → `{ unit }`.
 */
function columnInput(input, partial, newId, currentType) {
  const source = input || {}
  const issues = {}
  const data = {}
  if (!partial || source.name !== undefined) {
    const name = text(source.name)
    if (!name) issues.name = 'required'
    else if (name.length > NAME_MAX) issues.name = 'too_long'
    else data.name = name
  }
  if (!partial) {
    if (source.type === undefined || source.type === null || source.type === '') issues.type = 'required'
    else if (COLUMN_TYPES.indexOf(source.type) < 0) issues.type = 'invalid_option'
    else data.type = source.type
  }
  const type = data.type || currentType
  if (type && (!partial || source.settings !== undefined)) {
    const result = readSettings(type, source.settings, newId)
    if (result.issue) issues.settings = result.issue
    else data.settings = result.settings
  }
  return { issues, data }
}

/* ------------------------------------------------------------------ valores */

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100

/** Valor da célula para a coluna: `{ value }` (null limpa) ou `{ issue }`. */
function normalizeValue(column, raw) {
  if (raw === null || raw === undefined) return { value: null }
  switch (column.type) {
    case 'text': {
      if (typeof raw !== 'string') return { issue: 'invalid_type' }
      const value = raw.trim()
      if (!value) return { value: null }
      return value.length > TEXT_MAX ? { issue: 'too_long' } : { value }
    }
    case 'number':
      if (typeof raw !== 'number' || !isFinite(raw)) return { issue: 'invalid_type' }
      return Math.abs(raw) > NUMBER_MAX ? { issue: 'too_large' } : { value: round2(raw) }
    case 'date':
      if (raw === '') return { value: null }
      return isDay(raw) ? { value: raw } : { issue: 'invalid_date' }
    case 'checkbox':
      return typeof raw === 'boolean' ? { value: raw } : { issue: 'invalid_type' }
    case 'dropdown': {
      if (raw === '') return { value: null }
      const options = (column.settings && column.settings.options) || []
      return options.some((o) => o.id === raw) ? { value: raw } : { issue: 'invalid_option' }
    }
    case 'people':
      if (raw === '') return { value: null }
      return isId(raw) ? { value: raw } : { issue: 'invalid_type' }
    case 'link': {
      if (typeof raw !== 'string') return { issue: 'invalid_type' }
      const value = raw.trim()
      if (!value) return { value: null }
      if (value.length > LINK_MAX) return { issue: 'too_long' }
      return /^https?:\/\/[^\s]+$/i.test(value) ? { value } : { issue: 'invalid_url' }
    }
    default:
      return { issue: 'invalid_type' }
  }
}

/** Valores do elemento só das colunas que existem (vazio = sem a chave). */
function presentValues(custom, columns) {
  const out = {}
  const source = custom && typeof custom === 'object' ? custom : {}
  columns.forEach((c) => {
    if (!isEmpty(source[c.id])) out[c.id] = source[c.id]
  })
  return out
}

/* ------------------------------------------------------------------ alterar o tipo */

function parseNumber(value) {
  const raw = String(value).trim().replace(/\s/g, '')
  if (!/^-?\d+([.,]\d+)?$/.test(raw)) return null
  const n = Number(raw.replace(',', '.'))
  return isFinite(n) && Math.abs(n) <= NUMBER_MAX ? round2(n) : null
}

function parseDay(value) {
  const raw = String(value).trim()
  if (isDay(raw)) return raw
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw)
  if (!br) return null
  const iso = `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`
  return isDay(iso) ? iso : null
}

/** Texto do valor na coluna de origem (para converter para texto ou virar opção). */
function textOf(from, value, ctx) {
  if (from.type === 'dropdown') {
    const option = ((from.settings && from.settings.options) || []).find((o) => o.id === value)
    return option ? option.name : null
  }
  if (from.type === 'people') return ctx.nameOf(value) || null
  if (from.type === 'checkbox') return null
  return String(value)
}

/**
 * Converte os valores de uma coluna para outro tipo: `{ values: { item: valor|null }, settings, lost }`.
 * Texto ↔ número/data/link quando o conteúdo permite; qualquer um → texto; para lista, os textos
 * viram opções (sem repetir, até 30); pessoa → texto pelo nome. O que não converte fica vazio e
 * conta em `lost`. `ctx`: { newId, nameOf(userId) }.
 */
function convertValues(from, to, values, ctx) {
  const options = to.type === 'dropdown' ? ((to.settings && to.settings.options) || []).slice() : null
  const out = {}
  let lost = 0
  Object.keys(values || {}).forEach((itemId) => {
    const value = values[itemId]
    // vazio (ou caixa desmarcada) não é perda
    if (isEmpty(value) || (from.type === 'checkbox' && value === false)) {
      out[itemId] = null
      return
    }
    let next = null
    if (from.type === to.type) next = value
    else if (to.type === 'text') {
      const t = textOf(from, value, ctx)
      next = t ? t.slice(0, TEXT_MAX) : null
    } else if (to.type === 'number') next = from.type === 'text' ? parseNumber(value) : null
    else if (to.type === 'date') next = from.type === 'text' ? parseDay(value) : null
    else if (to.type === 'link') next = ['text'].indexOf(from.type) >= 0 && normalizeValue({ type: 'link' }, value).value ? String(value).trim() : null
    else if (to.type === 'dropdown') {
      const name = (textOf(from, value, ctx) || '').trim().slice(0, OPTION_NAME_MAX)
      if (name) {
        let option = options.find((o) => nameKey(o.name) === nameKey(name))
        if (!option && options.length < MAX_OPTIONS) {
          option = { id: ctx.newId(), name, color: OPTION_COLORS[options.length % OPTION_COLORS.length] }
          options.push(option)
        }
        next = option ? option.id : null
      }
    }
    if (next === null) lost += 1
    out[itemId] = next
  })
  return { values: out, settings: options ? Object.assign({}, to.settings, { options }) : to.settings || {}, lost }
}

module.exports = {
  COLUMN_TYPES,
  MAX_COLUMNS,
  NAME_MAX,
  OPTION_NAME_MAX,
  MAX_OPTIONS,
  TEXT_MAX,
  LINK_MAX,
  columnInput,
  normalizeValue,
  presentValues,
  convertValues,
}
