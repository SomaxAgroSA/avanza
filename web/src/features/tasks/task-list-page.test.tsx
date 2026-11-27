import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { TaskRepository } from '@/domain/repositories'
import { OPEN_TASK_CATEGORIES, type TaskPinCounts, type TaskSummary } from '@/domain/tasks'
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
    // sem "Minhas tarefas primeiro" (o escopo substitui); as fixadas no topo (§50)
    expect(options).toEqual({ pinnedFirst: true })
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

describe('Lista — fixar no topo: para mim (§55) e para todos (§50)', () => {
  const ana = { id: 'u9', name: 'Angelica Davalos', email: 'angelica@kamban.test', avatarUrl: null }
  const pinned = task({ id: 'k5', code: 'DRE-5', title: 'Portal de acceso · subir el login', pinned: { by: ana, at: new Date(Date.now() - 5 * 60_000) } })
  const minePin = task({ id: 'k6', code: 'DRE-6', title: 'Revisar contrato do frete', pinnedMine: { at: new Date() } })
  const bothPin = task({ id: 'k7', code: 'DRE-7', title: 'Fechar o orçamento', pinned: { by: ana, at: new Date() }, pinnedMine: { at: new Date() } })
  const EDITOR = ['tasks.view', 'tasks.list', 'tasks.edit', 'projects.view', 'projects.view_all'] as Parameters<typeof makeCurrentUser>[0]
  const READER = ['tasks.view', 'tasks.list', 'projects.view', 'projects.view_all'] as Parameters<typeof makeCurrentUser>[0]

  function setupPins(options: { hidden?: ScreenKey[]; permissions?: Parameters<typeof makeCurrentUser>[0]; items?: TaskSummary[]; pins?: TaskPinCounts } = {}) {
    const items = options.items ?? [minePin, bothPin, pinned, mine, other]
    const pins = options.pins ?? { all: 2, maxAll: 10, mine: 2, maxMine: 10 }
    const list = vi.fn<TaskRepository['list']>((query) =>
      Promise.resolve(query.perPage === 1 ? { items: [], page: 1, perPage: 1, total: 3, totalPages: 3 } : { items, page: 1, perPage: 20, total: items.length, totalPages: 1, pins }),
    )
    const saved = (id: string, patch: Partial<TaskSummary>) => Promise.resolve({ ...items.find((t) => t.id === id)!, ...patch } as never)
    const setPinned = vi.fn<TaskRepository['setPinned']>((id, value) => saved(id, { pinned: value ? { by: ana, at: new Date() } : null }))
    const setPinnedMine = vi.fn<TaskRepository['setPinnedMine']>((id, value) => saved(id, { pinnedMine: value ? { at: new Date() } : null }))
    const current = makeCurrentUser(options.permissions ?? EDITOR)
    renderRoutes([{ path: '/tasks', element: <TasksPage /> }], {
      repositories: fakeRepositories({
        auth: { me: async () => ({ ...current, role: current.role && { ...current.role, screens: { hidden: options.hidden ?? [], starts: {} } } }) },
        statuses: { list: () => Promise.resolve([backlog, done]) },
        priorities: { list: () => Promise.resolve([alta, media]) },
        areas: { list: () => Promise.resolve([]) },
        tasks: { list, setPinned, setPinnedMine },
      }),
      initialPath: '/tasks?scope=all',
    })
    const tableCalls = () => list.mock.calls.filter(([query]) => query.perPage !== 1)
    return { list, setPinned, setPinnedMine, tableCalls }
  }
  const pinOf = (item: TaskSummary) => within(screen.getByText(item.title).closest('tr')!).getByTestId('task-pin')
  const openPinMenu = async (item: TaskSummary) => {
    await userEvent.click(pinOf(item))
    return screen.findByRole('menu')
  }
  const moreOf = (item: TaskSummary) => within(screen.getByText(item.title).closest('tr')!).getByRole('button', { name: 'Mais ações' })

  it('pede as fixadas primeiro; a linha fica igual às outras e só a cor do 📌 muda: azul (minha), verde (todos), cinza', async () => {
    const { tableCalls } = setupPins()
    await screen.findByText(pinned.title)
    expect(tableCalls().at(-1)![1]).toMatchObject({ pinnedFirst: true })
    expect(screen.queryByTestId('row-group')).not.toBeInTheDocument()
    expect(screen.queryByText(/Fixada/)).not.toBeInTheDocument()
    expect(screen.getByText(pinned.title).closest('tr')).not.toHaveAttribute('data-highlight')
    // a ordem é do servidor: a tabela mostra como veio
    expect(screen.getAllByTestId('task-pin').map((b) => b.getAttribute('data-pin-state'))).toEqual(['mine', 'both', 'all', 'none', 'none'])
    for (const item of [minePin, bothPin]) {
      expect(pinOf(item)).toHaveClass('text-info-text')
      expect(pinOf(item).querySelector('svg')).toHaveClass('fill-current')
    }
    expect(pinOf(pinned)).toHaveClass('text-primary-text')
    expect(pinOf(pinned).querySelector('svg')).toHaveClass('fill-current')
    expect(pinOf(mine)).toHaveClass('text-subtle')
    expect(pinOf(mine).querySelector('svg')).not.toHaveClass('fill-current')
  })

  it.each([
    ['para todos: quem fixou e quando', () => pinned, /^Fixada para todos por Angelica Davalos · há \d+ minutos$/],
    ['para mim', () => minePin, /^Fixada para você · só você a vê no topo$/],
    ['para mim e para todos', () => bothPin, /^Fixada para você e para todos$/],
  ])('a dica do 📌 diz para quem está fixada (%s)', async (_name, item, text) => {
    setupPins()
    await screen.findByText(pinned.title)
    await userEvent.hover(pinOf(item()))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(text)
  })

  it('com as duas opções, o 📌 abre um menu: "Fixar para mim" e "Fixar para todos", cada uma com a explicação', async () => {
    const { setPinned, setPinnedMine } = setupPins()
    await screen.findByText(pinned.title)
    const menu = await openPinMenu(mine)
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2)
    expect(within(menu).getByRole('menuitem', { name: 'Fixar para mim' })).toHaveAccessibleDescription('Só você a vê no topo')
    expect(within(menu).getByRole('menuitem', { name: 'Fixar para todos' })).toHaveAccessibleDescription('Fica no topo para toda a equipe')
    expect(within(menu).getByRole('separator')).toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Fixar para mim' }))
    await waitFor(() => expect(setPinnedMine).toHaveBeenCalledWith(mine.id, true))
    expect(setPinned).not.toHaveBeenCalled()
    // fixada para as duas: as duas opções viram "Desafixar"
    const both = await openPinMenu(bothPin)
    expect(within(both).getByRole('menuitem', { name: 'Desafixar para mim' })).toHaveAccessibleDescription('Volta ao lugar dela na sua Lista')
    await userEvent.click(within(both).getByRole('menuitem', { name: 'Desafixar para todos' }))
    await waitFor(() => expect(setPinned).toHaveBeenCalledWith(bothPin.id, false))
  })

  it('o menu é acessível: setas percorrem as opções e Esc fecha e devolve o foco ao 📌', async () => {
    setupPins()
    await screen.findByText(pinned.title)
    const button = pinOf(other)
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAccessibleName(`Fixar: ${other.title}`)
    button.focus()
    await userEvent.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Fixar para mim' })).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}')
    expect(within(menu).getByRole('menuitem', { name: 'Fixar para todos' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(pinOf(other)).toHaveFocus()
  })

  it('no limite: "Fixar para todos" desligada com "Já há 10 fixadas para todos" (e o mesmo para mim)', async () => {
    const { setPinned } = setupPins({ pins: { all: 10, maxAll: 10, mine: 10, maxMine: 10 } })
    await screen.findByText(pinned.title)
    const menu = await openPinMenu(mine)
    const all = within(menu).getByRole('menuitem', { name: 'Fixar para todos' })
    expect(all).toHaveAttribute('aria-disabled', 'true')
    expect(all).toHaveAccessibleDescription('Já há 10 fixadas para todos')
    expect(within(menu).getByRole('menuitem', { name: 'Fixar para mim' })).toHaveAccessibleDescription('Você já tem 10 fixadas para você')
    await userEvent.click(all, { pointerEventsCheck: 0 })
    expect(setPinned).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    // desafixar continua possível
    const again = await openPinMenu(pinned)
    expect(within(again).getByRole('menuitem', { name: 'Desafixar para todos' })).not.toHaveAttribute('aria-disabled')
  })

  it('o ··· da linha oferece as mesmas opções', async () => {
    const { setPinnedMine } = setupPins()
    await screen.findByText(pinned.title)
    await userEvent.click(moreOf(other))
    expect(await screen.findByRole('menuitem', { name: 'Fixar para todos' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fixar para mim' }))
    await waitFor(() => expect(setPinnedMine).toHaveBeenCalledWith(other.id, true))
  })

  it('perfil só com "Fixar para mim": um clique fixa/desafixa para mim, sem menu', async () => {
    const { setPinned, setPinnedMine } = setupPins({ hidden: ['tasks.row_actions.pin'] })
    await screen.findByText(pinned.title)
    await userEvent.click(screen.getByRole('button', { name: `Fixar para mim: ${mine.title}` }))
    await waitFor(() => expect(setPinnedMine).toHaveBeenCalledWith(mine.id, true))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    const button = screen.getByRole('button', { name: `Desafixar para mim: ${minePin.title}` })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(button)
    await waitFor(() => expect(setPinnedMine).toHaveBeenCalledWith(minePin.id, false))
    // a fixada para todos continua verde, mas o clique fixa para mim
    expect(pinOf(pinned)).toHaveClass('text-primary-text')
    expect(pinOf(pinned)).toHaveAttribute('aria-pressed', 'false')
    expect(setPinned).not.toHaveBeenCalled()
  })

  it('perfil só com "Fixar para todos": um clique faz o de antes (para todos)', async () => {
    const { setPinned, setPinnedMine } = setupPins({ hidden: ['tasks.row_actions.pin_mine'] })
    await screen.findByText(pinned.title)
    await userEvent.click(screen.getByRole('button', { name: `Fixar para todos: ${mine.title}` }))
    await waitFor(() => expect(setPinned).toHaveBeenCalledWith(mine.id, true))
    await userEvent.click(screen.getByRole('button', { name: `Desafixar para todos: ${pinned.title}` }))
    await waitFor(() => expect(setPinned).toHaveBeenCalledWith(pinned.id, false))
    await userEvent.hover(pinOf(pinned))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Fixada para todos por Angelica Davalos · há \d+ minutos — clique para desafixar$/)
    expect(setPinnedMine).not.toHaveBeenCalled()
    await userEvent.click(moreOf(other))
    await screen.findByRole('menuitem', { name: 'Fixar para todos' })
    expect(screen.queryByRole('menuitem', { name: 'Fixar para mim' })).not.toBeInTheDocument()
  })

  it('perfil sem nenhum dos dois (§48): sem o botão; as fixadas continuam no topo, pedidas ao servidor', async () => {
    const { tableCalls } = setupPins({ hidden: ['tasks.row_actions.pin', 'tasks.row_actions.pin_mine'] })
    await screen.findByText(pinned.title)
    expect(screen.queryByTestId('task-pin')).not.toBeInTheDocument()
    expect(tableCalls().at(-1)![1]).toMatchObject({ pinnedFirst: true })
    await userEvent.click(moreOf(other))
    await screen.findByRole('menuitem', { name: 'Abrir tarefa' })
    expect(screen.queryByRole('menuitem', { name: /Fixar/ })).not.toBeInTheDocument()
  })

  it('sem editar tarefas: fixa para si com um clique; "Fixar para todos" não aparece', async () => {
    const { setPinned, setPinnedMine } = setupPins({ permissions: READER })
    await screen.findByText(pinned.title)
    await userEvent.click(screen.getByRole('button', { name: `Fixar para mim: ${pinned.title}` }))
    await waitFor(() => expect(setPinnedMine).toHaveBeenCalledWith(pinned.id, true))
    await userEvent.click(moreOf(mine))
    await screen.findByRole('menuitem', { name: 'Fixar para mim' })
    expect(screen.queryByRole('menuitem', { name: 'Fixar para todos' })).not.toBeInTheDocument()
    expect(setPinned).not.toHaveBeenCalled()
  })

  it('sem editar tarefas e sem "Fixar para mim" no perfil: o 📌 só informa (desligado, com a dica de quem fixou)', async () => {
    const { setPinned, setPinnedMine } = setupPins({ permissions: READER, hidden: ['tasks.row_actions.pin_mine'] })
    await screen.findByText(pinned.title)
    screen.getAllByTestId('task-pin').forEach((button) => expect(button).toHaveAttribute('aria-disabled', 'true'))
    await userEvent.hover(pinOf(pinned))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Fixada para todos por Angelica Davalos · há \d+ minutos$/)
    await userEvent.click(pinOf(pinned))
    expect(setPinned).not.toHaveBeenCalled()
    expect(setPinnedMine).not.toHaveBeenCalled()
  })

  it('"Colunas e ações": "Fixar" em "Ações em cada linha", ligado por padrão; desligar tira o botão', async () => {
    setupPins()
    await screen.findByText(pinned.title)
    await userEvent.click(screen.getByRole('button', { name: 'Colunas e ações' }))
    const option = await screen.findByRole('checkbox', { name: 'Fixar' })
    expect(option).toBeChecked()
    await userEvent.click(option)
    await waitFor(() => expect(screen.queryByTestId('task-pin')).not.toBeInTheDocument())
  })
})
