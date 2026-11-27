/**
 * Markdown ↔ documento do editor (JSON TipTap/ProseMirror) para os textos das tarefas: comentários e
 * descrições continuam gravados como Markdown (o modelo de dados não muda) e o editor trabalha com o
 * documento. Porte do `backend/src/domain/doc-markdown.js` (o da Documentação, usado pelo MCP), com:
 *
 * - **menções** `@[Nome](idDoUsuario)` ↔ nó `mention` { id, label } — o formato que
 *   `backend/src/domain/mentions.js` extrai e valida;
 * - **quebra simples** (`breaks`): uma nova linha dentro do parágrafo é quebra de linha, como nos
 *   comentários antigos (o `AppMarkdown` de antes mostrava `<br>`); sem títulos sublinhados (`===`);
 * - **endereços configuráveis**: links e imagens aceitos vêm das opções (nas tarefas, links só
 *   http(s); imagens só dos anexos `/api/v1/attachments/<id>/file` e da Documentação).
 *
 * Suportado (nos dois sentidos, ida e volta estável): títulos `#`..`####`, parágrafos, **negrito**,
 * *itálico*, ~~riscado~~, `código`, ==destaque==, <u>sublinhado</u>, links e URLs soltas, listas com
 * marcador, numeradas e de tarefas (`- [ ]`/`- [x]`), citação, bloco de código, linha horizontal,
 * tabelas GFM e imagens. Alertas (`> [!NOTE]`) e `[TOC]` só quando as opções pedem (Documentação).
 *
 * Puro e síncrono, sem dependências.
 */

import type { RichContent } from './docs'

export interface MarkdownDocOptions {
  /** Link aceito (devolve o endereço limpo) ou null (o texto fica sem link). */
  safeHref: (href: string) => string | null
  /** Imagem aceita como imagem (outro endereço vira link, se for seguro, ou só o texto). */
  isImageSrc: (src: string) => boolean
  /** Nova linha simples = quebra de linha (comentários); sem isso, vira espaço (CommonMark). */
  breaks?: boolean
  /** `@[Nome](id)` ↔ nó `mention`. */
  mentions?: boolean
  /** `> [!NOTE]` ↔ destaque (callout) e `[TOC]` ↔ sumário. */
  docBlocks?: boolean
}

export interface MarkdownCodec {
  toDoc: (markdown: string | null | undefined) => RichContent
  toMarkdown: (doc: RichContent | null | undefined) => string
}

type Mark = { type: string; attrs?: Record<string, unknown> }
type LinkMark = { type: 'link'; attrs: { href: string } }

interface TextToken {
  t: 'text'
  text: string
  marks: Mark[]
}
interface DelimToken {
  t: 'delim'
  ch: string
  n: number
  size: number
  open: boolean
  close: boolean
}
interface AtomToken {
  t: 'image' | 'mention'
  attrs: Record<string, unknown>
}
type Token = TextToken | DelimToken | AtomToken | { t: 'break' }

/** Item de texto já resolvido: quebra, texto com marcas ou átomo inline (menção). */
interface InlineItem {
  br?: boolean
  atom?: RichContent
  text: string
  marks: Mark[]
}

const TONE_BY_ALERT: Record<string, string> = { NOTE: 'info', IMPORTANT: 'info', TIP: 'success', WARNING: 'warning', CAUTION: 'danger' }
const ALERT_BY_TONE: Record<string, string> = { info: 'NOTE', success: 'TIP', warning: 'WARNING', danger: 'CAUTION' }
const MARK_ORDER = ['link', 'bold', 'italic', 'underline', 'strike', 'highlight', 'code']
const IMAGE_WIDTHS = [25, 50, 75, 100]
const LANGUAGE = /^[a-z0-9+#-]{1,20}$/i
const PUNCT = /^[!-/:-@[-`{-~]$/
const ALNUM = /^[\p{L}\p{N}]$/u
const SPACE = /^\s$/
const LIST_TYPES: Record<string, true> = { bulletList: true, orderedList: true, taskList: true }
/** Menção: o mesmo formato de `backend/src/domain/mentions.js`. */
const MENTION = /^@\[([^\]\n]{1,120})\]\(([A-Za-z0-9_]{1,64})\)/
const MENTION_ID = /^[A-Za-z0-9_]{1,64}$/
/** Citações/listas aninhadas além disto viram texto. */
const MAX_NESTING = 24
/** Limites de varredura (entrada patológica não pode travar a tela). */
const LINK_TEXT_MAX = 1000
const LINK_DEST_MAX = 2048
const EMPHASIS_BUDGET = 2000000

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/
const HR = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/
const TOC = /^ {0,3}\[TOC\][ \t]*$/i
const QUOTE = /^ {0,3}>/
const COMMENT = /^ {0,3}<!--.*-->[ \t]*$/
const SETEXT_1 = /^ {0,3}=+[ \t]*$/
const SETEXT_2 = /^ {0,3}-+[ \t]*$/
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const TASK = /^\[([ xX])\](?:[ \t]+|$)/

// ================================================================ nós

function node(type: string, attrs?: Record<string, unknown> | null, content?: RichContent[] | null): RichContent {
  const out: RichContent = { type }
  if (attrs) out.attrs = attrs
  if (content && content.length) out.content = content
  return out
}

const paragraph = (content?: RichContent[]) => node('paragraph', null, content)
const cellAttrs = () => ({ colspan: 1, rowspan: 1, colwidth: null })

/** Itens de lista começam por parágrafo (exigência do editor). */
function withLeadingParagraph(blocks: RichContent[]): RichContent[] {
  return blocks.length && blocks[0]?.type === 'paragraph' ? blocks : [paragraph(), ...blocks]
}

function atLeastParagraph(blocks: RichContent[]): RichContent[] {
  return blocks.length ? blocks : [paragraph()]
}

const childrenOf = (n: RichContent | undefined): RichContent[] => (n && Array.isArray(n.content) ? n.content : [])
const textOf = (n: RichContent): string => (n.type === 'text' ? (n.text ?? '') : childrenOf(n).map(textOf).join(''))

// ================================================================ linhas

const isBlank = (line: string) => /^\s*$/.test(line)

/** Largura do recuo (tab = 4 colunas). */
function indentWidth(line: string): number {
  let width = 0
  for (const ch of line) {
    if (ch === ' ') width += 1
    else if (ch === '\t') width += 4 - (width % 4)
    else break
  }
  return width
}

/** Tira até `n` colunas de recuo (tab que passa do limite vira espaços). */
function dedent(line: string, n: number): string {
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

interface Fence {
  indent: number
  ch: string
  len: number
  language: string | null
}

function fenceOpen(line: string): Fence | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return null
  const [, indent = '', run = '', rest = ''] = match
  if (run[0] === '`' && rest.indexOf('`') >= 0) return null
  const info = rest.trim().split(/\s+/)[0] ?? ''
  return { indent: indent.length, ch: run.charAt(0), len: run.length, language: LANGUAGE.test(info) ? info : null }
}

function fenceCloses(line: string, fence: Fence): boolean {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)
  return !!match && match[1]?.charAt(0) === fence.ch && (match[1]?.length ?? 0) >= fence.len
}

interface ListMarker {
  ordered: boolean
  number: number | null
  /** Coluna onde começa o conteúdo. */
  indent: number
  content: string
}

/** Marcador de item: { ordered, number, indent (coluna do conteúdo), content }. */
function listItem(line: string): ListMarker | null {
  let ordered = false
  let number: number | null = null
  let markerWidth: number
  let spaces: string
  let rest: string
  const bullet = /^( {0,3})([-+*])([ \t]*)(.*)$/.exec(line)
  if (bullet) {
    markerWidth = (bullet[1] ?? '').length + 1
    spaces = bullet[3] ?? ''
    rest = bullet[4] ?? ''
  } else {
    const numbered = /^( {0,3})(\d{1,9})([.)])([ \t]*)(.*)$/.exec(line)
    if (!numbered) return null
    ordered = true
    number = Number(numbered[2])
    markerWidth = (numbered[1] ?? '').length + (numbered[2] ?? '').length + 1
    spaces = numbered[4] ?? ''
    rest = numbered[5] ?? ''
  }
  if (!spaces && rest) return null
  const gap = spaces.length >= 1 && spaces.length <= 4 && rest ? spaces.length : 1
  return { ordered, number, indent: markerWidth + gap, content: rest ? ' '.repeat(Math.max(0, spaces.length - gap)) + rest : '' }
}

const itemKind = (item: ListMarker) => (item.ordered ? 'ordered' : TASK.test(item.content) ? 'task' : 'bullet')

/** Separa as células de uma linha de tabela (`\|` não separa). */
function splitRow(line: string): string[] {
  let source = line.trim()
  if (source[0] === '|') source = source.slice(1)
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i)
    if (ch === '\\' && i + 1 < source.length) {
      current += ch + source.charAt(i + 1)
      i += 1
    } else if (ch === '|') {
      cells.push(current)
      current = ''
    } else current += ch
  }
  if (current.trim() || !/\|\s*$/.test(line)) cells.push(current)
  return cells.map((cell) => cell.trim())
}

function isTableStart(lines: string[], i: number): boolean {
  const line = lines[i]
  const delim = lines[i + 1]
  if (line === undefined || delim === undefined || line.indexOf('|') < 0) return false
  return delim.indexOf('|') >= 0 && TABLE_DELIM.test(delim) && splitRow(line).length === splitRow(delim).length
}

/** `\|` vira `|` antes do texto da célula ser lido (inclusive dentro de `código`). */
function unescapePipes(cell: string): string {
  let out = ''
  for (let i = 0; i < cell.length; i++) {
    if (cell[i] === '\\' && cell[i + 1] === '|') {
      out += '|'
      i += 1
    } else if (cell[i] === '\\' && i + 1 < cell.length) {
      out += cell.charAt(i) + cell.charAt(i + 1)
      i += 1
    } else out += cell.charAt(i)
  }
  return out
}

/** Parágrafos da célula: separados por `<br><br>` fora de `código`. */
function cellParagraphs(text: string): string[] {
  const parts: string[] = []
  let start = 0
  let i = 0
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2
      continue
    }
    if (text[i] === '`') {
      const run = /^`+/.exec(text.slice(i))?.[0] ?? '`'
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

// ================================================================ marcas (comuns)

const markOf = (type: string, href?: string): Mark => (type === 'link' ? { type: 'link', attrs: { href } } : { type })
const hrefOf = (mark: Mark) => String((mark as LinkMark).attrs?.href ?? '')
const sameMark = (a: Mark, b: Mark) => a.type === b.type && (a.type !== 'link' || hrefOf(a) === hrefOf(b))
const hasMark = (marks: Mark[], mark: Mark) => marks.some((m) => sameMark(m, mark))
const rank = (mark: Mark) => MARK_ORDER.indexOf(mark.type)
const isCode = (item: InlineItem) => item.marks.length === 1 && item.marks[0]?.type === 'code'
const sameMarks = (a: Mark[], b: Mark[]) => a.length === b.length && a.every((m, k) => {
  const other = b[k]
  return !!other && sameMark(m, other)
})

function addMark(token: TextToken, mark: Mark) {
  if (!token.marks.some((m) => m.type === mark.type)) token.marks.push(mark)
}

const unescape = (value: string) => value.replace(/\\([!-/:-@[-`{-~])/g, (_m, ch: string) => ch)

/**
 * Espaços como o Markdown os guarda: nada nas pontas nem em volta das quebras de linha, e espaço na
 * ponta de uma marcação fica fora dela (só com as marcações que continuam do outro lado).
 */
function normalizeSpaces(input: InlineItem[]): InlineItem[] {
  const items = input.map((item) => ({ ...item }))
  items.forEach((item, k) => {
    if (item.br || item.atom || isCode(item)) return
    if (items[k - 1]?.br) item.text = item.text.replace(/^\s+/, '')
    if (items[k + 1]?.br) item.text = item.text.replace(/\s+$/, '')
  })
  const out: InlineItem[] = []
  const push = (item: InlineItem) => {
    if (!item.br && !item.atom && !item.text) return
    const last = out[out.length - 1]
    if (last && !last.br && !last.atom && !item.br && !item.atom && sameMarks(last.marks, item.marks)) last.text += item.text
    else out.push(item.br || item.atom ? item : { text: item.text, marks: item.marks })
  }
  items.forEach((item, k) => {
    if (item.br || item.atom || isCode(item) || !item.marks.length) return push(item)
    const lead = /^\s*/.exec(item.text)?.[0] ?? ''
    const core = item.text.slice(lead.length)
    const trail = /\s*$/.exec(core)?.[0] ?? ''
    const prev = items[k - 1]
    const next = items[k + 1]
    const shared = (other: InlineItem | undefined) => (other && !other.br ? item.marks.filter((m) => hasMark(other.marks, m)) : [])
    if (!core) {
      push({ text: item.text, marks: prev && next && !prev.br && !next.br ? shared(prev).filter((m) => hasMark(next.marks, m)) : [] })
      return
    }
    push({ text: lead, marks: shared(prev) })
    push({ text: core.slice(0, core.length - trail.length), marks: item.marks })
    push({ text: trail, marks: shared(next) })
  })
  const blank = (item: InlineItem | undefined) => !!item && (!!item.br || (!item.atom && !item.text.trim() && !isCode(item)))
  while (blank(out[0])) out.shift()
  while (blank(out[out.length - 1])) out.pop()
  const first = out[0]
  const last = out[out.length - 1]
  if (first && !first.atom && !isCode(first)) first.text = first.text.replace(/^\s+/, '')
  if (last && !last.atom && !isCode(last)) last.text = last.text.replace(/\s+$/, '')
  return out
}

// ================================================================ codec

export function createMarkdownCodec(options: MarkdownDocOptions): MarkdownCodec {
  const { safeHref, isImageSrc } = options
  const breaks = !!options.breaks
  const mentions = !!options.mentions
  const docBlocks = !!options.docBlocks

  /** A linha começa outro bloco (interrompe um parágrafo). */
  function startsBlock(line: string): boolean {
    if (fenceOpen(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || COMMENT.test(line)) return true
    if (docBlocks && TOC.test(line)) return true
    const item = listItem(line)
    return !!(item && item.content.trim())
  }

  // ---------------------------------------------------------------- blocos (Markdown → doc)

  function parseBlocks(lines: string[], level = 0): RichContent[] {
    if (level > MAX_NESTING) return inlineBlocks(lines.map((line) => line.trim()).filter((line) => line).join('\n'))
    const out: RichContent[] = []
    let i = 0
    while (i < lines.length) {
      const line = lines[i] ?? ''
      if (isBlank(line) || COMMENT.test(line)) {
        i += 1
        continue
      }
      const fence = fenceOpen(line)
      if (fence) {
        const body: string[] = []
        i += 1
        while (i < lines.length && !fenceCloses(lines[i] ?? '', fence)) {
          body.push(dedent(lines[i] ?? '', fence.indent))
          i += 1
        }
        i += 1
        const text = body.join('\n')
        out.push(node('codeBlock', { language: fence.language }, text ? [{ type: 'text', text }] : null))
        continue
      }
      const heading = HEADING.exec(line)
      if (heading) {
        const text = (heading[2] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '')
        out.push(node('heading', { level: Math.min((heading[1] ?? '#').length, 4) }, inlineNodes(text.trim())))
        i += 1
        continue
      }
      if (docBlocks && TOC.test(line)) {
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

  function parseQuote(lines: string[], start: number, out: RichContent[], level: number): number {
    const body: string[] = []
    let i = start
    let lazy = false
    while (i < lines.length) {
      const line = lines[i] ?? ''
      if (QUOTE.test(line)) {
        const inner = line.replace(/^ {0,3}> ?/, '')
        body.push(inner)
        lazy = !isBlank(inner) && !fenceOpen(inner)
      } else if (lazy && !isBlank(line) && !startsBlock(line)) body.push(line.trim())
      else break
      i += 1
    }
    const alert = docBlocks && body.length ? /^[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(.*)$/i.exec(body[0] ?? '') : null
    if (alert) {
      const inner = (alert[2] ? [alert[2]] : []).concat(body.slice(1))
      out.push(node('callout', { tone: TONE_BY_ALERT[(alert[1] ?? 'NOTE').toUpperCase()] }, atLeastParagraph(parseBlocks(inner, level + 1))))
    } else out.push(node('blockquote', null, atLeastParagraph(parseBlocks(body, level + 1))))
    return i
  }

  function parseList(lines: string[], start: number, out: RichContent[], level: number): number {
    const first = listItem(lines[start] ?? '') as ListMarker
    const kind = itemKind(first)
    const items: Array<{ item: ListMarker; body: string[] }> = []
    let i = start
    while (i < lines.length) {
      const item = listItem(lines[i] ?? '')
      if (!item || itemKind(item) !== kind) break
      const body = [item.content]
      let fences = fenceOpen(item.content) ? 1 : 0
      i += 1
      while (i < lines.length) {
        const line = lines[i] ?? ''
        if (isBlank(line)) {
          let j = i
          while (j < lines.length && isBlank(lines[j] ?? '')) j += 1
          if (j < lines.length && indentWidth(lines[j] ?? '') >= item.indent) {
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
      while (j < lines.length && isBlank(lines[j] ?? '')) j += 1
      const next = j < lines.length ? listItem(lines[j] ?? '') : null
      if (!next || itemKind(next) !== kind) break
      i = j
    }
    const nodes = items.map(({ body }) => {
      if (kind !== 'task') return node('listItem', null, withLeadingParagraph(parseBlocks(body, level + 1)))
      const head = body[0] ?? ''
      const task = TASK.exec(head)
      const rest = [head.slice(task?.[0].length ?? 0)].concat(body.slice(1))
      return node('taskItem', { checked: !!task && task[1] !== ' ' }, withLeadingParagraph(parseBlocks(rest, level + 1)))
    })
    if (kind === 'ordered') {
      const number = first.number ?? 1
      out.push(node('orderedList', { start: number >= 1 && number <= 100000 ? number : 1 }, nodes))
    } else out.push(node(kind === 'task' ? 'taskList' : 'bulletList', null, nodes))
    return i
  }

  function cellNode(type: string, text: string): RichContent {
    const blocks: RichContent[] = []
    cellParagraphs(unescapePipes(text)).forEach((part) => inlineBlocks(part.trim()).forEach((block) => blocks.push(block)))
    return node(type, cellAttrs(), atLeastParagraph(blocks))
  }

  function parseTable(lines: string[], start: number, out: RichContent[]): number {
    const header = splitRow(lines[start] ?? '')
    const columns = header.length
    const row = (cells: string[], type: string) => {
      const list: RichContent[] = []
      for (let c = 0; c < columns; c++) list.push(cellNode(type, cells[c] ?? ''))
      return node('tableRow', null, list)
    }
    const rows = [row(header, 'tableHeader')]
    let i = start + 2
    while (i < lines.length && !isBlank(lines[i] ?? '') && !startsBlock(lines[i] ?? '')) {
      rows.push(row(splitRow(lines[i] ?? ''), 'tableCell'))
      i += 1
    }
    out.push(node('table', null, rows))
    return i
  }

  function parseParagraph(lines: string[], start: number, out: RichContent[]): number {
    const body = [(lines[start] ?? '').replace(/^[ \t]+/, '')]
    let i = start + 1
    while (i < lines.length) {
      const line = lines[i] ?? ''
      if (isBlank(line)) break
      // títulos sublinhados só no Markdown da Documentação: nos comentários, "texto\n---" é texto + linha
      if (!breaks && (SETEXT_1.test(line) || SETEXT_2.test(line))) {
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

  // ---------------------------------------------------------------- inline (Markdown → doc)

  /** `[texto](destino "título")` a partir de `start` (o `[`); null se não for link. */
  function linkAt(src: string, start: number): { text: string; dest: string; title: string | null; end: number } | null {
    let depth = 0
    let j = start
    const limit = Math.min(src.length, start + LINK_TEXT_MAX)
    for (; j < limit; j++) {
      const ch = src[j]
      if (ch === '\\') {
        j += 1
      } else if (ch === '`') {
        const run = /^`+/.exec(src.slice(j))?.[0] ?? '`'
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
    while (k < src.length && SPACE.test(src.charAt(k))) k += 1
    let dest = ''
    if (src[k] === '<') {
      k += 1
      while (k < src.length && src[k] !== '>' && src[k] !== '\n' && dest.length < LINK_DEST_MAX) {
        if (src[k] === '\\' && PUNCT.test(src.charAt(k + 1))) k += 1
        dest += src.charAt(k)
        k += 1
      }
      if (src[k] !== '>') return null
      k += 1
    } else {
      let parens = 0
      while (k < src.length && dest.length < LINK_DEST_MAX) {
        const ch = src.charAt(k)
        if (ch === '\\' && PUNCT.test(src.charAt(k + 1))) {
          dest += src.charAt(k + 1)
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
    while (k < src.length && SPACE.test(src.charAt(k))) k += 1
    let title: string | null = null
    const opener = src[k]
    if (opener === '"' || opener === "'" || opener === '(') {
      const closer = opener === '(' ? ')' : opener
      let t = k + 1
      let raw = ''
      while (t < src.length && src[t] !== closer && raw.length < LINK_TEXT_MAX) {
        if (src[t] === '\\' && t + 1 < src.length) {
          raw += src.charAt(t) + src.charAt(t + 1)
          t += 2
          continue
        }
        raw += src.charAt(t)
        t += 1
      }
      if (t >= src.length || src[t] !== closer) return null
      title = unescape(raw)
      k = t + 1
      while (k < src.length && SPACE.test(src.charAt(k))) k += 1
    }
    if (src[k] !== ')') return null
    return { text: src.slice(start + 1, j), dest, title, end: k + 1 }
  }

  /** URL solta (sem `<>`): tira a pontuação do fim, como o GFM. */
  function bareUrl(rest: string): string | null {
    const match = /^https?:\/\/[^\s<]+/i.exec(rest)
    if (!match) return null
    let url = match[0]
    for (;;) {
      const last = url.charAt(url.length - 1)
      if ('.,:;"\'!?*_~=]'.indexOf(last) >= 0) url = url.slice(0, -1)
      else if (last === ')' && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length) url = url.slice(0, -1)
      else break
    }
    return /^https?:\/\/./i.test(url) ? url : null
  }

  function imageToken(alt: string, dest: string, title: string | null, width: number | null): Token[] {
    const text = unescape(alt)
    if (isImageSrc(dest)) {
      const attrs: Record<string, unknown> = { src: dest }
      if (text) attrs.alt = text.slice(0, 300)
      if (title) attrs.title = title.slice(0, 300)
      attrs.width = width !== null && IMAGE_WIDTHS.includes(width) ? width : null
      return [{ t: 'image', attrs }]
    }
    const href = safeHref(dest)
    if (href) return [{ t: 'text', text: text || href, marks: [markOf('link', href)] }]
    return text ? [{ t: 'text', text, marks: [] }] : []
  }

  function tokenize(src: string, inLink: boolean): Token[] {
    const tokens: Token[] = []
    const noCloser: Record<number, boolean> = {}
    let buf = ''
    const flush = () => {
      if (buf) tokens.push({ t: 'text', text: buf, marks: [] })
      buf = ''
    }
    let i = 0
    while (i < src.length) {
      const ch = src.charAt(i)
      const rest = src.slice(i)
      if (ch === '\\') {
        const next = src.charAt(i + 1)
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
        if (breaks || / {2,}$/.test(buf)) {
          buf = buf.replace(/ +$/, '')
          flush()
          tokens.push({ t: 'break' })
        } else buf = `${buf.replace(/ +$/, '')} `
        i += 1
        continue
      }
      if (ch === '`') {
        const run = /^`+/.exec(rest)?.[0] ?? '`'
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
      if (mentions && ch === '@' && src[i + 1] === '[') {
        const mention = MENTION.exec(rest)
        if (mention) {
          flush()
          tokens.push({ t: 'mention', attrs: { id: mention[2], label: mention[1] } })
          i += mention[0].length
          continue
        }
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
        const found = br ?? underline ?? auto
        if (found) {
          flush()
          if (br) tokens.push({ t: 'break' })
          else if (underline) tokens.push({ t: 'delim', ch: 'u', n: 1, size: 1, open: !underline[1], close: !!underline[1] })
          else if (auto) {
            const value = auto[1] ?? ''
            const href = safeHref(value)
            tokens.push({ t: 'text', text: value, marks: href ? [markOf('link', href)] : [] })
          }
          i += found[0].length
          continue
        }
      }
      if ((ch === 'h' || ch === 'H') && !inLink && !ALNUM.test(src[i - 1] ?? ' ')) {
        const url = bareUrl(rest)
        const href = url && safeHref(url)
        if (url && href) {
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
        const prev = src[i - 1] ?? ' '
        const next = src[i + n] ?? ' '
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

  const literal = (token: DelimToken) => (token.ch === 'u' ? (token.n ? (token.open ? '<u>' : '</u>') : '') : token.ch.repeat(token.n))

  /** Regra do múltiplo de 3 do CommonMark (`*`/`_` que abrem e fecham): `**a*b***` = negrito com itálico dentro. */
  function canPair(opener: DelimToken, closer: DelimToken): boolean {
    if (closer.ch !== '*' && closer.ch !== '_') return true
    if (!(opener.close || closer.open)) return true
    return (opener.size + closer.size) % 3 !== 0 || (opener.size % 3 === 0 && closer.size % 3 === 0)
  }

  /** Ênfases (delimitadores) no estilo CommonMark, com flancos simplificados. */
  function resolveEmphasis(tokens: Token[]): Token[] {
    // abaixo de `bottom[chave]` já se sabe que não há abertura para esse tipo de fechamento
    const bottom: Record<string, number> = {}
    let budget = EMPHASIS_BUDGET
    for (let c = 0; c < tokens.length && budget > 0; c++) {
      const closer = tokens[c]
      if (!closer || closer.t !== 'delim' || !closer.close) continue
      const key = `${closer.ch}${closer.open ? 1 : 0}${closer.size % 3}`
      while (closer.n > 0 && budget > 0) {
        const double = closer.ch === '~' || closer.ch === '='
        if (double && closer.n < 2) break
        const floor = bottom[key] ?? -1
        let o = c - 1
        const matches = (token: Token | undefined) =>
          !!token && token.t === 'delim' && token.open && token.n > 0 && token.ch === closer.ch && (!double || token.n >= 2) && canPair(token, closer)
        while (o > floor && !matches(tokens[o])) o -= 1
        budget -= c - o
        if (o <= floor) {
          bottom[key] = c - 1
          break
        }
        const opener = tokens[o] as DelimToken
        const use = closer.ch === 'u' ? 1 : double ? 2 : opener.n >= 2 && closer.n >= 2 ? 2 : 1
        const type = ({ '~': 'strike', '=': 'highlight', u: 'underline' } as Record<string, string>)[closer.ch] ?? (use === 2 ? 'bold' : 'italic')
        budget -= c - o
        for (let k = o + 1; k < c; k++) {
          const token = tokens[k]
          if (token?.t === 'delim') tokens[k] = { t: 'text', text: literal(token), marks: [] }
          const current = tokens[k]
          if (current?.t === 'text') addMark(current, markOf(type))
        }
        opener.n -= use
        closer.n -= use
      }
    }
    return tokens.map((token) => (token.t === 'delim' ? { t: 'text', text: literal(token), marks: [] } : token))
  }

  function parseInlineTokens(src: string, inLink = false): Token[] {
    return resolveEmphasis(tokenize(src, inLink))
  }

  /** Tokens → nós do editor: código só com a marca de código (como no editor), vizinhos iguais juntos. */
  function finishInline(tokens: Token[]): RichContent[] {
    const items: InlineItem[] = []
    tokens.forEach((token) => {
      if (token.t === 'break') items.push({ br: true, text: '', marks: [] })
      else if (token.t === 'mention') items.push({ atom: node('mention', token.attrs), text: '', marks: [] })
      else if (token.t === 'text' && token.text) {
        const code = token.marks.find((m) => m.type === 'code')
        items.push({ text: token.text, marks: code ? [code] : token.marks.slice().sort((a, b) => rank(a) - rank(b)) })
      }
    })
    return normalizeSpaces(items).map((item) => {
      if (item.br) return { type: 'hardBreak' }
      if (item.atom) return item.atom
      return item.marks.length ? { type: 'text', text: item.text, marks: item.marks } : { type: 'text', text: item.text }
    })
  }

  /** Conteúdo inline (títulos): imagens viram o texto alternativo. */
  function inlineNodes(src: string): RichContent[] {
    return finishInline(parseInlineTokens(src).map((token) => (token.t === 'image' ? { t: 'text' as const, text: String(token.attrs.alt ?? ''), marks: [] } : token)))
  }

  /** Parágrafo(s): imagens são blocos no editor, então quebram o parágrafo. */
  function inlineBlocks(src: string): RichContent[] {
    const blocks: RichContent[] = []
    let current: Token[] = []
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

  function toDoc(markdown: string | null | undefined): RichContent {
    const lines = String(markdown ?? '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
    return node('doc', null, parseBlocks(lines))
  }

  // ---------------------------------------------------------------- doc → Markdown

  function escapeText(text: string, table: boolean): string {
    let out = ''
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i)
      const prev = text.charAt(i - 1)
      const next = text.charAt(i + 1)
      if (ch === '\\' || ch === '*' || ch === '`' || ch === '[' || ch === ']') out += `\\${ch}`
      else if (ch === '_' && (!ALNUM.test(prev) || !ALNUM.test(next))) out += '\\_'
      else if ((ch === '~' || ch === '=') && (prev === ch || next === ch || !prev || !next)) out += `\\${ch}`
      else if (ch === '<' && /^<(?:\/?u>|br[ \t]*\/?>|https?:|mailto:|!--)/i.test(text.slice(i))) out += '\\<'
      else if (ch === '|' && table) out += '\\|'
      else if (ch === '\n') out += ' '
      else out += ch
    }
    return out.replace(/(https?):\/\//gi, (_m, scheme: string) => `${scheme}\\://`)
  }

  function codeSpan(text: string, table: boolean): string {
    const value = table ? text.replace(/\|/g, '\\|') : text
    const longest = (value.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0)
    const fence = '`'.repeat(longest + 1)
    const pad = value[0] === '`' || value[value.length - 1] === '`' || (value[0] === ' ' && value[value.length - 1] === ' ' && value.trim()) ? ' ' : ''
    return `${fence}${pad}${value}${pad}${fence}`
  }

  const escapeDest = (href: string) => href.replace(/[()\\<>]/g, (ch) => `\\${ch}`)

  const OPEN: Record<string, string> = { link: '[', bold: '**', italic: '*', underline: '<u>', strike: '~~', highlight: '==' }
  const CLOSE: Record<string, string> = { bold: '**', italic: '*', underline: '</u>', strike: '~~', highlight: '==' }
  const openDelim = (mark: Mark) => OPEN[mark.type] ?? ''
  const closeDelim = (mark: Mark) => (mark.type === 'link' ? `](${escapeDest(hrefOf(mark))})` : (CLOSE[mark.type] ?? ''))

  /** Marcas que o Markdown representa (links inseguros caem; código exclui as outras, como no editor). */
  function marksOf(n: RichContent): Mark[] {
    const marks = (n.marks ?? []).filter((m) => m && MARK_ORDER.includes(m.type) && (m.type !== 'link' || safeHref(String(m.attrs?.href ?? ''))))
    const code = marks.find((m) => m.type === 'code')
    if (code) return [{ type: 'code' }]
    return marks.map((m) => (m.type === 'link' ? markOf('link', safeHref(String(m.attrs?.href ?? '')) ?? '') : markOf(m.type))).sort((a, b) => rank(a) - rank(b))
  }

  function mentionMarkdown(attrs: Record<string, unknown> | undefined): string {
    const id = String(attrs?.id ?? '')
    const label = String(attrs?.label ?? '')
      .replace(/[\]\n\r]/g, ' ')
      .trim()
      .slice(0, 120)
    if (!MENTION_ID.test(id) || !label) return escapeText(`@${label}`, false)
    return `@[${label}](${id})`
  }

  interface Part {
    mark: Mark
    open: boolean
    pair: number
    s: string
  }

  /** Texto com marcações; `lineBreak` é como sai a quebra de linha (`\` + nova linha, ou `<br>`). */
  function renderInline(nodes: RichContent[], lineBreak: string, table = false): string {
    const raw: InlineItem[] = []
    nodes.forEach((n) => {
      // na célula, `<br><br>` separa parágrafos: quebras seguidas viram uma
      if (n.type === 'hardBreak') {
        if (!(table && raw.length && raw[raw.length - 1]?.br)) raw.push({ br: true, text: '', marks: [] })
      } else if (n.type === 'text' && n.text) raw.push({ text: n.text, marks: marksOf(n) })
      else if (n.type === 'mention' && mentions) raw.push({ atom: n, text: '', marks: [] })
      else if (n.type === 'mention') raw.push({ text: `@${String(n.attrs?.label ?? '')}`, marks: [] })
      else if (n.type === 'image' && n.attrs) raw.push({ text: String(n.attrs.alt ?? ''), marks: [] })
    })
    const items = normalizeSpaces(raw)
    const nextText: number[] = []
    for (let k = items.length - 1, next = -1; k >= 0; k--) {
      nextText[k] = next
      if (!items[k]?.br) next = k
    }
    const runLength = (k: number, mark: Mark) => {
      let n = 0
      for (let j = k; j < items.length; j++) {
        const item = items[j]
        if (!item || item.br) continue
        if (!hasMark(item.marks, mark)) break
        n += 1
      }
      return n
    }
    // partes: texto (string) ou delimitador ({ mark, open, pair, s }); o do itálico é decidido no fim
    const parts: Array<string | Part> = []
    let pending = ''
    const stack: Array<{ mark: Mark; pair: number }> = []
    let pairs = 0
    const write = (s: string) => parts.push(s)
    const close = () => {
      const entry = stack.pop()
      if (!entry) return
      const s = closeDelim(entry.mark)
      parts.push({ mark: entry.mark, open: false, pair: entry.pair, s: table ? s.replace(/\|/g, '\\|') : s })
    }
    items.forEach((item, k) => {
      if (item.br) {
        // o que não continua na linha seguinte fecha antes da quebra (no começo da linha não fecharia)
        const next = items[nextText[k] ?? -1]
        let keep = 0
        while (next && keep < stack.length && hasMark(next.marks, (stack[keep] as { mark: Mark }).mark)) keep += 1
        while (stack.length > keep) close()
        write(pending + lineBreak)
        pending = ''
        return
      }
      let keep = 0
      while (keep < stack.length && hasMark(item.marks, (stack[keep] as { mark: Mark }).mark)) keep += 1
      while (stack.length > keep) close()
      write(pending)
      pending = ''
      if (item.atom) {
        write(mentionMarkdown(item.atom.attrs))
        return
      }
      if (isCode(item)) {
        write(codeSpan(item.text, table))
        return
      }
      const opening = item.marks.filter((m) => !stack.some((entry) => sameMark(entry.mark, m))).sort((a, b) => runLength(k, b) - runLength(k, a) || rank(a) - rank(b))
      let text = item.text
      const only = opening[0]
      const href = opening.length === 1 && stack.length === 0 && only?.type === 'link' ? hrefOf(only) : null
      const next = items[k + 1]
      if (href && only && text === href && /^(?:https?:\/\/|mailto:)[^\s<>]+$/i.test(href) && !(next && !next.br && hasMark(next.marks, only))) {
        write(`<${table ? href.replace(/\|/g, '\\|') : href}>`)
        return
      }
      if (opening.length) {
        const lead = /^\s*/.exec(text)?.[0] ?? ''
        write(lead)
        text = text.slice(lead.length)
      }
      opening.forEach((m) => {
        pairs += 1
        stack.push({ mark: m, pair: pairs })
        parts.push({ mark: m, open: true, pair: pairs, s: openDelim(m) })
      })
      const trail = stack.length ? (/\s*$/.exec(text)?.[0] ?? '') : ''
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
  function chooseItalicDelimiters(parts: Array<string | Part>) {
    const charAt = (index: number, step: number) => {
      for (let j = index + step; j >= 0 && j < parts.length; j += step) {
        const part = parts[j]
        const s = typeof part === 'string' ? part : (part?.s ?? '')
        if (s) return step < 0 ? s.charAt(s.length - 1) : s.charAt(0)
      }
      return ''
    }
    const starNext = (index: number, step: number) => {
      const part = parts[index + step]
      return !!part && typeof part !== 'string' && part.s.charAt(step < 0 ? part.s.length - 1 : 0) === '*'
    }
    const closing: Record<number, number> = {}
    parts.forEach((part, j) => {
      if (typeof part !== 'string' && !part.open) closing[part.pair] = j
    })
    parts.forEach((part, a) => {
      if (typeof part === 'string' || part.mark.type !== 'italic' || !part.open) return
      const b = closing[part.pair]
      if (b === undefined) return
      const touches = starNext(a, -1) || starNext(a, 1) || starNext(b, -1) || starNext(b, 1)
      const end = parts[b]
      if (touches && end && typeof end !== 'string' && !ALNUM.test(charAt(a, -1)) && !ALNUM.test(charAt(b, 1)) && charAt(a, -1) !== '_' && charAt(b, 1) !== '_') {
        part.s = '_'
        end.s = '_'
      }
    })
  }

  /** Começo de linha que viraria outro bloco ganha `\`. */
  function escapeLineStarts(text: string): string {
    return text
      .split('\n')
      .map((line) => {
        if (/^(?:#{1,6}(?:\s|$)|>|[-+](?:\s|$)|-+\s*$|=+\s*$)/.test(line)) return `\\${line}`
        const ordered = /^(\d{1,9})([.)])(\s|$)/.exec(line)
        return ordered ? `${ordered[1]}\\${line.slice((ordered[1] ?? '').length)}` : line
      })
      .join('\n')
  }

  function imageMarkdown(attrs: Record<string, unknown>): string {
    const alt = String(attrs.alt ?? '').replace(/[\\[\]]/g, (ch) => `\\${ch}`)
    const title = attrs.title ? ` "${String(attrs.title).replace(/["\\]/g, (ch) => `\\${ch}`)}"` : ''
    const width = typeof attrs.width === 'number' && IMAGE_WIDTHS.includes(attrs.width) ? `{width=${attrs.width}%}` : ''
    return `![${alt}](${escapeDest(String(attrs.src ?? ''))}${title})${width}`
  }

  /** Linhas de citação: `> ` em todas (linha vazia vira `>`). */
  const quoteLines = (text: string) =>
    text
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'))
      .join('\n')

  const prefixLines = (text: string, first: string, rest: string) =>
    text
      .split('\n')
      .map((line, k) => (k === 0 ? `${first}${line}`.replace(/\s+$/, '') : line ? `${rest}${line}` : ''))
      .join('\n')

  function renderItem(item: RichContent, marker: string, indent: number): string {
    const children = childrenOf(item)
    let body = ''
    children.forEach((child, k) => {
      // `- ---` seria uma linha horizontal inteira: no começo do item ela sai como `***`
      const md = child.type === 'horizontalRule' && !body ? '***' : renderBlock(child)
      // sublista colada no parágrafo (lista "compacta"), menos `-` vazio, que sublinharia o parágrafo
      const tight = LIST_TYPES[child.type] && children[k - 1]?.type === 'paragraph' && !/^-(?:\n|$)/.test(md)
      if (k === 0) body = md
      else if (md) body += (body === '' ? '' : tight ? '\n' : '\n\n') + md
    })
    return prefixLines(body, marker, ' '.repeat(indent))
  }

  function renderList(n: RichContent): string {
    const items = childrenOf(n)
    if (n.type === 'orderedList') {
      const raw = n.attrs?.start
      const start = typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : 1
      return items
        .map((item, k) => {
          const marker = `${start + k}. `
          return renderItem(item, marker, marker.length)
        })
        .join('\n')
    }
    if (n.type === 'taskList') return items.map((item) => renderItem(item, item.attrs?.checked ? '- [x] ' : '- [ ] ', 2)).join('\n')
    return items.map((item) => renderItem(item, '- ', 2)).join('\n')
  }

  /** Célula: só texto e imagens (o resto vira parágrafos), parágrafos separados por `<br><br>`. */
  function cellMarkdown(cell: RichContent): string {
    const parts: string[] = []
    const visit = (blocks: RichContent[]) =>
      blocks.forEach((b) => {
        if (b.type === 'paragraph' || b.type === 'heading') parts.push(renderInline(childrenOf(b), '<br>', true))
        else if (b.type === 'image' && b.attrs) parts.push(imageMarkdown(b.attrs).replace(/\|/g, '\\|'))
        else if (b.type === 'codeBlock') parts.push(textOf(b) ? codeSpan(textOf(b).replace(/\n/g, ' '), true) : '')
        else visit(childrenOf(b))
      })
    visit(childrenOf(cell))
    return parts.filter((p) => p).join('<br><br>')
  }

  function renderTable(n: RichContent): string {
    const rows = childrenOf(n).map((row) => childrenOf(row).map(cellMarkdown))
    if (!rows.length) return ''
    const columns = Math.max(1, ...rows.map((cells) => cells.length))
    const line = (cells: string[]) => {
      const list: string[] = []
      for (let c = 0; c < columns; c++) list.push(cells[c] ?? '')
      return `| ${list.join(' | ')} |`
    }
    const delim = `| ${new Array(columns).fill('---').join(' | ')} |`
    return [line(rows[0] ?? []), delim].concat(rows.slice(1).map(line)).join('\n')
  }

  function renderBlock(n: RichContent | undefined): string {
    if (!n || typeof n !== 'object') return ''
    switch (n.type) {
      case 'paragraph':
        // nos comentários a quebra é a nova linha simples (é o que se lê no texto cru e no e-mail)
        return escapeLineStarts(renderInline(childrenOf(n), breaks ? '\n' : '\\\n'))
      case 'heading': {
        const level = Math.min(Math.max(Number(n.attrs?.level) || 1, 1), 4)
        const text = renderInline(childrenOf(n), '<br>').replace(/#$/, '\\#')
        return `${'#'.repeat(level)}${text ? ` ${text}` : ''}`
      }
      case 'blockquote':
        return quoteLines(renderBlocks(childrenOf(n)))
      case 'callout': {
        const inner = renderBlocks(childrenOf(n))
        if (!docBlocks) return quoteLines(inner)
        const tone = ALERT_BY_TONE[String(n.attrs?.tone ?? '')] ?? 'NOTE'
        return `> [!${tone}]${inner ? `\n${quoteLines(inner)}` : ''}`
      }
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return renderList(n)
      case 'codeBlock': {
        const text = textOf(n)
        const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0)
        const fence = '`'.repeat(Math.max(3, longest + 1))
        const raw = n.attrs?.language
        const language = typeof raw === 'string' && LANGUAGE.test(raw) ? raw : ''
        return `${fence}${language}\n${text ? `${text}\n` : ''}${fence}`
      }
      case 'horizontalRule':
        return '---'
      case 'tableOfContents':
        return docBlocks ? '[TOC]' : ''
      case 'image':
        return n.attrs?.src ? imageMarkdown(n.attrs) : ''
      case 'table':
        return renderTable(n)
      default:
        return renderBlocks(childrenOf(n))
    }
  }

  function renderBlocks(nodes: RichContent[]): string {
    let out = ''
    let previous: RichContent | null = null
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

  function toMarkdown(doc: RichContent | null | undefined): string {
    if (!doc || typeof doc !== 'object') return ''
    return renderBlocks(childrenOf(doc))
  }

  return { toDoc, toMarkdown }
}

// ================================================================ textos das tarefas

/** Imagens que um comentário/descrição pode mostrar: anexos da tarefa e arquivos da Documentação. */
const TASK_IMAGE_SRC = /^\/api\/v1\/(?:attachments\/[A-Za-z0-9_]{1,64}\/file|docs\/files\/[A-Za-z0-9]{15})$/

export function isTaskImageSrc(src: string): boolean {
  return TASK_IMAGE_SRC.test(src)
}

/** Links dos textos das tarefas: só http(s) (como sempre foi no `AppMarkdown`). */
export function safeTaskHref(href: string): string | null {
  const value = href.trim()
  return /^https?:\/\/[^\s]+$/i.test(value) ? value.slice(0, 2000) : null
}

/** Regras dos comentários e descrições: quebra simples, menções, links http(s), imagens dos anexos. */
export const TASK_MARKDOWN_OPTIONS: MarkdownDocOptions = { safeHref: safeTaskHref, isImageSrc: isTaskImageSrc, breaks: true, mentions: true }

export const taskMarkdown: MarkdownCodec = createMarkdownCodec(TASK_MARKDOWN_OPTIONS)
