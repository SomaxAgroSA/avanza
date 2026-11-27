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

/** Linha de tabela GFM (`| a | b |`) e a linha separadora do cabeçalho (`| --- | :-: |`). */
const TABLE_ROW = /^\s*\|(.*)\|\s*$/
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/

/** Uma linha do Markdown dos comentários/descrições (§53) sem as marcas de bloco; null = some. */
function plainLine(line) {
  if (line.indexOf('|') >= 0 && TABLE_DELIM.test(line)) return null
  const row = TABLE_ROW.exec(line)
  if (row) {
    return row[1]
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim())
      .join(' · ')
  }
  return line
    .replace(/^\s{0,3}(?:>\s?)+/, '') // citação
    .replace(/^\s{0,3}#{1,6}\s+/, '') // título
    .replace(/^(\s*)[-*+]\s+\[([ xX])\]\s+/, (_m, indent, mark) => `${indent}${mark === ' ' ? '☐' : '☑'} `) // lista de verificação
    .replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/, '') // separador
}

/**
 * Texto limpo para histórico, resumos, notificações e e-mails: menções viram "@Nome" e a marcação
 * Markdown some — também a do editor com formatação (§53): títulos, citações, listas de verificação
 * (☐/☑), tabelas (células separadas por " · "), blocos de código (só o conteúdo), imagens
 * ("[imagem: nome]"), ==destaque==, <u>sublinhado</u>, `<br>` e os escapes (`\*`).
 */
function plainText(content) {
  const lines = String(content || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const out = []
  let fence = null
  lines.forEach((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*[`~]+\s*$/.test(line)) fence = null
      else out.push(line)
      return
    }
    if (marker) {
      fence = marker[1]
      return
    }
    // `<!-- -->` separa duas listas seguidas no Markdown; não é texto
    if (/^\s*<!--.*-->\s*$/.test(line)) return
    const plain = plainLine(line)
    if (plain !== null) out.push(plain)
  })
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(MENTION_PATTERN, (_, name) => `@${name}`)
    .replace(/!\[([^\]\n]*)\]\([^)\s]+(?:\s+"[^"\n]*")?\)(?:\{width=\d{1,3}%?\})?/g, (_m, alt) => (alt ? `[imagem: ${alt}]` : '[imagem]'))
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/<(https?:\/\/[^\s<>]+)>/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?u>/gi, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/==([^=\n]+)==/g, '$1')
    .replace(/(^|[^*\w\\])\*([^*\n]+)\*/g, '$1$2')
    .replace(/(^|[^_\w\\])_([^_\n]+)_/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
}

module.exports = { MENTION_PATTERN, extractMentions, plainText }
