/**
 * Validação declarativa de entrada.
 *
 * Cada regra recebe o valor e devolve `{ value }` (possivelmente normalizado) ou `{ error: '<codigo>' }`.
 * Os códigos de erro (ex.: 'required', 'invalid_email') são traduzidos no frontend via i18n.
 */

const { appError } = require('./errors')

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isEmpty(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

function markRequired(rule) {
  rule.isRequired = true
  return rule
}

const rules = {
  required: () => markRequired((value) => (isEmpty(value) ? { error: 'required' } : { value })),

  string: () => (value) => (typeof value === 'string' ? { value: value.trim() } : { error: 'invalid_type' }),

  email: () => (value) => {
    if (typeof value !== 'string') return { error: 'invalid_type' }
    const trimmed = value.trim()
    return EMAIL_PATTERN.test(trimmed) && trimmed.length <= 254 ? { value: trimmed } : { error: 'invalid_email' }
  },

  minLength: (min) => (value) => {
    if (typeof value !== 'string') return { error: 'invalid_type' }
    return value.length < min ? { error: 'too_short' } : { value }
  },

  maxLength: (max) => (value) => {
    if (typeof value !== 'string') return { error: 'invalid_type' }
    const trimmed = value.trim()
    return trimmed.length > max ? { error: 'too_long' } : { value: trimmed }
  },

  pattern: (regex) => (value) => {
    if (typeof value !== 'string') return { error: 'invalid_type' }
    return regex.test(value) ? { value } : { error: 'invalid_format' }
  },

  oneOf: (options) => (value) => (options.indexOf(value) >= 0 ? { value } : { error: 'invalid_option' }),

  boolean: () => (value) => (typeof value === 'boolean' ? { value } : { error: 'invalid_type' }),

  /** Data/hora ISO 8601; o valor validado vira Date. */
  isoDate: () => (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return { error: 'invalid_date' }
    const date = new Date(value)
    return isNaN(date.getTime()) ? { error: 'invalid_date' } : { value: date }
  },

  stringArray: (max) => (value) => {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return { error: 'invalid_type' }
    if (max && value.length > max) return { error: 'too_many' }
    return { value: value.slice() }
  },

  custom: (fn) => (value) => {
    const issue = fn(value)
    return issue ? { error: issue } : { value }
  },
}

/**
 * Valida `input` contra `schema` ({ campo: [regra, ...] }).
 * Campos ausentes e sem `required` são ignorados. Retorna { value, errors }.
 */
function validate(input, schema) {
  const source = input || {}
  const value = {}
  const errors = {}

  Object.keys(schema).forEach((field) => {
    const fieldRules = schema[field]
    let current = source[field]

    if (current === undefined || current === null) {
      if (fieldRules.some((rule) => rule.isRequired)) errors[field] = 'required'
      return
    }

    for (let i = 0; i < fieldRules.length; i++) {
      const result = fieldRules[i](current)
      if (result.error) {
        errors[field] = result.error
        return
      }
      current = result.value
    }
    value[field] = current
  })

  return { value, errors }
}

/** Igual a `validate`, mas lança VALIDATION_ERROR quando houver erros. */
function assertValid(input, schema) {
  const result = validate(input, schema)
  if (Object.keys(result.errors).length > 0) {
    throw appError('VALIDATION_ERROR', undefined, { fields: result.errors })
  }
  return result.value
}

module.exports = { rules, validate, assertValid, isEmpty }
