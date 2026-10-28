/**
 * Menções em textos (comentários de tarefas e atualizações do quadro): `@[Nome exibido](idDoUsuario)`.
 * O editor insere a marcação; o servidor valida os IDs contra quem tem acesso ao projeto.
 */

/** Menção no texto: `@[Nome exibido](idDoUsuario)` — o editor insere; o servidor valida o ID. */
const MENTION_PATTERN = /@\[([^\]\n]{1,120})\]\(([A-Za-z0-9_]{1,64})\)/g

/** IDs mencionados, na ordem, sem repetir. */
function extractMentions(content) {
  const ids = []
  String(content || '').replace(MENTION_PATTERN, (_, _name, id) => {
    if (ids.indexOf(id) < 0) ids.push(id)
    return ''
  })
  return ids
}

/** Texto limpo para histórico e resumos: menções viram "@Nome" e a marcação Markdown some. */
function plainText(content) {
  return String(content || '')
    .replace(MENTION_PATTERN, (_, name) => `@${name}`)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1$2')
    .replace(/(^|[^_\w])_([^_\n]+)_/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
}

module.exports = { MENTION_PATTERN, extractMentions, plainText }
