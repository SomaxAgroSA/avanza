import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { PermissionCode } from '@/domain/permissions'
import type { DocModule, DocPage, DocSpace, DocSpaceDetail } from '@/domain/docs'
import type { Repositories } from '@/domain/repositories'
import { notify } from '@/presentation/components'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { DocsHomePage } from './DocsHomePage'
import { DocSpacePage } from './DocSpacePage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
afterEach(() => {
  vi.restoreAllMocks()
})

const MANAGE: PermissionCode[] = ['docs.view', 'docs.edit', 'docs.manage']
const READ: PermissionCode[] = ['docs.view']

const MODULES: DocModule[] = [
  { id: 'fin', name: 'Finanças', color: 'green', position: 1, spaceCount: 2 },
  { id: 'mkt', name: 'Marketing', color: 'pink', position: 0, spaceCount: 1 },
  { id: 'ti', name: 'TI e sistemas', color: 'violet', position: 2, spaceCount: 0 },
]
const ref = (id: string) => {
  const m = MODULES.find((x) => x.id === id)
  return m ? { id: m.id, name: m.name, color: m.color } : null
}

const space = (key: string, name: string, moduleId: string | null, manage = true): DocSpace => ({
  id: key.toLowerCase(),
  key,
  name,
  description: '',
  icon: 'book',
  color: 'blue',
  visibility: 'company',
  project: null,
  module: moduleId ? ref(moduleId) : null,
  homePageId: 'home',
  pageCount: 2,
  createdAt: new Date(2026, 10, 12, 10, 0),
  updatedAt: null,
  capabilities: { edit: manage, manage },
})

const SPACES = [space('DRE', 'Dashboard Resultado', 'fin'), space('RENT', 'Panel de Rentabilidad', 'fin'), space('PWGS', 'Página Web', 'mkt'), space('RCJ', 'Integração com IA', null)]

function setup(permissions: PermissionCode[], docs: Partial<Repositories['docs']> = {}, initialPath = '/docs', spaces = SPACES) {
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(permissions) },
    docs: {
      listSpaces: async () => spaces,
      listModules: async () => MODULES,
      ...docs,
    },
  })
  const routes = [
    { path: '/docs', element: <DocsHomePage /> },
    { path: '/docs/:spaceKey', element: <DocSpacePage /> },
    { path: '/docs/:spaceKey/:pageId', element: <DocSpacePage /> },
  ]
  return { repositories, ...renderRoutes(routes, { repositories, initialPath }) }
}

const moduleNav = () => screen.findByRole('navigation', { name: 'Filtrar espaços por módulo' })
const groupTitles = () => within(screen.getByRole('region', { name: 'Espaços' })).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)

describe('Documentação — módulos na tela inicial', () => {
  it('lista: Todos, módulos na ordem com a contagem e "Sem módulo"; leitor não cria módulo', async () => {
    setup(READ)
    const nav = await moduleNav()
    await waitFor(() => expect(within(nav).getByRole('button', { name: /Todos/ })).toHaveTextContent('4'))
    const buttons = within(nav).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Todos4', 'Marketing1', 'Finanças2', 'TI e sistemas0', 'Sem módulo1'])
    expect(within(nav).getByRole('button', { name: /Todos/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /Novo módulo/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Ações do módulo/ })).toBeNull()
  })

  it('"Sem módulo" só aparece quando há espaço sem módulo', async () => {
    setup(READ, {}, '/docs', SPACES.filter((s) => s.module))
    const nav = await moduleNav()
    await waitFor(() => expect(within(nav).getByRole('button', { name: /Todos/ })).toHaveTextContent('3'))
    expect(within(nav).queryByRole('button', { name: /Sem módulo/ })).toBeNull()
  })

  it('Todos: espaços agrupados por módulo (sem os vazios) e "Sem módulo" no fim; escolher um módulo filtra e vai para o endereço', async () => {
    const { router } = setup(READ)
    expect(await screen.findByRole('link', { name: /Dashboard Resultado/ })).toBeInTheDocument()
    expect(groupTitles()).toEqual(['Marketing', 'Finanças', 'Sem módulo'])
    expect(screen.getByRole('region', { name: 'Finanças' })).toHaveTextContent('2 espaços')

    await userEvent.click(within(await moduleNav()).getByRole('button', { name: /Finanças/ }))
    expect(router.state.location.search).toBe('?module=fin')
    expect(within(await moduleNav()).getByRole('button', { name: /Finanças/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('link', { name: /Página Web/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Panel de Rentabilidad/ })).toBeInTheDocument()

    await userEvent.click(within(await moduleNav()).getByRole('button', { name: /Sem módulo/ }))
    expect(router.state.location.search).toBe('?module=none')
    expect(screen.getAllByRole('link', { name: /Integração com IA|Dashboard|Página Web/ }).map((l) => l.textContent)).toEqual([expect.stringContaining('Integração com IA')])

    // voltar no navegador devolve o filtro anterior
    await router.navigate(-1)
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Filtrar espaços por módulo' })).getByRole('button', { name: /Finanças/ })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('módulo vazio escolhido pelo endereço mostra o aviso', async () => {
    setup(MANAGE, {}, '/docs?module=ti')
    expect(await screen.findByText(/Ainda não há espaços neste módulo/)).toBeInTheDocument()
  })

  it('módulo que não existe mais no endereço volta para Todos', async () => {
    setup(READ, {}, '/docs?module=apagado')
    expect(await screen.findByRole('link', { name: /Dashboard Resultado/ })).toBeInTheDocument()
    expect(within(await moduleNav()).getByRole('button', { name: /Todos/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('cartão mostra a data de criação no lugar da chave', async () => {
    setup(READ)
    const card = await screen.findByRole('link', { name: /Dashboard Resultado/ })
    expect(card).toHaveTextContent('Criado em 12/11/2026')
    expect(card).not.toHaveTextContent('DRE')
  })

  it('"⋯ → Mover para módulo" (quem configura o espaço) move e avisa; leitor não vê o menu', async () => {
    const updateSpace = vi.fn(async () => SPACES[3] as DocSpace)
    const success = vi.spyOn(notify, 'success')
    setup(MANAGE, { updateSpace })
    await userEvent.click(await screen.findByRole('button', { name: 'Ações do espaço Integração com IA' }))
    expect(await screen.findByText('Mover para módulo')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Sem módulo/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: /TI e sistemas/ }))
    await waitFor(() => expect(updateSpace).toHaveBeenCalledWith('rcj', { moduleId: 'ti' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('“Integração com IA” agora está em “TI e sistemas”.'))
  })

  it('leitor (sem configurar o espaço) não tem o "⋯" do cartão', async () => {
    setup(READ, {}, '/docs', SPACES.map((s) => ({ ...s, capabilities: { edit: false, manage: false } })))
    expect(await screen.findByRole('link', { name: /Dashboard Resultado/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ações do espaço/ })).toBeNull()
  })

  it('"Novo módulo": nome e cor da paleta; cria e passa a filtrar por ele', async () => {
    const created: DocModule = { id: 'rh', name: 'Recursos Humanos', color: 'orange', position: 3, spaceCount: 0 }
    const createModule = vi.fn(async () => created)
    const success = vi.spyOn(notify, 'success')
    const { router } = setup(MANAGE, { createModule })
    await userEvent.click(await screen.findByRole('button', { name: /Novo módulo/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Novo módulo' })
    // paleta fixa: sem cor livre
    expect(within(dialog).queryByLabelText(/personalizada/i)).toBeNull()
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nome/ }), 'Recursos Humanos')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Laranja' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar módulo' }))
    await waitFor(() => expect(createModule).toHaveBeenCalledWith({ name: 'Recursos Humanos', color: 'orange' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Módulo “Recursos Humanos” criado.'))
    expect(router.state.location.search).toBe('?module=rh')
  })

  it('nome em uso aparece no campo', async () => {
    const { AppError } = await import('@/core/errors/app-error')
    const createModule = vi.fn(async () => {
      throw new AppError({ code: 'DOC_MODULE_NAME_IN_USE', message: 'x', status: 409 })
    })
    setup(MANAGE, { createModule })
    await userEvent.click(await screen.findByRole('button', { name: /Novo módulo/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Novo módulo' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nome/ }), 'marketing')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar módulo' }))
    expect(await within(dialog).findByText('Já existe um módulo com esse nome')).toBeInTheDocument()
  })

  it('"⋯" do módulo: renomear, subir na lista e excluir com o aviso de que os espaços vão para "Sem módulo"', async () => {
    const updateModule = vi.fn(async () => MODULES[0] as DocModule)
    const deleteModule = vi.fn(async () => 2)
    const success = vi.spyOn(notify, 'success')
    setup(MANAGE, { updateModule, deleteModule })
    await userEvent.click(await screen.findByRole('button', { name: 'Ações do módulo Finanças' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Subir na lista' }))
    await waitFor(() => expect(updateModule).toHaveBeenCalledWith('fin', { position: 0 }))

    await userEvent.click(screen.getByRole('button', { name: 'Ações do módulo Finanças' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Renomear ou trocar a cor' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar módulo' })
    const name = within(dialog).getByRole('textbox', { name: /Nome/ })
    expect(name).toHaveValue('Finanças')
    await userEvent.clear(name)
    await userEvent.type(name, 'Financeiro')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(updateModule).toHaveBeenLastCalledWith('fin', { name: 'Financeiro', color: 'green' }))

    await userEvent.click(screen.getByRole('button', { name: 'Ações do módulo Finanças' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excluir módulo' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('Os 2 espaços deste módulo vão para “Sem módulo”')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Excluir módulo' }))
    await waitFor(() => expect(deleteModule).toHaveBeenCalledWith('fin'))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Módulo “Finanças” excluído.'))
  })

  it('"Novo espaço" com um módulo escolhido já vem nesse módulo', async () => {
    const createSpace = vi.fn(async () => SPACES[0] as DocSpace)
    setup(MANAGE, { createSpace, getSpace: async () => ({ space: SPACES[0] as DocSpace, pages: [], capabilities: { edit: true, manage: true } }) }, '/docs?module=mkt')
    await userEvent.click(await screen.findByRole('button', { name: 'Novo espaço' }))
    const dialog = await screen.findByRole('dialog', { name: 'Novo espaço de documentação' })
    expect(within(dialog).getByRole('combobox', { name: /Módulo/ })).toHaveTextContent('Marketing')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nome/ }), 'Campanhas')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar espaço' }))
    await waitFor(() => expect(createSpace).toHaveBeenCalledWith(expect.objectContaining({ name: 'Campanhas', moduleId: 'mkt' })))
  })
})

describe('Documentação — dentro do espaço', () => {
  const page = (space: DocSpace): DocPage => ({
    id: 'home',
    space: { id: space.id, key: space.key, name: space.name },
    parentId: null,
    title: space.name,
    status: 'published',
    content: { type: 'doc', content: [] },
    version: 1,
    publishedAt: new Date(),
    publishedBy: null,
    createdBy: null,
    isHome: true,
    ancestors: [],
    children: [],
    draft: null,
    capabilities: { edit: false, manage: false },
  })
  const detail = (space: DocSpace): DocSpaceDetail => ({
    space,
    pages: [{ id: 'home', parentId: null, title: space.name, status: 'published', position: 0, hasDraft: false, isHome: true, updatedAt: null, tasks: [] }],
    capabilities: { edit: false, manage: false },
  })

  it('trilha Documentação › Módulo › Espaço (o módulo abre a tela inicial filtrada) e "Todas as documentações" volta ao início', async () => {
    const dre = SPACES[0] as DocSpace
    const { router } = setup(READ, { getSpace: async () => detail(dre), getPage: async () => page(dre) }, '/docs/DRE')
    const trail = await screen.findByRole('navigation', { name: 'Trilha de navegação' })
    await waitFor(() => expect(trail).toHaveTextContent('DocumentaçãoFinançasDashboard Resultado'))
    expect(within(trail).getByRole('link', { name: 'Finanças' })).toHaveAttribute('href', '/docs?module=fin')

    await userEvent.click(await screen.findByRole('button', { name: 'Páginas do espaço' }))
    const back = await screen.findByRole('link', { name: /Todas as documentações/ })
    expect(back).toHaveAttribute('href', '/docs')
    await userEvent.click(back)
    await waitFor(() => expect(router.state.location.pathname).toBe('/docs'))
  })

  it('espaço sem módulo: trilha sem o nível do módulo', async () => {
    const rcj = SPACES[3] as DocSpace
    setup(READ, { getSpace: async () => detail(rcj), getPage: async () => page(rcj) }, '/docs/RCJ')
    const trail = await screen.findByRole('navigation', { name: 'Trilha de navegação' })
    await waitFor(() => expect(trail).toHaveTextContent('DocumentaçãoIntegração com IA'))
  })
})
