/**
 * Conteúdo das páginas de documentação (expansão, Onda 2).
 *
 * O editor (TipTap/ProseMirror) grava um documento JSON estruturado. Antes de salvar, o servidor
 * **higieniza**: só blocos e marcações conhecidos, só atributos esperados (com valores válidos),
 * links apenas http(s)/mailto ou internos, imagens apenas de arquivos da própria documentação.
 * Nunca há HTML cru. Na mesma passada, extrai o texto (busca) e os arquivos referenciados.
 */

const MAX_DEPTH = 30
const MAX_NODES = 20000
const MAX_TEXT = 300000
const FILE_URL = /^\/api\/v1\/docs\/files\/([A-Za-z0-9]{15})$/
const CALLOUT_TONES = ['info', 'warning', 'danger', 'success']
const IMAGE_WIDTHS = [25, 50, 75, 100]

const str = (max) => (value) => (typeof value === 'string' ? value.slice(0, max) : undefined)
const int = (min, max, fallback) => (value) => (typeof value === 'number' && Math.floor(value) === value && value >= min && value <= max ? value : fallback)
const cellAttrs = {
  colspan: int(1, 20, 1),
  rowspan: int(1, 50, 1),
  colwidth: (value) => (Array.isArray(value) && value.length <= 20 && value.every((w) => typeof w === 'number' && w > 0 && w < 5000) ? value.map(Math.round) : null),
}

/** Blocos aceitos: `content` = aceita filhos; `attrs` = validadores (valor inválido vira o padrão ou some). */
const NODES = {
  doc: { content: true },
  paragraph: { content: true },
  heading: { content: true, attrs: { level: (v) => ([1, 2, 3, 4].indexOf(v) >= 0 ? v : 2) } },
  blockquote: { content: true },
  bulletList: { content: true },
  orderedList: { content: true, attrs: { start: int(1, 100000, 1) } },
  listItem: { content: true },
  taskList: { content: true },
  taskItem: { content: true, attrs: { checked: (v) => v === true } },
  codeBlock: { content: true, attrs: { language: (v) => (typeof v === 'string' && /^[a-z0-9+#-]{1,20}$/i.test(v) ? v : null) } },
  horizontalRule: {},
  hardBreak: {},
  image: {
    attrs: {
      src: (v) => (typeof v === 'string' && FILE_URL.test(v) ? v : undefined),
      alt: str(300),
      title: str(300),
      width: (v) => (IMAGE_WIDTHS.indexOf(v) >= 0 ? v : null),
    },
    required: ['src'],
  },
  table: { content: true },
  tableRow: { content: true },
  tableHeader: { content: true, attrs: cellAttrs },
  tableCell: { content: true, attrs: cellAttrs },
  callout: { content: true, attrs: { tone: (v) => (CALLOUT_TONES.indexOf(v) >= 0 ? v : 'info') } },
  tableOfContents: {},
}

const BLOCK_BREAK = { paragraph: 1, heading: 1, listItem: 1, taskItem: 1, codeBlock: 1, blockquote: 1, callout: 1, tableRow: 1 }

function safeHref(href) {
  if (typeof href !== 'string') return null
  const value = href.trim()
  if (/^https?:\/\/[^\s]+$/i.test(value) || /^mailto:[^\s]+$/i.test(value)) return value.slice(0, 2000)
  if (/^\/docs\/[A-Za-z0-9/_-]*$/.test(value) || FILE_URL.test(value)) return value
  return null
}

const MARKS = {
  bold: true,
  italic: true,
  underline: true,
  strike: true,
  code: true,
  highlight: true,
  link: true,
}

function cleanMarks(marks) {
  if (!Array.isArray(marks)) return undefined
  const out = []
  marks.forEach((mark) => {
    if (!mark || typeof mark.type !== 'string' || !MARKS[mark.type]) return
    if (mark.type === 'link') {
      const href = safeHref(mark.attrs && mark.attrs.href)
      if (href) out.push({ type: 'link', attrs: { href } })
      return
    }
    out.push({ type: mark.type })
  })
  return out.length ? out : undefined
}

function fileIdOf(url) {
  const match = typeof url === 'string' ? FILE_URL.exec(url) : null
  return match ? match[1] : null
}

/**
 * Higieniza o documento. Retorna { doc, text, fileIds } ou { error }:
 * invalid_content (estrutura desconhecida), too_deep, too_large (nós demais), too_long (texto demais).
 */
function sanitizeDoc(input) {
  if (input === null || input === undefined) return { doc: { type: 'doc', content: [] }, text: '', fileIds: [] }
  if (typeof input !== 'object' || input.type !== 'doc') return { error: 'invalid_content' }
  const state = { nodes: 0, textLength: 0, parts: [], fileIds: [], error: null }

  function walk(node, depth) {
    if (state.error) return null
    if (depth > MAX_DEPTH) {
      state.error = 'too_deep'
      return null
    }
    state.nodes += 1
    if (state.nodes > MAX_NODES) {
      state.error = 'too_large'
      return null
    }
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
      state.error = 'invalid_content'
      return null
    }
    if (node.type === 'text') {
      if (typeof node.text !== 'string' || !node.text) return null
      state.textLength += node.text.length
      if (state.textLength > MAX_TEXT) {
        state.error = 'too_long'
        return null
      }
      state.parts.push(node.text)
      const out = { type: 'text', text: node.text }
      const marks = cleanMarks(node.marks)
      if (marks) out.marks = marks
      marks &&
        marks.forEach((m) => {
          const id = m.type === 'link' ? fileIdOf(m.attrs.href) : null
          if (id && state.fileIds.indexOf(id) < 0) state.fileIds.push(id)
        })
      return out
    }
    const spec = NODES[node.type]
    if (!spec) {
      state.error = 'invalid_content'
      return null
    }
    const out = { type: node.type }
    if (spec.attrs) {
      const attrs = {}
      const source = node.attrs && typeof node.attrs === 'object' ? node.attrs : {}
      Object.keys(spec.attrs).forEach((name) => {
        const value = spec.attrs[name](source[name])
        if (value !== undefined) attrs[name] = value
      })
      if (spec.required && spec.required.some((name) => attrs[name] === undefined)) return null
      out.attrs = attrs
    }
    if (node.type === 'image') {
      const id = fileIdOf(out.attrs.src)
      if (id && state.fileIds.indexOf(id) < 0) state.fileIds.push(id)
    }
    if (node.type === 'hardBreak') state.parts.push('\n')
    if (spec.content && Array.isArray(node.content)) {
      const children = []
      node.content.forEach((child) => {
        const cleaned = walk(child, depth + 1)
        if (cleaned) children.push(cleaned)
      })
      if (children.length) out.content = children
    }
    if (BLOCK_BREAK[node.type]) state.parts.push('\n')
    if (node.type === 'tableCell' || node.type === 'tableHeader') state.parts.push(' ')
    return out
  }

  const doc = walk(input, 0)
  if (state.error) return { error: state.error }
  const text = state.parts
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return { doc: doc || { type: 'doc', content: [] }, text, fileIds: state.fileIds }
}

/** Minúsculas sem acento, preservando o tamanho (o índice na versão "dobrada" vale no original). */
function fold(value) {
  const source = String(value || '')
  let out = ''
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
    out += (base ? base[0] : ch).toLowerCase()
  }
  return out
}

/** Trecho do texto em volta da primeira ocorrência do termo (sem acento/maiúsculas). */
function snippet(text, query, radius) {
  const r = radius || 80
  const source = String(text || '').replace(/\s+/g, ' ')
  const q = fold(String(query || '').trim())
  const index = q ? fold(source).indexOf(q) : -1
  if (index < 0) return source.length > r * 2 ? `${source.slice(0, r * 2).trim()}…` : source
  const start = Math.max(0, index - r)
  const end = Math.min(source.length, index + q.length + r)
  return `${start > 0 ? '…' : ''}${source.slice(start, end).trim()}${end < source.length ? '…' : ''}`
}

module.exports = { MAX_DEPTH, MAX_NODES, MAX_TEXT, CALLOUT_TONES, IMAGE_WIDTHS, FILE_URL, sanitizeDoc, safeHref, fold, snippet }
