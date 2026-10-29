/**
 * Peças comuns do catálogo MCP (src/mcp/tools/*.js): anotações, construtores de JSON Schema e o
 * apoio para levar os argumentos ao formato dos casos de uso. Sem regra de negócio.
 */

const READ = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })
/** Só acrescenta (cria, comenta, relaciona). */
const ADD = Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false })
/** Altera o que existe (a mesma chamada de novo não muda mais nada). */
const CHANGE = Object.freeze({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false })
/** Ação com efeito a cada chamada que não é só acrescentar (duplicar, enviar teste, reenviar). */
const ACTION = Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false })
/** Exclui de vez. */
const DELETE = Object.freeze({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false })

// ---------------------------------------------------------------- esquemas

function schema(properties, required) {
  const out = { type: 'object', properties, additionalProperties: false }
  if (required && required.length > 0) out.required = required
  return out
}

const id = (description) => ({ type: 'string', maxLength: 64, description })
const nullableId = (description) => ({ type: ['string', 'null'], maxLength: 64, description: `${description} null clears it.` })
const ids = (max, description) => ({ type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: max, description })
const text = (max, description) => ({ type: 'string', maxLength: max, description })
const nullableText = (max, description) => ({ type: ['string', 'null'], maxLength: max, description: `${description} null clears it.` })
const date = (description) => ({ type: 'string', maxLength: 30, description: `${description} (YYYY-MM-DD).` })
const nullableDate = (description) => ({ type: ['string', 'null'], maxLength: 30, description: `${description} (YYYY-MM-DD); null clears it.` })
const oneOf = (values, description) => ({ type: 'string', enum: values.slice(), description })
const bool = (description) => ({ type: 'boolean', description })
const int = (min, max, description) => ({ type: 'integer', minimum: min, maximum: max, description })
const hours = (description) => ({ type: 'number', minimum: 0.01, maximum: 100000, description })
const nullableHours = (description) => ({ type: ['number', 'null'], minimum: 0.01, maximum: 100000, description: `${description} null clears it.` })
/** Cor: um nome da paleta do lugar ou #rrggbb (ADR-047). */
const color = (description) => ({ type: 'string', maxLength: 20, description: `${description || 'Color'}: a palette name (gray, red, orange, amber, green, teal, blue, indigo, violet, pink) or #rrggbb.` })

const PAGE = {
  page: { type: 'integer', minimum: 1, description: 'Page number, starting at 1.' },
  per_page: { type: 'integer', minimum: 1, maximum: 100, description: 'Items per page (default 20, max 100).' },
}

const PROJECT_ID = id('Project id (from list_projects).')
const TASK_ID = id('Task id (from list_tasks; search accepts a task code such as CRM-12).')

// ---------------------------------------------------------------- apoio

/** Copia só as chaves informadas: `undefined` fica de fora; `null` passa (limpa o campo). */
function pick(args, keys) {
  const out = {}
  keys.forEach((key) => {
    if (args[key] !== undefined) out[key] = args[key]
  })
  return out
}

/** Os argumentos sem as chaves dadas (em geral o id que vai "no caminho"). */
function without(args, ...keys) {
  const out = Object.assign({}, args)
  keys.forEach((key) => delete out[key])
  return out
}

/** `page`/`per_page` no formato da API (`perPage`). */
function pageQuery(args) {
  const query = {}
  if (args.page !== undefined) query.page = args.page
  if (args.per_page !== undefined) query.perPage = args.per_page
  return query
}

const page = (result) => ({ items: result.items, meta: result.meta })

module.exports = {
  READ,
  ADD,
  CHANGE,
  ACTION,
  DELETE,
  schema,
  id,
  nullableId,
  ids,
  text,
  nullableText,
  date,
  nullableDate,
  oneOf,
  bool,
  int,
  hours,
  nullableHours,
  color,
  PAGE,
  PROJECT_ID,
  TASK_ID,
  pick,
  without,
  pageQuery,
  page,
}
