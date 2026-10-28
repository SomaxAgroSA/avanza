/**
 * Campos personalizados e tipos de tarefa — regras puras (sem PocketBase).
 *
 * Campos são definidos numa biblioteca global; cada tipo de tarefa escolhe seus campos e,
 * por tipo, define obrigatoriedade, visibilidade, exibição no card e ordem.
 * O valor de cada campo é validado aqui (usado pelas tarefas na Fase 4).
 */

/**
 * O que cada tipo permite:
 * - options: tem lista de opções; defaultValue: aceita valor padrão;
 * - searchable/filterable/sortable: flags que o administrador pode ligar.
 */
const TYPE_INFO = Object.freeze({
  text: { options: false, defaultValue: true, searchable: true, filterable: true, sortable: true },
  textarea: { options: false, defaultValue: true, searchable: true, filterable: false, sortable: false },
  number: { options: false, defaultValue: true, searchable: false, filterable: true, sortable: true },
  decimal: { options: false, defaultValue: true, searchable: false, filterable: true, sortable: true },
  boolean: { options: false, defaultValue: true, searchable: false, filterable: true, sortable: true },
  date: { options: false, defaultValue: true, searchable: false, filterable: true, sortable: true },
  datetime: { options: false, defaultValue: true, searchable: false, filterable: true, sortable: true },
  select: { options: true, defaultValue: true, searchable: false, filterable: true, sortable: true },
  multiselect: { options: true, defaultValue: true, searchable: false, filterable: true, sortable: false },
  user: { options: false, defaultValue: false, searchable: false, filterable: true, sortable: false },
  users: { options: false, defaultValue: false, searchable: false, filterable: true, sortable: false },
  project: { options: false, defaultValue: false, searchable: false, filterable: true, sortable: false },
  url: { options: false, defaultValue: true, searchable: true, filterable: false, sortable: false },
  email: { options: false, defaultValue: true, searchable: true, filterable: false, sortable: false },
  phone: { options: false, defaultValue: true, searchable: true, filterable: false, sortable: false },
  image: { options: false, defaultValue: false, searchable: false, filterable: false, sortable: false },
  file: { options: false, defaultValue: false, searchable: false, filterable: false, sortable: false },
})

const FIELD_TYPES = Object.freeze(Object.keys(TYPE_INFO))
const OPTION_COLORS = Object.freeze(['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink'])

/** Ícones disponíveis para tipos de tarefa (a interface mapeia para os ícones visuais). */
const TASK_TYPE_ICONS = Object.freeze([
  'bug', 'code', 'sparkles', 'wrench', 'plus-square', 'plug', 'life-buoy', 'book', 'check-square',
  'flag', 'zap', 'shield', 'rocket', 'target', 'file-text', 'layers', 'search', 'settings',
])

const NAME_PATTERN = /^[a-z][a-z0-9_]{1,39}$/
const TYPE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,29}$/
const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_PATTERN = /^https?:\/\/[^\s/$.?#][^\s]*$/i
const PHONE_PATTERN = /^\+?[0-9 ().-]{7,20}$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function typeInfo(type) {
  return TYPE_INFO[type] || null
}

function stripAccents(value) {
  try {
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  } catch (_) {
    return String(value)
  }
}

/** "Passos para reprodução" -> "passos_para_reproducao" */
function slugifyName(label) {
  return stripAccents(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[_0-9]+|_+$/g, '')
    .slice(0, 40)
}

function nameIssue(name) {
  return NAME_PATTERN.test(name) ? null : 'invalid_format'
}

/** " nova funcionalidade " -> "NOVA_FUNCIONALIDADE" */
function normalizeTypeKey(key) {
  return stripAccents(key)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
}

function typeKeyIssue(key) {
  return TYPE_KEY_PATTERN.test(key) ? null : 'invalid_format'
}

function isInt(value) {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value
}

function isNum(value) {
  return typeof value === 'number' && isFinite(value)
}

/**
 * Normaliza a configuração do campo conforme o tipo (propriedades desconhecidas são descartadas).
 * Retorna { value } ou { error: '<campo_da_config>' }.
 */
function normalizeConfig(type, raw) {
  const config = raw && typeof raw === 'object' ? raw : {}
  const has = (key) => config[key] !== undefined && config[key] !== null && config[key] !== ''

  if (type === 'text' || type === 'textarea') {
    const limit = type === 'text' ? 255 : 10000
    const maxLength = has('max_length') ? Number(config.max_length) : limit
    if (!isInt(maxLength) || maxLength < 1 || maxLength > limit) return { error: 'max_length' }
    return { value: { max_length: maxLength } }
  }

  if (type === 'number' || type === 'decimal') {
    const out = {}
    if (type === 'decimal') {
      const decimals = has('decimals') ? Number(config.decimals) : 2
      if (!isInt(decimals) || decimals < 0 || decimals > 6) return { error: 'decimals' }
      out.decimals = decimals
    }
    for (const key of ['min', 'max']) {
      if (!has(key)) continue
      const n = Number(config[key])
      if (!isNum(n) || (type === 'number' && !isInt(n))) return { error: key }
      out[key] = n
    }
    if (out.min !== undefined && out.max !== undefined && out.min > out.max) return { error: 'min_greater_than_max' }
    return { value: out }
  }

  return { value: {} }
}

function isEmptyValue(value) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  )
}

function validDate(value) {
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().slice(0, 10) === value
}

function uniqueStrings(list) {
  return list.filter((item, index) => list.indexOf(item) === index)
}

/**
 * Valida (e normaliza) o valor de um campo.
 * `field` = { type, config, options: [{ id, is_active }] }. Vazio vira null (obrigatoriedade é checada fora).
 * Retorna { value } ou { error }.
 */
function validateValue(field, raw) {
  if (isEmptyValue(raw)) return { value: null }
  const config = field.config || {}
  const activeOption = (id) => (field.options || []).some((o) => o.id === id && o.is_active !== false)

  switch (field.type) {
    case 'text':
    case 'textarea': {
      if (typeof raw !== 'string') return { error: 'invalid_type' }
      const value = raw.trim()
      return value.length > (config.max_length || 255) ? { error: 'too_long' } : { value }
    }
    case 'number':
    case 'decimal': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(',', '.')) : NaN
      if (!isNum(n)) return { error: 'invalid_type' }
      let value = n
      if (field.type === 'number') {
        if (!isInt(n)) return { error: 'not_integer' }
      } else {
        const factor = Math.pow(10, config.decimals === undefined ? 2 : config.decimals)
        value = Math.round(n * factor) / factor
      }
      if (config.min !== undefined && value < config.min) return { error: 'too_small' }
      if (config.max !== undefined && value > config.max) return { error: 'too_large' }
      return { value }
    }
    case 'boolean':
      return typeof raw === 'boolean' ? { value: raw } : { error: 'invalid_type' }
    case 'date':
      return typeof raw === 'string' && validDate(raw) ? { value: raw } : { error: 'invalid_date' }
    case 'datetime': {
      const date = typeof raw === 'string' ? new Date(raw) : null
      return date && !isNaN(date.getTime()) ? { value: date.toISOString() } : { error: 'invalid_date' }
    }
    case 'select':
      if (typeof raw !== 'string') return { error: 'invalid_type' }
      return activeOption(raw) ? { value: raw } : { error: 'invalid_option' }
    case 'multiselect': {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) return { error: 'invalid_type' }
      const value = uniqueStrings(raw)
      return value.every(activeOption) ? { value } : { error: 'invalid_option' }
    }
    case 'url': {
      if (typeof raw !== 'string') return { error: 'invalid_type' }
      const value = raw.trim()
      return URL_PATTERN.test(value) && value.length <= 2000 ? { value } : { error: 'invalid_url' }
    }
    case 'email': {
      if (typeof raw !== 'string') return { error: 'invalid_type' }
      const value = raw.trim()
      return EMAIL_PATTERN.test(value) && value.length <= 254 ? { value } : { error: 'invalid_email' }
    }
    case 'phone': {
      if (typeof raw !== 'string') return { error: 'invalid_type' }
      const value = raw.trim()
      const digits = value.replace(/[^0-9]/g, '').length
      return PHONE_PATTERN.test(value) && digits >= 7 ? { value } : { error: 'invalid_phone' }
    }
    case 'user':
    case 'project':
      return typeof raw === 'string' && ID_PATTERN.test(raw) ? { value: raw } : { error: 'invalid_type' }
    case 'users':
    case 'image':
    case 'file': {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string' || !ID_PATTERN.test(v))) return { error: 'invalid_type' }
      return { value: uniqueStrings(raw) }
    }
    default:
      return { error: 'invalid_type' }
  }
}

module.exports = {
  FIELD_TYPES,
  OPTION_COLORS,
  TASK_TYPE_ICONS,
  typeInfo,
  slugifyName,
  nameIssue,
  normalizeTypeKey,
  typeKeyIssue,
  normalizeConfig,
  validateValue,
  isEmptyValue,
}
