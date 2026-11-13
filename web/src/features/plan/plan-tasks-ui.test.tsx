import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { Page } from '@/domain/pagination'
import type { Plan, PlanGroup, PlanItem } from '@/domain/plan'
import type { PermissionCode } from '@/domain/permissions'
import type { Project, ProjectMember } from '@/domain/projects'
import type { TaskListOptions, TaskRepository } from '@/domain/repositories'
import type { TaskType, TaskTypeDetail } from '@/domain/task-config'
import type { TaskDetail, TaskSummary } from '@/domain/tasks'
import type { TaskPriority, TaskStatus } from '@/domain/workflow'
import { fakeRepositories, makeCurrentUser, renderRoutes, typeTexts } from '@/test/utils'
import { ProjectBoard } from './ProjectBoard'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

const group: PlanGroup = { id: 'g1', parentId: null, name: 'Iniciação', color: 'blue', position: 0, number: '1.0', summary: null }

const item = (id: string, name: string, extra: Partial<PlanItem> = {}): PlanItem => ({
  id,
  groupId: 'g1',
  parentId: null,
  name,
  statusId: null,
  startDate: null,
  endDate: null,
  dueDate: null,
  owner: null,
  resourceIds: [],
  estimatedHours: null,
  actualHours: null,
  durationDays: null,
  durationManual: null,
  progress: { value: 0, source: 'none' },
  progressManual: null,
  subitems: 0,
  position: 1,
  blocked: false,
  updates: 0,
  files: 0,
  baselineStart: null,
  baselineEnd: null,
  custom: {},
  tasks: { total: 0, done: 0 },
  ...extra,
})

const plan: Plan = {
  project: { id: 'p1', key: 'IMP', name: 'Implantação', archived: false },
  capabilities: { edit: true, manage: true },
  statuses: [],
  resources: [],
  groups: [group],
  items: [
    item('i1', 'Kickoff', { progress: { value: 60, source: 'tasks' }, tasks: { total: 5, done: 3 }, estimatedHours: 8, actualHours: 7.5, estimatedFromTasks: true, actualFromTasks: true }),
    item('i2', 'Cronograma', { position: 2, progress: { value: 20, source: 'manual' }, progressManual: 20, estimatedHours: 3 }),
  ],
  links: [],
  columns: [],
  settings: { dependencyRule: 'warn', baselineAt: null },
  summary: null,
  truncated: false,
}

const project = { id: 'p1', key: 'IMP', name: 'Implantação', myRole: 'manager', archivedAt: null } as unknown as Project

const members: ProjectMember[] = [{ user: { id: 'u-ana', name: 'Ana', email: 'ana@x.com', avatarUrl: null, status: 'active' }, role: 'manager', isOwner: true, joinedAt: null }]

const todo = { id: 's1', key: 'TODO', name: 'A fazer', color: 'gray', category: 'todo' } as const
const done = { id: 's2', key: 'DONE', name: 'Concluída', color: 'green', category: 'done' } as const

const summary = (id: string, number: number, title: string, extra: Partial<TaskSummary> = {}): TaskSummary => ({
  id,
  code: `IMP-${number}`,
  number,
  title,
  project: { id: 'p1', key: 'IMP', name: 'Implantação' },
  type: null,
  status: todo,
  priority: null,
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
  inReport: true,
  itVisible: false,
  urgency: null,
  area: null,
  planItem: null,
  ...extra,
})

const linked = [
  summary('t1', 1, 'Agendar reunião', { status: done, assignee: { id: 'u-ana', name: 'Ana', email: 'ana@x.com', avatarUrl: null }, planItem: { id: 'i1', name: 'Kickoff' } }),
  summary('t2', 2, 'Preparar pauta', { planItem: { id: 'i1', name: 'Kickoff' } }),
]
const others = [summary('t9', 9, 'Levantar requisitos'), summary('t8', 8, 'Revisar contrato', { planItem: { id: 'i2', name: 'Cronograma' } }), ...linked]

const page = (items: TaskSummary[]): Page<TaskSummary> => ({ items, page: 1, perPage: 20, total: items.length, totalPages: 1 })

const bugType: TaskType = { id: 'tt1', key: 'TASK', name: 'Tarefa', description: '', translations: typeTexts('Tarefa'), icon: 'check-square', color: 'blue', order: 0, isActive: true, fieldCount: 0, createdAt: null, updatedAt: null }
const typeDetail: TaskTypeDetail = { ...bugType, fields: [] }
const lookup = <T extends TaskStatus | TaskPriority>(o: Partial<T>) => ({ id: 'x', key: 'X', name: 'X', description: '', color: 'gray', order: 0, isActive: true, isDefault: true, createdAt: null, updatedAt: null, ...o }) as T

const ALL: PermissionCode[] = ['plan.view', 'plan.edit', 'tasks.view', 'tasks.create', 'tasks.edit', 'projects.view']

function setup(options: { permissions?: PermissionCode[]; tasks?: Partial<TaskRepository>; initialPath?: string } = {}) {
  const list = vi.fn<TaskRepository['list']>((_query, opts?: TaskListOptions) => Promise.resolve(page(opts?.planItemId ? linked : others)))
  const update = vi.fn<TaskRepository['update']>((id) => Promise.resolve({ ...linked[0], id } as TaskDetail))
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(options.permissions ?? ALL) },
    plan: { get: () => Promise.resolve(plan) },
    projects: { get: () => Promise.resolve(project), listMembers: () => Promise.resolve(members) },
    taskTypes: { list: () => Promise.resolve([bugType]), get: () => Promise.resolve(typeDetail) },
    statuses: { list: () => Promise.resolve([lookup<TaskStatus>({ id: 's1', name: 'A fazer', category: 'todo' })]) },
    priorities: { list: () => Promise.resolve([lookup<TaskPriority>({ id: 'pr1', name: 'Média' })]) },
    tasks: { list, update, ...options.tasks },
  })
  renderRoutes([{ path: '/', element: <ProjectBoard projectId="p1" /> }], { repositories, initialPath: options.initialPath ?? '/' })
  return { list, update }
}

const openTasksTab = '/?item=i1&panel=tasks'

describe('Gestão: tarefas vinculadas aos elementos', () => {
  it('progresso pelas tarefas: "pelas tarefas · 3/5", sem edição manual; o indicador abre a aba Tarefas', async () => {
    setup()
    const table = await screen.findByRole('table', { name: '1.0 Iniciação' })
    expect(within(table).getByText('pelas tarefas · 3/5')).toBeInTheDocument()
    expect(within(table).getByRole('progressbar', { name: 'Progresso de Kickoff' })).toHaveAttribute('aria-valuenow', '60')
    // vem das tarefas: não se digita; o informado à mão continua editável
    expect(within(table).queryByRole('button', { name: 'Editar progresso de Kickoff (0 a 100)' })).not.toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Editar progresso de Cronograma (0 a 100)' })).toBeInTheDocument()

    await userEvent.click(within(table).getByRole('button', { name: 'Tarefas de Kickoff: 3 de 5 concluídas' }))
    const panel = await screen.findByRole('dialog', { name: 'Kickoff' })
    expect(within(panel).getByRole('tab', { name: 'Tarefas (5)' })).toHaveAttribute('aria-selected', 'true')
  })

  it('esforço pelas tarefas: a célula e o painel mostram a soma com "pelas tarefas"; o informado no elemento fica sem o aviso', async () => {
    setup()
    const table = await screen.findByRole('table', { name: '1.0 Iniciação' })
    const fromTasks = within(table).getByRole('button', { name: 'Esforço estimado de Kickoff (horas)' })
    expect(fromTasks).toHaveTextContent(/^8\s*pelas tarefas$/)
    expect(fromTasks.closest('[title]')).toHaveAttribute('title', expect.stringContaining('Soma das horas das tarefas vinculadas'))
    const own = within(table).getByRole('button', { name: 'Esforço estimado de Cronograma (horas)' })
    expect(own).toHaveTextContent(/^3$/)

    await userEvent.click(within(table).getByRole('button', { name: 'Tarefas de Kickoff: 3 de 5 concluídas' }))
    const panel = await screen.findByRole('dialog', { name: 'Kickoff' })
    await userEvent.click(within(panel).getByRole('tab', { name: 'Detalhes' }))
    // o elemento não tem a coluna Realizado no quadro: no painel aparece quando há valor
    expect(within(panel).getByText('8 h')).toBeInTheDocument()
    expect(within(panel).getByText('7,5 h')).toBeInTheDocument()
    expect(within(panel).getAllByText('· pelas tarefas')).toHaveLength(2)
  })

  it('aba Tarefas: lista código, título (link), status e responsável, com "3 de 5 concluídas"', async () => {
    const { list } = setup({ initialPath: openTasksTab })
    const panel = await screen.findByRole('dialog', { name: 'Kickoff' })
    const rows = await within(panel).findByRole('list', { name: 'Tarefas vinculadas a Kickoff' })
    expect(within(panel).getByText('3 de 5 concluídas')).toBeInTheDocument()
    expect(within(rows).getByText('IMP-1')).toBeInTheDocument()
    expect(within(rows).getByRole('link', { name: 'Agendar reunião' })).toHaveAttribute('href', '/tasks/t1')
    expect(within(rows).getByText('Concluída')).toBeInTheDocument()
    expect(within(rows).getByText('Ana')).toBeInTheDocument()
    expect(list).toHaveBeenCalledWith(expect.anything(), { projectId: 'p1', planItemId: 'i1' })
  })

  it('vincular: busca as tarefas do projeto (sem as deste elemento) e grava o planItemId', async () => {
    const { update } = setup({ initialPath: openTasksTab })
    const panel = await screen.findByRole('dialog', { name: 'Kickoff' })
    await userEvent.click(await within(panel).findByRole('button', { name: 'Vincular tarefa' }))
    const results = await within(panel).findByRole('list', { name: 'Tarefas para vincular' })
    expect(within(results).queryByRole('button', { name: /IMP-1 / })).not.toBeInTheDocument()
    // de outro elemento: aparece com o aviso de que muda para cá
    expect(within(results).getByText('Em Cronograma — vincular aqui move a tarefa')).toBeInTheDocument()
    await userEvent.click(within(results).getByRole('button', { name: 'Vincular IMP-9 Levantar requisitos' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('t9', { planItemId: 'i1' }))
  })

  it('desvincular grava planItemId null', async () => {
    const { update } = setup({ initialPath: openTasksTab })
    const panel = await screen.findByRole('dialog', { name: 'Kickoff' })
    await userEvent.click(await within(panel).findByRole('button', { name: 'Desvincular IMP-2' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('t2', { planItemId: null }))
  })

  it('nova tarefa: abre o formulário já com o projeto e o elemento', async () => {
    const create = vi.fn<TaskRepository['create']>(() => Promise.resolve({ ...linked[1], id: 't10', code: 'IMP-10' } as TaskDetail))
    setup({ initialPath: openTasksTab, tasks: { create } })
    const panel = await screen.findByRole('dialog', { name: 'Kickoff' })
    await userEvent.click(await within(panel).findByRole('button', { name: 'Nova tarefa' }))
    const form = await screen.findByRole('dialog', { name: 'Nova tarefa' })
    expect(await within(form).findByRole('combobox', { name: /^Elemento da Gestão/ })).toHaveTextContent('Kickoff')
    await userEvent.click(within(form).getByRole('combobox', { name: /^Tipo/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Tarefa' }))
    await userEvent.type(within(form).getByLabelText(/^Título/), 'Enviar convite')
    await userEvent.click(within(form).getByRole('button', { name: 'Nova tarefa' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]?.[0]).toMatchObject({ projectId: 'p1', title: 'Enviar convite', planItemId: 'i1' })
  })

  it('sem permissão de editar tarefas: só vê a lista', async () => {
    setup({ initialPath: openTasksTab, permissions: ['plan.view', 'tasks.view', 'projects.view'] })
    const panel = await screen.findByRole('dialog', { name: 'Kickoff' })
    expect(await within(panel).findByRole('list', { name: 'Tarefas vinculadas a Kickoff' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Vincular tarefa' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Nova tarefa' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /^Desvincular/ })).not.toBeInTheDocument()
  })
})
