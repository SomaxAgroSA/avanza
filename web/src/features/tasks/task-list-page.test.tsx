import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { TaskRepository } from '@/domain/repositories'
import { OPEN_TASK_CATEGORIES, type TaskSummary } from '@/domain/tasks'
import type { TaskPriority, TaskStatus } from '@/domain/workflow'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { TasksPage } from './TasksPage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
beforeEach(() => {
  window.localStorage.removeItem('kamban.table.task-list')
  window.localStorage.removeItem('avanza.tasks.mineFirst')
})

function lookup<T extends TaskStatus | TaskPriority>(overrides: Partial<T>): T {
  return { id: 'x', key: 'X', name: 'X', description: '', color: 'gray', order: 0, isActive: true, isDefault: false, createdAt: null, updatedAt: null, ...overrides } as T
}
const backlog = lookup<TaskStatus>({ id: 's1', key: 'BACKLOG', name: 'Backlog', category: 'backlog', isDefault: true })
const done = lookup<TaskStatus>({ id: 's9', key: 'DONE', name: 'Concluído', category: 'done', order: 9 })
const alta = lookup<TaskPriority>({ id: 'p1', key: 'ALTA', name: 'Alta', color: 'orange' })
const media = lookup<TaskPriority>({ id: 'p2', key: 'MEDIA', name: 'Média', color: 'amber', order: 1, isDefault: true })

const task = (overrides: Partial<TaskSummary>): TaskSummary =>
  ({
    id: 'k1',
    code: 'OYMA-1',
    number: 1,
    title: 'Crear un MCP para conexión',
    project: { id: 'p1', key: 'OYMA', name: 'Optimización y mejoras' },
    type: { id: 't1', key: 'BUG', name: 'Bug', icon: 'bug', color: 'red' },
    status: { id: 's1', key: 'BACKLOG', name: 'Backlog', color: 'gray', category: 'backlog' },
    priority: { id: 'p2', key: 'MEDIA', name: 'Média', color: 'amber' },
    assignee: { id: 'u1', name: 'Ana Souza', email: 'ana@kamban.test', avatarUrl: null },
    dueDate: new Date('2026-01-10T00:00:00Z'),
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-02T10:00:00Z'),
    tags: [],
    checklistProgress: { done: 0, total: 0 },
    commentCount: 0,
    attachmentCount: 0,
    subtaskProgress: { done: 0, total: 0 },
    blocked: false,
    inReport: true,
    itVisible: false,
    urgency: null,
    area: null,
    planItem: null,
    ...overrides,
  }) as TaskSummary

const mine = task({})
const other = task({ id: 'k2', code: 'ADP-1', title: 'Unir la base de clientes', assignee: null, dueDate: null })

/** As contagens pedem uma linha só (perPage 1); a tabela, a página. */
function setup(permissions = ['tasks.view', 'tasks.list', 'tasks.create', 'projects.view'] as Parameters<typeof makeCurrentUser>[0]) {
  const list = vi.fn<TaskRepository['list']>((query) => {
    const total = query.filters.assignee === 'me' ? 3 : 12
    if (query.perPage === 1) return Promise.resolve({ items: [], page: 1, perPage: 1, total, totalPages: total })
    const items = query.filters.assignee === 'me' ? [mine] : [mine, other]
    return Promise.resolve({ items, page: 1, perPage: 20, total: items.length, totalPages: 1 })
  })
  renderRoutes([{ path: '/tasks', element: <TasksPage /> }], {
    repositories: fakeRepositories({
      auth: { me: async () => makeCurrentUser(permissions) },
      statuses: { list: () => Promise.resolve([backlog, done]) },
      priorities: { list: () => Promise.resolve([alta, media]) },
      areas: { list: () => Promise.resolve([]) },
      tasks: { list },
    }),
    initialPath: '/tasks',
  })
  const tableCalls = () => list.mock.calls.filter(([query]) => query.perPage !== 1)
  return { list, tableCalls }
}

describe('Lista de tarefas do menu (§42)', () => {
  it('abre em "Minhas tarefas": pede assignee_id=me, só as abertas, pelo prazo; mostra quantas abertas há em cada escopo', async () => {
    const { tableCalls } = setup()
    expect(await screen.findByRole('heading', { name: 'Tarefas' })).toBeInTheDocument()
    expect(screen.getByText(i18n.t('taskList.subtitle'))).toBeInTheDocument()
    const scope = screen.getByRole('radiogroup', { name: i18n.t('taskList.scopeLabel') })
    const mineOption = within(scope).getByRole('radio', { name: /Minhas tarefas/ })
    expect(mineOption).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(mineOption).toHaveTextContent('Minhas tarefas3'))
    expect(within(scope).getByRole('radio', { name: /Ver todas/ })).toHaveTextContent('Ver todas12')
    await screen.findByText(mine.title)
    const [query, options] = tableCalls().at(-1)!
    expect(query.filters).toEqual({ assignee: 'me', category: OPEN_TASK_CATEGORIES })
    expect(query.sort).toEqual({ id: 'due_date', direction: 'asc' })
    // sem "Minhas tarefas primeiro": o escopo substitui
    expect(options).toEqual({})
    expect(screen.queryByRole('button', { name: i18n.t('tasks.mine.toggle') })).not.toBeInTheDocument()
  })

  it('"Ver todas" tira o responsável (todas as dos projetos que vê), ordena pelas mais recentes e volta a "Minhas" a cada entrada', async () => {
    const { tableCalls } = setup()
    await screen.findByText(mine.title)
    await userEvent.click(screen.getByRole('radio', { name: /Ver todas/ }))
    expect(await screen.findByText(other.title)).toBeInTheDocument()
    const [query] = tableCalls().at(-1)!
    expect(query.filters).toEqual({ category: OPEN_TASK_CATEGORIES })
    expect(query.sort).toEqual({ id: 'updated_at', direction: 'desc' })
    // sem responsável
    expect(screen.getByText(i18n.t('tasks.unassigned'))).toBeInTheDocument()
  })

  it('colunas Tarefa (título e código), Projeto, Status, Responsável, Prioridade, Urgência e Prazo; prazo vencido em vermelho com "vencida"', async () => {
    setup()
    await screen.findByText(mine.title)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim() ?? '')
    expect(headers.slice(0, 7).map((h) => h.replace(/[↑↓↕]/g, '').trim())).toEqual(['Tarefa', 'Projeto', 'Status', 'Responsável', 'Prioridade', 'Urgência', 'Prazo'])
    expect(screen.getByText(mine.code)).toBeInTheDocument()
    expect(screen.getByText(mine.project!.name)).toBeInTheDocument()
    expect(screen.getByText(`· ${i18n.t('taskList.overdue')}`)).toBeInTheDocument()
  })

  it('barra como a das listas de projetos: Status (seletor), Prioridade e Urgência em botões; sem Responsável', async () => {
    const { tableCalls } = setup()
    await screen.findByText(mine.title)
    expect(screen.getAllByRole('combobox').map((c) => c.getAttribute('aria-label'))).toEqual(['Status', 'Por página'])
    const priority = screen.getByRole('group', { name: 'Prioridade' })
    await userEvent.click(within(priority).getByRole('button', { name: 'Alta' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Urgência' })).getByRole('button', { name: 'Sem urgência' }))
    await waitFor(() => expect(tableCalls().at(-1)![0].filters).toEqual({ priority: 'p1', urgency: 'none', assignee: 'me', category: OPEN_TASK_CATEGORIES }))
  })

  it('escolher um Status mostra esse status (inclusive encerrado): sai o "só abertas"', async () => {
    const { tableCalls } = setup()
    await screen.findByText(mine.title)
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Concluído' }))
    await waitFor(() => expect(tableCalls().at(-1)![0].filters).toEqual({ status: 's9', assignee: 'me' }))
  })

  it('um Responsável (ou Área) guardado no navegador não filtra escondido', async () => {
    window.localStorage.setItem('kamban.table.task-list', JSON.stringify({ filters: { assignee: 'u9', area: 'a1', urgency: 'high' } }))
    const { tableCalls } = setup()
    await screen.findByText(mine.title)
    tableCalls().forEach(([query]) => expect(query.filters).toEqual({ urgency: 'high', assignee: 'me', category: OPEN_TASK_CATEGORIES }))
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('kamban.table.task-list') ?? '{}').filters).toEqual({ urgency: 'high' }))
  })
})
