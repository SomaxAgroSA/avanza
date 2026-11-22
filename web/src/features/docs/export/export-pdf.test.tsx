import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { DocExport, DocExportPage, DocExportSpace, DocExportTarget } from '@/domain/doc-export'
import type { DocModule, DocPage, DocSpace, DocSpaceDetail, DocTreePage, RichContent } from '@/domain/docs'
import type { PermissionCode } from '@/domain/permissions'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { DocsHomePage } from '../DocsHomePage'
import { DocSpacePage } from '../DocSpacePage'
import { DocsPrintPage } from './DocsPrintPage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
afterEach(() => {
  vi.restoreAllMocks()
})

const READ: PermissionCode[] = ['docs.view']
const ana = { id: 'u1', name: 'Ana Lima', email: 'ana@example.com', avatarUrl: null }
const text = (value: string): RichContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] })
const MARKETING = { id: 'mkt', name: 'Marketing', color: 'pink' as const }

const exported = (id: string, title: string, parentId: string | null, words: number, body = `Texto publicado de ${title}`): DocExportPage => ({
  id,
  parentId,
  depth: parentId ? 2 : 1,
  title,
  version: id === 'home' ? 2 : 1,
  publishedAt: new Date(2026, 10, 12, 10, 0),
  publishedBy: ana,
  words,
  content: text(body),
})

// inicial · Mapa (Paraguai, Brasil) · Problemas · Anexo — Catálogo
const WEB: DocExportSpace = {
  id: 'sp1',
  key: 'PWGS',
  name: 'Página Web Grupo Somax',
  description: 'Relevamento das webs atuais e definições.',
  icon: 'globe',
  color: 'blue',
  module: MARKETING,
  project: { id: 'p1', key: 'PWGS', name: 'Página Web' },
  homePageId: 'home',
  pages: [
    exported('home', 'Relevamento das webs', null, 900),
    exported('mapa', 'Mapa geral e tecnologia', null, 300),
    exported('py', 'Somax Paraguai', 'mapa', 100),
    exported('br', 'Somax Brasil', 'mapa', 100),
    exported('prob', 'Problemas encontrados', null, 100),
    exported('anx', 'Anexo — Catálogo de Blend', null, 100),
  ],
}
const CAMP: DocExportSpace = { ...WEB, id: 'sp2', key: 'CAMP', name: 'Campanhas', description: 'Peças e calendário', project: null, homePageId: 'c1', pages: [exported('c1', 'Calendário de campanhas', null, 400)] }

const SPACE_EXPORT: DocExport = { module: null, spaces: [WEB] }
const MODULE_EXPORT: DocExport = { module: MARKETING, spaces: [CAMP, WEB] }

function exportDocs(target: DocExportTarget): Promise<DocExport> {
  return Promise.resolve('module' in target ? MODULE_EXPORT : SPACE_EXPORT)
}

const tree = (id: string, title: string, parentId: string | null, position: number): DocTreePage => ({
  id,
  parentId,
  title,
  status: 'published',
  position,
  hasDraft: false,
  isHome: id === 'home',
  updatedAt: null,
  tasks: [],
})

const SPACE: DocSpace = {
  id: 'sp1',
  key: 'PWGS',
  name: WEB.name,
  description: WEB.description,
  icon: 'globe',
  color: 'blue',
  visibility: 'company',
  project: null,
  module: MARKETING,
  homePageId: 'home',
  pageCount: 6,
  createdAt: new Date(2026, 10, 12),
  updatedAt: null,
  capabilities: { edit: false, manage: false },
}

const DETAIL: DocSpaceDetail = {
  space: SPACE,
  pages: WEB.pages.map((p, i) => tree(p.id, p.title, p.parentId, i * 1024)),
  capabilities: { edit: false, manage: false },
}

function docPage(id: string): DocPage {
  const page = WEB.pages.find((p) => p.id === id)!
  return {
    id,
    space: { id: 'sp1', key: 'PWGS', name: WEB.name },
    parentId: page.parentId,
    title: page.title,
    status: 'published',
    content: page.content,
    version: page.version,
    publishedAt: page.publishedAt,
    publishedBy: ana,
    createdBy: null,
    isHome: id === 'home',
    ancestors: [],
    children: WEB.pages.filter((p) => p.parentId === id).map((p) => ({ id: p.id, title: p.title, status: 'published' as const })),
    draft: null,
    capabilities: { edit: false, manage: false },
  }
}

function setup(initialPath: string, spy = vi.fn(exportDocs)) {
  const modules: DocModule[] = [{ ...MARKETING, position: 0, spaceCount: 2 }]
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(READ) },
    docs: {
      exportDocs: spy,
      listSpaces: async () => [SPACE, { ...SPACE, id: 'sp2', key: 'CAMP', name: 'Campanhas', pageCount: 1 }],
      listModules: async () => modules,
      getSpace: async () => DETAIL,
      getPage: async (id) => docPage(id),
    },
  })
  const result = renderRoutes(
    [
      { path: '/docs', element: <DocsHomePage /> },
      { path: '/docs/:spaceKey', element: <DocSpacePage /> },
      { path: '/docs/:spaceKey/:pageId', element: <DocSpacePage /> },
      { path: '/print/docs', element: <DocsPrintPage /> },
    ],
    { repositories, initialPath },
  )
  return { ...result, exportDocs: spy }
}

const scopes = (dialog: HTMLElement) => within(within(dialog).getByRole('radiogroup', { name: 'O que exportar' })).getAllByRole('radio')
const scopeText = (dialog: HTMLElement) => scopes(dialog).map((radio) => radio.closest('label')!.textContent)

describe('Exportar PDF — janela (§43)', () => {
  it('na página com subpáginas: esta página, com as subpáginas e a documentação completa; "Ver e imprimir" abre a vista com a escolha', async () => {
    const { router, exportDocs: spy } = setup('/docs/PWGS/mapa')
    await userEvent.click(await screen.findByRole('button', { name: 'Exportar PDF' }))
    const dialog = await screen.findByRole('dialog', { name: 'Exportar PDF' })
    await waitFor(() => expect(scopes(dialog)).toHaveLength(3))
    expect(spy).toHaveBeenCalledWith({ space: 'PWGS' })
    expect(scopeText(dialog)).toEqual([
      'Esta páginaMapa geral e tecnologia',
      'Esta página e suas subpáginas3 páginas',
      'Documentação completaAs 6 páginas de Página Web Grupo Somax',
    ])
    // uma página: sem capa nem anexos; 300 palavras = 2 folhas
    expect(within(dialog).queryByRole('switch', { name: 'Capa e índice' })).toBeNull()
    expect(within(dialog).getByTestId('export-sheets')).toHaveTextContent('≈ 2 folhas A4')

    await userEvent.click(within(dialog).getByRole('radio', { name: /Esta página e suas subpáginas/ }))
    expect(within(dialog).getByRole('switch', { name: 'Capa e índice' })).toBeChecked()
    // o ramo não tem anexos: o interruptor não aparece
    expect(within(dialog).queryByRole('switch', { name: 'Incluir anexos' })).toBeNull()
    expect(within(dialog).getByTestId('export-sheets')).toHaveTextContent('≈ 6 folhas A4')
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Capa e índice' }))
    expect(within(dialog).getByTestId('export-sheets')).toHaveTextContent('≈ 4 folhas A4')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Ver e imprimir' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/print/docs'))
    expect(router.state.location.search).toBe('?space=PWGS&page=mapa&scope=branch&cover=0&annex=1')
  })

  it('página sem subpáginas: sem a opção do ramo; documentação completa com anexos', async () => {
    setup('/docs/PWGS/prob')
    await userEvent.click(await screen.findByRole('button', { name: 'Exportar PDF' }))
    const dialog = await screen.findByRole('dialog', { name: 'Exportar PDF' })
    await waitFor(() => expect(scopes(dialog)).toHaveLength(2))
    expect(scopeText(dialog).map((label) => label!.split(/(?<=[a-zç])(?=[A-Z0-9])/)[0])).toEqual(['Esta página', 'Documentação completa'])
    await userEvent.click(within(dialog).getByRole('radio', { name: /Documentação completa/ }))
    const annex = within(dialog).getByRole('switch', { name: 'Incluir anexos' })
    expect(annex).toBeChecked()
    expect(within(dialog).getByTestId('export-sheets')).toHaveTextContent('≈ 12 folhas A4')
    await userEvent.click(annex)
    expect(within(dialog).getByTestId('export-sheets')).toHaveTextContent('≈ 11 folhas A4')
  })

  it('a página inicial, cujo ramo é o espaço inteiro, não mostra a opção do ramo', async () => {
    const whole: DocExport = { module: null, spaces: [{ ...WEB, pages: [exported('home', 'Início', null, 10), exported('a', 'A', 'home', 10), exported('b', 'B', 'home', 10)] }] }
    setup('/docs/PWGS/home', vi.fn(async () => whole))
    await userEvent.click(await screen.findByRole('button', { name: 'Exportar PDF' }))
    const dialog = await screen.findByRole('dialog', { name: 'Exportar PDF' })
    await waitFor(() => expect(scopes(dialog)).toHaveLength(2))
    expect(within(dialog).queryByRole('radio', { name: /subpáginas/ })).toBeNull()
  })

  it('no título do módulo, "Exportar módulo": só "Todo o módulo"; no ⋯ do cartão, só a documentação completa', async () => {
    const { router, exportDocs: spy } = setup('/docs')
    await userEvent.click(await screen.findByRole('button', { name: 'Exportar o módulo Marketing em PDF' }))
    let dialog = await screen.findByRole('dialog', { name: 'Exportar PDF' })
    await waitFor(() => expect(scopes(dialog)).toHaveLength(1))
    expect(spy).toHaveBeenCalledWith({ module: 'mkt' })
    expect(scopeText(dialog)).toEqual(['Todo o módulo Marketing2 espaços · 7 páginas'])
    // 7 páginas: corpo 4+2+1+1+1+1 + campanhas 2 = 12; + capa e índice + 2 aberturas
    expect(within(dialog).getByTestId('export-sheets')).toHaveTextContent('≈ 16 folhas A4')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await userEvent.click(screen.getByRole('button', { name: /Ações do espaço Página Web Grupo Somax/ }))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Exportar PDF' }))
    dialog = await screen.findByRole('dialog', { name: 'Exportar PDF' })
    await waitFor(() => expect(scopes(dialog)).toHaveLength(1))
    expect(scopeText(dialog)).toEqual(['Documentação completaAs 6 páginas de Página Web Grupo Somax'])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ver e imprimir' }))
    await waitFor(() => expect(router.state.location.search).toBe('?space=PWGS&scope=space&cover=1&annex=1'))
  })
})

describe('Exportar PDF — vista de impressão', () => {
  it('capa, índice e cada página numa folha, na ordem, com o conteúdo publicado; "Imprimir ou salvar PDF" chama a impressão', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    setup('/print/docs?space=PWGS&page=mapa&scope=space&cover=1&annex=1')
    const sheets = await screen.findByTestId('print-sheets')
    const sections = await within(sheets).findAllByRole('region')
    // capa (título do espaço), índice e as 6 páginas
    expect(sections.map((s) => s.getAttribute('aria-label') ?? s.querySelector('h1,h2')?.textContent)).toEqual([
      'Página Web Grupo Somax',
      'Índice',
      'Relevamento das webs',
      'Mapa geral e tecnologia',
      'Somax Paraguai',
      'Somax Brasil',
      'Problemas encontrados',
      'Anexo — Catálogo de Blend',
    ])
    const cover = sections[0]!
    expect(within(cover).getByText('Documentação')).toBeInTheDocument()
    expect(within(cover).getByText('Relevamento das webs atuais e definições.')).toBeInTheDocument()
    expect(within(cover).getByText('PWGS · Página Web')).toBeInTheDocument()
    expect(within(cover).getByText(/6 páginas · versão publicada de cada uma/)).toBeInTheDocument()
    expect(within(cover).getByText(/por Ana Souza$/)).toBeInTheDocument()
    expect(within(sections[1]!).getAllByRole('listitem')).toHaveLength(6)
    expect(within(sections[1]!).getAllByText(/^Versão 1 · /)).toHaveLength(5)
    const mapa = sections[3]!
    expect(within(mapa).getByText('2')).toBeInTheDocument()
    expect(within(mapa).getByText(/^Versão 1 · publicada em .* por Ana Lima$/)).toBeInTheDocument()
    expect(within(mapa).getByText('Página Web Grupo Somax')).toBeInTheDocument()
    expect(await within(mapa).findByText('Texto publicado de Mapa geral e tecnologia')).toBeInTheDocument()

    expect(screen.getByText('Documentação completa')).toBeInTheDocument()
    expect(screen.getByText('6 páginas · com capa e índice')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Imprimir ou salvar PDF' })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(print).toHaveBeenCalledOnce()
    // a capa tira margem e rodapé da primeira folha
    expect(document.head.querySelector('style[data-print-rules]')?.textContent).toContain('@page :first')
  })

  it('a impressão espera as imagens do conteúdo carregarem', async () => {
    const withImage: DocExport = {
      module: null,
      spaces: [{ ...WEB, pages: [{ ...exported('home', 'Mapa do site', null, 50), content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/api/v1/docs/files/abcdefghijklmno', alt: 'Mapa' } }] } }] }],
    }
    setup('/print/docs?space=PWGS&scope=space&cover=1&annex=1', vi.fn(async () => withImage))
    const sheets = await screen.findByTestId('print-sheets')
    const image = await within(sheets).findByRole('img', { name: 'Mapa' })
    const button = screen.getByRole('button', { name: 'Imprimir ou salvar PDF' })
    expect(button).toBeDisabled()
    Object.defineProperty(image, 'complete', { configurable: true, get: () => true })
    image.dispatchEvent(new Event('load'))
    await waitFor(() => expect(button).toBeEnabled())
  })

  it('sem anexos e sem capa: as páginas do anexo saem e a primeira folha já é conteúdo', async () => {
    setup('/print/docs?space=PWGS&scope=space&cover=0&annex=0')
    const sheets = await screen.findByTestId('print-sheets')
    const titles = (await within(sheets).findAllByRole('heading', { level: 1 })).map((h) => h.textContent)
    expect(titles).toEqual(['Relevamento das webs', 'Mapa geral e tecnologia', 'Somax Paraguai', 'Somax Brasil', 'Problemas encontrados'])
    expect(within(sheets).queryByText('Índice')).toBeNull()
    expect(document.head.querySelector('style[data-print-rules]')?.textContent).not.toContain('@page :first')
  })

  it('módulo: capa do módulo e uma abertura por espaço antes das páginas dele', async () => {
    setup('/print/docs?module=mkt&scope=module&cover=1&annex=1')
    const sheets = await screen.findByTestId('print-sheets')
    const sections = await within(sheets).findAllByRole('region')
    expect(sections.map((s) => s.getAttribute('aria-label') ?? s.querySelector('h1,h2')?.textContent)).toEqual([
      'Marketing',
      'Índice',
      'Campanhas',
      'Calendário de campanhas',
      'Página Web Grupo Somax',
      'Relevamento das webs',
      'Mapa geral e tecnologia',
      'Somax Paraguai',
      'Somax Brasil',
      'Problemas encontrados',
      'Anexo — Catálogo de Blend',
    ])
    expect(within(sections[0]!).getByText('Módulo Marketing')).toBeInTheDocument()
    expect(within(sections[0]!).getByText('Campanhas · Página Web Grupo Somax')).toBeInTheDocument()
  })

  it('"Alterar seleção" reabre a janela com a escolha atual e troca o endereço', async () => {
    const { router } = setup('/print/docs?space=PWGS&page=mapa&scope=page&cover=1&annex=1')
    await screen.findByTestId('print-sheets')
    await userEvent.click(screen.getByRole('button', { name: 'Alterar seleção' }))
    const dialog = await screen.findByRole('dialog', { name: 'Exportar PDF' })
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: /^Esta páginaMapa/ })).toBeChecked())
    await userEvent.click(within(dialog).getByRole('radio', { name: /Esta página e suas subpáginas/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ver e imprimir' }))
    await waitFor(() => expect(router.state.location.search).toBe('?space=PWGS&page=mapa&scope=branch&cover=1&annex=1'))
    expect(await screen.findByText('Esta página e suas subpáginas')).toBeInTheDocument()
  })
})
