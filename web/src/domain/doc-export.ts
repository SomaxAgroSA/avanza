/**
 * Exportar a documentação em PDF (regras de negócio §43, ADR-059). O servidor entrega as páginas
 * publicadas na ordem de leitura (`GET /docs/export`); aqui ficam a escolha do que imprimir (esta
 * página, com as subpáginas, o espaço ou o módulo), os anexos, a estimativa de folhas e o endereço da
 * vista de impressão. O navegador imprime (sem gerador de PDF no servidor).
 */
import type { DocModuleRef, RichContent, SpaceIcon } from './docs'
import type { UserSummary } from './projects'
import type { OptionColor } from './task-config'

/** Palavras que cabem numa folha A4 com o corpo do documento (estimativa; cada página começa numa folha nova). */
export const WORDS_PER_SHEET = 290
/** Capa + índice. */
export const COVER_SHEETS = 2

export interface DocExportPage {
  id: string
  /** Primeira página publicada acima (o servidor já sobe a página de um rascunho); null = raiz. */
  parentId: string | null
  depth: number
  title: string
  version: number
  publishedAt: Date | null
  publishedBy: UserSummary | null
  words: number
  /** Conteúdo publicado (nunca o rascunho). */
  content: RichContent
}

export interface DocExportSpace {
  id: string
  key: string
  name: string
  description: string
  icon: SpaceIcon
  color: OptionColor
  module: DocModuleRef | null
  project: { id: string; key: string; name: string } | null
  homePageId: string | null
  /** Publicadas, na ordem de leitura. */
  pages: DocExportPage[]
}

export interface DocExport {
  /** Só na exportação de um módulo. */
  module: DocModuleRef | null
  spaces: DocExportSpace[]
}

/** O que buscar: um espaço (pela chave) ou um módulo (pelo id). */
export type DocExportTarget = { space: string } | { module: string }

/** De onde a exportação foi pedida: a página aberta, o cartão do espaço ou o título do módulo. */
export type ExportOrigin = { kind: 'page'; spaceKey: string; pageId: string } | { kind: 'space'; spaceKey: string } | { kind: 'module'; moduleId: string }

export type ExportScope = 'page' | 'branch' | 'space' | 'module'

export interface ExportOptions {
  scope: ExportScope
  /** Capa e índice (só com mais de uma página). */
  cover: boolean
  /** Páginas cujo título começa com "Anexo" (só com mais de uma página). */
  annex: boolean
}

export interface ExportGroup {
  space: DocExportSpace
  pages: DocExportPage[]
}

export interface ExportSelection {
  groups: ExportGroup[]
  /** Páginas que saem. */
  total: number
  /** Mais de uma página antes de tirar os anexos: aparecem "Capa e índice" e "Incluir anexos". */
  multiple: boolean
  /** Há anexos entre as páginas escolhidas (o interruptor só aparece com eles). */
  hasAnnexes: boolean
  /** Capa e índice de verdade (pedidos e com mais de uma página). */
  cover: boolean
  /** Módulo: cada espaço abre com uma folha de abertura. */
  dividers: boolean
}

export interface ScopeChoice {
  scope: ExportScope
  pages: number
}

export function targetOf(origin: ExportOrigin): DocExportTarget {
  return origin.kind === 'module' ? { module: origin.moduleId } : { space: origin.spaceKey }
}

/** Anexo = página cujo título começa com "Anexo" (sem diferença de maiúsculas). */
export function isAnnex(title: string): boolean {
  return /^\s*anexo/i.test(title)
}

/** A página e todas as que estão abaixo dela, na ordem de leitura. */
export function branchOf(pages: DocExportPage[], pageId: string): DocExportPage[] {
  const inBranch = new Set([pageId])
  return pages.filter((page) => {
    if (page.id === pageId) return true
    if (page.parentId && inBranch.has(page.parentId)) {
      inBranch.add(page.id)
      return true
    }
    return false
  })
}

const allPages = (data: DocExport) => data.spaces.reduce((sum, space) => sum + space.pages.length, 0)

/**
 * Opções da janela, pela origem: na página, "Esta página", "Esta página e suas subpáginas" (só quando ela
 * tem subpáginas e o ramo não é o espaço inteiro) e "Documentação completa"; no cartão do espaço, só a
 * documentação completa; no módulo, só o módulo inteiro.
 */
export function scopeChoices(origin: ExportOrigin, data: DocExport): ScopeChoice[] {
  if (origin.kind === 'module') return [{ scope: 'module', pages: allPages(data) }]
  const space = data.spaces[0]
  const total = space ? space.pages.length : 0
  if (origin.kind === 'space') return [{ scope: 'space', pages: total }]
  const branch = space ? branchOf(space.pages, origin.pageId).length : 0
  return [{ scope: 'page', pages: 1 }, ...(branch > 1 && branch < total ? [{ scope: 'branch' as const, pages: branch }] : []), { scope: 'space', pages: total }]
}

/** Escolha padrão de cada origem. */
export function defaultOptions(origin: ExportOrigin): ExportOptions {
  return { scope: origin.kind === 'module' ? 'module' : origin.kind === 'space' ? 'space' : 'page', cover: true, annex: true }
}

/** A escolha vale para a origem? (senão, a primeira opção). */
export function validScope(origin: ExportOrigin, data: DocExport, scope: ExportScope): ExportScope {
  const choices = scopeChoices(origin, data)
  return choices.some((c) => c.scope === scope) ? scope : (choices[0]?.scope ?? 'page')
}

/** Páginas que saem, agrupadas por espaço, e o que a janela e a vista precisam saber sobre elas. */
export function selectExport(data: DocExport, origin: ExportOrigin, options: ExportOptions): ExportSelection {
  const scope = validScope(origin, data, options.scope)
  let groups: ExportGroup[]
  if (scope === 'module') groups = data.spaces.map((space) => ({ space, pages: space.pages }))
  else {
    const space = data.spaces[0]
    if (!space) groups = []
    else if (scope === 'space') groups = [{ space, pages: space.pages }]
    else {
      const pageId = origin.kind === 'page' ? origin.pageId : ''
      const pages = scope === 'branch' ? branchOf(space.pages, pageId) : space.pages.filter((p) => p.id === pageId)
      groups = [{ space, pages }]
    }
  }
  const before = groups.reduce((sum, g) => sum + g.pages.length, 0)
  const multiple = before > 1
  const hasAnnexes = multiple && groups.some((g) => g.pages.some((p) => isAnnex(p.title)))
  if (multiple && !options.annex) {
    // o ramo nunca perde a própria página de partida
    const keep = origin.kind === 'page' && scope === 'branch' ? origin.pageId : null
    groups = groups.map((g) => ({ ...g, pages: g.pages.filter((p) => p.id === keep || !isAnnex(p.title)) }))
  }
  groups = groups.filter((g) => g.pages.length > 0)
  const total = groups.reduce((sum, g) => sum + g.pages.length, 0)
  return { groups, total, multiple, hasAnnexes, cover: multiple && options.cover && total > 1, dividers: scope === 'module' && total > 0 }
}

/** Título que vai na capa: o módulo, a página de partida do ramo ou o espaço. */
export function coverTitle(data: DocExport, origin: ExportOrigin, scope: ExportScope): string {
  if (scope === 'module') return data.module?.name ?? ''
  const space = data.spaces[0]
  if (scope === 'branch' && origin.kind === 'page') return space?.pages.find((p) => p.id === origin.pageId)?.title ?? space?.name ?? ''
  return space?.name ?? ''
}

/** ≈ folhas A4: cada página começa numa folha nova (máx(1, palavras/290)), + capa e índice e as aberturas dos espaços. */
export function sheetEstimate(selection: ExportSelection): number {
  const body = selection.groups.reduce((sum, g) => sum + g.pages.reduce((s, p) => s + Math.max(1, Math.ceil(p.words / WORDS_PER_SHEET)), 0), 0)
  return body + (selection.cover ? COVER_SHEETS : 0) + (selection.dividers ? selection.groups.length : 0)
}

/** Parâmetros da vista de impressão (`/print/docs?…`): a origem e a escolha ficam no endereço. */
export function printSearch(origin: ExportOrigin, options: ExportOptions): string {
  const params = new URLSearchParams()
  if (origin.kind === 'module') params.set('module', origin.moduleId)
  else {
    params.set('space', origin.spaceKey)
    if (origin.kind === 'page') params.set('page', origin.pageId)
  }
  params.set('scope', options.scope)
  params.set('cover', options.cover ? '1' : '0')
  params.set('annex', options.annex ? '1' : '0')
  return params.toString()
}

const SCOPES: readonly ExportScope[] = ['page', 'branch', 'space', 'module']

/** Lê a origem e a escolha do endereço da vista de impressão; null quando falta o espaço/módulo. */
export function parsePrintSearch(params: URLSearchParams): { origin: ExportOrigin; options: ExportOptions } | null {
  const moduleId = params.get('module')
  const spaceKey = params.get('space')
  const pageId = params.get('page')
  const origin: ExportOrigin | null = moduleId ? { kind: 'module', moduleId } : spaceKey ? (pageId ? { kind: 'page', spaceKey, pageId } : { kind: 'space', spaceKey }) : null
  if (!origin) return null
  const raw = params.get('scope') as ExportScope | null
  const fallback = defaultOptions(origin)
  return {
    origin,
    options: {
      scope: raw && SCOPES.includes(raw) ? raw : fallback.scope,
      cover: params.get('cover') !== '0',
      annex: params.get('annex') !== '0',
    },
  }
}
