import { describe, expect, it } from 'vitest'
import { applyMove, buildDocTree, docOutline, matchRanges, dropZone, flattenDocTree, isSafeDocHref, moveTarget, normalizeDocHref, type DocTreePage } from './docs'

const page = (id: string, parentId: string | null, position: number, extra: Partial<DocTreePage> = {}): DocTreePage => ({
  id,
  parentId,
  tasks: [],
  title: id.toUpperCase(),
  status: 'published',
  position,
  hasDraft: false,
  isHome: false,
  updatedAt: null,
  ...extra,
})

const pages = [page('home', null, 0, { isHome: true }), page('a', null, 1024), page('b', 'a', 1024), page('c', 'a', 2048), page('d', null, 2048), page('e', 'ghost', 4096)]

describe('domain/docs — árvore de páginas', () => {
  it('monta a árvore: inicial primeiro, depois pela posição; órfã (pai invisível) vira raiz', () => {
    const tree = buildDocTree(pages)
    expect(tree.map((n) => n.id)).toEqual(['home', 'a', 'd', 'e'])
    expect(tree[1]?.children.map((n) => [n.id, n.depth])).toEqual([
      ['b', 2],
      ['c', 2],
    ])
  })

  it('linhas visíveis respeitam as recolhidas', () => {
    const tree = buildDocTree(pages)
    expect(flattenDocTree(tree, new Set()).map((n) => n.id)).toEqual(['home', 'a', 'b', 'c', 'd', 'e'])
    expect(flattenDocTree(tree, new Set(['a'])).map((n) => n.id)).toEqual(['home', 'a', 'd', 'e'])
  })

  it('zona de soltar: quarto de cima = antes; de baixo = depois; meio = dentro', () => {
    expect(dropZone(2, 32)).toBe('before')
    expect(dropZone(16, 32)).toBe('inside')
    expect(dropZone(30, 32)).toBe('after')
  })

  it('destino do arraste (espelha o servidor): sem ciclo, sem mexer na inicial, nunca antes dela', () => {
    expect(moveTarget(pages, 'd', 'b', 'before')).toEqual({ parentId: 'a', nextId: 'b' })
    expect(moveTarget(pages, 'd', 'c', 'after')).toEqual({ parentId: 'a', prevId: 'c' })
    expect(moveTarget(pages, 'd', 'a', 'inside')).toEqual({ parentId: 'a' })
    // para dentro de uma subpágina sua: não
    expect(moveTarget(pages, 'a', 'b', 'inside')).toBeNull()
    expect(moveTarget(pages, 'a', 'a', 'inside')).toBeNull()
    // a inicial não se move; ninguém vai antes dela
    expect(moveTarget(pages, 'home', 'd', 'after')).toBeNull()
    expect(moveTarget(pages, 'd', 'home', 'before')).toEqual({ parentId: null, prevId: 'home' })
  })
})

describe('domain/docs — conteúdo', () => {
  it('links aceitos espelham o servidor', () => {
    expect(isSafeDocHref('https://exemplo.com/a?b=1')).toBe(true)
    expect(isSafeDocHref('mailto:time@exemplo.com')).toBe(true)
    expect(isSafeDocHref('/docs/MANUAL/abc123')).toBe(true)
    expect(isSafeDocHref('/api/v1/docs/files/abcdefghijklmno')).toBe(true)
    expect(isSafeDocHref('javascript:alert(1)')).toBe(false)
    expect(isSafeDocHref('/api/v1/users')).toBe(false)
    expect(isSafeDocHref('data:text/html,oi')).toBe(false)
  })

  it('completa o endereço digitado; recusa o que o servidor removeria', () => {
    expect(normalizeDocHref('exemplo.com')).toBe('https://exemplo.com')
    expect(normalizeDocHref('time@exemplo.com')).toBe('mailto:time@exemplo.com')
    expect(normalizeDocHref('/docs/MANUAL')).toBe('/docs/MANUAL')
    expect(normalizeDocHref('javascript:alert(1)')).toBeNull()
    expect(normalizeDocHref('   ')).toBeNull()
  })

  it('sumário: títulos na ordem, com nível e texto (marcações ignoradas)', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Visão ' }, { type: 'text', text: 'geral', marks: [{ type: 'bold' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'texto' }] },
        { type: 'callout', content: [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Atenção' }] }] },
      ],
    }
    expect(docOutline(doc)).toEqual([
      { level: 1, text: 'Visão geral', index: 0 },
      { level: 3, text: 'Atenção', index: 1 },
    ])
    expect(docOutline(null)).toEqual([])
  })
})

describe('domain/docs — movimento otimista', () => {
  const positionOf = (list: DocTreePage[], id: string) => list.find((p) => p.id === id)
  it('entre vizinhos, antes do primeiro, no fim e para dentro', () => {
    expect(positionOf(applyMove(pages, 'd', { parentId: 'a', prevId: 'b' }), 'd')).toMatchObject({ parentId: 'a', position: 1536 })
    expect(positionOf(applyMove(pages, 'd', { parentId: 'a', nextId: 'b' }), 'd')).toMatchObject({ parentId: 'a', position: 0 })
    expect(positionOf(applyMove(pages, 'd', { parentId: 'a', prevId: 'c' }), 'd')).toMatchObject({ position: 3072 })
    expect(positionOf(applyMove(pages, 'b', { parentId: 'd' }), 'b')).toMatchObject({ parentId: 'd', position: 1024 })
    const tree = buildDocTree(applyMove(pages, 'd', { parentId: 'a', nextId: 'b' }))
    expect(tree[1]?.children.map((n) => n.id)).toEqual(['d', 'b', 'c'])
  })
})

describe('domain/docs — destaque da busca', () => {
  it('casa sem acento e sem maiúsculas, todas as ocorrências', () => {
    expect(matchRanges('Validação do CNPJ; validacao manual', 'VALIDACAO')).toEqual([
      [0, 9],
      [19, 28],
    ])
    expect(matchRanges('Agenda', 'x')).toEqual([])
    expect(matchRanges('Agenda', '  ')).toEqual([])
  })
})

describe('validação do espaço', () => {
  const base = { name: 'Manuais', key: 'manual', description: '', icon: 'book' as const, color: 'blue' as const, visibility: 'company' as const, projectId: '' }
  it('chave em maiúsculas; espaço só de membros exige o projeto', async () => {
    const { docSpaceSchema } = await import('./validation')
    expect(docSpaceSchema.parse(base).key).toBe('MANUAL')
    const result = docSpaceSchema.safeParse({ ...base, visibility: 'project' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]).toMatchObject({ path: ['projectId'], message: 'project_required' })
    expect(docSpaceSchema.safeParse({ ...base, visibility: 'project', projectId: 'p1' }).success).toBe(true)
  })
})
