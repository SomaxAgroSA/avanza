/**
 * Paginação e ordenação seguras.
 *
 * A ordenação só aceita campos presentes na whitelist (`allowed`: campoPublico -> colunaDoBanco),
 * o que impede injeção via parâmetro `sort` e exposição de colunas internas.
 */

const DEFAULTS = { defaultPerPage: 20, maxPerPage: 100 }

function toPositiveInt(raw, fallback) {
  const n = parseInt(raw, 10)
  return isFinite(n) && n > 0 ? n : fallback
}

function parsePagination(query, options) {
  const opts = Object.assign({}, DEFAULTS, options || {})
  const q = query || {}
  const page = toPositiveInt(q.page, 1)
  const perPage = Math.min(toPositiveInt(q.perPage, opts.defaultPerPage), opts.maxPerPage)
  return { page, perPage, offset: (page - 1) * perPage }
}

/**
 * Converte "campo,-outro" em [{ column, direction }]. Campos fora da whitelist são ignorados;
 * se nada sobrar, usa `fallback` (campo público) em ordem ascendente.
 */
function parseSort(raw, allowed, fallback) {
  const items = []
  String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const desc = part.charAt(0) === '-'
      const key = desc ? part.slice(1) : part
      if (Object.prototype.hasOwnProperty.call(allowed, key)) {
        items.push({ column: allowed[key], direction: desc ? 'DESC' : 'ASC' })
      }
    })
  if (items.length === 0 && fallback && allowed[fallback]) {
    items.push({ column: allowed[fallback], direction: 'ASC' })
  }
  return items
}

function buildPageMeta(pagination, total) {
  return {
    page: pagination.page,
    perPage: pagination.perPage,
    total: total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pagination.perPage),
  }
}

module.exports = { parsePagination, parseSort, buildPageMeta }
