import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { AuditEntry } from '@/domain/entities'
import type { DemandOverview, DemandStatus } from '@/domain/demands'
import type { DemandRepository, TaskRepository } from '@/domain/repositories'
import type { TaskType } from '@/domain/task-config'
import type { TaskComment, TaskDetail, TaskSummary } from '@/domain/tasks'
import type { Area, TaskPriority, TaskStatus } from '@/domain/workflow'
import { AppShell } from '@/presentation/layouts/AppShell'
import { RequireAuth } from '@/features/auth/guards'
import { fakeRepositories, makeCurrentUser, renderRoutes, typeTexts } from '@/test/utils'
import { TasksPage } from '@/features/tasks/TasksPage'
import { TaskDetailPage } from '@/features/tasks/TaskDetailPage'
import { TaskFormDialog } from '@/features/tasks/TaskFormDialog'
import { DemandsPage } from './DemandsPage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
beforeEach(() => {
  window.localStorage.removeItem('kamban.table.task-list')
})

const person = (id: string, name: string) => ({ id, name, email: `${id}@x.com`, avatarUrl: null })
const ana = person('u1', 'Ana Souza')
const cesar = person('u2', 'César')
const jorge = person('u3', 'Jorge')
const carlos = person('u4', 'Carlos')

function lookup<T extends TaskStatus | TaskPriority | Area>(overrides: Partial<T>): T {
  return { id: 'x', key: 'X', name: 'X', description: '', color: 'gray', order: 0, isActive: true, isDefault: false, createdAt: null, updatedAt: null, ...overrides } as T
}
const backlog = lookup<TaskStatus>({ id: 's1', key: 'BACKLOG', name: 'Backlog', category: 'backlog', isDefault: true })
const media = lookup<TaskPriority>({ id: 'p2', key: 'MEDIA', name: 'Média', color: 'amber', isDefault: true })
const alta = lookup<TaskPriority>({ id: 'p1', key: 'ALTA', name: 'Alta', color: 'red' })
const estrategia = lookup<Area>({ id: 'a1', key: 'EST', name: 'Estratégia', color: 'blue' })
const devType: TaskType = { id: 't1', key: 'DEV', name: 'Desenvolvimento', description: '', translations: typeTexts('Desenvolvimento'), icon: 'code', color: 'blue', order: 0, isActive: true, fieldCount: 0, createdAt: null, updatedAt: null }

function demand(overrides: Omit<Partial<TaskDetail>, 'status'> & { step?: DemandStatus } = {}): TaskDetail {
  const { step: status = 'unassigned', ...rest } = overrides
  return {
    id: 'd1',
    code: 'DEM-1',
    number: 1,
    title: 'Vista DMR: agregar Fecha cuenta',
    project: null,
    type: { id: 't1', key: 'DEV', name: 'Desenvolvimento', icon: 'code', color: 'blue' },
    status: { id: 's1', key: 'BACKLOG', name: 'Backlog', color: 'gray', category: 'backlog' },
    priority: { id: 'p1', key: 'ALTA', name: 'Alta', color: 'red' },
    sprint: null,
    creator: ana,
    assignee: null,
    reporter: ana,
    parentTaskId: null,
    startDate: null,
    dueDate: null,
    estimatedHours: null,
    actualHours: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-11-19T13:02:00Z'),
    updatedAt: new Date('2026-11-19T13:02:00Z'),
    tags: [],
    checklistProgress: { done: 0, total: 0 },
    commentCount: 0,
    attachmentCount: 0,
    subtaskProgress: { done: 0, total: 0 },
    blocked: false,
    inReport: true,
    itVisible: false,
    urgency: null,
    area: { id: 'a1', key: 'EST', name: 'Estratégia', color: 'blue' },
    planItem: null,
    demand: { status, owner: cesar, dueAt: null, openedAt: new Date('2026-11-19T13:02:00Z') },
    description: 'A coluna **Fecha cuenta** para o DRE.',
    customValues: {},
    checklist: [],
    parent: null,
    forkedFrom: null,
    fields: [],
    capabilities: { edit: true, delete: false, assign: false, comment: true, link: false, fork: false },
    ...rest,
  }
}

const emptyCounts = () => ({ unassigned: 0, assigned: 0, in_progress: 0, to_validate: 0, done: 0 })

function overview(received: Partial<Record<DemandStatus, number>>, team: DemandOverview['team'] = [], all?: { counts: Partial<Record<DemandStatus, number>>; team: DemandOverview['team'] }): DemandOverview {
  return {
    counts: { received: { ...emptyCounts(), ...received }, assigned: emptyCounts(), requested: emptyCounts(), all: { ...emptyCounts(), ...all?.counts } },
    team,
    allTeam: all?.team ?? [],
  }
}

const page = (items: TaskSummary[]) => ({ items, page: 1, perPage: 100, total: items.length, totalPages: 1 })

function repos(options: { me?: typeof ana; demands?: Partial<DemandRepository>; tasks?: Partial<TaskRepository>; permissions?: Parameters<typeof makeCurrentUser>[0] } = {}) {
  const me = options.me ?? ana
  return fakeRepositories({
    auth: {
      me: async () => {
        const current = makeCurrentUser(options.permissions ?? ['tasks.view', 'tasks.list', 'tasks.create', 'tasks.edit', 'tasks.assign', 'projects.view'])
        return { ...current, user: { ...current.user, id: me.id, name: me.name } }
      },
    },
    taskTypes: { list: () => Promise.resolve([devType]) },
    statuses: { list: () => Promise.resolve([backlog]) },
    priorities: { list: () => Promise.resolve([alta, media]) },
    areas: { list: () => Promise.resolve([estrategia]) },
    demands: { owners: () => Promise.resolve([cesar, jorge]), ...options.demands },
    tasks: options.tasks,
  })
}

/** Escolhe a opção (na lista com busca, a opção é um botão dentro da lista). */
async function chooseOption(label: RegExp | string, option: RegExp | string) {
  await userEvent.click(screen.getByRole('combobox', { name: label }))
  const listbox = await screen.findByRole('listbox')
  const button = within(listbox).queryByRole('button', { name: option })
  await userEvent.click(button ?? within(listbox).getByRole('option', { name: option }))
}

describe('Tarefas — dois botões e a demanda interna (§45)', () => {
  it('"＋ Demanda interna" abre só o formulário da demanda e "＋ Tarefa de projeto" só o de projeto (sem os botões de tipo dentro)', async () => {
    renderRoutes([{ path: '/tasks', element: <TasksPage /> }], { repositories: repos(), initialPath: '/tasks' })
    expect(await screen.findByRole('heading', { name: 'Tarefas' })).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Demanda interna' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Tarefa de projeto' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Demanda interna' })).toBeNull()
    expect(within(dialog).getByRole('heading', { name: 'Nova demanda interna' })).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: /^Responsável/ })).toBeInTheDocument()
    expect(within(dialog).getByText(i18n.t('demands.form.ownerHint'))).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: /^Departamento que pede/ })).toBeInTheDocument()
    expect(within(dialog).getByText(i18n.t('demands.form.deadlineLocked'))).toBeInTheDocument()
    expect(within(dialog).getByText(/automática/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Criar demanda' })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: /Cancelar/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Tarefa de projeto: só o formulário de sempre (com Projeto), sem os botões de tipo
    await userEvent.click(screen.getByRole('button', { name: 'Tarefa de projeto' }))
    const projectDialog = await screen.findByRole('dialog')
    expect(within(projectDialog).queryByRole('button', { name: 'Demanda interna' })).toBeNull()
    expect(within(projectDialog).queryByRole('button', { name: 'Tarefa de projeto' })).toBeNull()
    expect(within(projectDialog).getByRole('heading', { name: 'Nova tarefa' })).toBeInTheDocument()
    expect(await within(projectDialog).findByRole('combobox', { name: /^Projeto/ })).toBeInTheDocument()
    expect(within(projectDialog).queryByRole('button', { name: 'Criar demanda' })).not.toBeInTheDocument()
  })

  it('cria a demanda com tipo, título, responsável e departamento (obrigatórios)', async () => {
    const create = vi.fn<DemandRepository['create']>(() => Promise.resolve(demand()))
    renderRoutes([{ path: '/tasks', element: <TasksPage /> }], { repositories: repos({ demands: { create } }), initialPath: '/tasks' })
    await userEvent.click(await screen.findByRole('button', { name: 'Demanda interna' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar demanda' }))
    expect(await within(dialog).findAllByText('Campo obrigatório')).toHaveLength(4)
    expect(create).not.toHaveBeenCalled()
    await chooseOption(/^Tipo/, 'Desenvolvimento')
    await userEvent.type(within(dialog).getByLabelText(/^Título/), 'Vista DMR: agregar Fecha cuenta')
    await chooseOption(/^Responsável/, /César/)
    await chooseOption(/^Departamento que pede/, 'Estratégia')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar demanda' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]?.[0]).toMatchObject({ taskTypeId: 't1', title: 'Vista DMR: agregar Fecha cuenta', ownerId: 'u2', areaId: 'a1' })
  })

  it('lista: Todas · Com projeto · Sem projeto; a demanda mostra "Demanda interna" no lugar do projeto', async () => {
    // a tarefa de projeto com quem distribui continua mostrando o projeto
    const withOwner = demand({ id: 'k7', code: 'FIN-7', title: 'Publicar o dashboard', project: { id: 'p9', key: 'FIN', name: 'Finanças' } })
    const list = vi.fn<TaskRepository['list']>((query) => Promise.resolve({ ...page(query.perPage === 1 ? [] : [demand(), withOwner]), total: 2 }))
    renderRoutes([{ path: '/tasks', element: <TasksPage /> }], { repositories: repos({ tasks: { list } }), initialPath: '/tasks' })
    expect(await screen.findByText('Vista DMR: agregar Fecha cuenta')).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    const internal = rows.find((row) => row.textContent?.includes('DEM-1'))!
    const fromProject = rows.find((row) => row.textContent?.includes('FIN-7'))!
    expect(within(internal).getByText('Demanda interna')).toBeInTheDocument()
    expect(within(fromProject).getByText('Finanças')).toBeInTheDocument()
    expect(within(fromProject).queryByText('Demanda interna')).not.toBeInTheDocument()
    expect(screen.getByText(i18n.t('taskList.mineHint'))).toBeInTheDocument()
    const kind = screen.getByRole('radiogroup', { name: i18n.t('taskList.kindLabel') })
    await userEvent.click(within(kind).getByRole('radio', { name: 'Sem projeto' }))
    await waitFor(() => expect(list.mock.calls.filter(([query]) => query.perPage !== 1).at(-1)![0].filters).toMatchObject({ kind: 'demand', mine: 'true' }))
  })
})

describe('Demandas — caixas (§45)', () => {
  const unassigned = demand({ id: 'd1', code: 'DEM-1' })
  const running = demand({ id: 'd2', code: 'DEM-2', title: 'Usuário técnico do Datasphere', step: 'in_progress', assignee: jorge, estimatedHours: 4 })
  running.demand = { ...running.demand!, dueAt: new Date(2026, 10, 21, 17, 0) }
  const projectTask = demand({ id: 'k9', code: 'FIN-3', title: 'Publicar o dashboard', step: 'assigned', assignee: carlos, project: { id: 'p9', key: 'FIN', name: 'Finanças' } })

  it('Recebidas por mim: números, grupos por passo, chip do projeto, Atribuir e a carga da equipe', async () => {
    const assign = vi.fn<DemandRepository['assign']>(() => Promise.resolve(unassigned))
    renderRoutes([{ path: '/tasks/demands', element: <DemandsPage /> }], {
      repositories: repos({
        me: cesar,
        demands: {
          overview: () =>
            Promise.resolve(
              overview({ unassigned: 1, in_progress: 1, assigned: 1 }, [
                { user: jorge, openCount: 1, estimatedHours: 4 },
                { user: carlos, openCount: 1, estimatedHours: 2 },
              ]),
            ),
          list: () => Promise.resolve(page([unassigned, running, projectTask])),
          team: () => Promise.resolve([carlos, cesar, jorge]),
          assign,
        },
      }),
      initialPath: '/tasks/demands',
    })
    expect(await screen.findByTestId('kpi-unassigned')).toHaveTextContent('1')
    expect(screen.getByTestId('kpi-in_progress')).toHaveTextContent('1')
    expect(await screen.findByRole('region', { name: 'Sem atribuir' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Em andamento' })).toBeInTheDocument()
    // tarefa de projeto com quem distribui: o chip com o nome do projeto
    expect(screen.getByText('Finanças')).toBeInTheDocument()
    expect(screen.getByText('prazo ' + new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(running.demand!.dueAt!))).toBeInTheDocument()
    const load = screen.getByRole('list', { name: 'Carga da minha equipe' })
    expect(within(load).getByLabelText('Jorge: 1 demandas, 4 horas')).toHaveTextContent('1 · 4 h')
    expect(within(load).getAllByRole('listitem')).toHaveLength(2)

    await userEvent.click(within(screen.getByRole('region', { name: 'Sem atribuir' })).getByRole('button', { name: 'Atribuir' }))
    const dialog = await screen.findByRole('dialog', { name: 'Atribuir · DEM-1' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Atribuir' }))
    expect(await within(dialog).findAllByText('Campo obrigatório')).toHaveLength(3)
    await chooseOption(/^Atribuir a/, /Jorge/)
    await userEvent.type(within(dialog).getByLabelText(/^Prazo · data/), '21/11/2026')
    await userEvent.type(within(dialog).getByLabelText(/^Hora/), '1700')
    await userEvent.type(within(dialog).getByLabelText(/^Estimativa/), '4')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Atribuir' }))
    await waitFor(() => expect(assign).toHaveBeenCalledOnce())
    expect(assign.mock.calls[0]).toEqual(['d1', { assigneeId: 'u3', dueAt: new Date(2026, 10, 21, 17, 0).toISOString(), estimatedHours: 4 }])
  })

  it('Atribuídas a mim: Começar, Passar a… e Concluir (com o comentário obrigatório)', async () => {
    const assigned = demand({ id: 'd3', code: 'DEM-3', step: 'assigned', assignee: jorge })
    const start = vi.fn<DemandRepository['start']>(() => Promise.resolve(assigned))
    const conclude = vi.fn<DemandRepository['conclude']>(() => Promise.resolve(assigned))
    renderRoutes([{ path: '/tasks/demands', element: <DemandsPage /> }], {
      repositories: repos({ me: jorge, demands: { list: () => Promise.resolve(page([assigned])), start, conclude } }),
      initialPath: '/tasks/demands?box=assigned',
    })
    const row = (await screen.findByText(assigned.title)).closest('li')!
    expect(within(row).getByRole('button', { name: 'Passar a…' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Reatribuir' })).not.toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Começar' }))
    await waitFor(() => expect(start).toHaveBeenCalledWith('d3'))
    await userEvent.click(within(row).getByRole('button', { name: 'Concluir' }))
    const dialog = await screen.findByRole('dialog', { name: 'Concluir · DEM-3' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Concluir' }))
    expect(await within(dialog).findByText('Campo obrigatório')).toBeInTheDocument()
    expect(conclude).not.toHaveBeenCalled()
    await userEvent.type(within(dialog).getByLabelText(/^O que foi entregue/), 'Coluna publicada na vista.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Concluir' }))
    await waitFor(() => expect(conclude).toHaveBeenCalledWith('d3', 'Coluna publicada na vista.'))
  })

  it('Pedidas por mim: Validar e Devolver (com comentário obrigatório)', async () => {
    const waiting = demand({ id: 'd4', code: 'DEM-4', step: 'to_validate', assignee: jorge })
    const validate = vi.fn<DemandRepository['validate']>(() => Promise.resolve(waiting))
    const returnDemand = vi.fn<DemandRepository['returnDemand']>(() => Promise.resolve(waiting))
    renderRoutes([{ path: '/tasks/demands', element: <DemandsPage /> }], {
      repositories: repos({ me: ana, demands: { list: () => Promise.resolve(page([waiting])), validate, returnDemand } }),
      initialPath: '/tasks/demands?box=requested',
    })
    const row = (await screen.findByText(waiting.title)).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Devolver' }))
    const dialog = await screen.findByRole('dialog', { name: 'Devolver · DEM-4' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Devolver' }))
    expect(await within(dialog).findByText('Campo obrigatório')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(/^O que falta/), 'Falta o filtro por safra.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Devolver' }))
    await waitFor(() => expect(returnDemand).toHaveBeenCalledWith('d4', 'Falta o filtro por safra.'))
    await userEvent.click(within(row).getByRole('button', { name: 'Validar' }))
    await waitFor(() => expect(validate).toHaveBeenCalledWith('d4'))
  })
})

describe('Demandas — Todas (§45, só com projects.view_all)', () => {
  const internal = demand({ id: 'd1', code: 'DEM-1', step: 'in_progress', assignee: jorge, estimatedHours: 4 })
  const fromProject = demand({ id: 'k9', code: 'FIN-3', title: 'Publicar o dashboard', step: 'assigned', assignee: carlos, project: { id: 'p9', key: 'FIN', name: 'Finanças' } })
  fromProject.demand = { ...fromProject.demand!, owner: ana }
  const allOverview = () =>
    overview({}, [], {
      counts: { unassigned: 2, assigned: 3, in_progress: 1, to_validate: 4 },
      team: [
        { user: jorge, openCount: 1, estimatedHours: 4 },
        { user: carlos, openCount: 1, estimatedHours: 0 },
      ],
    })

  it('sem projects.view_all: a aba Todas não aparece e ?box=all mostra Recebidas por mim', async () => {
    const list = vi.fn<DemandRepository['list']>(() => Promise.resolve(page([])))
    renderRoutes([{ path: '/tasks/demands', element: <DemandsPage /> }], {
      repositories: repos({ me: cesar, demands: { list, overview: () => Promise.resolve(allOverview()) } }),
      initialPath: '/tasks/demands?box=all',
    })
    const tabs = await screen.findByRole('radiogroup', { name: 'Caixas de demandas' })
    expect(within(tabs).getAllByRole('radio')).toHaveLength(3)
    expect(within(tabs).queryByRole('radio', { name: /Todas/ })).toBeNull()
    expect(within(tabs).getByRole('radio', { name: /Recebidas por mim/ })).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(list).toHaveBeenCalled())
    expect(list.mock.calls.every(([box]) => box !== 'all')).toBe(true)
  })

  it('com projects.view_all: números de todas, filtros por Responsável e Atribuída a, lista agrupada e a Carga das equipes', async () => {
    const list = vi.fn<DemandRepository['list']>(() => Promise.resolve(page([internal, fromProject])))
    renderRoutes(
      [
        { path: '/tasks/demands', element: <DemandsPage /> },
        { path: '/tasks/:id', element: <p>Página da tarefa</p> },
      ],
      {
        repositories: repos({
          me: cesar,
          permissions: ['tasks.view', 'tasks.list', 'tasks.create', 'tasks.edit', 'tasks.assign', 'projects.view', 'projects.view_all'],
          demands: { list, overview: () => Promise.resolve(allOverview()), owners: () => Promise.resolve([ana, carlos, cesar, jorge]) },
        }),
        initialPath: '/tasks/demands',
      },
    )
    const tabs = await screen.findByRole('radiogroup', { name: 'Caixas de demandas' })
    await userEvent.click(await within(tabs).findByRole('radio', { name: /Todas/ }))
    // números de todas as demandas (os quatro primeiros passos)
    expect(await screen.findByTestId('kpi-unassigned')).toHaveTextContent('2')
    expect(screen.getByTestId('kpi-assigned')).toHaveTextContent('3')
    expect(screen.getByTestId('kpi-to_validate')).toHaveTextContent('4')
    expect(within(tabs).getByRole('radio', { name: /Todas/ })).toHaveTextContent('10')
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('all', {}))
    // grupos por passo; cada linha com o responsável, quem executa e o projeto (ou "Demanda interna")
    const running = await screen.findByRole('region', { name: 'Em andamento' })
    const internalRow = within(running).getByText(internal.title).closest('li')!
    expect(within(internalRow).getByText('Responsável: César')).toBeInTheDocument()
    expect(within(internalRow).getByText('Jorge')).toBeInTheDocument()
    expect(within(internalRow).getByText('Demanda interna')).toBeInTheDocument()
    const projectRow = within(screen.getByRole('region', { name: 'Atribuídas' })).getByText('Publicar o dashboard').closest('li')!
    expect(within(projectRow).getByText('Responsável: Ana Souza')).toBeInTheDocument()
    expect(within(projectRow).getByText('Finanças')).toBeInTheDocument()
    // Carga das equipes: todas as pessoas com demandas abertas
    const load = screen.getByRole('list', { name: 'Carga das equipes' })
    expect(within(load).getByLabelText('Jorge: 1 demandas, 4 horas')).toBeInTheDocument()
    expect(within(load).getAllByRole('listitem')).toHaveLength(2)
    // filtros (selects): Responsável e Atribuída a
    await chooseOption('Responsável', /César/)
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('all', { ownerId: 'u2' }))
    await chooseOption('Atribuída a', /Jorge/)
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('all', { ownerId: 'u2', assigneeId: 'u3' }))
    // a linha abre a tarefa em página inteira
    await userEvent.click(screen.getByRole('link', { name: internal.title }))
    expect(await screen.findByText('Página da tarefa')).toBeInTheDocument()
  })
})

describe('Demanda — página inteira (§45)', () => {
  it('voltar, código · Demanda interna · tipo, propriedades e a linha do tempo com histórico e comentários', async () => {
    const task = demand({ step: 'assigned', assignee: jorge, estimatedHours: 4 })
    task.demand = { ...task.demand!, dueAt: new Date(2026, 10, 21, 17, 0), actions: { assign: true, start: false, pass: false, conclude: false, validate: false, return: false } }
    const entries: AuditEntry[] = [
      { id: 'h1', entityType: 'task', entityId: 'd1', action: 'task.created', oldValue: null, newValue: { demand_owner: 'César' }, user: { id: 'u1', name: 'Ana Souza', email: 'a@x' }, ip: '', correlationId: '', createdAt: new Date('2026-11-19T13:02:00Z') },
      { id: 'h2', entityType: 'task', entityId: 'd1', action: 'task.demand_passed', oldValue: { assignee: 'Carlos' }, newValue: { assignee: 'Jorge', note: 'Jorge já configurou esse servidor.' }, user: { id: 'u4', name: 'Carlos', email: 'c@x' }, ip: '', correlationId: '', createdAt: new Date('2026-11-19T15:00:00Z') },
    ]
    const comment: TaskComment = { id: 'c1', taskId: 'd1', author: cesar, content: 'Prioridade para sexta.', mentions: [], attachments: [], deleted: false, createdAt: new Date('2026-11-19T14:00:00Z'), editedAt: null, capabilities: { edit: false, delete: false } }
    renderRoutes([{ path: '/tasks/:taskId', element: <TaskDetailPage /> }], {
      repositories: fakeRepositories({
        auth: { me: async () => ({ ...makeCurrentUser(['tasks.view', 'tasks.edit']), user: { ...makeCurrentUser([]).user, id: 'u2', name: 'César' } }) },
        tasks: { get: () => Promise.resolve(task), history: () => Promise.resolve({ items: entries, page: 1, perPage: 100, total: 2, totalPages: 1 }) },
        comments: { list: () => Promise.resolve([comment]) },
        attachments: { list: () => Promise.resolve([]) },
      }),
      initialPath: '/tasks/d1',
    })
    expect(await screen.findByRole('heading', { name: task.title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar a Tarefas/ })).toHaveAttribute('href', '/tasks')
    expect(screen.getByText('DEM-1 · Demanda interna · Desenvolvimento')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reatribuir' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.getByText('Propriedades')).toBeInTheDocument()
    expect(screen.getByText('Pediu')).toBeInTheDocument()
    expect(screen.getByText('Departamento que pede')).toBeInTheDocument()
    expect(screen.getByText('Estratégia')).toBeInTheDocument()
    expect(screen.getByText('Atribuída a')).toBeInTheDocument()
    expect(screen.getByText('4 h')).toBeInTheDocument()
    // histórico e comentários juntos, do mais antigo ao mais novo
    const events = await screen.findAllByTestId('demand-event')
    expect(events[0]).toHaveTextContent('Ana Souza abriu a demanda para César')
    expect(events[1]).toHaveTextContent('Carlos passou a Jorge')
    expect(events[1]).toHaveTextContent('Jorge já configurou esse servidor.')
    const timeline = screen.getByRole('list', { name: i18n.t('comments.title') })
    expect(within(timeline).getAllByRole('listitem').map((li) => li.textContent?.includes('Prioridade para sexta.'))).toEqual([false, true, false])
  })
})

describe('Tarefa de projeto com quem recebe e distribui (§45)', () => {
  it('campo "Responsável (recebe e distribui)" no formulário de projeto: trava status, responsável, prazo e estimativa', async () => {
    const create = vi.fn<TaskRepository['create']>(() => Promise.resolve(demand({ project: { id: 'p1', key: 'CRM', name: 'CRM' } })))
    renderRoutes([{ path: '/', element: <TaskFormDialog open projectId="p1" onOpenChange={() => {}} /> }], {
      repositories: fakeRepositories({
        auth: { me: async () => makeCurrentUser(['tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'projects.view']) },
        taskTypes: { list: () => Promise.resolve([devType]), get: () => Promise.resolve({ ...devType, fields: [] }) },
        statuses: { list: () => Promise.resolve([backlog]) },
        priorities: { list: () => Promise.resolve([media]) },
        areas: { list: () => Promise.resolve([estrategia]) },
        demands: { owners: () => Promise.resolve([cesar, jorge]) },
        tasks: { create },
      }),
      initialPath: '/',
    })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(i18n.t('demands.projectFlow.ownerHint'))).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: 'Status' })).toBeEnabled()
    await chooseOption(/^Responsável \(recebe e distribui\)/, 'César')
    expect(within(dialog).getByRole('combobox', { name: 'Status' })).toBeDisabled()
    expect(within(dialog).getByRole('combobox', { name: /^Responsável$/ })).toBeDisabled()
    expect(within(dialog).getByLabelText(/^Estimativa/)).toBeDisabled()
    await chooseOption(/^Tipo/, 'Desenvolvimento')
    await userEvent.type(within(dialog).getByLabelText(/^Título/), 'Publicar o dashboard')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nova tarefa' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    const body = create.mock.calls[0]![0]
    expect(body).toMatchObject({ projectId: 'p1', demandOwnerId: 'u2', title: 'Publicar o dashboard' })
    expect(body.statusId).toBeUndefined()
    expect(body.assigneeId).toBeUndefined()
    expect(body.dueDate).toBeUndefined()
    expect(body.estimatedHours).toBeUndefined()
  })
})

describe('Menu — selo de Tarefas (§45)', () => {
  it('mostra quantas demandas recebidas estão sem atribuir', async () => {
    renderRoutes(
      [
        {
          path: '/',
          element: (
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          ),
          children: [{ path: 'home', element: <p>Início</p> }],
        },
      ],
      {
        repositories: fakeRepositories({
          auth: { me: async () => makeCurrentUser(['tasks.view', 'tasks.list']) },
          demands: { overview: () => Promise.resolve(overview({ unassigned: 3 })) },
        }),
        initialPath: '/home',
      },
    )
    const nav = await screen.findByRole('navigation', { name: i18n.t('nav.main') })
    const badge = await within(nav).findByTestId('nav-count')
    expect(badge).toHaveTextContent('3')
    expect(within(badge).getByText('3 demandas recebidas sem atribuir')).toHaveClass('sr-only')
    expect(badge.closest('a')).toHaveAttribute('href', '/tasks')
  })
})
