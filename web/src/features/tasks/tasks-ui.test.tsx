import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { AppError } from '@/core/errors/app-error'
import type { ProjectMember } from '@/domain/projects'
import type { TaskRepository } from '@/domain/repositories'
import type { CustomField, TaskType, TaskTypeDetail } from '@/domain/task-config'
import type { TaskDetail } from '@/domain/tasks'
import type { TaskPriority, TaskStatus } from '@/domain/workflow'
import { fakeRepositories, makeCurrentUser, renderRoutes, typeTexts } from '@/test/utils'
import { TaskFormDialog } from './TaskFormDialog'
import { TaskDetailPage } from './TaskDetailPage'
import { TasksTable } from './TasksTable'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

function field(overrides: Partial<CustomField>): CustomField {
  return {
    id: 'f1',
    name: 'versao',
    label: 'Versão',
    type: 'text',
    description: '',
    config: { max_length: 50 },
    defaultValue: null,
    searchable: true,
    filterable: false,
    sortable: false,
    options: [],
    usedBy: [],
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

const versao = field({})
const severidade = field({
  id: 'f2',
  name: 'severidade',
  label: 'Severidade',
  type: 'select',
  config: {},
  defaultValue: 'o2',
  options: [
    { id: 'o1', label: 'Alta', color: 'red', order: 0, isActive: true },
    { id: 'o2', label: 'Média', color: 'amber', order: 1, isActive: true },
  ],
})

const bugType: TaskType = { id: 't1', key: 'BUG', name: 'Bug', description: '', translations: typeTexts('Bug'), icon: 'bug', color: 'red', order: 0, isActive: true, fieldCount: 2, createdAt: null, updatedAt: null }
const bugDetail: TaskTypeDetail = {
  ...bugType,
  fields: [
    { field: versao, order: 0, required: true, visible: true, showOnCard: false, requiredStatusIds: [] },
    { field: severidade, order: 1, required: true, visible: true, showOnCard: true, requiredStatusIds: [] },
  ],
}

function lookup<T extends TaskStatus | TaskPriority>(overrides: Partial<T>): T {
  return { id: 'x', key: 'X', name: 'X', description: '', color: 'gray', order: 0, isActive: true, isDefault: false, createdAt: null, updatedAt: null, ...overrides } as T
}
const backlog = lookup<TaskStatus>({ id: 's1', key: 'BACKLOG', name: 'Backlog', category: 'backlog', isDefault: true })
const dev = lookup<TaskStatus>({ id: 's2', key: 'DEV', name: 'Desenvolvimento', category: 'in_progress', order: 1 })
const media = lookup<TaskPriority>({ id: 'p2', key: 'MEDIA', name: 'Média', color: 'amber', isDefault: true })

const members: ProjectMember[] = [
  { user: { id: 'u1', name: 'Gabi', email: 'g@x.com', avatarUrl: null, status: 'active' }, role: 'manager', isOwner: true, joinedAt: null },
  { user: { id: 'u2', name: 'Lia', email: 'l@x.com', avatarUrl: null, status: 'active' }, role: 'viewer', isOwner: false, joinedAt: null },
]

const detail: TaskDetail = {
  id: 'k1',
  code: 'CRM-7',
  number: 7,
  title: 'Erro ao salvar pedido',
  project: { id: 'p1', key: 'CRM', name: 'CRM Corporativo' },
  type: { id: 't1', key: 'BUG', name: 'Bug', icon: 'bug', color: 'red' },
  status: { id: 's1', key: 'BACKLOG', name: 'Backlog', color: 'gray', category: 'backlog' },
  priority: { id: 'p2', key: 'MEDIA', name: 'Média', color: 'amber' },
  creator: { id: 'u1', name: 'Gabi', email: 'g@x.com', avatarUrl: null },
  assignee: null,
  reporter: null,
  parentTaskId: null,
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  actualHours: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date('2026-09-01T10:00:00Z'),
  updatedAt: new Date('2026-09-02T10:00:00Z'),
  description: 'Ao clicar em salvar, nada acontece.',
  customValues: { versao: '2.1', severidade: 'o1' },
  checklist: [],
  tags: [],
  checklistProgress: { done: 0, total: 0 },
  commentCount: 0,
  attachmentCount: 0,
  subtaskProgress: { done: 0, total: 0 },
  blocked: false,
  inReport: true, itVisible: false,
    urgency: null,
    area: null,
  sprint: null,
  fields: bugDetail.fields,
  parent: null, forkedFrom: null, capabilities: { edit: true, delete: false, assign: true, comment: true, link: true, fork: true },
}

function repositories(tasks: Partial<TaskRepository> = {}) {
  return fakeRepositories({
    auth: { me: async () => makeCurrentUser(['tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'projects.view']) },
    taskTypes: { list: () => Promise.resolve([bugType]), get: () => Promise.resolve(bugDetail) },
    statuses: { list: () => Promise.resolve([backlog, dev]) },
    priorities: { list: () => Promise.resolve([media]) },
    projects: { listMembers: () => Promise.resolve(members) },
    tasks,
  })
}

async function chooseOption(label: RegExp, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: label }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}

describe('TaskFormDialog', () => {
  function setup(create = vi.fn<TaskRepository['create']>(() => Promise.resolve(detail))) {
    renderRoutes([{ path: '/', element: <TaskFormDialog open projectId="p1" onOpenChange={() => {}} /> }], {
      repositories: repositories({ create }),
      initialPath: '/',
    })
    return { create }
  }

  it('escolher o tipo carrega os campos dele com os valores padrão', async () => {
    setup()
    await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^Tipo/ })).toBeEnabled())
    await chooseOption(/^Tipo/, 'Bug')
    expect(await screen.findByLabelText(/^Versão/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /^Severidade/ })).toHaveTextContent('Média')
  })

  it('valida título e campos obrigatórios do tipo antes de enviar', async () => {
    const { create } = setup()
    await chooseOption(/^Tipo/, 'Bug')
    await screen.findByLabelText(/^Versão/)
    await userEvent.click(screen.getByRole('button', { name: 'Nova tarefa' }))
    expect(await screen.findAllByText('Campo obrigatório')).toHaveLength(2)
    expect(create).not.toHaveBeenCalled()
  })

  it('cria com padrões de status/prioridade e valores por nome técnico', async () => {
    const { create } = setup()
    await chooseOption(/^Tipo/, 'Bug')
    await userEvent.type(await screen.findByLabelText(/^Versão/), '2.1')
    await userEvent.type(screen.getByLabelText(/^Título/), 'Erro ao salvar pedido')
    await userEvent.click(screen.getByRole('button', { name: 'Nova tarefa' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      projectId: 'p1',
      taskTypeId: 't1',
      title: 'Erro ao salvar pedido',
      statusId: 's1',
      priorityId: 'p2',
      customValues: { versao: '2.1', severidade: 'o2' },
    })
  })

  it('leitor do projeto não aparece como responsável; erros do servidor voltam ao campo', async () => {
    const create = vi.fn<TaskRepository['create']>(() =>
      Promise.reject(new AppError({ code: 'VALIDATION_ERROR', message: 'x', status: 400, details: { fields: { 'custom_values.versao': 'too_long' } } })),
    )
    setup(create)
    await chooseOption(/^Tipo/, 'Bug')
    await userEvent.click(screen.getByRole('combobox', { name: /^Responsável/ }))
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByRole('option', { name: 'Gabi' })).toBeInTheDocument()
    expect(within(listbox).queryByRole('option', { name: 'Lia' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.type(await screen.findByLabelText(/^Versão/), '2.1')
    await userEvent.type(screen.getByLabelText(/^Título/), 'Erro')
    await userEvent.click(screen.getByRole('button', { name: 'Nova tarefa' }))
    expect(await screen.findByText('Muito longo')).toBeInTheDocument()
  })
})

describe('TaskDetailPage', () => {
  function setup(task: TaskDetail = detail, update = vi.fn<TaskRepository['update']>(() => Promise.resolve(task))) {
    renderRoutes([{ path: '/tasks/:taskId', element: <TaskDetailPage /> }], {
      repositories: repositories({
        get: () => Promise.resolve(task),
        update,
        history: () =>
          Promise.resolve({
            items: [
              {
                id: 'a1',
                entityType: 'task',
                entityId: 'k1',
                action: 'task.updated',
                oldValue: { 'cf:Severidade': 'Média', task_status: 'Backlog' },
                newValue: { 'cf:Severidade': 'Alta', task_status: 'Desenvolvimento' },
                user: { id: 'u1', name: 'Gabi', email: 'g@x.com' },
                ip: '',
                userAgent: '',
                correlationId: '',
                createdAt: new Date('2026-09-02T10:00:00Z'),
              },
            ],
            page: 1,
            perPage: 100,
            total: 1,
            totalPages: 1,
          }),
      }),
      initialPath: '/tasks/k1',
    })
    return { update }
  }

  it('mostra valores dos campos com rótulos das opções', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: 'Erro ao salvar pedido' })).toBeInTheDocument()
    expect(screen.getByText('2.1')).toBeInTheDocument()
    expect(screen.getAllByText('Alta').length).toBeGreaterThan(0)
  })

  it('troca rápida de status envia só o status', async () => {
    const { update } = setup()
    await screen.findByRole('heading', { name: 'Erro ao salvar pedido' })
    await chooseOption(/^Status/, 'Desenvolvimento')
    await waitFor(() => expect(update).toHaveBeenCalledWith('k1', { statusId: 's2' }))
  })

  it('sem permissão de edição, as trocas rápidas ficam bloqueadas', async () => {
    setup({ ...detail, parent: null, forkedFrom: null, capabilities: { edit: false, delete: false, assign: false, comment: true, link: false, fork: false } })
    await screen.findByRole('heading', { name: 'Erro ao salvar pedido' })
    expect(screen.getByRole('combobox', { name: /^Status/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
  })

  it('histórico mostra campos personalizados pelo rótulo', async () => {
    setup()
    await userEvent.click(await screen.findByRole('tab', { name: 'Histórico' }))
    expect((await screen.findAllByText(/Severidade/)).length).toBeGreaterThan(0)
    expect(screen.getByText('Atualizou a tarefa', { exact: false })).toBeInTheDocument()
  })
})

describe('Status: só as transições permitidas', () => {
  const redo = lookup<TaskStatus>({ id: 's3', key: 'REDESENVOLVER', name: 'Redesenvolver', category: 'in_progress', order: 2, allowedNext: ['s4'] })
  const homolog = lookup<TaskStatus>({ id: 's4', key: 'HOMOLOGACAO', name: 'Homologação', category: 'in_progress', order: 3 })
  const inRedo: TaskDetail = { ...detail, status: { id: 's3', key: 'REDESENVOLVER', name: 'Redesenvolver', color: 'gray', category: 'in_progress' } }
  const repos = (task: TaskDetail) =>
    fakeRepositories({
      auth: { me: async () => makeCurrentUser(['tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'projects.view']) },
      taskTypes: { list: () => Promise.resolve([bugType]), get: () => Promise.resolve(bugDetail) },
      statuses: { list: () => Promise.resolve([backlog, dev, redo, homolog]) },
      priorities: { list: () => Promise.resolve([media]) },
      projects: { listMembers: () => Promise.resolve(members) },
      tasks: { get: () => Promise.resolve(task), history: () => Promise.resolve({ items: [], page: 1, perPage: 100, total: 0, totalPages: 0 }) },
    })
  const optionNames = async (label: RegExp) => {
    await userEvent.click(screen.getByRole('combobox', { name: label }))
    const names = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
    await userEvent.keyboard('{Escape}')
    return names
  }

  it('editar: lista o status atual e os destinos permitidos', async () => {
    renderRoutes([{ path: '/', element: <TaskFormDialog open task={inRedo} onOpenChange={() => {}} /> }], { repositories: repos(inRedo), initialPath: '/' })
    await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^Status/ })).toHaveTextContent('Redesenvolver'))
    expect(await optionNames(/^Status/)).toEqual(['Redesenvolver', 'Homologação'])
  })

  it('troca rápida: mesma regra; sem transições configuradas, todos', async () => {
    renderRoutes([{ path: '/tasks/:taskId', element: <TaskDetailPage /> }], { repositories: repos(inRedo), initialPath: '/tasks/k1' })
    await screen.findByRole('heading', { name: 'Erro ao salvar pedido' })
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^Status/ })).toHaveTextContent('Redesenvolver'))
    expect(await optionNames(/^Status/)).toEqual(['Redesenvolver', 'Homologação'])
  })

  it('status sem transições (Backlog): todos aparecem', async () => {
    renderRoutes([{ path: '/tasks/:taskId', element: <TaskDetailPage /> }], { repositories: repos(detail), initialPath: '/tasks/k1' })
    await screen.findByRole('heading', { name: 'Erro ao salvar pedido' })
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^Status/ })).toHaveTextContent('Backlog'))
    expect(await optionNames(/^Status/)).toEqual(['Backlog', 'Desenvolvimento', 'Redesenvolver', 'Homologação'])
  })
})

describe('TasksTable: escolher o que sai no informe do projeto', () => {
  it('o botão liga/desliga a tarefa no informe e só aparece na aba do projeto', async () => {
    const setInReport = vi.fn<TaskRepository['setInReport']>(() => Promise.resolve({ ...detail, inReport: false }))
    const list = vi.fn<TaskRepository['list']>(() => Promise.resolve({ items: [detail], page: 1, perPage: 20, total: 1, totalPages: 1 }))
    renderRoutes([{ path: '/', element: <TasksTable tableId="report-test" projectId="p1" /> }], {
      repositories: repositories({ list, setInReport }),
      initialPath: '/',
    })
    await userEvent.click(await screen.findByRole('button', { name: i18n.t('tasks.report.remove') }))
    await waitFor(() => expect(setInReport).toHaveBeenCalledWith(detail.id, false))
  })

  it('fora do projeto (página Tarefas), não há o botão', async () => {
    const list = vi.fn<TaskRepository['list']>(() => Promise.resolve({ items: [detail], page: 1, perPage: 20, total: 1, totalPages: 1 }))
    renderRoutes([{ path: '/', element: <TasksTable tableId="report-test-2" /> }], { repositories: repositories({ list }), initialPath: '/' })
    await screen.findByText(detail.title)
    expect(screen.queryByRole('button', { name: i18n.t('tasks.report.remove') })).not.toBeInTheDocument()
  })
})

describe('TasksTable: urgencia (semáforo)', () => {
  it('la celda muestra la urgencia y quien edita la cambia con un clic', async () => {
    const setUrgency = vi.fn<TaskRepository['setUrgency']>(() => Promise.resolve({ ...detail, urgency: 'high' }))
    const list = vi.fn<TaskRepository['list']>(() => Promise.resolve({ items: [detail], page: 1, perPage: 20, total: 1, totalPages: 1 }))
    renderRoutes([{ path: '/', element: <TasksTable tableId="urgency-test" projectId="p1" /> }], { repositories: repositories({ list, setUrgency }), initialPath: '/' })
    const trigger = await screen.findByRole('button', { name: i18n.t('tasks.urgency.change', { code: detail.code, urgency: i18n.t('tasks.urgency.none') }) })
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('menuitem', { name: i18n.t('tasks.urgency.high') }))
    await waitFor(() => expect(setUrgency).toHaveBeenCalledWith(detail.id, 'high'))
  })
})
