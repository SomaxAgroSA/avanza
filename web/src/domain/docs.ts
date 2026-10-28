/**
 * Documentação (expansão, Onda 2). Regras de acesso, conteúdo e árvore ficam no servidor
 * (backend/src/domain/docs.js, doc-content.js, doc-tree.js); aqui, os tipos e a
 * organização da árvore na tela (o arraste espelha as regras do servidor para dar retorno na hora).
 */
import type { UserSummary } from './projects'
import type { OptionColor } from './task-config'

export const SPACE_VISIBILITIES = ['company', 'project'] as const
export type SpaceVisibility = (typeof SPACE_VISIBILITIES)[number]
export const SPACE_ICONS = ['book', 'file-text', 'layers', 'settings', 'shield', 'users', 'rocket', 'target', 'code', 'database', 'globe', 'briefcase'] as const
export type SpaceIcon = (typeof SPACE_ICONS)[number]
export const MAX_DOC_DEPTH = 8

/** Documento do editor (JSON estruturado; higienizado pelo servidor). */
export interface RichContent {
  type: string
  content?: RichContent[]
  attrs?: Record<string, unknown>
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  text?: string
}
export const EMPTY_DOC: RichContent = { type: 'doc', content: [] }

/* ---------------------------------------------- conteúdo (espelha doc-content.js) */

export const CALLOUT_TONES = ['info', 'success', 'warning', 'danger'] as const
export type CalloutTone = (typeof CALLOUT_TONES)[number]
export const IMAGE_WIDTHS = [25, 50, 75, 100] as const
export type ImageWidth = (typeof IMAGE_WIDTHS)[number]
/** Endereço dos arquivos da documentação (imagens só podem vir daqui). */
export const DOC_FILE_URL = /^\/api\/v1\/docs\/files\/[A-Za-z0-9]{15}$/

/** Links aceitos pelo servidor: http(s), mailto, páginas internas (/docs/…) e arquivos da documentação. */
export function isSafeDocHref(href: string): boolean {
  const value = href.trim()
  return /^https?:\/\/[^\s]+$/i.test(value) || /^mailto:[^\s]+$/i.test(value) || /^\/docs\/[A-Za-z0-9/_-]*$/.test(value) || DOC_FILE_URL.test(value)
}

/** Completa o que a pessoa digitou (ex.: "exemplo.com" → "https://exemplo.com"); null se não for aceito. */
export function normalizeDocHref(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  // outro esquema explícito (javascript:, data:, ftp:…) nunca é "completado"
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(value) && !/^(https?|mailto):/i.test(value)) return null
  const withProtocol = /^(https?:|mailto:|\/)/i.test(value) ? value : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? `mailto:${value}` : `https://${value}`
  return isSafeDocHref(withProtocol) ? withProtocol : null
}

export interface DocOutlineItem {
  level: number
  text: string
  /** Posição entre os títulos do documento (para rolar até ele). */
  index: number
}

const plainText = (node: RichContent): string => (node.text ?? '') + (node.content ?? []).map(plainText).join('')

/** Títulos (h1–h4) do documento, na ordem — o "Nesta página" e o bloco de sumário. */
export function docOutline(doc: RichContent | null | undefined): DocOutlineItem[] {
  const out: DocOutlineItem[] = []
  const walk = (node: RichContent) => {
    if (node.type === 'heading') {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 2
      out.push({ level, text: plainText(node).trim(), index: out.length })
      return
    }
    ;(node.content ?? []).forEach(walk)
  }
  if (doc) walk(doc)
  return out
}

export interface DocSpace {
  id: string
  key: string
  name: string
  description: string
  icon: SpaceIcon
  color: OptionColor
  visibility: SpaceVisibility
  project: { id: string; key: string; name: string } | null
  homePageId: string | null
  pageCount: number | null
  createdAt: Date | null
  updatedAt: Date | null
  capabilities: { edit: boolean; manage: boolean }
}

export interface DocSpaceInput {
  key?: string
  name?: string
  description?: string
  icon?: SpaceIcon
  color?: OptionColor
  projectId?: string
  visibility?: SpaceVisibility
}

export interface DocTreePage {
  id: string
  parentId: string | null
  title: string
  status: 'draft' | 'published'
  position: number
  hasDraft: boolean
  isHome: boolean
  updatedAt: Date | null
}

export interface DocSpaceDetail {
  space: DocSpace
  pages: DocTreePage[]
  capabilities: { edit: boolean; manage: boolean }
}

export interface DocPage {
  id: string
  space: { id: string; key: string; name: string }
  parentId: string | null
  title: string
  status: 'draft' | 'published'
  /** Publicado (null enquanto a página nunca foi publicada). */
  content: RichContent | null
  version: number
  publishedAt: Date | null
  publishedBy: UserSummary | null
  createdBy: UserSummary | null
  isHome: boolean
  ancestors: Array<{ id: string; title: string }>
  children: Array<{ id: string; title: string; status: 'draft' | 'published' }>
  /** Rascunho pendente (só para quem edita). */
  draft: { title: string; by: UserSummary | null; at: Date | null } | null
  capabilities: { edit: boolean; manage: boolean }
}

export interface DocDraft {
  title: string
  content: RichContent
  savedAt: Date | null
  by: UserSummary | null
}

export interface DocVersion {
  version: number
  title: string
  author: UserSummary | null
  createdAt: Date | null
}

export interface DocVersionDetail extends DocVersion {
  content: RichContent
}

export interface DocSearchResult {
  pageId: string
  title: string
  space: { id: string; key: string; name: string }
  snippet: string
  publishedAt: Date | null
}

export interface DocRecent {
  pageId: string
  title: string
  space: { id: string; key: string; name: string }
  publishedAt: Date | null
  publishedBy: UserSummary | null
}

export interface DocFile {
  id: string
  name: string
  kind: 'image' | 'document'
  mime: string
  size: number
  url: string
}

export interface DocMoveTarget {
  parentId: string | null
  prevId?: string
  nextId?: string
}

/* ------------------------------------------------------------------ árvore */

export interface DocTreeNode extends DocTreePage {
  depth: number
  children: DocTreeNode[]
}

const byOrder = (a: DocTreePage, b: DocTreePage) => Number(b.isHome) - Number(a.isHome) || a.position - b.position || a.title.localeCompare(b.title)

/** Árvore a partir da lista: inicial primeiro, depois pela posição; pai invisível → a página vira raiz. */
export function buildDocTree(pages: DocTreePage[]): DocTreeNode[] {
  const ids = new Set(pages.map((p) => p.id))
  const childrenOf = (parentId: string | null, depth: number): DocTreeNode[] =>
    pages
      .filter((p) => (parentId === null ? !p.parentId || !ids.has(p.parentId) : p.parentId === parentId))
      .sort(byOrder)
      .map((p) => ({ ...p, depth, children: childrenOf(p.id, depth + 1) }))
  return childrenOf(null, 1)
}

/** Linhas visíveis (na ordem), pulando os filhos das recolhidas. */
export function flattenDocTree(nodes: DocTreeNode[], collapsed: Set<string>): DocTreeNode[] {
  const out: DocTreeNode[] = []
  const walk = (list: DocTreeNode[]) =>
    list.forEach((node) => {
      out.push(node)
      if (!collapsed.has(node.id)) walk(node.children)
    })
  walk(nodes)
  return out
}

export type DropZone = 'before' | 'inside' | 'after'

/** Onde soltar dentro da linha: quarto de cima = antes; de baixo = depois; meio = dentro. */
export function dropZone(offsetY: number, height: number): DropZone {
  if (offsetY < height / 4) return 'before'
  if (offsetY > (height * 3) / 4) return 'after'
  return 'inside'
}

function descendants(pages: DocTreePage[], id: string): Set<string> {
  const out = new Set<string>()
  const queue = [id]
  while (queue.length) {
    const current = queue.shift() as string
    pages.filter((p) => p.parentId === current).forEach((p) => {
      out.add(p.id)
      queue.push(p.id)
    })
  }
  return out
}

/** Destino ao soltar `dragId` em relação a `overId` (espelha o servidor: sem ciclo; a inicial fica). */
export function moveTarget(pages: DocTreePage[], dragId: string, overId: string, zone: DropZone): DocMoveTarget | null {
  const drag = pages.find((p) => p.id === dragId)
  const over = pages.find((p) => p.id === overId)
  if (!drag || !over || drag.isHome || dragId === overId) return null
  if (descendants(pages, dragId).has(overId)) return null
  if (zone === 'inside') return { parentId: over.id }
  // ninguém fica antes da página inicial
  if (over.isHome) return { parentId: null, prevId: over.id }
  return zone === 'before' ? { parentId: over.parentId, nextId: over.id } : { parentId: over.parentId, prevId: over.id }
}

const STEP = 1024

/**
 * Aplica um movimento na lista (retorno imediato na tela, antes da resposta): mesmo pai e mesma
 * regra de posição do servidor — entre os vizinhos; sem vizinho indicado, no fim.
 */
export function applyMove(pages: DocTreePage[], id: string, target: DocMoveTarget): DocTreePage[] {
  const siblings = pages.filter((p) => (p.parentId ?? null) === target.parentId && p.id !== id).sort((a, b) => a.position - b.position)
  const at = siblings.findIndex((p) => p.id === (target.prevId ?? target.nextId))
  const pos = (index: number) => siblings[index]?.position
  let position: number
  if (at < 0) position = (pos(siblings.length - 1) ?? 0) + STEP
  else if (target.prevId) position = ((pos(at) as number) + (pos(at + 1) ?? (pos(at) as number) + 2 * STEP)) / 2
  else position = ((pos(at - 1) ?? (pos(at) as number) - 2 * STEP) + (pos(at) as number)) / 2
  return pages.map((p) => (p.id === id ? { ...p, parentId: target.parentId, position } : p))
}

/** Letra "dobrada" (sem acento, minúscula) — a mesma comparação da busca no servidor. */
const foldChar = (c: string) => c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Trechos de `text` que casam com `query` (sem acento/maiúsculas), para destacar o resultado da busca. */
export function matchRanges(text: string, query: string): Array<[number, number]> {
  const q = [...query.trim()].map(foldChar).join('')
  if (!q) return []
  const chars = [...text]
  const folded = chars.map(foldChar)
  const out: Array<[number, number]> = []
  let i = 0
  while (i < chars.length) {
    let j = i
    let acc = ''
    while (j < chars.length && acc.length < q.length) acc += folded[j++]
    if (acc === q) {
      out.push([i, j])
      i = j
    } else i += 1
  }
  return out
}
