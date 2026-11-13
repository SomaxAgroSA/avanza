import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Outlet } from 'react-router'
import i18n from '@/core/i18n'
import { AppError } from '@/core/errors/app-error'
import type { DocPage, DocSpace, DocSpaceDetail, DocTreePage, TaskDocLink } from '@/domain/docs'
import type { PermissionCode } from '@/domain/permissions'
import type { Project } from '@/domain/projects'
import type { Repositories } from '@/domain/repositories'
import type { TaskDetail, TaskSummary } from '@/domain/tasks'
import { fakeRepositories, makeCurrentUser, renderRoutes, renderWithProviders } from '@/test/utils'
import { DeleteProjectDialog } from '@/features/projects/DeleteProjectDialog'
import { TaskDocsPanel } from '@/features/tasks/TaskDocsPanel'
import { DocSpacePage } from './DocSpacePage'
import { ProjectDocsTab } from './ProjectDocsTab'
import { SpaceFormDialog } from './SpaceFormDialog'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
afterEach(() => {
  vi.restoreAllMocks()
})

const ALL: PermissionCode[] = ['docs.view', 'docs.edit', 'docs.manage', 'projects.view', 'tasks.view']

const project = (id: string, key: string, name: string, extra: Partial<Project> = {}): Project =>
  ({ id, key, name, icon: 'folder', cover: 'blue', archivedAt: null, parent: null, capabilities: { edit: true }, ...extra }) as unknown as Project
const DRE = project('dre', 'DRE', 'DRE POR UNIDAD')
const ECC = project('ecc', 'ECC', 'EVALUACIÓN DE CAMPOS A CIEGAS')
const MSB = project('msb', 'MSB', 'MARGEM SOMAX BRASIL')
const projectPage = (items: Project[]) => ({ items, page: 1, perPage: 100, total: items.length, totalPages: 1 })

const space = (extra: Partial<DocSpace> = {}): DocSpace => ({
  id: 'sp1',
  key: 'EAC',
  name: 'Evaluaciones a Ciegas',
  description: '',
  icon: 'book',
  color: 'green',
  visibility: 'project',
  project: { id: 'ecc', key: 'ECC', name: 'EVALUACIÓN DE CAMPOS A CIEGAS' },
  homePageId: 'home',
  pageCount: 2,
  createdAt: null,
  updatedAt: null,
  capabilities: { edit: true, manage: true },
  ...extra,
})
const tree = (id: string, title: string, parentId: string | null, extra: Partial<DocTreePage> = {}): DocTreePage => ({
  id,
  parentId,
  title,
  status: 'published',
  position: 1024,
  hasDraft: false,
  isHome: false,
  updatedAt: null,
  tasks: [],
  ...extra,
})
const PAGES = [
  tree('home', 'PROMPT PARA REPLICAR DEMO', null, { isHome: true, position: 0, tasks: [{ id: 't11', code: 'ECC-11', title: 'Prompt de desarrollo' }] }),
  tree('spec', 'Sistema de entrenamiento generado por Fabiano', 'home', { tasks: [{ id: 't5', code: 'ECC-5', title: 'Prototipo' }] }),
]
const docPage = (id: string, title: string, extra: Partial<DocPage> = {}): DocPage => ({
  id,
  space: { id: 'sp1', key: 'EAC', name: 'Evaluaciones a Ciegas' },
  parentId: null,
  title,
  status: 'published',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Especificación funcional del SojaLab.' }] }] },
  version: 1,
  publishedAt: new Date(),
  publishedBy: null,
  createdBy: null,
  isHome: false,
  ancestors: [],
  children: [],
  draft: null,
  capabilities: { edit: true, manage: true },
  ...extra,
})
const summary = (id: string, code: string, title: string, number: number, assignee: string | null = null): TaskSummary =>
  ({ id, code, title, number, assignee: assignee ? { id: assignee, name: 'Angelica', email: 'a@x.com', avatarUrl: null } : null, project: { id: 'ecc', key: 'ECC', name: 'ECC' } }) as unknown as TaskSummary

describe('Espaço: trocar o projeto', () => {
  it('o projeto não fica mais travado: escolher outro mostra o aviso e salva o novo projeto', async () => {
    const updateSpace = vi.fn(async () => space())
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(ALL) },
      projects: { list: async () => projectPage([DRE, MSB, project('arq', 'ARQ', 'Arquivado', { archivedAt: new Date() })]) },
      docs: { updateSpace },
    })
    const tdc = space({ id: 'tdc', key: 'TDC', name: 'Tabla de custos', project: { id: 'dre', key: 'DRE', name: 'DRE POR UNIDAD' } })
    renderRoutes([{ path: '/', element: <SpaceFormDialog open onOpenChange={() => {}} space={tdc} /> }], { repositories, initialPath: '/' })
    const dialog = await screen.findByRole('dialog', { name: 'Configurar espaço' })
    const select = within(dialog).getByRole('combobox', { name: /Projeto/ })
    await waitFor(() => expect(select).toHaveTextContent('DRE · DRE POR UNIDAD'))
    expect(within(dialog).queryByTestId('space-project-change')).toBeNull()

    await userEvent.click(select)
    const listbox = await screen.findByRole('listbox')
    // arquivado não aparece
    expect(within(listbox).queryByRole('button', { name: /Arquivado/ })).toBeNull()
    await userEvent.click(within(listbox).getByRole('button', { name: 'MSB · MARGEM SOMAX BRASIL' }))
    expect(await within(dialog).findByTestId('space-project-change')).toHaveTextContent('Ao salvar, TDC passa de DRE para MSB')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(updateSpace).toHaveBeenCalledWith('tdc', expect.objectContaining({ projectId: 'msb', visibility: 'project' })))
  })

  it('remover o projeto deixa o espaço para toda a empresa', async () => {
    const updateSpace = vi.fn(async () => space())
    const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(ALL) }, projects: { list: async () => projectPage([DRE]) }, docs: { updateSpace } })
    renderRoutes([{ path: '/', element: <SpaceFormDialog open onOpenChange={() => {}} space={space({ id: 'tdc', key: 'TDC', project: { id: 'dre', key: 'DRE', name: 'DRE POR UNIDAD' } })} /> }], { repositories, initialPath: '/' })
    const dialog = await screen.findByRole('dialog', { name: 'Configurar espaço' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remover projeto' }))
    expect(within(dialog).getByTestId('space-project-change')).toHaveTextContent('deixa de estar vinculado a DRE')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(updateSpace).toHaveBeenCalledWith('tdc', expect.objectContaining({ projectId: '', visibility: 'company' })))
  })
})

describe('Página: tarefas vinculadas', () => {
  function setupPage(docs: Partial<Repositories['docs']>) {
    const detail: DocSpaceDetail = { space: space(), pages: PAGES, capabilities: { edit: true, manage: true } }
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(ALL) },
      tasks: { list: async () => ({ items: [summary('t7', 'ECC-7', 'PWA del evaluador', 7), summary('t12', 'ECC-12', 'Base de productos', 12, 'u1'), summary('t5', 'ECC-5', 'Prototipo', 5)], page: 1, perPage: 100, total: 3, totalPages: 1 }) },
      docs: { listSpaces: async () => [detail.space], getSpace: async () => detail, getPage: async (id) => docPage(id, 'Sistema de entrenamiento generado por Fabiano'), ...docs },
    })
    renderRoutes([{ path: '/docs/:spaceKey/:pageId', element: <DocSpacePage /> }], { repositories, initialPath: '/docs/EAC/spec' })
  }

  it('mostra as tarefas vinculadas e vincula as abertas do projeto do espaço (as já vinculadas vêm marcadas)', async () => {
    const linkTasks = vi.fn(async () => [])
    setupPage({ listPageTasks: async () => [summary('t5', 'ECC-5', 'Prototipo', 5)], linkTasks })
    const bar = await screen.findByTestId('page-tasks')
    expect(await within(bar).findByRole('link', { name: /ECC-5/ })).toHaveAttribute('href', '/tasks/t5')
    await userEvent.click(within(bar).getByRole('button', { name: 'Vincular a tarefas' }))
    const dialog = await screen.findByRole('dialog', { name: 'Vincular a tarefas' })
    expect(dialog).toHaveTextContent('Tarefas abertas de ECC · EVALUACIÓN DE CAMPOS A CIEGAS')
    const list = await within(dialog).findByTestId('link-tasks-list')
    expect(within(list).getByRole('checkbox', { name: /ECC-5s*Prototipo/ })).toBeDisabled()
    expect(within(list).getByText('Sua')).toBeInTheDocument()
    await userEvent.click(within(list).getByRole('checkbox', { name: /ECC-7s*PWA del evaluador/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vincular' }))
    await waitFor(() => expect(linkTasks).toHaveBeenCalledWith('spec', ['t7']))
  })
})

describe('Tarefa: aba Documentação', () => {
  const TASK = { id: 't7', code: 'ECC-7', title: 'PWA del evaluador', project: { id: 'ecc', key: 'ECC', name: 'ECC' } } as unknown as TaskDetail
  const link = (id: string, title: string, extra: Partial<TaskDocLink> = {}): TaskDocLink => ({
    id,
    title,
    status: 'published',
    isHome: false,
    space: { id: 'sp1', key: 'EAC', name: 'Evaluaciones a Ciegas', icon: 'book', color: 'green' },
    updatedAt: null,
    linkedAt: null,
    canUnlink: true,
    ...extra,
  })

  it('lê a página vinculada ali mesmo e tira o vínculo', async () => {
    const unlinkTask = vi.fn(async () => {})
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(ALL) },
      docs: {
        listTaskDocs: async () => [link('spec', 'Sistema de entrenamiento generado por Fabiano'), link('home', 'PROMPT PARA REPLICAR DEMO', { isHome: true })],
        listSpaces: async () => [space()],
        getPage: async (id) => docPage(id, id === 'spec' ? 'Sistema de entrenamiento generado por Fabiano' : 'PROMPT PARA REPLICAR DEMO'),
        unlinkTask,
      },
    })
    renderRoutes([{ path: '/tasks/:id', element: <TaskDocsPanel task={TASK} /> }], { repositories, initialPath: '/tasks/t7' })
    const reader = await screen.findByTestId('task-doc-reader')
    expect(await within(reader).findByRole('heading', { name: 'Sistema de entrenamiento generado por Fabiano' })).toBeInTheDocument()
    expect(await within(reader).findByText('Especificación funcional del SojaLab.')).toBeInTheDocument()
    // trocar de página não sai da tarefa
    await userEvent.click(screen.getByRole('button', { name: /PROMPT PARA REPLICAR DEMO/ }))
    expect(await within(screen.getByTestId('task-doc-reader')).findByRole('heading', { name: 'PROMPT PARA REPLICAR DEMO' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Criar página a partir da tarefa' })).toBeInTheDocument()
    await userEvent.click(within(screen.getByTestId('task-doc-reader')).getByRole('button', { name: 'Tirar vínculo' }))
    await waitFor(() => expect(unlinkTask).toHaveBeenCalledWith('home', 't7'))
  })

  it('sem documentação: convida a vincular, sem sair da tarefa', async () => {
    const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(ALL) }, docs: { listTaskDocs: async () => [], listSpaces: async () => [] } })
    renderRoutes([{ path: '/tasks/:id', element: <TaskDocsPanel task={TASK} /> }], { repositories, initialPath: '/tasks/t7' })
    expect(await screen.findByText('Sem documentação vinculada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vincular página' })).toBeInTheDocument()
    expect(screen.getByText('O projeto ainda não tem espaço de documentação.')).toBeInTheDocument()
  })
})

describe('Projeto: aba Documentação', () => {
  it('lista os espaços do projeto com as páginas e as tarefas de cada uma', async () => {
    const detail: DocSpaceDetail = { space: space(), pages: PAGES, capabilities: { edit: true, manage: true } }
    const other = space({ id: 'sp2', key: 'OUTRO', name: 'De outro projeto', project: { id: 'dre', key: 'DRE', name: 'DRE' } })
    const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(ALL) }, docs: { listSpaces: async () => [detail.space, other], getSpace: async () => detail } })
    renderRoutes([{ path: '/projects/:id', element: <Outlet context={{ project: ECC }} />, children: [{ path: 'docs', element: <ProjectDocsTab /> }] }], { repositories, initialPath: '/projects/ecc/docs' })
    const section = await screen.findByRole('region', { name: /Evaluaciones a Ciegas/ })
    expect(screen.queryByText('De outro projeto')).toBeNull()
    expect(await within(section).findByRole('link', { name: 'PROMPT PARA REPLICAR DEMO' })).toHaveAttribute('href', '/docs/EAC/home')
    expect(within(section).getByRole('link', { name: 'ECC-5' })).toHaveAttribute('href', '/tasks/t5')
    expect(within(section).getByRole('button', { name: 'Nova página' })).toBeInTheDocument()
  })

  it('sem espaço: quem administra cria um já vinculado ao projeto', async () => {
    const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(ALL) }, docs: { listSpaces: async () => [] }, projects: { list: async () => projectPage([ECC]) } })
    renderRoutes([{ path: '/projects/:id', element: <Outlet context={{ project: ECC }} />, children: [{ path: 'docs', element: <ProjectDocsTab /> }] }], { repositories, initialPath: '/projects/ecc/docs' })
    await userEvent.click(await screen.findByRole('button', { name: 'Criar espaço' }))
    const dialog = await screen.findByRole('dialog', { name: 'Novo espaço de documentação' })
    expect(within(dialog).getByRole('combobox', { name: /Quem pode ler/ })).toHaveTextContent('Membros do projeto')
  })
})

describe('Excluir projeto com documentação', () => {
  const EDEAC = { id: 'edeac', key: 'EDEAC', name: 'EVALUCION DE ENSAYOS A CIEGA' }

  it('pergunta o que fazer: mover (padrão, exige o projeto), deixar geral ou excluir junto', async () => {
    const remove = vi.fn(async () => {})
    const onDeleted = vi.fn()
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(ALL) },
      projects: { list: async () => projectPage([ECC, project('edeac', 'EDEAC', 'EVALUCION DE ENSAYOS A CIEGA')]), remove },
      docs: { listSpaces: async () => [space({ id: 'eac1', key: 'EAC1', name: 'Evaluaciones a Ciegas documentacion', project: EDEAC, pageCount: 3 })] },
    })
    renderWithProviders(<DeleteProjectDialog project={EDEAC} open onOpenChange={() => {}} onDeleted={onDeleted} />, repositories)
    const dialog = await screen.findByTestId('delete-project-docs')
    expect(dialog).toHaveTextContent('EAC1 · Evaluaciones a Ciegas documentacion')
    expect(screen.getByRole('radio', { name: /Mover para outro projeto/ })).toHaveAttribute('aria-checked', 'true')
    const confirm = screen.getByRole('button', { name: 'Excluir projeto' })
    expect(confirm).toBeDisabled()

    await userEvent.click(screen.getByRole('combobox', { name: /Projeto que recebe a documentação/ }))
    const listbox = await screen.findByRole('listbox')
    // o próprio projeto não é destino
    expect(within(listbox).queryByRole('button', { name: /EDEAC/ })).toBeNull()
    await userEvent.click(within(listbox).getByRole('button', { name: 'ECC · EVALUACIÓN DE CAMPOS A CIEGAS' }))
    await userEvent.click(confirm)
    await waitFor(() => expect(remove).toHaveBeenCalledWith('edeac', { docs: 'move', docsProjectId: 'ecc' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
  })

  it('excluir junto é uma escolha explícita', async () => {
    const remove = vi.fn(async () => {})
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(ALL) },
      projects: { list: async () => projectPage([ECC]), remove },
      docs: { listSpaces: async () => [space({ id: 'eac1', key: 'EAC1', project: EDEAC })] },
    })
    renderWithProviders(<DeleteProjectDialog project={EDEAC} open onOpenChange={() => {}} onDeleted={() => {}} />, repositories)
    await userEvent.click(await screen.findByRole('radio', { name: /Excluir junto com o projeto/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Excluir projeto' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('edeac', { docs: 'delete' }))
  })

  it('sem documentação, a confirmação de sempre; se o servidor avisar que há documentação, mostra a escolha', async () => {
    const remove = vi.fn(async () => {
      throw new AppError({ code: 'PROJECT_HAS_DOCS', status: 409, message: 'x', details: { spaces: [{ id: 'oculto', key: 'OCULTO', name: 'Espaço que eu não vejo' }] } })
    })
    const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(ALL) }, projects: { list: async () => projectPage([ECC]), remove }, docs: { listSpaces: async () => [] } })
    renderWithProviders(<DeleteProjectDialog project={EDEAC} open onOpenChange={() => {}} onDeleted={() => {}} />, repositories)
    const alert = await screen.findByRole('alertdialog')
    await userEvent.click(within(alert).getByRole('button', { name: 'Excluir' }))
    expect(await screen.findByTestId('delete-project-docs')).toHaveTextContent('OCULTO · Espaço que eu não vejo')
    expect(remove).toHaveBeenCalledWith('edeac', undefined)
  })
})
