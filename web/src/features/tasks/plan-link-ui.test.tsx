import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { AppError } from '@/core/errors/app-error'
import type { Plan, PlanItem } from '@/domain/plan'
import type { PermissionCode } from '@/domain/permissions'
import type { TaskRepository } from '@/domain/repositories'
import type { TaskType, TaskTypeDetail } from '@/domain/task-config'
import type { TaskDetail } from '@/domain/tasks'
import { fakeRepositories, makeCurrentUser, renderRoutes, typeTexts } from '@/test/utils'
import { TaskFormDialog } from './TaskFormDialog'
import { TaskDetailPage } from './TaskDetailPage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const item = (id: string, groupId: string, name: string, extra: Partial<PlanItem> = {}): PlanItem => ({
  id,
  groupId,
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
  ...extra,
})

const plan: Plan = {
  project: { id: 'p1', key: 'IMP', name: 'Implantação', archived: false },
  capabilities: { edit: true, manage: true },
  statuses: [],
  resources: [],
  groups: [
    { id: 'g1', parentId: null, name: 'Iniciação', color: 'blue', position: 0, number: '1.0', summary: null },
    { id: 'g2', parentId: null, name: 'Planejamento', color: 'green', position: 1, number: '2.0', summary: null },
  ],
  items: [item('i1', 'g1', 'Kickoff', { subitems: 1 }), item('s1', 'g1', 'Montar apresentação', { parentId: 'i1' }), item('i2', 'g2', 'Plano v6')],
  links: [],
  columns: [],
  settings: { dependencyRule: 'warn', baselineAt: null },
  summary: null,
  truncated: false,
}

const taskType: TaskType = { id: 't1', key: 'TASK', name: 'Tarefa', description: '', translations: typeTexts('Tarefa'), icon: 'check-square', color: 'blue', order: 0, isActive: true, fieldCount: 0, createdAt: null, updatedAt: null }
const typeDetail: TaskTypeDetail = { ...taskType, fields: [] }

const detail: TaskDetail = {
  id: 'k1',
  code: 'IMP-7',
  number: 7,
  title: 'Agendar kickoff',
  project: { id: 'p1', key: 'IMP', name: 'Implantação' },
  type: { id: 't1', key: 'TASK', name: 'Tarefa', icon: 'check-square', color: 'blue' },
  status: { id: 's1', key: 'TODO', name: 'A fazer', color: 'gray', category: 'todo' },
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
  planItem: { id: 'i1', name: 'Kickoff' },
  description: '',
  customValues: {},
  checklist: [],
  fields: [],
  parent: null,
  forkedFrom: null,
  capabilities: { edit: true, delete: false, assign: true, comment: true, link: true, fork: false },
}

const ALL: PermissionCode[] = ['tasks.view', 'tasks.edit', 'tasks.assign', 'projects.view', 'plan.view']

function repositories(permissions: PermissionCode[], tasks: Partial<TaskRepository>) {
  return fakeRepositories({
    auth: { me: async () => makeCurrentUser(permissions) },
    taskTypes: { list: () => Promise.resolve([taskType]), get: () => Promise.resolve(typeDetail) },
    plan: { get: () => Promise.resolve(plan) },
    tasks,
  })
}

function editForm(permissions: PermissionCode[] = ALL, task: TaskDetail = detail) {
  const update = vi.fn<TaskRepository['update']>(() => Promise.resolve(task))
  renderRoutes([{ path: '/', element: <TaskFormDialog open task={task} onOpenChange={() => {}} /> }], { repositories: repositories(permissions, { update }), initialPath: '/' })
  return { update }
}

const field = () => screen.findByRole('combobox', { name: /^Elemento da Gestão/ })

describe('Tarefa: campo "Elemento da Gestão"', () => {
  it('lista os elementos e subelementos agrupados por grupo; escolher envia o planItemId', async () => {
    const { update } = editForm()
    const combo = await field()
    await waitFor(() => expect(combo).toHaveTextContent('Kickoff'))
    await userEvent.click(combo)
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByText('1.0 Iniciação')).toBeInTheDocument()
    expect(within(listbox).getByText('2.0 Planejamento')).toBeInTheDocument()
    await userEvent.click(within(listbox).getByRole('button', { name: 'Montar apresentação' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(update.mock.calls[0]?.[1]).toMatchObject({ planItemId: 's1' })
  })

  it('"Nenhum" desvincula (planItemId null)', async () => {
    const { update } = editForm()
    const combo = await field()
    await waitFor(() => expect(combo).toHaveTextContent('Kickoff'))
    await userEvent.click(combo)
    await userEvent.click(within(await screen.findByRole('listbox')).getByRole('button', { name: 'Nenhum' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(update.mock.calls[0]?.[1]).toMatchObject({ planItemId: null })
  })

  it('sem mudar o campo (ou sem plan.view, sem o campo), o vínculo não vai no envio', async () => {
    const { update } = editForm(['tasks.view', 'tasks.edit', 'projects.view'])
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(screen.queryByRole('combobox', { name: /^Elemento da Gestão/ })).not.toBeInTheDocument()
    expect(update.mock.calls[0]?.[1].planItemId).toBeUndefined()
  })

  it('erro do servidor (elemento de outro projeto) volta ao campo', async () => {
    const update = vi.fn<TaskRepository['update']>(() =>
      Promise.reject(new AppError({ code: 'VALIDATION_ERROR', message: 'x', status: 400, details: { fields: { plan_item_id: 'invalid_option' } } })),
    )
    renderRoutes([{ path: '/', element: <TaskFormDialog open task={detail} onOpenChange={() => {}} /> }], { repositories: repositories(ALL, { update }), initialPath: '/' })
    const combo = await field()
    await userEvent.click(combo)
    await userEvent.click(within(await screen.findByRole('listbox')).getByRole('button', { name: 'Plano v6' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Opção inválida')).toBeInTheDocument()
  })
})

describe('Detalhe da tarefa: elemento vinculado', () => {
  it('mostra o elemento com link para abrir na Gestão do projeto', async () => {
    renderRoutes([{ path: '/tasks/:taskId', element: <TaskDetailPage /> }], {
      repositories: repositories(ALL, { get: () => Promise.resolve(detail) }),
      initialPath: '/tasks/k1',
    })
    const link = await screen.findByRole('link', { name: 'Kickoff' })
    expect(link).toHaveAttribute('href', '/projects/p1/management?item=i1')
  })
})
