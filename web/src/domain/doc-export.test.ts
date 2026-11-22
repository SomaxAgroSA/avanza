import { describe, expect, it } from 'vitest'
import {
  branchOf,
  defaultOptions,
  isAnnex,
  parsePrintSearch,
  printSearch,
  scopeChoices,
  selectExport,
  sheetEstimate,
  type DocExport,
  type DocExportPage,
  type DocExportSpace,
  type ExportOrigin,
} from './doc-export'

const page = (id: string, title: string, parentId: string | null = null, words = 100): DocExportPage => ({
  id,
  parentId,
  depth: parentId ? 2 : 1,
  title,
  version: 1,
  publishedAt: new Date('2026-11-12T10:00:00Z'),
  publishedBy: null,
  words,
  content: { type: 'doc', content: [] },
})

const space = (key: string, pages: DocExportPage[]): DocExportSpace => ({
  id: `sp-${key}`,
  key,
  name: `Espaço ${key}`,
  description: '',
  icon: 'book',
  color: 'blue',
  module: null,
  project: null,
  homePageId: pages[0]?.id ?? null,
  pages,
})

// inicial · Mapa (Paraguai, Brasil) · Problemas · Anexo — Catálogo · Anexo — Unidades
const web = space('PWGS', [
  page('home', 'Relevamento das webs', null, 900),
  page('mapa', 'Mapa geral', null, 300),
  page('py', 'Somax Paraguai', 'mapa', 50),
  page('br', 'Somax Brasil', 'mapa', 0),
  page('prob', 'Problemas encontrados'),
  page('anx1', 'Anexo — Catálogo de Blend'),
  page('anx2', 'anexo: Unidades'),
])
const data: DocExport = { module: null, spaces: [web] }
const atPage = (pageId: string): ExportOrigin => ({ kind: 'page', spaceKey: 'PWGS', pageId })

describe('domain/doc-export — opções da janela', () => {
  it('na página com subpáginas: esta página, com as subpáginas e a documentação completa', () => {
    expect(scopeChoices(atPage('mapa'), data)).toEqual([
      { scope: 'page', pages: 1 },
      { scope: 'branch', pages: 3 },
      { scope: 'space', pages: 7 },
    ])
  })

  it('sem subpáginas, ou quando o ramo é o espaço inteiro, a opção do ramo não aparece', () => {
    expect(scopeChoices(atPage('py'), data).map((c) => c.scope)).toEqual(['page', 'space'])
    const whole = space('ONE', [page('root', 'Início'), page('a', 'A', 'root'), page('b', 'B', 'root')])
    expect(scopeChoices({ kind: 'page', spaceKey: 'ONE', pageId: 'root' }, { module: null, spaces: [whole] }).map((c) => c.scope)).toEqual(['page', 'space'])
  })

  it('no cartão do espaço só a documentação completa; no módulo, só o módulo inteiro', () => {
    expect(scopeChoices({ kind: 'space', spaceKey: 'PWGS' }, data)).toEqual([{ scope: 'space', pages: 7 }])
    const both: DocExport = { module: { id: 'm1', name: 'Marketing', color: 'blue' }, spaces: [web, space('CAMP', [page('c1', 'Campanhas')])] }
    expect(scopeChoices({ kind: 'module', moduleId: 'm1' }, both)).toEqual([{ scope: 'module', pages: 8 }])
    expect(defaultOptions({ kind: 'module', moduleId: 'm1' })).toEqual({ scope: 'module', cover: true, annex: true })
    expect(defaultOptions(atPage('mapa')).scope).toBe('page')
  })
})

describe('domain/doc-export — o que sai', () => {
  it('ramo: a página e as de baixo, na ordem de leitura', () => {
    expect(branchOf(web.pages, 'mapa').map((p) => p.id)).toEqual(['mapa', 'py', 'br'])
  })

  it('uma página só: sem capa, sem interruptores, mesmo sendo anexo', () => {
    const one = selectExport(data, atPage('anx1'), { scope: 'page', cover: true, annex: false })
    expect(one.groups[0]!.pages.map((p) => p.id)).toEqual(['anx1'])
    expect([one.multiple, one.cover, one.hasAnnexes]).toEqual([false, false, false])
  })

  it('anexos: títulos que começam com "Anexo"; desligados, saem da documentação completa', () => {
    expect([isAnnex('Anexo — Catálogo'), isAnnex('  anexo 2'), isAnnex('Mapa com anexo')]).toEqual([true, true, false])
    const all = selectExport(data, atPage('mapa'), { scope: 'space', cover: true, annex: true })
    expect([all.total, all.hasAnnexes, all.cover]).toEqual([7, true, true])
    const without = selectExport(data, atPage('mapa'), { scope: 'space', cover: true, annex: false })
    expect(without.groups[0]!.pages.map((p) => p.id)).toEqual(['home', 'mapa', 'py', 'br', 'prob'])
    // o ramo de Mapa não tem anexos: o interruptor não aparece
    expect(selectExport(data, atPage('mapa'), { scope: 'branch', cover: false, annex: true }).hasAnnexes).toBe(false)
  })

  it('opção que não vale para a origem volta para a primeira', () => {
    const fromCard = selectExport(data, { kind: 'space', spaceKey: 'PWGS' }, { scope: 'page', cover: true, annex: true })
    expect(fromCard.total).toBe(7)
  })

  it('módulo: um grupo por espaço, cada um com a sua folha de abertura', () => {
    const both: DocExport = { module: { id: 'm1', name: 'Marketing', color: 'blue' }, spaces: [web, space('CAMP', [page('c1', 'Campanhas', null, 600)])] }
    const selection = selectExport(both, { kind: 'module', moduleId: 'm1' }, { scope: 'module', cover: true, annex: false })
    expect(selection.groups.map((g) => [g.space.key, g.pages.length])).toEqual([
      ['PWGS', 5],
      ['CAMP', 1],
    ])
    expect(selection.dividers).toBe(true)
    // corpo: 4 + 2 + 1 + 1 + 1 (PWGS sem anexos) + 3 (CAMP) = 12; + capa e índice + 2 aberturas
    expect(sheetEstimate(selection)).toBe(12 + 2 + 2)
  })
})

describe('domain/doc-export — folhas e endereço', () => {
  it('≈ folhas: cada página começa numa folha nova; + 2 com capa e índice', () => {
    const selection = selectExport(data, atPage('mapa'), { scope: 'branch', cover: true, annex: true })
    expect(sheetEstimate(selection)).toBe(2 + 1 + 1 + 2)
    expect(sheetEstimate(selectExport(data, atPage('mapa'), { scope: 'branch', cover: false, annex: true }))).toBe(4)
  })

  it('o endereço guarda a origem e a escolha, e volta igual', () => {
    const search = printSearch(atPage('mapa'), { scope: 'branch', cover: false, annex: true })
    expect(search).toBe('space=PWGS&page=mapa&scope=branch&cover=0&annex=1')
    expect(parsePrintSearch(new URLSearchParams(search))).toEqual({ origin: atPage('mapa'), options: { scope: 'branch', cover: false, annex: true } })
    expect(parsePrintSearch(new URLSearchParams('module=m1'))).toEqual({ origin: { kind: 'module', moduleId: 'm1' }, options: { scope: 'module', cover: true, annex: true } })
    expect(parsePrintSearch(new URLSearchParams('space=PWGS&scope=xyz'))!.options.scope).toBe('space')
    expect(parsePrintSearch(new URLSearchParams(''))).toBeNull()
  })
})
