import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { AppError } from '@/core/errors/app-error'
import type { Board, BoardCard } from '@/domain/kanban'
import type { Project, ProjectMember } from '@/domain/projects'
import { DEFAULT_PROJECT_FILTER, type ProjectFilterSettings } from '@/domain/project-filter'
import type { BoardRepository, TaskRepository } from '@/domain/repositories'
import type { CustomField, TaskType, TaskTypeDetail } from '@/domain/task-config'
import type { TaskDetail } from '@/domain/tasks'
import type { TaskPriority, TaskStatus } from '@/domain/workflow'
import { fakeRepositories, makeCurrentUser, renderRoutes, typeTexts } from '@/test/utils'
import { KanbanPage, ProjectKanbanPage } from './KanbanPage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
beforeEach(() => {
  window.localStorage.clear()
})

const severidade: CustomField = {
  id: 'f2',
  name: 'severidade',
  label: 'Severidade',
  type: 'select',
  description: '',
  config: {},
  defaultValue: null,
  searchable: true,
  filterable: false,
  sortable: false,
  options: [{ id: 'o1', label: 'Crítica', color: 'red', order: 0, isActive: true }],
  usedBy: [],
  createdAt: null,
  updatedAt: null,
}

const bugType: TaskType = { id: 't1', key: 'BUG', name: 'Bug', description: '', translations: typeTexts('Bug'), icon: 'bug', color: 'red', order: 0, isActive: true, fieldCount: 1, createdAt: null, updatedAt: null }
const bugDetail: TaskTypeDetail = { ...bugType, fields: [{ field: severidade, order: 0, required: false, visible: true, showOnCard: true, requiredStatusIds: [] }] }
const bugRequired: TaskTypeDetail = { ...bugType, fields: [{ field: severidade, order: 0, required: true, visible: true, showOnCard: true, requiredStatusIds: [] }] }

const lookup = <T extends TaskStatus | TaskPriority>(overrides: Partial<T>): T =>
  ({ id: 'x', key: 'X', name: 'X', description: '', color: 'gray', order: 0, isActive: true, isDefault: false, createdAt: null, updatedAt: null, ...overrides }) as T
const todo = lookup<TaskStatus>({ id: 's1', key: 'TODO', name: 'A fazer', category: 'todo', isDefault: true })
const doing = lookup<TaskStatus>({ id: 's2', key: 'DOING', name: 'Fazendo', category: 'in_progress', order: 1 })
const alta = lookup<TaskPriority>({ id: 'p1', key: 'ALTA', name: 'Alta', color: 'orange', isDefault: true })
const ti = lookup<TaskPriority>({ id: 'a1', key: 'TI', name: 'Dpto. TI', color: 'blue' })
const comex = lookup<TaskPriority>({ id: 'a2', key: 'COMEX', name: 'Comex', color: 'teal', order: 1 })

const gabi = { id: 'u1', name: 'Gabi Rocha', email: 'g@x.com', avatarUrl: null }
const members: ProjectMember[] = [{ user: { ...gabi, status: 'active' }, role: 'manager', isOwner: true, joinedAt: null }]

function card(id: string, title: string, extra: Partial<BoardCard> = {}): BoardCard {
  return {
    id,
    code: `CRM-${id}`,
    number: Number(id),
    title,
    project: { id: 'p1', key: 'CRM', name: 'CRM' },
    type: { id: 't1', key: 'BUG', name: 'Bug', icon: 'bug', color: 'red' },
    status: null,
    priority: { id: 'p1', key: 'ALTA', name: 'Alta', color: 'orange' },
    creator: null,
    assignee: null,
    reporter: null,
    parentTaskId: null,
    startDate: null,
    dueDate: null,
    estimatedHours: null,
    actualHours: null,
    startedAt: null,
    completedAt: null,
    createdAt: null,
    updatedAt: null,
    tags: [],
    checklistProgress: { done: 0, total: 0 },
    commentCount: 0,
    attachmentCount: 0,
    subtaskProgress: { done: 0, total: 0 },
    blocked: false,
    inReport: true,
    urgency: null,
    area: null,
    sprint: null,
    cardFields: [],
    ...extra,
  }
}

const column = (status: TaskStatus, cards: BoardCard[], extra: Partial<Board['columns'][number]> = {}) => ({
  status: { id: status.id, key: status.key, name: status.name, color: status.color, category: status.category, isDefault: status.isDefault },
  wipLimit: 0,
  allowedNext: [],
  total: cards.length,
  truncated: false,
  cards: cards.map((c) => ({ ...c, status: { id: status.id, key: status.key, name: status.name, color: status.color, category: status.category } })),
  ...extra,
})

const board: Board = {
  project: { id: 'p1', key: 'CRM', name: 'CRM Corporativo', archived: false },
  projects: [{ id: 'p1', key: 'CRM', name: 'CRM Corporativo' }],
  capabilities: { move: true, create: true },
  columns: [
    column(todo, [
      card('1', 'Erro ao salvar pedido', { assignee: gabi, cardFields: [{ field: severidade, value: 'o1' }] }),
      card('2', 'Ajustar relatório de vendas'),
    ]),
    column(doing, [card('3', 'Nova tela de login', { assignee: gabi })], { wipLimit: 1 }),
  ],
}

const detail: TaskDetail = {
  ...card('1', 'Erro ao salvar pedido'),
  status: { id: 's1', key: 'TODO', name: 'A fazer', color: 'gray', category: 'todo' },
  description: '',
  customValues: {},
  checklist: [],
  fields: [],
  parent: null, forkedFrom: null, capabilities: { edit: true, delete: false, assign: true, comment: true, link: true, fork: true },
}

const erpProject = { id: 'p2', key: 'ERP', name: 'ERP Financeiro' }
const rhProject = { id: 'p3', key: 'RH', name: 'RH' }
const bia = { id: 'u2', name: 'Bia Lima', email: 'b@x.com', avatarUrl: null }
/** Quadro de todos os projetos: CRM (pode mover) + ERP (leitor) + RH (sem cards). */
const allBoard: Board = {
  project: null,
  projects: [board.projects[0]!, erpProject, rhProject],
  capabilities: { move: true, create: true },
  columns: [
    column(todo, [
      card('1', 'Erro ao salvar pedido', { assignee: gabi, canMove: true }),
      card('7', 'Conciliar notas', { code: 'ERP-7', project: erpProject, assignee: bia, canMove: false }),
      card('2', 'Ajustar relatório de vendas', { canMove: true }),
    ]),
    column(doing, [card('3', 'Nova tela de login', { assignee: gabi, canMove: true })], { wipLimit: 1 }),
  ],
}

function setup({
  data = board,
  create = vi.fn<TaskRepository['create']>(() => Promise.resolve(detail)),
  type = bugDetail,
  path = '/projects/p1/kanban',
  get = vi.fn<BoardRepository['get']>(() => Promise.resolve(data)),
  getAll = vi.fn<BoardRepository['getAll']>(() => Promise.resolve(allBoard)),
  move = vi.fn<BoardRepository['move']>(() => Promise.resolve(detail)),
  projectFilter = DEFAULT_PROJECT_FILTER,
  projectList = [],
}: {
  data?: Board
  create?: TaskRepository['create']
  type?: TaskTypeDetail
  path?: string
  get?: BoardRepository['get']
  getAll?: BoardRepository['getAll']
  move?: BoardRepository['move']
  projectFilter?: ProjectFilterSettings
  projectList?: Project[]
} = {}) {
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(['kanban.view', 'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'projects.view'], 'ADMIN') },
    board: { get, getAll, move },
    taskTypes: { list: () => Promise.resolve([bugType]), get: () => Promise.resolve(type) },
    statuses: { list: () => Promise.resolve([todo, doing]) },
    priorities: { list: () => Promise.resolve([alta]) },
    areas: { list: () => Promise.resolve([ti, comex]) },
    projects: {
      listMembers: () => Promise.resolve(members),
      list: () => Promise.resolve({ items: projectList, page: 1, perPage: 100, total: projectList.length, totalPages: 1 }),
    },
    tasks: { create, get: () => Promise.resolve(detail) },
    preferences: { getProjectFilter: () => Promise.resolve(projectFilter) },
  })
  const utils = renderRoutes(
    [
      { path: '/kanban', element: <KanbanPage /> },
      { path: '/kanban/all', element: <KanbanPage /> },
      { path: '/projects/:projectId/kanban', element: <ProjectKanbanPage /> },
    ],
    { repositories, initialPath: path },
  )
  return { ...utils, create, get, getAll, move }
}

describe('KanbanPage', () => {
  it('mostra colunas na ordem do fluxo, contagem com limite WIP e campos do card', async () => {
    setup()
    const todoCell = await screen.findByTestId('kanban-cell-all::s1')
    expect(within(todoCell).getByText('Erro ao salvar pedido')).toBeInTheDocument()
    expect(within(todoCell).getByText('Crítica')).toBeInTheDocument()
    expect(screen.getByText('1/1')).toBeInTheDocument()
    expect(screen.getByText('1 de no máximo 1 tarefas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /CRM-3 · Nova tela de login/ })).toBeInTheDocument()
  })

  it('dentro do projeto: sem título nem seletor de projeto; visões da aba Tarefas e "Nova tarefa" ao lado', async () => {
    setup()
    await screen.findByText('Erro ao salvar pedido')
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Projeto' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('kanban-project-filter')).not.toBeInTheDocument()
    const views = screen.getByRole('navigation', { name: 'Visões das tarefas' })
    expect(within(views).getAllByRole('link').map((link) => link.textContent)).toEqual(['Lista', 'Kanban', 'Planejamento', 'Cronograma'])
    expect(within(views).getByRole('link', { name: 'Kanban' })).toHaveAttribute('aria-current', 'page')
    expect(within(views).getByRole('link', { name: 'Planejamento' })).toHaveAttribute('href', '/projects/p1/planning')
    expect(screen.getByRole('button', { name: 'Nova tarefa' })).toBeInTheDocument()
  })

  it('/kanban abre o quadro de todos os projetos, sem seletor de projeto', async () => {
    const { router, get } = setup({ path: '/kanban' })
    expect(await screen.findByText('Conciliar notas')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/kanban')
    expect(screen.getByRole('heading', { name: 'Kanban' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Projeto' })).not.toBeInTheDocument()
    expect(get).not.toHaveBeenCalled()
  })

  it('busca e filtro "minhas tarefas" filtram no navegador', async () => {
    setup()
    await screen.findByText('Erro ao salvar pedido')
    await userEvent.type(screen.getByPlaceholderText('Buscar por código ou título'), 'relatório')
    await waitFor(() => expect(screen.queryByText('Erro ao salvar pedido')).not.toBeInTheDocument())
    expect(screen.getByText('Ajustar relatório de vendas')).toBeInTheDocument()
    expect(screen.getByText('1 tarefa corresponde aos filtros')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Responsável' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Sem responsável' }))
    expect(screen.getByText('Ajustar relatório de vendas')).toBeInTheDocument()
    expect(screen.queryByText('Nova tela de login')).not.toBeInTheDocument()
  })

  it('urgência: semáforo no cartão (com o nome para leitores de tela) e filtro na barra', async () => {
    const urgent: Board = {
      ...board,
      columns: [column(todo, [card('1', 'Erro ao salvar pedido', { urgency: 'high' }), card('2', 'Ajustar relatório de vendas', { urgency: 'low' })]), column(doing, [card('3', 'Nova tela de login')])],
    }
    setup({ data: urgent })
    const first = await screen.findByRole('button', { name: /CRM-1 · Erro ao salvar pedido/ })
    expect(within(first).getByText('Urgência: Alta')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /CRM-3 · Nova tela de login/ })).queryByText(/^Urgência:/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('combobox', { name: 'Urgência' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Alta' }))
    expect(screen.getByRole('combobox', { name: 'Urgência' })).toHaveTextContent('Urgência: Alta')
    expect(screen.getByText('Erro ao salvar pedido')).toBeInTheDocument()
    expect(screen.queryByText('Ajustar relatório de vendas')).not.toBeInTheDocument()
    expect(screen.queryByText('Nova tela de login')).not.toBeInTheDocument()
  })

  it('área: selo com o nome no cartão e filtro na barra (área ou "Sem área")', async () => {
    const withAreas: Board = {
      ...board,
      columns: [
        column(todo, [card('1', 'Erro ao salvar pedido', { area: { id: 'a1', key: 'TI', name: 'Dpto. TI', color: 'blue' } }), card('2', 'Ajustar relatório de vendas', { area: { id: 'a2', key: 'COMEX', name: 'Comex', color: 'teal' } })]),
        column(doing, [card('3', 'Nova tela de login')]),
      ],
    }
    setup({ data: withAreas })
    const first = await screen.findByRole('button', { name: /CRM-1 · Erro ao salvar pedido/ })
    expect(within(first).getByText('Dpto. TI')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /CRM-3 · Nova tela de login/ })).queryByText('Sem área')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('combobox', { name: 'Área' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Comex' }))
    expect(screen.getByRole('combobox', { name: 'Área' })).toHaveTextContent('Área: Comex')
    expect(screen.getByText('Ajustar relatório de vendas')).toBeInTheDocument()
    expect(screen.queryByText('Erro ao salvar pedido')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('combobox', { name: 'Área' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Sem área' }))
    expect(screen.getByText('Nova tela de login')).toBeInTheDocument()
    expect(screen.queryByText('Ajustar relatório de vendas')).not.toBeInTheDocument()
  })

  it('filtro de etapas: só as colunas escolhidas; Limpar filtros traz todas de volta', async () => {
    setup()
    await screen.findByText('Erro ao salvar pedido')
    await userEvent.click(screen.getByTestId('kanban-stage-filter'))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Fazendo' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByTestId('kanban-stage-filter')).toHaveTextContent('Etapas: Fazendo')
    expect(screen.queryByTestId('kanban-cell-all::s1')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('kanban-cell-all::s2')).getByText('Nova tela de login')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(await screen.findByTestId('kanban-cell-all::s1')).toBeInTheDocument()
  })

  it('recolher coluna vira faixa com a contagem; compacto esconde os campos do card; as duas escolhas ficam salvas', async () => {
    const first = setup()
    await screen.findByText('Erro ao salvar pedido')
    await userEvent.click(screen.getByRole('button', { name: 'Recolher a coluna A fazer' }))
    const strip = screen.getByTestId('kanban-cell-all::s1')
    expect(within(strip).queryByText('Erro ao salvar pedido')).not.toBeInTheDocument()
    expect(within(strip).getByRole('button', { name: 'Expandir a coluna A fazer (2)' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Compacto' }))
    expect(screen.getByRole('button', { name: 'Compacto' })).toHaveAttribute('aria-pressed', 'true')
    expect(JSON.parse(window.localStorage.getItem('kamban.kanban.view') ?? '{}')).toEqual({ collapsed: ['s1'], compact: true })
    first.unmount()

    // volta igual: coluna recolhida e compacto; expandir mostra os cards sem os campos extras
    setup()
    const again = await screen.findByTestId('kanban-cell-all::s1')
    await userEvent.click(within(again).getByRole('button', { name: /Expandir a coluna A fazer/ }))
    expect(await screen.findByText('Erro ao salvar pedido')).toBeInTheDocument()
    expect(screen.queryByText('Crítica')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compacto' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('raias por responsável agrupam os cards', async () => {
    setup()
    await screen.findByText('Erro ao salvar pedido')
    await userEvent.click(screen.getByRole('combobox', { name: 'Agrupar em raias' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Raias por responsável' }))
    expect(within(screen.getByTestId('kanban-cell-u1::s2')).getByText('Nova tela de login')).toBeInTheDocument()
    expect(within(screen.getByTestId('kanban-cell-::s1')).getByText('Ajustar relatório de vendas')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sem responsável' })).toBeInTheDocument()
  })

  it('Enter no card abre o painel com troca rápida de status', async () => {
    setup()
    const target = await screen.findByRole('button', { name: /CRM-1 · Erro ao salvar pedido/ })
    target.focus()
    await userEvent.keyboard('{Enter}')
    const drawer = await screen.findByRole('dialog')
    expect(await within(drawer).findByRole('combobox', { name: 'Status' })).toBeInTheDocument()
  })

  it('"Abrir tarefa" no painel abre a tarefa completa numa janela, sem sair do Kanban', async () => {
    const { router } = setup()
    await userEvent.click(await screen.findByRole('button', { name: /CRM-1 · Erro ao salvar pedido/ }))
    const drawer = await screen.findByRole('dialog')
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Abrir tarefa' }))
    const full = await screen.findByRole('dialog', { name: 'Erro ao salvar pedido' })
    // as abas da tarefa ficam na janela e não mexem no endereço do quadro
    await userEvent.click(within(full).getByRole('tab', { name: /Comentários/ }))
    expect(router.state.location.pathname).toBe('/projects/p1/kanban')
    expect(router.state.location.search).toBe('')
    expect(within(full).getByRole('link', { name: 'Abrir em página inteira' })).toHaveAttribute('href', '/tasks/1')
  })

  it('criação rápida nasce na coluna escolhida', async () => {
    const { create } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Criar tarefa em Fazendo' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/começa em "Fazendo"/)).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(/^Título/), 'Revisar contrato')
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: /^Tipo/ })).toHaveTextContent('Bug'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nova tarefa' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(vi.mocked(create).mock.calls[0]?.[0]).toMatchObject({ projectId: 'p1', taskTypeId: 't1', title: 'Revisar contrato', statusId: 's2', priorityId: 'p1' })
  })

  it('tipo com campo obrigatório continua no formulário completo com o título digitado', async () => {
    const { create } = setup({ type: bugRequired })
    await userEvent.click(await screen.findByRole('button', { name: 'Criar tarefa em A fazer' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/^Título/), 'Revisar contrato')
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Continuar' }))
    expect(await screen.findByDisplayValue('Revisar contrato')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Nova tarefa' })).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('projeto arquivado: somente leitura, sem criação', async () => {
    setup({ data: { ...board, project: { ...board.project!, archived: true }, capabilities: { move: false, create: false } } })
    expect(await screen.findByText('Projeto arquivado: somente leitura')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Criar tarefa em/ })).not.toBeInTheDocument()
  })

  it('sem acesso ao projeto: aviso no lugar do quadro', async () => {
    setup({ get: () => Promise.reject(new AppError({ code: 'PROJECT_NOT_FOUND', message: 'x', status: 404 })) })
    expect(await screen.findByText('Quadro não encontrado ou você não tem acesso a este projeto.')).toBeInTheDocument()
  })
})

describe('KanbanPage — todos os projetos', () => {
  it('cards de vários projetos com a etiqueta do projeto, sem limite WIP e sem criação por coluna', async () => {
    const { getAll, get } = setup({ path: '/kanban/all' })
    const erpCard = await screen.findByRole('button', { name: /ERP-7 · Conciliar notas/ })
    expect(within(erpCard).getByTestId('kanban-card-project')).toHaveTextContent('ERP')
    expect(within(screen.getByRole('button', { name: /CRM-1 · Erro ao salvar pedido/ })).getByTestId('kanban-card-project')).toHaveTextContent('CRM')
    expect(getAll).toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    // WIP é por projeto: a coluna mostra só o total
    expect(screen.queryByText('1/1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Criar tarefa em/ })).not.toBeInTheDocument()
    // card de projeto em que a pessoa só lê não arrasta
    expect(erpCard).not.toHaveAttribute('aria-roledescription')
    expect(screen.getByRole('button', { name: /CRM-1 · Erro ao salvar pedido/ })).toHaveAttribute('aria-roledescription', 'card arrastável')
    expect(screen.getByText('Tarefas de todos os projetos que você acompanha.')).toBeInTheDocument()
  })

  it('filtro de projeto (escolha múltipla) e responsáveis tirados dos cards; sem filtro de sprint', async () => {
    setup({ path: '/kanban/all' })
    await screen.findByText('Conciliar notas')
    expect(screen.queryByRole('combobox', { name: 'Sprint' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('combobox', { name: 'Responsável' }))
    expect(await screen.findByRole('option', { name: 'Bia Lima' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByTestId('kanban-project-filter'))
    // RH não tem cards no quadro: fica fora das opções
    expect(screen.queryByRole('menuitemcheckbox', { name: /RH/ })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'ERP · ERP Financeiro' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('Erro ao salvar pedido')).not.toBeInTheDocument())
    expect(screen.getByText('Conciliar notas')).toBeInTheDocument()
    expect(screen.getByTestId('kanban-project-filter')).toHaveTextContent('Projeto: ERP')
  })

  it('"Nova tarefa" abre o formulário completo para escolher o projeto; some sem permissão de criar', async () => {
    const first = setup({ path: '/kanban/all' })
    await screen.findByText('Conciliar notas')
    await userEvent.click(screen.getByRole('button', { name: 'Nova tarefa' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nova tarefa' })
    expect(within(dialog).getByRole('combobox', { name: /^Projeto/ })).toBeInTheDocument()
    first.unmount()

    setup({ path: '/kanban/all', getAll: () => Promise.resolve({ ...allBoard, capabilities: { move: false, create: false } }) })
    await screen.findByText('Conciliar notas')
    expect(screen.queryByRole('button', { name: 'Nova tarefa' })).not.toBeInTheDocument()
    expect(screen.getByText('Somente leitura')).toBeInTheDocument()
  })

  it('sem projetos: aviso no lugar do quadro', async () => {
    setup({ path: '/kanban/all', getAll: () => Promise.resolve({ ...allBoard, projects: [], columns: allBoard.columns.map((c) => ({ ...c, cards: [], total: 0 })) }) })
    expect(await screen.findByText('Nenhum projeto para mostrar')).toBeInTheDocument()
  })
})

describe('KanbanPage — configurador do filtro de projetos', () => {
  const listed = (id: string, key: string, status: Project['status'], myRole: Project['myRole']) => ({ id, key, name: key, status, myRole, archivedAt: null }) as Project
  // CRM: em andamento, participo · ERP: em andamento, não participo · RH: pausado, participo
  const projectList = [listed('p1', 'CRM', 'active', 'member'), listed('p2', 'ERP', 'active', null), listed('p3', 'RH', 'paused', 'owner')]

  it('"Todos os projetos" pede à API só os projetos permitidos', async () => {
    const { getAll } = setup({ path: '/kanban/all', projectList, projectFilter: { statuses: ['active'], membersOnly: true } })
    await screen.findByText('Conciliar notas')
    expect(getAll).toHaveBeenCalledTimes(1)
    expect(getAll).toHaveBeenCalledWith(['p1'])
    // engrenagem ao lado do filtro de projetos, marcada como ativa
    expect(screen.getAllByRole('button', { name: 'Configurar filtro de projetos (ativo nesta tela)' })).toHaveLength(1)
    // a lista do filtro de projetos também respeita a configuração (ERP está no quadro, mas não participo)
    await userEvent.click(screen.getByTestId('kanban-project-filter'))
    expect(await screen.findByRole('menuitemcheckbox', { name: 'CRM · CRM Corporativo' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemcheckbox', { name: /ERP/ })).not.toBeInTheDocument()
  })

  it('sem configuração, o quadro de todos não restringe', async () => {
    const { getAll } = setup({ path: '/kanban/all', projectList })
    await screen.findByText('Conciliar notas')
    expect(getAll).toHaveBeenCalledWith(undefined)
  })

  it('nenhum projeto atende: avisa sem pedir o quadro', async () => {
    const { getAll } = setup({ path: '/kanban/all', projectList, projectFilter: { statuses: ['cancelled'], membersOnly: false } })
    expect(await screen.findByText('Nenhum projeto atende ao filtro desta tela')).toBeInTheDocument()
    expect(getAll).not.toHaveBeenCalled()
    // sem a barra de filtros, a engrenagem fica no aviso
    expect(screen.getByRole('button', { name: 'Configurar filtro de projetos (ativo nesta tela)' })).toBeInTheDocument()
  })
})
