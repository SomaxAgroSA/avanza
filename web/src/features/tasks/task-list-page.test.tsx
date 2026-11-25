import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { TaskRepository } from '@/domain/repositories'
import { OPEN_TASK_CATEGORIES, type TaskSummary } from '@/domain/tasks'
import type { TaskPriority, TaskStatus } from '@/domain/workflow'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import type { ScreenKey } from '@/domain/screens'
import { TasksPage } from './TasksPage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
beforeEach(() => {
  window.localStorage.removeItem('kamban.table.task-list')
  window.localStorage.removeItem('avanza.tasks.mineFirst')
  window.localStorage.removeItem('avanza.taskList.scope.u1')
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
function setup(permissions = ['tasks.view', 'tasks.list', 'tasks.create', 'tasks.edit', 'tasks.delete', 'projects.view'] as Parameters<typeof makeCurrentUser>[0], initialPath = '/tasks', items?: TaskSummary[]) {
  const list = vi.fn<TaskRepository['list']>((query) => {
    const total = query.filters.mine === 'true' ? 3 : 12
    if (query.perPage === 1) return Promise.resolve({ items: [], page: 1, perPage: 1, total, totalPages: total })
    const rows = items ?? (query.filters.mine === 'true' ? [mine] : [mine, other])
    return Promise.resolve({ items: rows, page: 1, perPage: 20, total: rows.length, totalPages: 1 })
  })
  renderRoutes([{ path: '/tasks', element: <TasksPage /> }], {
    repositories: fakeRepositories({
      auth: { me: async () => makeCurrentUser(permissions) },
      statuses: { list: () => Promise.resolve([backlog, done]) },
      priorities: { list: () => Promise.resolve([alta, media]) },
      areas: { list: () => Promise.resolve([]) },
      tasks: { list },
    }),
    initialPath,
  })
  const tableCalls = () => list.mock.calls.filter(([query]) => query.perPage !== 1)
  return { list, tableCalls }
}

describe('Lista — Tarefas do perfil (ajuste 23/11)', () => {
  function setupViews(hidden: ScreenKey[], initialPath = '/tasks') {
    const list = vi.fn<TaskRepository['list']>((query) => Promise.resolve({ items: query.perPage === 1 ? [] : [mine], page: 1, perPage: 20, total: 1, totalPages: 1 }))
    const current = makeCurrentUser(['tasks.view', 'tasks.list', 'projects.view', 'projects.view_all'])
    renderRoutes(
      [
        { path: '/tasks', element: <TasksPage /> },
        { path: '/tasks/demands', element: <p>Caixa de entrada aberta</p> },
      ],
      {
        repositories: fakeRepositories({
          auth: { me: async () => ({ ...current, role: current.role && { ...current.role, screens: { hidden, starts: {} } } }) },
          statuses: { list: () => Promise.resolve([backlog, done]) },
          priorities: { list: () => Promise.resolve([alta, media]) },
          areas: { list: () => Promise.resolve([]) },
          tasks: { list },
        }),
        initialPath,
      },
    )
    return { list }
  }

  it('"Só as suas tarefas" (§48, tasks.scopes.all escondido): sem "Ver todas" (nem por ?scope=all), mesmo vendo todos os projetos; só pede mine=true', async () => {
    const { list } = setupViews(['tasks.scopes.all'], '/tasks?scope=all')
    // a sessão (com o perfil) chega depois da primeira pintura; com um alcance só, sem botões: o nome com o número
    await waitFor(() => expect(screen.getByTestId('task-scope-title').textContent?.replace(/\d+$/, '')).toBe('Minhas tarefas'))
    expect(screen.queryByRole('radiogroup', { name: i18n.t('taskList.scopeLabel') })).toBeNull()
    // a tabela, já com o perfil, pede só as dela
    await waitFor(() => expect(list.mock.calls.filter(([query]) => query.perPage !== 1).at(-1)?.[0].filters.mine).toBe('true'))
  })

  it('Lista oculta: /tasks leva à Caixa de entrada', async () => {
    setupViews(['tasks.screens.list'])
    expect(await screen.findByText('Caixa de entrada aberta')).toBeInTheDocument()
  })
})

describe('Lista de tarefas do menu (§44)', () => {
  it('abre em "Minhas tarefas": pede mine=true (atribuídas e demandas pedidas ou recebidas, §45), só as abertas, pelo prazo; mostra quantas abertas há em cada escopo', async () => {
    const { tableCalls } = setup()
    expect(await screen.findByRole('heading', { name: 'Tarefas' })).toBeInTheDocument()
    const scope = screen.getByRole('radiogroup', { name: i18n.t('taskList.scopeLabel') })
    const mineOption = within(scope).getByRole('radio', { name: /Minhas tarefas/ })
    expect(mineOption).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(mineOption).toHaveTextContent('Minhas tarefas3'))
    expect(within(scope).getByRole('radio', { name: /Ver todas/ })).toHaveTextContent('Ver todas12')
    await screen.findByText(mine.title)
    const [query, options] = tableCalls().at(-1)!
    expect(query.filters).toEqual({ mine: 'true', category: OPEN_TASK_CATEGORIES })
    expect(query.sort).toEqual({ id: 'due_date', direction: 'asc' })
    // sem "Minhas tarefas primeiro": o escopo substitui
    expect(options).toEqual({})
    expect(screen.queryByRole('button', { name: i18n.t('tasks.mine.toggle') })).not.toBeInTheDocument()
  })

  it('"Ver todas" tira o responsável (todas as dos projetos que vê), ordena pelas mais recentes e fica guardado para a próxima entrada', async () => {
    const { tableCalls } = setup()
    await screen.findByText(mine.title)
    await userEvent.click(screen.getByRole('radio', { name: /Ver todas/ }))
    expect(await screen.findByText(other.title)).toBeInTheDocument()
    const [query] = tableCalls().at(-1)!
    expect(query.filters).toEqual({ category: OPEN_TASK_CATEGORIES })
    expect(query.sort).toEqual({ id: 'updated_at', direction: 'desc' })
    // sem responsável
    expect(screen.getByText(i18n.t('tasks.unassigned'))).toBeInTheDocument()
    expect(window.localStorage.getItem('avanza.taskList.scope.u1')).toBe('"all"')
  })

  it('colunas Tarefa (só o título, sem o código), Projeto, Status, Responsável, Atribuída a, Prioridade, Urgência e Prazo; prazo vencido em vermelho com "vencida"', async () => {
    setup()
    await screen.findByText(mine.title)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim() ?? '')
    expect(headers.slice(0, 8).map((h) => h.replace(/[↑↓↕]/g, '').trim())).toEqual(['Tarefa', 'Projeto', 'Status', 'Responsável', 'Atribuída a', 'Prioridade', 'Urgência', 'Prazo'])
    // o código fica na página da tarefa (e continua na busca)
    expect(screen.queryByText(mine.code)).not.toBeInTheDocument()
    expect(screen.getByText(mine.project!.name)).toBeInTheDocument()
    expect(screen.getByText(`· ${i18n.t('taskList.overdue')}`)).toBeInTheDocument()
  })

  it('barra (ajuste 24/11): os seletores juntos — Status, Empresa, Responsável e Atribuída a — e depois Prioridade e Urgência em botões', async () => {
    const { tableCalls } = setup()
    await screen.findByText(mine.title)
    // Prioridade e Urgência também têm o seletor compacto, que só aparece com a barra apertada (AppToolbar)
    expect(screen.getAllByRole('combobox').map((c) => c.getAttribute('aria-label'))).toEqual(['Status', 'Empresa', 'Prioridade', 'Urgência', 'Por página'])
    // os dois filtros de pessoa são menus (várias ao mesmo tempo), logo depois de Status e Empresa
    const bar = screen.getByRole('searchbox').closest<HTMLElement>('[data-toolbar]')!
    const names = within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(names.indexOf('Responsável')).toBeGreaterThan(-1)
    expect(names.indexOf('Atribuída a')).toBe(names.indexOf('Responsável') + 1)
    expect(screen.getByRole('combobox', { name: 'Prioridade' }).parentElement).toHaveClass('hidden')
    const priority = screen.getByRole('group', { name: 'Prioridade' })
    await userEvent.click(within(priority).getByRole('button', { name: 'Alta' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Urgência' })).getByRole('button', { name: 'Sem urgência' }))
    await waitFor(() => expect(tableCalls().at(-1)![0].filters).toEqual({ priority: 'p1', urgency: 'none', mine: 'true', category: OPEN_TASK_CATEGORIES }))
  })

  it('filtros novos (24/11): Atribuída a na barra (com "Sem atribuir") e o Prazo em grupos no funil da coluna; o nome quebra em duas linhas', async () => {
    const { tableCalls } = setup()
    await screen.findByText(mine.title)
    await userEvent.click(screen.getByRole('button', { name: 'Atribuída a' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Atribuída a' })).getByRole('button', { name: 'Sem atribuir' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar Prazo' }))
    const due = await screen.findByRole('dialog', { name: 'Filtrar Prazo' })
    expect(within(due).getAllByRole('button', { pressed: false }).map((b) => b.textContent)).toEqual(['Vencidas', 'Hoje', 'Próximos 7 dias', 'Mais adiante', 'Sem prazo'])
    await userEvent.click(within(due).getByRole('button', { name: 'Vencidas' }))
    await waitFor(() => expect(tableCalls().at(-1)![0].filters).toEqual({ assignee: 'none', due_date: 'overdue', mine: 'true', category: OPEN_TASK_CATEGORIES }))
    // o funil da coluna Tarefa é a busca; o nome quebra em até duas linhas (a coluna se ajusta)
    expect(screen.getByRole('button', { name: 'Filtrar Tarefa' })).toBeInTheDocument()
    expect(screen.getByText(mine.title)).toHaveClass('line-clamp-2')
  })

  it('escolher um Status mostra esse status (inclusive encerrado): sai o "só abertas"', async () => {
    const { tableCalls } = setup()
    await screen.findByText(mine.title)
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Concluído' }))
    await waitFor(() => expect(tableCalls().at(-1)![0].filters).toEqual({ status: 's9', mine: 'true' }))
  })

  it('um filtro que não é da Lista (Área, Tipo) guardado no navegador não filtra escondido', async () => {
    window.localStorage.setItem('kamban.table.task-list', JSON.stringify({ filters: { type: 't1', area: 'a1', urgency: 'high' } }))
    const { tableCalls } = setup()
    await screen.findByText(mine.title)
    tableCalls().forEach(([query]) => expect(query.filters).toEqual({ urgency: 'high', mine: 'true', category: OPEN_TASK_CATEGORIES }))
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('kamban.table.task-list') ?? '{}').filters).toEqual({ urgency: 'high' }))
  })
})

describe('Lista de tarefas do menu — tela limpa (ajustes 20/11)', () => {
  it('sem textos de ajuda; linha 1: visões, escopo e os botões de criar (sem Com/Sem projeto, 25/11); linha 2: busca, filtros e "Colunas e ações"', async () => {
    setup()
    await screen.findByText(mine.title)
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Status: Abertas')
    expect(screen.queryByText(/Só as abertas/)).not.toBeInTheDocument()
    expect(screen.queryByText(/inclui as demandas que você pediu/)).not.toBeInTheDocument()
    // o cabeçalho fica só com o título
    const heading = screen.getByRole('heading', { name: 'Tarefas' })
    expect(heading.parentElement!.parentElement!.querySelectorAll('button')).toHaveLength(0)
    const row = screen.getByRole('navigation', { name: i18n.t('taskList.viewLabel') }).parentElement!
    expect(row).toHaveClass('flex-nowrap')
    expect(within(row).getByRole('radiogroup', { name: i18n.t('taskList.scopeLabel') })).toBeInTheDocument()
    expect(within(row).getAllByRole('radiogroup')).toHaveLength(1)
    expect(within(row).queryByRole('radio', { name: 'Com projeto' })).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Tarefa de projeto' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Demanda interna' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Colunas e ações' })).not.toBeInTheDocument()
    const filters = screen.getByRole('searchbox').closest<HTMLElement>('[data-toolbar]')!
    expect(filters).toHaveClass('flex-nowrap')
    expect(await within(filters).findByRole('button', { name: 'Colunas e ações' })).toBeInTheDocument()
    expect(within(filters).getByRole('combobox', { name: 'Status' })).toBeInTheDocument()
  })

  it('linha apertada: os botões de criar têm o texto curto (o CSS escolhe) e o nome inteiro no aria-label; os números do escopo somem', async () => {
    setup()
    await screen.findByText(mine.title)
    const project = screen.getByRole('button', { name: 'Tarefa de projeto' })
    expect(within(project).getByText('Tarefa de projeto')).toHaveClass('@max-[1060px]:hidden')
    expect(within(project).getByText('Tarefa')).toHaveClass('hidden', '@max-[1060px]:inline')
    expect(within(screen.getByRole('button', { name: 'Demanda interna' })).getByText('Demanda')).toHaveClass('hidden')
    const mineOption = within(screen.getByRole('radiogroup', { name: i18n.t('taskList.scopeLabel') })).getByRole('radio', { name: /Minhas/ })
    expect(await within(mineOption).findByText('3')).toHaveClass('@max-[960px]:hidden')
    const columns = await screen.findByRole('button', { name: 'Colunas e ações' })
    expect(columns).toHaveAttribute('title', 'Colunas e ações')
    expect(within(columns).getByText('Colunas e ações')).toHaveClass('@max-[1150px]:hidden')
  })

  it('cada linha: Visualizar, Editar e ··· (Excluir fica no ···); checklist só enquanto incompleto; sem contador de comentários', async () => {
    const pending = task({ checklistProgress: { done: 0, total: 8 }, commentCount: 5 })
    const complete = task({ id: 'k3', code: 'OYMA-3', title: 'Checklist pronto', checklistProgress: { done: 8, total: 8 }, commentCount: 2 })
    setup(undefined, '/tasks', [pending, complete])
    await screen.findByText(pending.title)
    expect(screen.getAllByRole('button', { name: 'Visualizar' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    expect(screen.getAllByText('0/8')).toHaveLength(1)
    expect(screen.queryByText('8/8')).not.toBeInTheDocument()
    expect(screen.queryByText('5')).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Mais ações' })[0]!)
    expect(await screen.findByRole('menuitem', { name: 'Excluir' })).toBeInTheDocument()
  })

  it('Responsável = quem recebe e distribui (ou a pessoa atribuída); Atribuída a = quem executa, "Sem atribuir" enquanto ninguém pegou', async () => {
    const cesar = { id: 'u7', name: 'César TI', email: 'cesar@kamban.test', avatarUrl: null }
    const waiting = task({
      id: 'k4',
      title: 'Ajustar a vista de cartera',
      assignee: null,
      demand: { status: 'unassigned', owner: cesar, dueAt: null, openedAt: null },
    })
    setup(undefined, '/tasks', [mine, waiting])
    await screen.findByText(waiting.title)
    const row = screen.getByText(waiting.title).closest('tr')!
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent?.trim())
    expect(cells[3]).toMatch(/César TI$/)
    expect(cells[4]).toBe('Sem atribuir')
    const normal = screen.getByText(mine.title).closest('tr')!
    const normalCells = within(normal).getAllByRole('cell').map((c) => c.textContent?.trim())
    expect(normalCells[3]).toMatch(/Ana Souza$/)
    expect(normalCells[4]).toMatch(/Ana Souza$/)
  })

  it('"Atribuída a" tem a mesma largura de "Responsável" (nome e sobrenome inteiros), mesmo com uma largura menor guardada', async () => {
    window.localStorage.setItem('kamban.table.task-list', JSON.stringify({ columnSizing: { assignee: 110 } }))
    setup()
    await screen.findByText(mine.title)
    const responsible = screen.getByRole('columnheader', { name: /^Responsável/ })
    const assigned = screen.getByRole('columnheader', { name: /^Atribuída a/ })
    expect(assigned.style.width).toBe(responsible.style.width)
    expect(assigned.style.minWidth).toBe(responsible.style.minWidth)
    expect(parseInt(assigned.style.width, 10)).toBeGreaterThanOrEqual(200)
  })

  it('quem vê todos os projetos abre em "Ver todas"; a última escolha fica guardada por pessoa', async () => {
    const { tableCalls } = setup(['tasks.view', 'tasks.list', 'projects.view', 'projects.view_all'])
    await screen.findByText(other.title)
    expect(screen.getByRole('radio', { name: /Ver todas/ })).toHaveAttribute('aria-checked', 'true')
    expect(tableCalls().at(-1)![0].filters).toEqual({ category: OPEN_TASK_CATEGORIES })
  })

  it('a escolha guardada vale na próxima entrada (mesmo para quem vê tudo)', async () => {
    window.localStorage.setItem('avanza.taskList.scope.u1', JSON.stringify('mine'))
    setup(['tasks.view', 'tasks.list', 'projects.view', 'projects.view_all'])
    await screen.findByText(mine.title)
    expect(screen.getByRole('radio', { name: /Minhas tarefas/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('/tasks?scope=all (Ctrl K → Buscar tarefa) busca em todas', async () => {
    const { tableCalls } = setup(undefined, '/tasks?scope=all&search=Unir')
    await waitFor(() => expect(tableCalls().at(-1)![0]).toMatchObject({ search: 'Unir', filters: { category: OPEN_TASK_CATEGORIES } }))
    expect(screen.getByRole('radio', { name: /Ver todas/ })).toHaveAttribute('aria-checked', 'true')
  })
})
