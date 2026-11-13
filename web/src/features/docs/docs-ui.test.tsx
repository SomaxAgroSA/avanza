import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { PermissionCode } from '@/domain/permissions'
import type { DocPage, DocSpace, DocSpaceDetail, DocTreePage, RichContent } from '@/domain/docs'
import type { Repositories } from '@/domain/repositories'
import { notify } from '@/presentation/components'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { DocsHomePage } from './DocsHomePage'
import { DocSpacePage } from './DocSpacePage'
import { DocPageEditorPage } from './DocPageEditorPage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
afterEach(() => {
  vi.restoreAllMocks()
})

const SPACE: DocSpace = {
  id: 'sp1',
  key: 'MANUAL',
  name: 'Manuais',
  description: 'Guias de uso do CRM',
  icon: 'book',
  color: 'blue',
  visibility: 'company',
  project: null,
  homePageId: 'home',
  pageCount: 3,
  createdAt: null,
  updatedAt: null,
  capabilities: { edit: true, manage: true },
}

const tree = (id: string, title: string, parentId: string | null, position: number, extra: Partial<DocTreePage> = {}): DocTreePage => ({
  id,
  parentId,
  tasks: [],
  title,
  status: 'published',
  position,
  hasDraft: false,
  isHome: false,
  updatedAt: null,
  ...extra,
})

const PAGES = [tree('home', 'Início', null, 0, { isHome: true }), tree('agenda', 'Agenda', null, 1024), tree('regras', 'Regras da agenda', 'agenda', 1024, { status: 'draft' }), tree('faq', 'FAQ', null, 2048)]

const CONTENT: RichContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Como agendar' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Escolha o horário livre.' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Cancelamento' }] },
  ],
}

function docPage(id: string, title: string, extra: Partial<DocPage> = {}): DocPage {
  return {
    id,
    space: { id: 'sp1', key: 'MANUAL', name: 'Manuais' },
    parentId: null,
    title,
    status: 'published',
    content: CONTENT,
    version: 2,
    publishedAt: new Date(),
    publishedBy: { id: 'u1', name: 'Ana Lima', email: 'ana@example.com', avatarUrl: null },
    createdBy: null,
    isHome: false,
    ancestors: [],
    children: [{ id: 'regras', title: 'Regras da agenda', status: 'draft' }],
    draft: null,
    capabilities: { edit: true, manage: true },
    ...extra,
  }
}

function setup(permissions: PermissionCode[], docs: Partial<Repositories['docs']> = {}, initialPath = '/docs') {
  const readOnly = !permissions.includes('docs.edit')
  const detail: DocSpaceDetail = {
    space: { ...SPACE, capabilities: { edit: !readOnly, manage: permissions.includes('docs.manage') } },
    pages: readOnly ? PAGES.filter((p) => p.status === 'published') : PAGES,
    capabilities: { edit: !readOnly, manage: permissions.includes('docs.manage') },
  }
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(permissions) },
    docs: {
      listSpaces: async () => [detail.space],
      getSpace: async () => detail,
      getPage: async (id) => docPage(id, PAGES.find((p) => p.id === id)?.title ?? id, { isHome: id === 'home', capabilities: detail.capabilities, children: readOnly ? [] : docPage('x', 'x').children }),
      recent: async () => [{ pageId: 'agenda', title: 'Agenda', space: { id: 'sp1', key: 'MANUAL', name: 'Manuais' }, publishedAt: new Date(), publishedBy: null }],
      ...docs,
    },
  })
  const routes = [
    { path: '/docs', element: <DocsHomePage /> },
    { path: '/docs/:spaceKey', element: <DocSpacePage /> },
    { path: '/docs/:spaceKey/:pageId', element: <DocSpacePage /> },
    { path: '/docs/:spaceKey/:pageId/edit', element: <DocPageEditorPage /> },
  ]
  return { repositories, ...renderRoutes(routes, { repositories, initialPath }) }
}

describe('Documentação — início', () => {
  it('lista espaços e recentes; leitor não cria espaço', async () => {
    setup(['docs.view'])
    const card = await within(await screen.findByRole('region', { name: 'Espaços' })).findByRole('link', { name: /Manuais/ })
    expect(card).toHaveAttribute('href', '/docs/MANUAL')
    expect(card).toHaveTextContent('3 páginas')
    expect(card).toHaveTextContent('Toda a empresa')
    expect(await within(screen.getByRole('region', { name: 'Atualizadas recentemente' })).findByRole('link', { name: /Agenda/ })).toHaveAttribute('href', '/docs/MANUAL/agenda')
    expect(screen.queryByRole('button', { name: 'Novo espaço' })).toBeNull()
  })

  it('busca sem acento destaca o termo no trecho', async () => {
    const search = vi.fn(async () => [{ pageId: 'agenda', title: 'Agenda', space: { id: 'sp1', key: 'MANUAL', name: 'Manuais' }, snippet: '…exige a validação do CNPJ…', publishedAt: new Date() }])
    setup(['docs.view'], { search })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar na documentação' }), 'validacao')
    expect(await screen.findByText('1 página encontrada')).toBeInTheDocument()
    expect(search).toHaveBeenLastCalledWith('validacao')
    expect(screen.getByText('validação', { selector: 'mark' })).toBeInTheDocument()
  })

  it('cria espaço: chave sugerida pelo nome e abre o espaço criado', async () => {
    const createSpace = vi.fn(async () => SPACE)
    const success = vi.spyOn(notify, 'success')
    setup(['docs.view', 'docs.edit', 'docs.manage'], { createSpace })
    await userEvent.click(await screen.findByRole('button', { name: 'Novo espaço' }))
    const dialog = await screen.findByRole('dialog', { name: 'Novo espaço de documentação' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nome/ }), 'Manual do Usuário')
    expect(within(dialog).getByRole('textbox', { name: /Chave/ })).toHaveValue('MDU')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar espaço' }))
    await waitFor(() => expect(createSpace).toHaveBeenCalledWith(expect.objectContaining({ name: 'Manual do Usuário', key: 'MDU', visibility: 'company', icon: 'book' })))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Espaço “Manuais” criado.'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument()
  })
})

/** Abre o painel do espaço (no celular a árvore fica nele) e devolve a navegação das páginas. */
async function openTree() {
  await userEvent.click(await screen.findByRole('button', { name: 'Páginas do espaço' }))
  return screen.findByRole('navigation', { name: 'Páginas do espaço' })
}

describe('Documentação — espaço e página', () => {
  it('árvore, trilha, conteúdo publicado, "Nesta página" e subpáginas', async () => {
    setup(['docs.view', 'docs.edit'], {}, '/docs/MANUAL/agenda')
    expect(await screen.findByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Trilha de navegação' })).toHaveTextContent('DocumentaçãoManuaisAgenda')
    expect(screen.getByText(/Versão 2 · publicada por Ana Lima/)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 2, name: 'Como agendar' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Nesta página' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Como agendar', 'Cancelamento'])
    expect(within(screen.getByRole('region', { name: '1 subpágina' })).getByRole('link', { name: /Regras da agenda/ })).toHaveAttribute('href', '/docs/MANUAL/regras')
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()

    // árvore no painel do espaço; escolher uma página fecha o painel
    const nav = await openTree()
    expect(within(nav).getByRole('link', { name: 'Agenda' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: /Regras da agenda/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nova página' })).toBeInTheDocument()
    await userEvent.click(within(nav).getByRole('link', { name: 'FAQ' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'FAQ' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Páginas do espaço' })).toBeNull())
  })

  it('leitor: sem editar, sem rascunhos na árvore, sem ações de página', async () => {
    setup(['docs.view'], {}, '/docs/MANUAL/agenda')
    expect(await screen.findByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
    await openTree()
    expect(screen.queryByRole('button', { name: 'Nova página' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Regras da agenda/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Ações de/ })).toBeNull()
  })

  it('mover pelo teclado: escolhe a nova página-mãe', async () => {
    const move = vi.fn(async () => docPage('faq', 'FAQ'))
    const success = vi.spyOn(notify, 'success')
    setup(['docs.view', 'docs.edit'], { move }, '/docs/MANUAL/agenda')
    await openTree()
    await userEvent.click(await screen.findByRole('button', { name: 'Ações de FAQ' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mover…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Mover “FAQ”' })
    expect(within(dialog).getByRole('button', { name: 'Mover' })).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Nova página-mãe' }))
    // a própria página não aparece como destino
    expect(screen.queryByRole('option', { name: 'FAQ' })).toBeNull()
    await userEvent.click(await screen.findByRole('option', { name: 'Agenda' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mover' }))
    await waitFor(() => expect(move).toHaveBeenCalledWith('faq', { parentId: 'agenda' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Página movida.'))
  })

  it('excluir página com subpáginas pede confirmação com a contagem', async () => {
    const deletePage = vi.fn(async () => 2)
    const success = vi.spyOn(notify, 'success')
    setup(['docs.view', 'docs.edit'], { deletePage }, '/docs/MANUAL/agenda')
    await openTree()
    await userEvent.click(await screen.findByRole('button', { name: 'Ações de Agenda' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('A página e 1 subpágina serão excluídas')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(deletePage).toHaveBeenCalledWith('agenda'))
    await waitFor(() => expect(success).toHaveBeenCalledWith('2 páginas excluídas.'))
  })
})

describe('Documentação — editor', () => {
  it('abre o rascunho e publica título e conteúdo; volta para a leitura', async () => {
    // como o servidor real: depois de publicar, buscar a página devolve a versão publicada
    // (sem isso, a nova busca da leitura disputava com o cache e o título voltava a "Agenda")
    let published = false
    const publish = vi.fn(async () => {
      published = true
      return docPage('agenda', 'Agenda nova', { version: 3 })
    })
    const success = vi.spyOn(notify, 'success')
    setup(
      ['docs.view', 'docs.edit'],
      {
        getDraft: async () => ({ title: 'Agenda', content: CONTENT, savedAt: null, by: null }),
        getPage: async (id) => (published ? docPage(id, 'Agenda nova', { version: 3 }) : docPage(id, 'Agenda')),
        publish,
      },
      '/docs/MANUAL/agenda/edit',
    )
    const title = await screen.findByRole('textbox', { name: 'Título da página' })
    expect(await screen.findByRole('textbox', { name: 'Conteúdo da página' })).toHaveTextContent('Escolha o horário livre.')
    await userEvent.clear(title)
    await userEvent.type(title, 'Agenda nova')
    expect(await screen.findByText('Alterações não salvas')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Publicar alterações' }))
    await waitFor(() => expect(publish).toHaveBeenCalledWith('agenda', { title: 'Agenda nova', content: CONTENT }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Página publicada (versão 3).'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Agenda nova' })).toBeInTheDocument()
  })
})
