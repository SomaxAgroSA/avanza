/**
 * Módulos da documentação (regras de negócio §43): lista única da empresa (ex.: Marketing, Finanças)
 * para organizar os espaços na tela inicial da Documentação. Um espaço fica em um módulo ou em
 * nenhum ("Sem módulo"); o módulo não muda quem lê nem quem edita o espaço.
 *
 * - Nome obrigatório, até 60 caracteres, único sem diferença de maiúsculas, acentos e espaços.
 * - Ordem: `position` (0, 1, 2…); no empate, pelo nome.
 */

const MODULE_NAME_MAX = 60
const MAX_POSITION = 999

/** Chave do nome para a unicidade: sem acento, minúsculas e espaços simples. */
function nameKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Nova lista ordenada (posição e nome); não altera a recebida. */
function sortModules(list) {
  return list.slice().sort((a, b) => (a.position || 0) - (b.position || 0) || String(a.name).localeCompare(String(b.name)))
}

/** Ordem dos ids depois de levar `id` para o índice `index` (fim da lista quando passa do tamanho). */
function reorder(list, id, index) {
  const ids = sortModules(list).map((m) => m.id)
  const from = ids.indexOf(id)
  if (from < 0) return ids
  ids.splice(from, 1)
  ids.splice(Math.min(index, ids.length), 0, id)
  return ids
}

function positionIssue(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_POSITION ? null : 'invalid_type'
}

module.exports = { MODULE_NAME_MAX, nameKey, sortModules, reorder, positionIssue }
