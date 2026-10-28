import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { AppError } from '@/core/errors/app-error'
import type { Board, BoardCard } from '@/domain/kanban'
import type { ProjectMember } from '@/domain/projects'
import type { BoardRepository, TaskRepository } from '@/domain/repositories'
import type { CustomField, TaskType, TaskTypeDetail } from '@/domain/task-config'
import type { TaskDetail } from '@/domain/tasks'
import type { TaskPriority, TaskStatus } from '@/domain/workflow'
import { fakeRepositories, makeCurrentUser, renderRoutes, typeTexts } from '@/test/utils'
import { KanbanPage } from './KanbanPage'

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
  path = '/kanban/p1',
  get = vi.fn<BoardRepository['get']>(() => Promise.resolve(data)),
  getAll = vi.fn<BoardRepository['getAll']>(() => Promise.resolve(allBoard)),
  move = vi.fn<BoardRepository['move']>(() => Promise.resolve(detail)),
}: { data?: Board; create?: TaskRepository['create']; type?: TaskTypeDetail; path?: string; get?: BoardRepository['get']; getAll?: BoardRepository['getAll']; move?: BoardRepository['move'] } = {}) {
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(['kanban.view', 'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'projects.view'], 'ADMIN') },
    board: { get, getAll, move },
    taskTypes: { list: () => Promise.resolve([bugType]), get: () => Promise.resolve(type) },
    statuses: { list: () => Promise.resolve([todo, doing]) },
    priorities: { list: () => Promise.resolve([alta]) },
    projects: {
      listMembers: () => Promise.resolve(members),
      list: () => Promise.resolve({ items: [], page: 1, perPage: 100, total: 0, totalPages: 0 }),
    },
    tasks: { create, get: () => Promise.resolve(detail) },
  })
  const utils = renderRoutes(
    [
      { path: '/kanban', element: <KanbanPage /> },
      { path: '/kanban/:projectId', element: <KanbanPage /> },
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
    // lembra o quadro para a próxima visita a /kanban
    await waitFor(() => expect(window.localStorage.getItem('kamban.kanban.project')).toBe('p1'))
  })

  it('/kanban sem escolha abre todos os projetos; com quadro lembrado, abre direto', async () => {
    const first = setup({ path: '/kanban' })
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/kanban/all'))
    expect(await screen.findByText('Conciliar notas')).toBeInTheDocument()
    await waitFor(() => expect(window.localStorage.getItem('kamban.kanban.project')).toBe('all'))
    first.unmount()

    window.localStorage.setItem('kamban.kanban.project', 'p1')
    const { router } = setup({ path: '/kanban' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/kanban/p1'))
    expect(await screen.findByText('Erro ao salvar pedido')).toBeInTheDocument()
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

  it('sem acesso ao projeto: aviso e esquece o quadro lembrado', async () => {
    window.localStorage.setItem('kamban.kanban.project', 'p1')
    setup({ get: () => Promise.reject(new AppError({ code: 'PROJECT_NOT_FOUND', message: 'x', status: 404 })) })
    expect(await screen.findByText('Quadro não encontrado ou você não tem acesso a este projeto.')).toBeInTheDocument()
    await waitFor(() => expect(window.localStorage.getItem('kamban.kanban.project')).toBeNull())
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
