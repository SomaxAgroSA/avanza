/**
 * Envelope padrão das respostas da API /api/v1: { data, meta, error }.
 */

function success(data, meta) {
  return { data: data === undefined ? null : data, meta: meta || {}, error: null }
}

function failure(error, meta) {
  return { data: null, meta: meta || {}, error: error }
}

module.exports = { success, failure }
