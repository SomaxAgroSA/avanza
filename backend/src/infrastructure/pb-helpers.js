/**
 * Utilitários de baixo nível para lidar com o PocketBase (JSVM).
 * Só a camada de infraestrutura deve importar este módulo.
 */

/** Converte types.DateTime do PocketBase em Date (ou null). */
function toDate(dateTime) {
  if (!dateTime || (typeof dateTime.isZero === 'function' && dateTime.isZero())) return null
  const raw = typeof dateTime.string === 'function' ? dateTime.string() : String(dateTime)
  if (!raw) return null
  const parsed = new Date(raw.replace(' ', 'T'))
  return isNaN(parsed.getTime()) ? null : parsed
}

/** Date -> string aceita pelos campos `date` do PocketBase ("" limpa o campo). */
function toPbDate(date) {
  return date ? new Date(date).toISOString().replace('T', ' ') : ''
}

function isNotFoundError(err) {
  const message = String((err && err.message) || err || '')
  return message.indexOf('no rows in result set') >= 0
}

/** Executa uma busca e converte "registro inexistente" em null; outros erros são propagados. */
function findOrNull(fn) {
  try {
    return fn()
  } catch (err) {
    if (isNotFoundError(err)) return null
    throw err
  }
}

/** Normaliza valores Go (maps/slices) em objetos JS puros. */
function toPlain(value) {
  if (value === undefined || value === null) return value
  return JSON.parse(JSON.stringify(value))
}

module.exports = { toDate, toPbDate, findOrNull, isNotFoundError, toPlain }
