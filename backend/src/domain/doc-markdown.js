/**
 * Markdown ↔ documento das páginas de documentação (o JSON TipTap/ProseMirror que
 * domain/doc-content.js higieniza). Usado pelo MCP: o modelo lê e escreve páginas em Markdown.
 *
 * Suportado (nos dois sentidos, ida e volta estável):
 * - títulos `#`..`####` (mais fundos viram nível 4; também `===`/`---` sob o texto), parágrafos,
 *   quebra de linha (`\` ou dois espaços no fim da linha, e `<br>`);
 * - **negrito**, *itálico* (`_` também), ~~riscado~~, `código`, ==destaque==, <u>sublinhado</u>,
 *   [links](https://…) e <https://…> (só o que `safeHref` aceita; o resto fica como texto) e URLs soltas;
 * - listas com marcador, numeradas (guardam o número inicial) e de tarefas (`- [ ]`/`- [x]`), aninhadas
 *   pelo recuo; citação; bloco de código com linguagem; linha horizontal; tabelas GFM (a 1ª linha é o
 *   cabeçalho); imagens `![alt](/api/v1/docs/files/<id> "título"){width=50%}` (outro endereço vira
 *   link ou só o texto); destaques no formato de alerta do GitHub (`> [!NOTE]`, TIP, WARNING, CAUTION,
 *   IMPORTANT) ↔ tons info/success/warning/danger; `[TOC]` ↔ sumário. Comentários `<!-- -->` sozinhos
 *   na linha são ignorados (separam duas listas seguidas).
 *
 * Limites conhecidos: parágrafos vazios somem; numa célula de tabela só há texto e imagens (listas e
 * citações viram parágrafos) e mesclagem (colspan/rowspan) e larguras de coluna se perdem; tabela sem
 * linha de cabeçalho ganha uma; código não leva outras marcações (como no editor); HTML cru e entidades
 * (`&amp;`) ficam como texto; blocos de código só cercados (``` ou ~~~), sem o recuo de 4 espaços;
 * espaços nas pontas de uma marcação ou em volta de quebra de linha são normalizados; citações/listas
 * com mais de 24 níveis viram texto; texto de link com mais de 1000 caracteres não vira link.
 *
 * Puro e síncrono, sem dependências.
 */

const { safeHref, FILE_URL, IMAGE_WIDTHS } = require('./doc-content')

const TONE_BY_ALERT = { NOTE: 'info', IMPORTANT: 'info', TIP: 'success', WARNING: 'warning', CAUTION: 'danger' }
const ALERT_BY_TONE = { info: 'NOTE', success: 'TIP', warning: 'WARNING', danger: 'CAUTION' }
const MARK_ORDER = ['link', 'bold', 'italic', 'underline', 'strike', 'highlight', 'code']
const LANGUAGE = /^[a-z0-9+#-]{1,20}$/i
const PUNCT = /^[!-/:-@[-`{-~]$/
const ALNUM = /^[\p{L}\p{N}]$/u
const SPACE = /^\s$/
const LIST_TYPES = { bulletList: 1, orderedList: 1, taskList: 1 }
/** Citações/listas aninhadas além disto viram texto (o servidor recusa documento fundo demais). */
const MAX_NESTING = 24
/** Limites de varredura (entrada patológica não pode travar a API). */
const LINK_TEXT_MAX = 1000
const LINK_DEST_MAX = 2048
const EMPHASIS_BUDGET = 2000000

// ================================================================ nós

/** Nó no formato que sanitizeDoc devolve: sem `content` vazio, `attrs` só onde o bloco tem. */
function node(type, attrs, content) {
  const out = { type }
  if (attrs) out.attrs = attrs
  if (content && content.length) out.content = content
  return out
}

const paragraph = (content) => node('paragraph', null, content)
const cellAttrs = () => ({ colspan: 1, rowspan: 1, colwidth: null })

/** Itens de lista começam por parágrafo (exigência do editor). */
function withLeadingParagraph(blocks) {
  return blocks.length && blocks[0].type === 'paragraph' ? blocks : [paragraph()].concat(blocks)
}

function atLeastParagraph(blocks) {
  return blocks.length ? blocks : [paragraph()]
}

// ================================================================ linhas

const isBlank = (line) => /^\s*$/.test(line)

/** Largura do recuo (tab = 4 colunas). */
function indentWidth(line) {
  let width = 0
  for (const ch of line) {
    if (ch === ' ') width += 1
    else if (ch === '\t') width += 4 - (width % 4)
    else break
  }
  return width
}

/** Tira até `n` colunas de recuo (tab que passa do limite vira espaços). */
function dedent(line, n) {
  let width = 0
  let i = 0
  while (i < line.length && width < n) {
    const ch = line[i]
    if (ch === ' ') width += 1
    else if (ch === '\t') width += 4 - (width % 4)
    else break
    i += 1
  }
  return ' '.repeat(Math.max(0, width - n)) + line.slice(i)
}

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/
const HR = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/
const TOC = /^ {0,3}\[TOC\][ \t]*$/i
const QUOTE = /^ {0,3}>/
const COMMENT = /^ {0,3}<!--.*-->[ \t]*$/
const SETEXT_1 = /^ {0,3}=+[ \t]*$/
const SETEXT_2 = /^ {0,3}-+[ \t]*$/
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const TASK = /^\[([ xX])\](?:[ \t]+|$)/

function fenceOpen(line) {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return null
  if (match[2][0] === '`' && match[3].indexOf('`') >= 0) return null
  const info = match[3].trim().split(/\s+/)[0] || ''
  return { indent: match[1].length, ch: match[2][0], len: match[2].length, language: LANGUAGE.test(info) ? info : null }
}

function fenceCloses(line, fence) {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)
  return !!match && match[1][0] === fence.ch && match[1].length >= fence.len
}

/** Marcador de item: { ordered, number, indent (coluna do conteúdo), content }. */
function listItem(line) {
  let match = /^( {0,3})([-+*])([ \t]*)(.*)$/.exec(line)
  let ordered = false
  let number = null
  let markerWidth
  if (match) {
    markerWidth = match[1].length + 1
  } else {
    match = /^( {0,3})(\d{1,9})([.)])([ \t]*)(.*)$/.exec(line)
    if (!match) return null
    ordered = true
    number = Number(match[2])
    markerWidth = match[1].length + match[2].length + 1
    match = [match[0], match[1], match[2], match[4], match[5]]
  }
  const spaces = match[3]
  const rest = match[4]
  if (!spaces && rest) return null
  const gap = spaces.length >= 1 && spaces.length <= 4 && rest ? spaces.length : 1
  return { ordered, number, indent: markerWidth + gap, content: rest ? ' '.repeat(Math.max(0, spaces.length - gap)) + rest : '' }
}

const itemKind = (item) => (item.ordered ? 'ordered' : TASK.test(item.content) ? 'task' : 'bullet')

/** Separa as células de uma linha de tabela (`\|` não separa). */
function splitRow(line) {
  let source = line.trim()
  if (source[0] === '|') source = source.slice(1)
  const cells = []
  let current = ''
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (ch === '\\' && i + 1 < source.length) {
      current += ch + source[i + 1]
      i += 1
    } else if (ch === '|') {
      cells.push(current)
      current = ''
    } else current += ch
  }
  if (current.trim() || !/\|\s*$/.test(line)) cells.push(current)
  return cells.map((cell) => cell.trim())
}

function isTableStart(lines, i) {
  if (i + 1 >= lines.length || lines[i].indexOf('|') < 0) return false
  const delim = lines[i + 1]
  return delim.indexOf('|') >= 0 && TABLE_DELIM.test(delim) && splitRow(lines[i]).length === splitRow(delim).length
}

/** A linha começa outro bloco (interrompe um parágrafo). */
function startsBlock(line) {
  if (fenceOpen(line) || HEADING.test(line) || HR.test(line) || TOC.test(line) || QUOTE.test(line) || COMMENT.test(line)) return true
  const item = listItem(line)
  return !!(item && item.content.trim())
}

// ================================================================ blocos (Markdown → doc)

function parseBlocks(lines, depth) {
  const level = depth || 0
  if (level > MAX_NESTING) return inlineBlocks(lines.map((line) => line.trim()).filter((line) => line).join('\n'))
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line) || COMMENT.test(line)) {
      i += 1
      continue
    }
    const fence = fenceOpen(line)
    if (fence) {
      const body = []
      i += 1
      while (i < lines.length && !fenceCloses(lines[i], fence)) {
        body.push(dedent(lines[i], fence.indent))
        i += 1
      }
      i += 1
      const text = body.join('\n')
      out.push(node('codeBlock', { language: fence.language }, text ? [{ type: 'text', text }] : null))
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      const text = (heading[2] || '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '')
      out.push(node('heading', { level: Math.min(heading[1].length, 4) }, inlineNodes(text.trim())))
      i += 1
      continue
    }
    if (TOC.test(line)) {
      out.push(node('tableOfContents'))
      i += 1
      continue
    }
    if (HR.test(line)) {
      out.push(node('horizontalRule'))
      i += 1
      continue
    }
    if (QUOTE.test(line)) {
      i = parseQuote(lines, i, out, level)
      continue
    }
    if (listItem(line)) {
      i = parseList(lines, i, out, level)
      continue
    }
    if (isTableStart(lines, i)) {
      i = parseTable(lines, i, out)
      continue
    }
    i = parseParagraph(lines, i, out)
  }
  return out
}

function parseQuote(lines, start, out, level) {
  const body = []
  let i = start
  let lazy = false
  while (i < lines.length) {
    const line = lines[i]
    if (QUOTE.test(line)) {
      const inner = line.replace(/^ {0,3}> ?/, '')
      body.push(inner)
      lazy = !isBlank(inner) && !fenceOpen(inner)
    } else if (lazy && !isBlank(line) && !startsBlock(line)) body.push(line.trim())
    else break
    i += 1
  }
  const alert = body.length ? /^[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(.*)$/i.exec(body[0]) : null
  if (alert) {
    const inner = (alert[2] ? [alert[2]] : []).concat(body.slice(1))
    out.push(node('callout', { tone: TONE_BY_ALERT[alert[1].toUpperCase()] }, atLeastParagraph(parseBlocks(inner, level + 1))))
  } else out.push(node('blockquote', null, atLeastParagraph(parseBlocks(body, level + 1))))
  return i
}

function parseList(lines, start, out, level) {
  const first = listItem(lines[start])
  const kind = itemKind(first)
  const items = []
  let i = start
  while (i < lines.length) {
    const item = listItem(lines[i])
    if (!item || itemKind(item) !== kind) break
    const body = [item.content]
    let fences = fenceOpen(item.content) ? 1 : 0
    i += 1
    while (i < lines.length) {
      const line = lines[i]
      if (isBlank(line)) {
        let j = i
        while (j < lines.length && isBlank(lines[j])) j += 1
        if (j < lines.length && indentWidth(lines[j]) >= item.indent) {
          for (let k = i; k < j; k++) body.push('')
          i = j
          continue
        }
        break
      }
      if (indentWidth(line) >= item.indent) {
        const inner = dedent(line, item.indent)
        if (fenceOpen(inner)) fences += 1
        body.push(inner)
        i += 1
        continue
      }
      const previous = body[body.length - 1]
      if (fences % 2 === 0 && previous && !isBlank(previous) && !fenceOpen(previous) && !listItem(line) && !startsBlock(line) && !isTableStart(lines, i)) {
        body.push(line.trim())
        i += 1
        continue
      }
      break
    }
    items.push({ item, body })
    let j = i
    while (j < lines.length && isBlank(lines[j])) j += 1
    const next = j < lines.length ? listItem(lines[j]) : null
    if (!next || itemKind(next) !== kind) break
    i = j
  }
  const nodes = items.map(({ body }) => {
    if (kind !== 'task') return node('listItem', null, withLeadingParagraph(parseBlocks(body, level + 1)))
    const task = TASK.exec(body[0])
    const rest = [body[0].slice(task[0].length)].concat(body.slice(1))
    return node('taskItem', { checked: task[1] !== ' ' }, withLeadingParagraph(parseBlocks(rest, level + 1)))
  })
  if (kind === 'ordered') {
    const number = first.number
    out.push(node('orderedList', { start: number >= 1 && number <= 100000 ? number : 1 }, nodes))
  } else out.push(node(kind === 'task' ? 'taskList' : 'bulletList', null, nodes))
  return i
}

/** `\|` vira `|` antes do texto da célula ser lido (inclusive dentro de `código`). */
function unescapePipes(cell) {
  let out = ''
  for (let i = 0; i < cell.length; i++) {
    if (cell[i] === '\\' && cell[i + 1] === '|') {
      out += '|'
      i += 1
    } else if (cell[i] === '\\' && i + 1 < cell.length) {
      out += cell[i] + cell[i + 1]
      i += 1
    } else out += cell[i]
  }
  return out
}

/** Parágrafos da célula: separados por `<br><br>` fora de `código`. */
function cellParagraphs(text) {
  const parts = []
  let start = 0
  let i = 0
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2
      continue
    }
    if (text[i] === '`') {
      const run = /^`+/.exec(text.slice(i))[0]
      const close = text.indexOf(run, i + run.length)
      i = close > 0 ? close + run.length : i + run.length
      continue
    }
    const br = /^<br[ \t]*\/?>\s*<br[ \t]*\/?>/i.exec(text.slice(i))
    if (br) {
      parts.push(text.slice(start, i))
      i += br[0].length
      start = i
      continue
    }
    i += 1
  }
  parts.push(text.slice(start))
  return parts
}

function cellNode(type, text) {
  const blocks = []
  cellParagraphs(unescapePipes(text))
    .forEach((part) => inlineBlocks(part.trim()).forEach((block) => blocks.push(block)))
  return node(type, cellAttrs(), atLeastParagraph(blocks))
}

function parseTable(lines, start, out) {
  const header = splitRow(lines[start])
  const columns = header.length
  const row = (cells, type) => {
    const list = []
    for (let c = 0; c < columns; c++) list.push(cellNode(type, cells[c] || ''))
    return node('tableRow', null, list)
  }
  const rows = [row(header, 'tableHeader')]
  let i = start + 2
  while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) {
    rows.push(row(splitRow(lines[i]), 'tableCell'))
    i += 1
  }
  out.push(node('table', null, rows))
  return i
}

function parseParagraph(lines, start, out) {
  const body = [lines[start].replace(/^[ \t]+/, '')]
  let i = start + 1
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) break
    if (SETEXT_1.test(line) || SETEXT_2.test(line)) {
      out.push(node('heading', { level: SETEXT_1.test(line) ? 1 : 2 }, inlineNodes(body.join('\n').trim())))
      return i + 1
    }
    if (startsBlock(line) || isTableStart(lines, i)) break
    body.push(line.replace(/^[ \t]+/, ''))
    i += 1
  }
  inlineBlocks(body.join('\n').replace(/\s+$/, '')).forEach((block) => out.push(block))
  return i
}

// ================================================================ inline (Markdown → doc)

const markOf = (type, href) => (type === 'link' ? { type: 'link', attrs: { href } } : { type })
const sameMark = (a, b) => a.type === b.type && (a.type !== 'link' || a.attrs.href === b.attrs.href)

function addMark(token, mark) {
  if (!token.marks.some((m) => m.type === mark.type)) token.marks.push(mark)
}

const unescape = (value) => value.replace(/\\([!-/:-@[-`{-~])/g, (_m, ch) => ch)

/** `[texto](destino "título")` a partir de `start` (o `[`); null se não for link. */
function linkAt(src, start) {
  let depth = 0
  let j = start
  const limit = Math.min(src.length, start + LINK_TEXT_MAX)
  for (; j < limit; j++) {
    const ch = src[j]
    if (ch === '\\') {
      j += 1
    } else if (ch === '`') {
      const run = /^`+/.exec(src.slice(j))[0]
      const close = src.indexOf(run, j + run.length)
      if (close > 0) j = close + run.length - 1
      else j += run.length - 1
    } else if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) break
    }
  }
  if (j >= limit || src[j + 1] !== '(') return null
  let k = j + 2
  while (k < src.length && SPACE.test(src[k])) k += 1
  let dest = ''
  if (src[k] === '<') {
    k += 1
    while (k < src.length && src[k] !== '>' && src[k] !== '\n' && dest.length < LINK_DEST_MAX) {
      if (src[k] === '\\' && PUNCT.test(src[k + 1] || '')) k += 1
      dest += src[k]
      k += 1
    }
    if (src[k] !== '>') return null
    k += 1
  } else {
    let parens = 0
    while (k < src.length && dest.length < LINK_DEST_MAX) {
      const ch = src[k]
      if (ch === '\\' && PUNCT.test(src[k + 1] || '')) {
        dest += src[k + 1]
        k += 2
        continue
      }
      if (SPACE.test(ch)) break
      if (ch === '(') parens += 1
      else if (ch === ')') {
        if (parens === 0) break
        parens -= 1
      }
      dest += ch
      k += 1
    }
  }
  while (k < src.length && SPACE.test(src[k])) k += 1
  let title = null
  const opener = src[k]
  if (opener === '"' || opener === "'" || opener === '(') {
    const closer = opener === '(' ? ')' : opener
    let t = k + 1
    let raw = ''
    while (t < src.length && src[t] !== closer && raw.length < LINK_TEXT_MAX) {
      if (src[t] === '\\' && t + 1 < src.length) {
        raw += src[t] + src[t + 1]
        t += 2
        continue
      }
      raw += src[t]
      t += 1
    }
    if (t >= src.length || src[t] !== closer) return null
    title = unescape(raw)
    k = t + 1
    while (k < src.length && SPACE.test(src[k])) k += 1
  }
  if (src[k] !== ')') return null
  return { text: src.slice(start + 1, j), dest, title, end: k + 1 }
}

/** URL solta (sem `<>`): tira a pontuação do fim, como o GFM. */
function bareUrl(rest) {
  const match = /^https?:\/\/[^\s<]+/i.exec(rest)
  if (!match) return null
  let url = match[0]
  for (;;) {
    const last = url[url.length - 1]
    if ('.,:;"\'!?*_~=]'.indexOf(last) >= 0) url = url.slice(0, -1)
    else if (last === ')' && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) url = url.slice(0, -1)
    else break
  }
  return /^https?:\/\/./i.test(url) ? url : null
}

function imageToken(alt, dest, title, width) {
  const text = unescape(alt)
  if (FILE_URL.test(dest)) {
    const attrs = { src: dest }
    if (text) attrs.alt = text.slice(0, 300)
    if (title) attrs.title = title.slice(0, 300)
    attrs.width = IMAGE_WIDTHS.indexOf(width) >= 0 ? width : null
    return [{ t: 'image', attrs }]
  }
  const href = safeHref(dest)
  if (href) return [{ t: 'text', text: text || href, marks: [markOf('link', href)] }]
  return text ? [{ t: 'text', text, marks: [] }] : []
}

function tokenize(src, inLink) {
  const tokens = []
  const noCloser = {}
  let buf = ''
  const flush = () => {
    if (buf) tokens.push({ t: 'text', text: buf, marks: [] })
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const rest = src.slice(i)
    if (ch === '\\') {
      const next = src[i + 1]
      if (next === '\n') {
        flush()
        tokens.push({ t: 'break' })
        i += 2
      } else if (next && PUNCT.test(next)) {
        buf += next
        i += 2
      } else {
        buf += ch
        i += 1
      }
      continue
    }
    if (ch === '\n') {
      if (/ {2,}$/.test(buf)) {
        buf = buf.replace(/ +$/, '')
        flush()
        tokens.push({ t: 'break' })
      } else buf = `${buf.replace(/ +$/, '')} `
      i += 1
      continue
    }
    if (ch === '`') {
      const run = /^`+/.exec(rest)[0]
      let close = -1
      let from = i + run.length
      while (!noCloser[run.length] && from < src.length) {
        const found = src.indexOf(run, from)
        if (found < 0) break
        if (src[found + run.length] !== '`' && src[found - 1] !== '`') {
          close = found
          break
        }
        from = found + 1
        while (src[from] === '`') from += 1
      }
      if (close < 0) {
        noCloser[run.length] = true
        buf += run
        i += run.length
        continue
      }
      let code = src.slice(i + run.length, close).replace(/\n/g, ' ')
      if (code.length > 2 && code[0] === ' ' && code[code.length - 1] === ' ' && code.trim()) code = code.slice(1, -1)
      flush()
      if (code) tokens.push({ t: 'text', text: code, marks: [markOf('code')] })
      i = close + run.length
      continue
    }
    if (ch === '!' && src[i + 1] === '[') {
      const link = linkAt(src, i + 1)
      if (link) {
        const after = /^\{[ \t]*width[ \t]*=[ \t]*(\d{1,3})%?[ \t]*\}/.exec(src.slice(link.end))
        flush()
        imageToken(link.text, link.dest, link.title, after ? Number(after[1]) : null).forEach((token) => tokens.push(token))
        i = link.end + (after ? after[0].length : 0)
        continue
      }
    }
    if (ch === '[' && !inLink) {
      const link = linkAt(src, i)
      if (link) {
        const href = safeHref(link.dest)
        flush()
        parseInlineTokens(link.text, true).forEach((token) => {
          if (href && token.t === 'text' && !token.marks.some((m) => m.type === 'code')) addMark(token, markOf('link', href))
          tokens.push(token)
        })
        i = link.end
        continue
      }
    }
    if (ch === '<') {
      const br = /^<br[ \t]*\/?>/i.exec(rest)
      const underline = /^<(\/?)u>/i.exec(rest)
      const auto = inLink ? null : /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest)
      if (br || underline || auto) {
        flush()
        if (br) tokens.push({ t: 'break' })
        else if (underline) tokens.push({ t: 'delim', ch: 'u', n: 1, size: 1, open: !underline[1], close: !!underline[1] })
        else {
          const href = safeHref(auto[1])
          tokens.push({ t: 'text', text: auto[1], marks: href ? [markOf('link', href)] : [] })
        }
        i += (br || underline || auto)[0].length
        continue
      }
    }
    if ((ch === 'h' || ch === 'H') && !inLink && !ALNUM.test(src[i - 1] || ' ')) {
      const url = bareUrl(rest)
      const href = url && safeHref(url)
      if (href) {
        flush()
        tokens.push({ t: 'text', text: url, marks: [markOf('link', href)] })
        i += url.length
        continue
      }
    }
    if (ch === '*' || ch === '_' || ch === '~' || ch === '=') {
      let n = 1
      while (src[i + n] === ch) n += 1
      if ((ch === '~' || ch === '=') && n < 2) {
        buf += ch
        i += 1
        continue
      }
      const prev = src[i - 1] || ' '
      const next = src[i + n] || ' '
      let open = !SPACE.test(next)
      let close = !SPACE.test(prev)
      if (ch === '_') {
        open = open && !ALNUM.test(prev)
        close = close && !ALNUM.test(next)
      }
      flush()
      tokens.push({ t: 'delim', ch, n, size: n, open, close })
      i += n
      continue
    }
    buf += ch
    i += 1
  }
  flush()
  return tokens
}

const literal = (token) => (token.ch === 'u' ? (token.n ? (token.open ? '<u>' : '</u>') : '') : token.ch.repeat(token.n))

/** Regra do múltiplo de 3 do CommonMark (`*`/`_` que abrem e fecham): `**a*b***` = negrito com itálico dentro. */
function canPair(opener, closer) {
  if (closer.ch !== '*' && closer.ch !== '_') return true
  if (!(opener.close || closer.open)) return true
  return (opener.size + closer.size) % 3 !== 0 || (opener.size % 3 === 0 && closer.size % 3 === 0)
}

/** Ênfases (delimitadores) no estilo CommonMark, com flancos simplificados. */
function resolveEmphasis(tokens) {
  // abaixo de `bottom[chave]` já se sabe que não há abertura para esse tipo de fechamento
  const bottom = {}
  let budget = EMPHASIS_BUDGET
  for (let c = 0; c < tokens.length && budget > 0; c++) {
    const closer = tokens[c]
    if (closer.t !== 'delim' || !closer.close) continue
    const key = `${closer.ch}${closer.open ? 1 : 0}${closer.size % 3}`
    while (closer.n > 0 && budget > 0) {
      const double = closer.ch === '~' || closer.ch === '='
      if (double && closer.n < 2) break
      const floor = bottom[key] === undefined ? -1 : bottom[key]
      let o = c - 1
      const matches = (token) => token.t === 'delim' && token.open && token.n > 0 && token.ch === closer.ch && (!double || token.n >= 2) && canPair(token, closer)
      while (o > floor && !matches(tokens[o])) o -= 1
      budget -= c - o
      if (o <= floor) {
        bottom[key] = c - 1
        break
      }
      const opener = tokens[o]
      const use = closer.ch === 'u' ? 1 : double ? 2 : opener.n >= 2 && closer.n >= 2 ? 2 : 1
      const type = { '~': 'strike', '=': 'highlight', u: 'underline' }[closer.ch] || (use === 2 ? 'bold' : 'italic')
      budget -= c - o
      for (let k = o + 1; k < c; k++) {
        const token = tokens[k]
        if (token.t === 'delim') {
          tokens[k] = { t: 'text', text: literal(token), marks: [] }
        }
        if (tokens[k].t === 'text') addMark(tokens[k], markOf(type))
      }
      opener.n -= use
      closer.n -= use
    }
  }
  return tokens.map((token) => (token.t === 'delim' ? { t: 'text', text: literal(token), marks: [] } : token))
}

function parseInlineTokens(src, inLink) {
  return resolveEmphasis(tokenize(src, inLink))
}

const rank = (mark) => MARK_ORDER.indexOf(mark.type)

const isCode = (item) => item.marks.length === 1 && item.marks[0].type === 'code'
const sameMarks = (a, b) => a.length === b.length && a.every((m, k) => sameMark(m, b[k]))

/**
 * Espaços como o Markdown os guarda: nada nas pontas nem em volta das quebras de linha, e espaço na
 * ponta de uma marcação fica fora dela (só com as marcações que continuam do outro lado).
 */
function normalizeSpaces(input) {
  const items = input.slice()
  items.forEach((item, k) => {
    if (item.br || isCode(item)) return
    if (items[k - 1] && items[k - 1].br) item.text = item.text.replace(/^\s+/, '')
    if (items[k + 1] && items[k + 1].br) item.text = item.text.replace(/\s+$/, '')
  })
  const out = []
  const push = (item) => {
    if (!item.br && !item.text) return
    const last = out[out.length - 1]
    if (last && !last.br && !item.br && sameMarks(last.marks, item.marks)) last.text += item.text
    else out.push(item.br ? item : { text: item.text, marks: item.marks })
  }
  items.forEach((item, k) => {
    if (item.br || isCode(item) || !item.marks.length) return push(item)
    const lead = /^\s*/.exec(item.text)[0]
    const core = item.text.slice(lead.length)
    const trail = /\s*$/.exec(core)[0]
    const prev = items[k - 1]
    const next = items[k + 1]
    const shared = (other) => (other && !other.br ? item.marks.filter((m) => hasMark(other.marks, m)) : [])
    if (!core) return push({ text: item.text, marks: prev && next && !prev.br && !next.br ? shared(prev).filter((m) => hasMark(next.marks, m)) : [] })
    push({ text: lead, marks: shared(prev) })
    push({ text: core.slice(0, core.length - trail.length), marks: item.marks })
    push({ text: trail, marks: shared(next) })
    return undefined
  })
  const blank = (item) => item && (item.br || (!item.text.trim() && !isCode(item)))
  while (blank(out[0])) out.shift()
  while (blank(out[out.length - 1])) out.pop()
  if (out.length && !isCode(out[0])) out[0].text = out[0].text.replace(/^\s+/, '')
  if (out.length && !isCode(out[out.length - 1])) out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '')
  return out
}

/** Tokens → nós do editor: código só com a marca de código (como no editor), vizinhos iguais juntos. */
function finishInline(tokens) {
  const items = []
  tokens.forEach((token) => {
    if (token.t === 'break') items.push({ br: true })
    else if (token.t === 'text' && token.text) {
      const code = token.marks.find((m) => m.type === 'code')
      items.push({ text: token.text, marks: code ? [code] : token.marks.slice().sort((a, b) => rank(a) - rank(b)) })
    }
  })
  return normalizeSpaces(items).map((item) => {
    if (item.br) return { type: 'hardBreak' }
    return item.marks.length ? { type: 'text', text: item.text, marks: item.marks } : { type: 'text', text: item.text }
  })
}

/** Conteúdo inline (títulos): imagens viram o texto alternativo. */
function inlineNodes(src) {
  return finishInline(parseInlineTokens(src).map((token) => (token.t === 'image' ? { t: 'text', text: token.attrs.alt || '', marks: [] } : token)))
}

/** Parágrafo(s): imagens são blocos no editor, então quebram o parágrafo. */
function inlineBlocks(src) {
  const blocks = []
  let current = []
  const flush = () => {
    const nodes = finishInline(current)
    if (nodes.length) blocks.push(paragraph(nodes))
    current = []
  }
  parseInlineTokens(src).forEach((token) => {
    if (token.t === 'image') {
      flush()
      blocks.push(node('image', token.attrs))
    } else current.push(token)
  })
  flush()
  return blocks
}

/** Markdown → documento do editor (aceito sem mudanças por sanitizeDoc). */
function markdownToDoc(markdown) {
  const lines = String(markdown === null || markdown === undefined ? '' : markdown)
    .replace(/\r\n?/g, '\n')
    .split('\n')
  return node('doc', null, parseBlocks(lines))
}

// ================================================================ doc → Markdown

const childrenOf = (n) => (n && Array.isArray(n.content) ? n.content : [])
const textOf = (n) => (n.type === 'text' ? n.text || '' : childrenOf(n).map(textOf).join(''))

function escapeText(text, table) {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const prev = text[i - 1] || ''
    const next = text[i + 1] || ''
    if (ch === '\\' || ch === '*' || ch === '`' || ch === '[' || ch === ']') out += `\\${ch}`
    else if (ch === '_' && (!ALNUM.test(prev) || !ALNUM.test(next))) out += '\\_'
    else if ((ch === '~' || ch === '=') && (prev === ch || next === ch || !prev || !next)) out += `\\${ch}`
    else if (ch === '<' && /^<(?:\/?u>|br[ \t]*\/?>|https?:|mailto:|!--)/i.test(text.slice(i))) out += '\\<'
    else if (ch === '|' && table) out += '\\|'
    else if (ch === '\n') out += ' '
    else out += ch
  }
  return out.replace(/(https?):\/\//gi, (_m, scheme) => `${scheme}\\://`)
}

function codeSpan(text, table) {
  const value = table ? text.replace(/\|/g, '\\|') : text
  const longest = (value.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0)
  const fence = '`'.repeat(longest + 1)
  const pad = value[0] === '`' || value[value.length - 1] === '`' || (value[0] === ' ' && value[value.length - 1] === ' ' && value.trim()) ? ' ' : ''
  return `${fence}${pad}${value}${pad}${fence}`
}

const escapeDest = (href) => href.replace(/[()\\<>]/g, (ch) => `\\${ch}`)

function openDelim(mark) {
  return { link: '[', bold: '**', italic: '*', underline: '<u>', strike: '~~', highlight: '==' }[mark.type] || ''
}

function closeDelim(mark) {
  if (mark.type === 'link') return `](${escapeDest(mark.attrs.href)})`
  return { bold: '**', italic: '*', underline: '</u>', strike: '~~', highlight: '==' }[mark.type] || ''
}

/** Marcas que o Markdown representa (links inseguros caem; código exclui as outras, como no editor). */
function marksOf(n) {
  const marks = (n.marks || []).filter((m) => m && MARK_ORDER.indexOf(m.type) >= 0 && (m.type !== 'link' || (m.attrs && safeHref(m.attrs.href))))
  const code = marks.find((m) => m.type === 'code')
  if (code) return [code]
  return marks.map((m) => (m.type === 'link' ? markOf('link', safeHref(m.attrs.href)) : markOf(m.type))).sort((a, b) => rank(a) - rank(b))
}

const hasMark = (marks, mark) => marks.some((m) => sameMark(m, mark))

/** Texto com marcações; `lineBreak` é como sai a quebra de linha (`\` + nova linha, ou `<br>`). */
function renderInline(nodes, lineBreak, table) {
  const raw = []
  nodes.forEach((n) => {
    // na célula, `<br><br>` separa parágrafos: quebras seguidas viram uma
    if (n.type === 'hardBreak') {
      if (!(table && raw.length && raw[raw.length - 1].br)) raw.push({ br: true })
    } else if (n.type === 'text' && n.text) raw.push({ text: n.text, marks: marksOf(n) })
    else if (n.type === 'image' && n.attrs) raw.push({ text: n.attrs.alt || '', marks: [] })
  })
  const items = normalizeSpaces(raw)
  const nextText = []
  for (let k = items.length - 1, next = -1; k >= 0; k--) {
    nextText[k] = next
    if (!items[k].br) next = k
  }
  const runLength = (k, mark) => {
    let n = 0
    for (let j = k; j < items.length; j++) {
      if (items[j].br) continue
      if (!hasMark(items[j].marks, mark)) break
      n += 1
    }
    return n
  }
  // partes: texto (string) ou delimitador ({ mark, open, pair, s }); o do itálico é decidido no fim
  const parts = []
  let pending = ''
  const stack = []
  let pairs = 0
  const write = (s) => parts.push(s)
  const close = () => {
    const entry = stack.pop()
    const s = closeDelim(entry.mark)
    parts.push({ mark: entry.mark, open: false, pair: entry.pair, s: table ? s.replace(/\|/g, '\\|') : s })
  }
  items.forEach((item, k) => {
    if (item.br) {
      // o que não continua na linha seguinte fecha antes da quebra (no começo da linha não fecharia)
      const next = items[nextText[k]]
      let keep = 0
      while (next && keep < stack.length && hasMark(next.marks, stack[keep].mark)) keep += 1
      while (stack.length > keep) close()
      write(pending + lineBreak)
      pending = ''
      return
    }
    const code = item.marks.length === 1 && item.marks[0].type === 'code'
    let keep = 0
    while (keep < stack.length && hasMark(item.marks, stack[keep].mark)) keep += 1
    while (stack.length > keep) close()
    write(pending)
    pending = ''
    if (code) {
      write(codeSpan(item.text, table))
      return
    }
    const opening = item.marks.filter((m) => !stack.some((entry) => sameMark(entry.mark, m))).sort((a, b) => runLength(k, b) - runLength(k, a) || rank(a) - rank(b))
    let text = item.text
    const href = opening.length === 1 && stack.length === 0 && opening[0].type === 'link' ? opening[0].attrs.href : null
    const next = items[k + 1]
    if (href && text === href && /^(?:https?:\/\/|mailto:)[^\s<>]+$/i.test(href) && !(next && !next.br && hasMark(next.marks, opening[0]))) {
      write(`<${table ? href.replace(/\|/g, '\\|') : href}>`)
      return
    }
    if (opening.length) {
      const lead = /^\s*/.exec(text)[0]
      write(lead)
      text = text.slice(lead.length)
    }
    opening.forEach((m) => {
      pairs += 1
      stack.push({ mark: m, pair: pairs })
      parts.push({ mark: m, open: true, pair: pairs, s: openDelim(m) })
    })
    const trail = stack.length ? /\s*$/.exec(text)[0] : ''
    write(escapeText(text.slice(0, text.length - trail.length), table))
    pending = trail.replace(/\n/g, ' ')
  })
  while (stack.length) close()
  const list = parts.filter((part) => part !== '')
  chooseItalicDelimiters(list)
  // `!` logo antes de um link viraria imagem
  list.forEach((part, k) => {
    const prev = list[k - 1]
    if (typeof part !== 'string' && part.open && part.mark.type === 'link' && typeof prev === 'string' && /!$/.test(prev)) list[k - 1] = `${prev.slice(0, -1)}\\!`
  })
  return list.map((part) => (typeof part === 'string' ? part : part.s)).join('')
}

/**
 * Itálico sai como `*`; colado em outro delimitador de `*` (ex.: `*a**b*****c**`, ambíguo) vira `_`
 * quando pode (`_` não abre nem fecha no meio de palavra).
 */
function chooseItalicDelimiters(parts) {
  const charAt = (index, step) => {
    for (let j = index + step; j >= 0 && j < parts.length; j += step) {
      const s = typeof parts[j] === 'string' ? parts[j] : parts[j].s
      if (s) return step < 0 ? s[s.length - 1] : s[0]
    }
    return ''
  }
  const starNext = (index, step) => {
    const part = parts[index + step]
    return !!part && typeof part !== 'string' && part.s[step < 0 ? part.s.length - 1 : 0] === '*'
  }
  const closing = {}
  parts.forEach((part, j) => {
    if (typeof part !== 'string' && !part.open) closing[part.pair] = j
  })
  parts.forEach((part, a) => {
    if (typeof part === 'string' || part.mark.type !== 'italic' || !part.open) return
    const b = closing[part.pair]
    const touches = starNext(a, -1) || starNext(a, 1) || starNext(b, -1) || starNext(b, 1)
    if (touches && !ALNUM.test(charAt(a, -1)) && !ALNUM.test(charAt(b, 1)) && charAt(a, -1) !== '_' && charAt(b, 1) !== '_') {
      part.s = '_'
      parts[b].s = '_'
    }
  })
}

/** Começo de linha que viraria outro bloco ganha `\`. */
function escapeLineStarts(text) {
  return text
    .split('\n')
    .map((line) => {
      if (/^(?:#{1,6}(?:\s|$)|>|[-+](?:\s|$)|-+\s*$|=+\s*$)/.test(line)) return `\\${line}`
      const ordered = /^(\d{1,9})([.)])(\s|$)/.exec(line)
      return ordered ? `${ordered[1]}\\${line.slice(ordered[1].length)}` : line
    })
    .join('\n')
}

function imageMarkdown(attrs) {
  const alt = String(attrs.alt || '').replace(/[\\[\]]/g, (ch) => `\\${ch}`)
  const title = attrs.title ? ` "${String(attrs.title).replace(/["\\]/g, (ch) => `\\${ch}`)}"` : ''
  const width = IMAGE_WIDTHS.indexOf(attrs.width) >= 0 ? `{width=${attrs.width}%}` : ''
  return `![${alt}](${escapeDest(String(attrs.src || ''))}${title})${width}`
}

/** Linhas de citação: `> ` em todas (linha vazia vira `>`). */
function quoteLines(text) {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')
}

function prefixLines(text, first, rest) {
  return text
    .split('\n')
    .map((line, k) => (k === 0 ? `${first}${line}`.replace(/\s+$/, '') : line ? `${rest}${line}` : ''))
    .join('\n')
}

function renderItem(item, marker, indent) {
  const children = childrenOf(item)
  let body = ''
  children.forEach((child, k) => {
    // `- ---` seria uma linha horizontal inteira: no começo do item ela sai como `***`
    const md = child.type === 'horizontalRule' && !body ? '***' : renderBlock(child)
    // sublista colada no parágrafo (lista "compacta"), menos `-` vazio, que sublinharia o parágrafo
    const tight = LIST_TYPES[child.type] && children[k - 1] && children[k - 1].type === 'paragraph' && !/^-(?:\n|$)/.test(md)
    if (k === 0) body = md
    else if (md) body += (body === '' ? '' : tight ? '\n' : '\n\n') + md
  })
  return prefixLines(body, marker, ' '.repeat(indent))
}

function renderList(n) {
  const items = childrenOf(n)
  if (n.type === 'orderedList') {
    const start = n.attrs && Number.isInteger(n.attrs.start) && n.attrs.start >= 1 ? n.attrs.start : 1
    return items
      .map((item, k) => {
        const marker = `${start + k}. `
        return renderItem(item, marker, marker.length)
      })
      .join('\n')
  }
  if (n.type === 'taskList') return items.map((item) => renderItem(item, item.attrs && item.attrs.checked ? '- [x] ' : '- [ ] ', 2)).join('\n')
  return items.map((item) => renderItem(item, '- ', 2)).join('\n')
}

/** Célula: só texto e imagens (o resto vira parágrafos), parágrafos separados por `<br><br>`. */
function cellMarkdown(cell) {
  const parts = []
  const visit = (blocks) =>
    blocks.forEach((b) => {
      if (b.type === 'paragraph' || b.type === 'heading') parts.push(renderInline(childrenOf(b), '<br>', true))
      else if (b.type === 'image' && b.attrs) parts.push(imageMarkdown(b.attrs).replace(/\|/g, '\\|'))
      else if (b.type === 'codeBlock') parts.push(textOf(b) ? codeSpan(textOf(b).replace(/\n/g, ' '), true) : '')
      else visit(childrenOf(b))
    })
  visit(childrenOf(cell))
  return parts.filter((p) => p).join('<br><br>')
}

function renderTable(n) {
  const rows = childrenOf(n).map((row) => childrenOf(row).map(cellMarkdown))
  if (!rows.length) return ''
  const columns = Math.max(1, ...rows.map((cells) => cells.length))
  const line = (cells) => {
    const list = []
    for (let c = 0; c < columns; c++) list.push(cells[c] || '')
    return `| ${list.join(' | ')} |`
  }
  const delim = `| ${new Array(columns).fill('---').join(' | ')} |`
  return [line(rows[0]), delim].concat(rows.slice(1).map(line)).join('\n')
}

function renderBlock(n) {
  if (!n || typeof n !== 'object') return ''
  switch (n.type) {
    case 'paragraph':
      return escapeLineStarts(renderInline(childrenOf(n), '\\\n'))
    case 'heading': {
      const level = Math.min(Math.max(Number(n.attrs && n.attrs.level) || 1, 1), 4)
      const text = renderInline(childrenOf(n), '<br>').replace(/#$/, '\\#')
      return `${'#'.repeat(level)}${text ? ` ${text}` : ''}`
    }
    case 'blockquote':
      return quoteLines(renderBlocks(childrenOf(n)))
    case 'callout': {
      const tone = ALERT_BY_TONE[n.attrs && n.attrs.tone] || 'NOTE'
      const inner = renderBlocks(childrenOf(n))
      return `> [!${tone}]${inner ? `\n${quoteLines(inner)}` : ''}`
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return renderList(n)
    case 'codeBlock': {
      const text = textOf(n)
      const longest = (text.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0)
      const fence = '`'.repeat(Math.max(3, longest + 1))
      const language = n.attrs && typeof n.attrs.language === 'string' && LANGUAGE.test(n.attrs.language) ? n.attrs.language : ''
      return `${fence}${language}\n${text ? `${text}\n` : ''}${fence}`
    }
    case 'horizontalRule':
      return '---'
    case 'tableOfContents':
      return '[TOC]'
    case 'image':
      return n.attrs && n.attrs.src ? imageMarkdown(n.attrs) : ''
    case 'table':
      return renderTable(n)
    default:
      return renderBlocks(childrenOf(n))
  }
}

function renderBlocks(nodes) {
  let out = ''
  let previous = null
  nodes.forEach((n) => {
    const md = renderBlock(n)
    if (!md) return
    // duas listas do mesmo tipo seguidas se juntariam: um comentário separa
    const separator = previous && LIST_TYPES[n.type] && previous.type === n.type ? '\n\n<!-- -->\n\n' : '\n\n'
    out += out ? separator + md : md
    previous = n
  })
  return out
}

/** Documento do editor → Markdown. */
function docToMarkdown(doc) {
  if (!doc || typeof doc !== 'object') return ''
  return renderBlocks(childrenOf(doc))
}

module.exports = { markdownToDoc, docToMarkdown }
