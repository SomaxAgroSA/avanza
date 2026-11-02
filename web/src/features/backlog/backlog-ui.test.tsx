import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { BacklogView } from '@/domain/backlog'
import type { Sprint } from '@/domain/sprints'
import type { BacklogRepository, BoardRepository, SprintRepository } from '@/domain/repositories'
import type { TaskDetail, TaskSummary } from '@/domain/tasks'
import type { TaskPriority, TaskStatus } from '@/domain/workflow'
import { notify } from '@/presentation/components'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { ProjectPlanningPage } from './BacklogPage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
beforeEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

/** Mensagens enviadas ao toast (o contêiner não é montado nos testes). */
function toasts() {
  const spy = vi.spyOn(notify, 'success')
  return () => spy.mock.calls.map((call) => call[0])
}

const lookup = <T extends TaskStatus | TaskPriority>(overrides: Partial<T>): T =>
  ({ id: 'x', key: 'X', name: 'X', description: '', color: 'gray', order: 0, isActive: true, isDefault: false, createdAt: null, updatedAt: null, ...overrides }) as T
const backlogStatus = lookup<TaskStatus>({ id: 's0', key: 'BACKLOG', name: 'Backlog', category: 'backlog', isDefault: true, allowedNext: [] })
const todo = lookup<TaskStatus>({ id: 's1', key: 'TODO', name: 'A fazer', category: 'todo', order: 1 })
const dev = lookup<TaskStatus>({ id: 's2', key: 'DEV', name: 'Desenvolvimento', category: 'in_progress', order: 2 })
const alta = lookup<TaskPriority>({ id: 'p1', key: 'ALTA', name: 'Alta', color: 'orange', isDefault: true })

const sprint: Sprint = {
  id: 'c1',
  name: 'Sprint 1',
  state: 'active',
  projectId: 'p1',
  goal: 'Checkout estável',
  startDate: '2026-10-01',
  endDate: '2026-10-14',
  order: 1,
  createdAt: null,
  updatedAt: null,
}

function item(id: string, title: string, extra: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    code: `CRM-${id}`,
    number: Number(id),
    title,
    project: { id: 'p1', key: 'CRM', name: 'CRM' },
    type: { id: 't1', key: 'BUG', name: 'Bug', icon: 'bug', color: 'red' },
    status: { id: 's0', key: 'BACKLOG', name: 'Backlog', color: 'gray', category: 'backlog' },
    priority: { id: 'p1', key: 'ALTA', name: 'Alta', color: 'orange' },
    sprint: null,
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
    ...extra,
  }
}

const view: BacklogView = {
  project: { id: 'p1', key: 'CRM', name: 'CRM Corporativo', archived: false },
  capabilities: { rank: true, create: true, manageSprints: true },
  statuses: [
    { id: 's0', key: 'BACKLOG', name: 'Backlog', color: 'gray', category: 'backlog', isDefault: true },
    { id: 's1', key: 'TODO', name: 'A fazer', color: 'gray', category: 'todo', isDefault: false },
  ],
  sprints: [sprint],
  items: [
    item('1', 'Erro ao salvar pedido', { sprint: { id: 'c1', name: 'Sprint 1', state: 'active' }, estimatedHours: 3 }),
    item('2', 'Ajustar relatório de vendas', { estimatedHours: 2.5 }),
    item('3', 'Nova tela de login'),
    item('4', 'Relatório analisado', { status: { id: 's1', key: 'TODO', name: 'A fazer', color: 'gray', category: 'todo' } }),
  ],
  truncated: false,
}

const moved = (id: string) => ({ ...item(id, 'x'), description: '', customValues: {}, checklist: [], fields: [], parent: null, forkedFrom: null, capabilities: { edit: true, delete: false, assign: true, comment: true, link: true, fork: true } }) as TaskDetail

function setup({
  data = view,
  path = '/projects/p1/planning',
  move = vi.fn<BoardRepository['move']>((id) => Promise.resolve(moved(id))),
  rank = vi.fn<BacklogRepository['rank']>((id) => Promise.resolve(moved(id))),
  sprints = {},
}: { data?: BacklogView; path?: string; move?: BoardRepository['move']; rank?: BacklogRepository['rank']; sprints?: Partial<SprintRepository> } = {}) {
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(['tasks.view', 'tasks.create', 'tasks.edit', 'projects.view', 'projects.edit'], 'ADMIN') },
    backlog: { get: () => Promise.resolve(data), rank },
    board: { move },
    sprints: { list: () => Promise.resolve(data.sprints), ...sprints },
    statuses: { list: () => Promise.resolve([backlogStatus, todo, dev]) },
    priorities: { list: () => Promise.resolve([alta]) },
    projects: {
      listMembers: () => Promise.resolve([]),
      list: () => Promise.resolve({ items: [], page: 1, perPage: 100, total: 0, totalPages: 0 }),
    },
  })
  const utils = renderRoutes([{ path: '/projects/:projectId/planning', element: <ProjectPlanningPage /> }], { repositories, initialPath: path })
  return { ...utils, move, rank }
}

async function openItemMenu(code: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Ações de ${code}` }))
  return screen.findByRole('menu')
}

describe('Planejamento (aba Tarefas do projeto)', () => {
  it('agrupa por sprint (com período, situação e estimativa) e deixa "sem sprint" por último', async () => {
    setup()
    const sprintGroup = await screen.findByTestId('backlog-group-c1')
    expect(within(sprintGroup).getByRole('heading', { name: 'Sprint 1' })).toBeInTheDocument()
    expect(within(sprintGroup).getByText('Ativa')).toBeInTheDocument()
    expect(within(sprintGroup).getByText('Checkout estável')).toBeInTheDocument()
    expect(within(sprintGroup).getByText('1 tarefa · 3 h')).toBeInTheDocument()
    expect(within(sprintGroup).getByText('Erro ao salvar pedido')).toBeInTheDocument()

    const rest = screen.getByTestId('backlog-group-none')
    expect(within(rest).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Ajustar relatório de vendas'),
      expect.stringContaining('Nova tela de login'),
      expect.stringContaining('Relatório analisado'),
    ])
    expect(within(rest).getByText(/2 sem estimativa/)).toBeInTheDocument()
    expect(screen.getByText('4 tarefas · 5,5 h estimadas')).toBeInTheDocument()
  })

  it('ativar pelo menu do item leva ao status escolhido (mesma regra do Kanban)', async () => {
    const messages = toasts()
    const { move } = setup()
    const menu = await openItemMenu('CRM-2')
    // backlog e encerrados não aparecem como destino
    expect(within(menu).queryByRole('menuitem', { name: 'Backlog' })).not.toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Desenvolvimento' }))
    await waitFor(() => expect(move).toHaveBeenCalledWith('2', { statusId: 's2' }))
    await waitFor(() => expect(messages()).toContain('CRM-2 foi para "Desenvolvimento".'))
  })

  it('planejar na sprint pelo menu e em lote', async () => {
    const messages = toasts()
    const { rank, move } = setup()
    let menu = await openItemMenu('CRM-2')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Sprint 1' }))
    await waitFor(() => expect(rank).toHaveBeenCalledWith('2', { prevId: undefined, nextId: undefined, sprintId: 'c1' }))

    menu = await openItemMenu('CRM-1')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Tirar da sprint' }))
    await waitFor(() => expect(rank).toHaveBeenLastCalledWith('1', { prevId: undefined, nextId: undefined, sprintId: null }))

    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar CRM-2' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar CRM-3' }))
    const bulk = screen.getByRole('region', { name: 'Ações nas tarefas selecionadas' })
    expect(within(bulk).getByText('2 selecionadas')).toBeInTheDocument()
    await userEvent.click(within(bulk).getByRole('button', { name: 'Mover para' }))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'A fazer' }))
    await waitFor(() => expect(move).toHaveBeenCalledTimes(2))
    expect(move).toHaveBeenCalledWith('3', { statusId: 's1' })
    await waitFor(() => expect(messages()).toContain('2 tarefas foram para "A fazer".'))
  })

  it('gestor cria sprint com período validado e encerra com confirmação', async () => {
    const create = vi.fn<SprintRepository['create']>((_p, d) => Promise.resolve({ ...sprint, id: 'c2', name: d.name, state: 'planned' }))
    const update = vi.fn<SprintRepository['update']>(() => Promise.resolve({ ...sprint, state: 'closed', returnedCount: 1 }))
    const messages = toasts()
    setup({ sprints: { create, update } })
    await userEvent.click(await screen.findByRole('button', { name: 'Nova sprint' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    expect(within(dialog).getByText('Campo obrigatório')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(/^Nome/), 'Sprint 2')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith('p1', { name: 'Sprint 2', goal: '', startDate: null, endDate: null }))

    await userEvent.click(await screen.findByRole('button', { name: 'Ações da sprint Sprint 1' }))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Encerrar sprint' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(/voltam para "Sem sprint"/)).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole('button', { name: 'Encerrar sprint' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('c1', { state: 'closed' }))
    await waitFor(() => expect(messages()).toContain('Sprint "Sprint 1" encerrada. 1 tarefa não concluída voltou para "Sem sprint".'))
  })

  it('leitor: sem arrastar, sem ações de planejamento e sem criar', async () => {
    setup({ data: { ...view, capabilities: { rank: false, create: false, manageSprints: false } } })
    await screen.findByText('Erro ao salvar pedido')
    expect(screen.queryByRole('button', { name: /^Arrastar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nova sprint' })).not.toBeInTheDocument()
    expect(screen.getByText('Somente leitura')).toBeInTheDocument()
    const menu = await openItemMenu('CRM-1')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Abrir tarefa'])
  })

  it('ordenação diferente da manual desliga o arraste; filtros só escondem', async () => {
    setup()
    expect(await screen.findAllByRole('button', { name: /^Arrastar/ })).toHaveLength(4)
    await userEvent.click(screen.getByRole('combobox', { name: 'Ordenar' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Maior estimativa' }))
    expect(screen.queryByRole('button', { name: /^Arrastar/ })).not.toBeInTheDocument()
    expect(screen.getByText(/volte à ordem manual/)).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText('Buscar por código ou título'), 'login')
    await waitFor(() => expect(screen.queryByText('Erro ao salvar pedido')).not.toBeInTheDocument())
    expect(within(screen.getByTestId('backlog-group-c1')).getByText('Nenhuma tarefa corresponde aos filtros.')).toBeInTheDocument()
  })

  it('dentro do projeto: sem título nem seletor de projeto; visões da aba Tarefas e as ações ao lado', async () => {
    setup()
    expect(await screen.findByRole('button', { name: 'Nova sprint' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Projeto' })).not.toBeInTheDocument()
    const views = screen.getByRole('navigation', { name: 'Visões das tarefas' })
    expect(within(views).getByRole('link', { name: 'Planejamento' })).toHaveAttribute('aria-current', 'page')
    expect(within(views).getByRole('link', { name: 'Lista' })).toHaveAttribute('href', '/projects/p1/tasks')
    // sem kanban.view, a visão Kanban não aparece
    expect(within(views).queryByRole('link', { name: 'Kanban' })).not.toBeInTheDocument()
  })

  it('tarefa já analisada aparece com o status, pode voltar ao backlog e o status filtra a lista', async () => {
    const { move } = setup()
    const row = await screen.findByTestId('backlog-item-4')
    expect(within(row).getByText('A fazer')).toBeInTheDocument()
    const menu = await openItemMenu('CRM-4')
    expect(within(menu).queryByRole('menuitem', { name: 'A fazer' })).not.toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Backlog' }))
    await waitFor(() => expect(move).toHaveBeenCalledWith('4', { statusId: 's0' }))

    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: 'A fazer' }))
    await waitFor(() => expect(screen.queryByText('Nova tela de login')).not.toBeInTheDocument())
    expect(screen.getByText('Relatório analisado')).toBeInTheDocument()
  })

  it('organizar sprints: subir/descer (ordem para todos) e recolher', async () => {
    const second: Sprint = { ...sprint, id: 'c2', name: 'Sprint 2', state: 'planned', goal: '', order: 2 }
    const reorder = vi.fn<SprintRepository['reorder']>(() => Promise.resolve([second, sprint]))
    setup({ data: { ...view, sprints: [sprint, second] }, sprints: { reorder } })
    await userEvent.click(await screen.findByRole('button', { name: 'Ações da sprint Sprint 1' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Subir' })).toHaveAttribute('data-disabled')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Descer' }))
    await waitFor(() => expect(reorder).toHaveBeenCalledWith('p1', ['c2', 'c1']))

    const group = screen.getByTestId('backlog-group-c1')
    await userEvent.click(within(group).getByRole('button', { name: 'Recolher Sprint 1' }))
    expect(within(group).queryByText('Erro ao salvar pedido')).not.toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Expandir Sprint 1' })).toHaveAttribute('aria-expanded', 'false')
  })
})
