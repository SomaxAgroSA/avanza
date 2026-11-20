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
    { id: 'g21', parentId: 'g2', name: 'Plano do projeto', color: 'green', position: 0, number: '2.1', summary: null },
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
  inReport: true,
  itVisible: false,
  urgency: null,
  area: null,
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

function repositories(permissions: PermissionCode[], tasks: Partial<TaskRepository>, board: Plan = plan) {
  return fakeRepositories({
    auth: { me: async () => makeCurrentUser(permissions) },
    taskTypes: { list: () => Promise.resolve([taskType]), get: () => Promise.resolve(typeDetail) },
    plan: { get: () => Promise.resolve(board) },
    tasks,
  })
}

function createForm(permissions: PermissionCode[] = ALL, board: Plan = plan) {
  const create = vi.fn<TaskRepository['create']>(() => Promise.resolve(detail))
  renderRoutes([{ path: '/', element: <TaskFormDialog open projectId="p1" onOpenChange={() => {}} /> }], {
    repositories: repositories(permissions, { create }, board),
    initialPath: '/',
  })
  return { create }
}

function editForm(permissions: PermissionCode[] = ALL, task: TaskDetail = detail) {
  const update = vi.fn<TaskRepository['update']>(() => Promise.resolve(task))
  renderRoutes([{ path: '/', element: <TaskFormDialog open task={task} onOpenChange={() => {}} /> }], {
    repositories: repositories(permissions, { update }),
    initialPath: '/',
  })
  return { update }
}

const STAGE = /^Etapa da gestão/
const field = () => screen.findByRole('combobox', { name: STAGE })

async function fillRequired() {
  const form = await screen.findByRole('dialog', { name: 'Nova tarefa' })
  await userEvent.click(within(form).getByRole('combobox', { name: /^Tipo/ }))
  await userEvent.click(clickable(await screen.findByRole('option', { name: 'Tarefa' })))
  await userEvent.type(within(form).getByLabelText(/^Título/), 'Unir a base de clientes')
  return form
}

describe('Nova tarefa: campo "Etapa da gestão"', () => {
  it('fica na coluna da esquerda, logo abaixo de Tags (Etiquetas), com as etapas numeradas e "Sem etapa" como padrão', async () => {
    createForm()
    const combo = await field()
    expect(combo).toHaveTextContent('Sem etapa')
    expect(within(screen.getByRole('complementary', { name: 'Propriedades' })).queryByRole('combobox', { name: STAGE })).not.toBeInTheDocument()
    const tags = screen.getByText('Tags')
    const stage = screen.getByText('Etapa da gestão')
    expect(tags.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // sem texto de ajuda (ajuste 20/11)
    expect(screen.queryByText(/aparece sozinha nessa etapa da Gestão/)).not.toBeInTheDocument()
    await userEvent.click(combo)
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(options).toEqual(['Sem etapa', '1.0 Iniciação', '2.0 Planejamento', '2.1 Plano do projeto'])
  })

  it('escolher a etapa envia planGroupId na criação', async () => {
    const { create } = createForm()
    const form = await fillRequired()
    await userEvent.click(await field())
    await userEvent.click(clickable(await screen.findByRole('option', { name: '2.1 Plano do projeto' })))
    await userEvent.click(within(form).getByRole('button', { name: 'Nova tarefa' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]?.[0]).toMatchObject({ projectId: 'p1', title: 'Unir a base de clientes', planGroupId: 'g21' })
  })

  it('"Sem etapa" (padrão) não manda etapa nem elemento', async () => {
    const { create } = createForm()
    const form = await fillRequired()
    await field()
    await userEvent.click(within(form).getByRole('button', { name: 'Nova tarefa' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]?.[0].planGroupId).toBeUndefined()
    expect(create.mock.calls[0]?.[0].planItemId).toBeUndefined()
  })

  it('sem plan.view o campo não aparece', async () => {
    createForm(['tasks.view', 'tasks.create', 'tasks.edit', 'projects.view'])
    await screen.findByRole('dialog', { name: 'Nova tarefa' })
    await screen.findByText('Tags')
    expect(screen.queryByRole('combobox', { name: STAGE })).not.toBeInTheDocument()
  })

  it('quadro sem etapas: o campo não aparece', async () => {
    createForm(ALL, { ...plan, groups: [], items: [] })
    await screen.findByRole('dialog', { name: 'Nova tarefa' })
    await waitFor(() => expect(screen.queryByRole('combobox', { name: STAGE })).not.toBeInTheDocument())
  })

  it('o antigo campo "Elemento da Gestão" saiu do formulário', async () => {
    createForm()
    await field()
    expect(screen.queryByRole('combobox', { name: /^Elemento da Gestão/ })).not.toBeInTheDocument()
  })
})

describe('Editar tarefa: etapa da gestão', () => {
  it('tarefa já na Gestão: mostra a etapa só para leitura, com o caminho até a linha; salvar não mexe no vínculo', async () => {
    const { update } = editForm()
    const combo = await field()
    await waitFor(() => expect(combo).toHaveTextContent('1.0 Iniciação'))
    expect(combo).toBeDisabled()
    expect(screen.getByText(/1\.0 Iniciação › Kickoff\./)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(update.mock.calls[0]?.[1].planGroupId).toBeUndefined()
    expect(update.mock.calls[0]?.[1].planItemId).toBeUndefined()
  })

  it('subelemento: o caminho mostra o elemento pai', async () => {
    editForm(ALL, { ...detail, planItem: { id: 's1', name: 'Montar apresentação' } })
    expect(await screen.findByText(/1\.0 Iniciação › Kickoff › Montar apresentação/)).toBeInTheDocument()
  })

  it('tarefa fora da Gestão: escolher a etapa envia planGroupId (o servidor cria a linha)', async () => {
    const { update } = editForm(ALL, { ...detail, planItem: null })
    const combo = await field()
    expect(combo).not.toBeDisabled()
    await userEvent.click(combo)
    await userEvent.click(clickable(await screen.findByRole('option', { name: '2.0 Planejamento' })))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(update.mock.calls[0]?.[1]).toMatchObject({ planGroupId: 'g2' })
  })

  it('erro do servidor (a tarefa já entrou na Gestão) volta ao campo', async () => {
    const update = vi.fn<TaskRepository['update']>(() =>
      Promise.reject(new AppError({ code: 'VALIDATION_ERROR', message: 'x', status: 400, details: { fields: { plan_group_id: 'already_linked' } } })),
    )
    renderRoutes([{ path: '/', element: <TaskFormDialog open task={{ ...detail, planItem: null }} onOpenChange={() => {}} /> }], {
      repositories: repositories(ALL, { update }),
      initialPath: '/',
    })
    await userEvent.click(await field())
    await userEvent.click(clickable(await screen.findByRole('option', { name: '1.0 Iniciação' })))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('A tarefa já está na Gestão')).toBeInTheDocument()
  })

  it('sem plan.view (ex.: Responsável TI), nem a etapa nem o vínculo aparecem', async () => {
    editForm(['tasks.view', 'tasks.edit', 'projects.view'])
    await screen.findByRole('dialog')
    expect(screen.queryByRole('combobox', { name: STAGE })).not.toBeInTheDocument()
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

/** Na lista com busca a opção é um botão dentro do item; nas listas simples, o próprio item. */
function clickable(option: HTMLElement): HTMLElement {
  return within(option).queryByRole('button') ?? option
}
