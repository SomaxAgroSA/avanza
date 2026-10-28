/**
 * Validação dos argumentos de uma ferramenta MCP contra o JSON Schema que ela declara — só o
 * subconjunto que o catálogo usa: objeto com `properties`/`required`/`additionalProperties: false`,
 * `type` (um ou uma lista, ex.: ['string', 'null']), `enum`, `maxLength`, `minimum`/`maximum`,
 * `items` e `maxItems`.
 *
 * Devolve `{ campo: código }` com os códigos da API (`required`, `invalid_type`, `invalid_option`,
 * `too_long`, `too_small`, `too_large`, `too_many`, `unknown_field`): a regra de negócio continua
 * nos casos de uso; aqui só se recusa cedo o que nem tem o formato pedido.
 */

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function matchesType(value, type) {
  return [].concat(type).some((t) => {
    if (t === 'null') return value === null
    if (t === 'integer') return Number.isInteger(value)
    if (t === 'number') return typeof value === 'number' && isFinite(value)
    if (t === 'array') return Array.isArray(value)
    if (t === 'object') return isObject(value)
    return typeof value === t
  })
}

/** Código do primeiro problema do valor, ou null. */
function issueOf(value, schema) {
  if (schema.type !== undefined && !matchesType(value, schema.type)) return 'invalid_type'
  if (value === null) return null
  if (schema.enum && schema.enum.indexOf(value) < 0) return 'invalid_option'
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) return 'too_long'
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return 'too_small'
    if (schema.maximum !== undefined && value > schema.maximum) return 'too_large'
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return 'too_many'
    // item fora do formato: o campo inteiro é inválido (o caso de uso detalha quando precisa)
    if (schema.items && value.some((item) => issueOf(item, schema.items) !== null)) return 'invalid_type'
  }
  if (isObject(value) && schema.properties && Object.keys(validateArguments(value, schema)).length > 0) return 'invalid_type'
  return null
}

function validateArguments(args, schema) {
  if (!isObject(args)) return { arguments: 'invalid_type' }
  const properties = schema.properties || {}
  const fields = {}
  ;(schema.required || []).forEach((key) => {
    if (args[key] === undefined) fields[key] = 'required'
  })
  Object.keys(args).forEach((key) => {
    if (args[key] === undefined) return
    if (!Object.prototype.hasOwnProperty.call(properties, key)) {
      if (schema.additionalProperties === false) fields[key] = 'unknown_field'
      return
    }
    const issue = issueOf(args[key], properties[key])
    if (issue) fields[key] = issue
  })
  return fields
}

module.exports = { validateArguments }
