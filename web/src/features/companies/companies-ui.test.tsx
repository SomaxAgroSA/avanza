/**
 * Empresa (§46) nas telas: formulário do projeto, da demanda interna (primeiro campo da direita) e da tarefa
 * de projeto (só leitura, herdada do projeto), a coluna e o filtro Empresa da Lista de tarefas, o filtro
 * Empresa da aba Todas das demandas e as propriedades da tarefa.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { Company } from '@/domain/companies'
import type { Project } from '@/domain/projects'
import type { DemandRepository, ProjectRepository, TaskRepository } from '@/domain/repositories'
import type { TaskType } from '@/domain/task-config'
import type { TaskDetail, TaskSummary } from '@/domain/tasks'
import type { Area, TaskPriority, TaskStatus } from '@/domain/workflow'
import { fakeRepositories, makeCurrentUser, renderRoutes, typeTexts } from '@/test/utils'
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog'
import { TaskFormDialog } from '@/features/tasks/TaskFormDialog'
import { TasksTable } from '@/features/tasks/TasksTable'
import { TaskProperties } from '@/features/tasks/TaskProperties'
import { DemandsPage } from '@/features/demands/DemandsPage'
import { EMPTY_DEMAND_COUNTS } from '@/domain/demands'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
beforeEach(() => {
  window.localStorage.removeItem('kamban.table.company-tasks')
})

const company = (id: string, name: string, extra: Partial<Company> = {}): Company => ({
  id,
  name,
  shortCode: '',
  active: true,
  projectCount: 0,
  demandCount: 0,
  usageCount: 0,
  createdAt: null,
  updatedAt: null,
  ...extra,
})
const somax = company('c1', 'Somax Paraguay', { shortCode: 'SMX' })
const agro = company('c2', 'Agro SA')
const ana = { id: 'u1', name: 'Ana Souza', email: 'u1@x.com', avatarUrl: null }
const cesar = { id: 'u2', name: 'César', email: 'u2@x.com', avatarUrl: null }

function lookup<T extends TaskStatus | TaskPriority | Area>(overrides: Partial<T>): T {
  return { id: 'x', key: 'X', name: 'X', description: '', color: 'gray', order: 0, isActive: true, isDefault: false, createdAt: null, updatedAt: null, ...overrides } as T
}
const backlog = lookup<TaskStatus>({ id: 's1', key: 'BACKLOG', name: 'Backlog', category: 'backlog', isDefault: true })
const media = lookup<TaskPriority>({ id: 'p2', key: 'MEDIA', name: 'Média', color: 'amber', isDefault: true })
const estrategia = lookup<Area>({ id: 'a1', key: 'EST', name: 'Estratégia', color: 'blue' })
const devType: TaskType = { id: 't1', key: 'DEV', name: 'Desenvolvimento', description: '', translations: typeTexts('Desenvolvimento'), icon: 'code', color: 'blue', order: 0, isActive: true, fieldCount: 0, createdAt: null, updatedAt: null }

function project(id: string, key: string, name: string, extra: Partial<Project> = {}): Project {
  return {
    id, key, name, description: '', platformUrl: '', icon: 'folder', cover: 'blue', status: 'active', priority: 'medium', urgency: null, area: null, company: null, parent: null,
    childCount: 0, owner: ana, lead: ana, devLead: null, startDate: null, dueDate: null, archivedAt: null, createdAt: null, updatedAt: null, memberCount: 1, myRole: 'owner',
    capabilities: { edit: true, manageMembers: true, archive: true, delete: false, transfer: true, uploadFiles: true, sections: [] },
    ...extra,
  }
}
const crm = project('p1', 'CRM', 'CRM', { company: { id: somax.id, name: somax.name, shortCode: 'SMX' } })
const erp = project('p2', 'ERP', 'ERP')

function task(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: 'k1', code: 'CRM-1', number: 1, title: 'Tarefa do CRM', project: { id: 'p1', key: 'CRM', name: 'CRM' },
    type: { id: 't1', key: 'DEV', name: 'Desenvolvimento', icon: 'code', color: 'blue' },
    status: { id: 's1', key: 'BACKLOG', name: 'Backlog', color: 'gray', category: 'backlog' },
    priority: { id: 'p2', key: 'MEDIA', name: 'Média', color: 'amber' }, sprint: null, creator: ana, assignee: null, reporter: ana, parentTaskId: null,
    startDate: null, dueDate: null, estimatedHours: null, actualHours: null, startedAt: null, completedAt: null, createdAt: null, updatedAt: null, tags: [],
    checklistProgress: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, subtaskProgress: { done: 0, total: 0 }, blocked: false, inReport: true,
    itVisible: false, urgency: null, area: null, company: { id: somax.id, name: somax.name, shortCode: 'SMX' }, planItem: null, demand: null,
    description: '', customValues: {}, checklist: [], parent: null, forkedFrom: null, fields: [],
    capabilities: { edit: true, delete: false, assign: true, comment: true, link: false, fork: false },
    ...overrides,
  }
}

const page = <T,>(items: T[]) => ({ items, page: 1, perPage: 100, total: items.length, totalPages: 1 })

function repos(extra: Parameters<typeof fakeRepositories>[0] = {}, companies: Company[] = [somax, agro]) {
  return fakeRepositories({
    auth: { me: async () => makeCurrentUser(['projects.view', 'projects.view_all', 'projects.create', 'tasks.view', 'tasks.list', 'tasks.create', 'tasks.edit', 'tasks.assign']) },
    companies: { list: () => Promise.resolve(companies) },
    taskTypes: { list: () => Promise.resolve([devType]), get: () => Promise.resolve({ ...devType, fields: [] }) },
    statuses: { list: () => Promise.resolve([backlog]) },
    priorities: { list: () => Promise.resolve([media]) },
    areas: { list: () => Promise.resolve([estrategia]) },
    demands: { owners: () => Promise.resolve([cesar]) },
    ...extra,
  })
}

/** Escolhe a opção (na lista com busca, a opção é um botão dentro da lista). */
async function chooseOption(label: RegExp | string, option: RegExp | string) {
  await userEvent.click(screen.getByRole('combobox', { name: label }))
  const listbox = await screen.findByRole('listbox')
  const button = within(listbox).queryByRole('button', { name: option })
  await userEvent.click(button ?? within(listbox).getByRole('option', { name: option }))
}

describe('Empresa no projeto (§46)', () => {
  it('com empresa ativa, é obrigatória ao criar e vai no corpo', async () => {
    const create = vi.fn<ProjectRepository['create']>(() => Promise.resolve({ ...crm }))
    renderRoutes(
      [
        { path: '/projects', element: <ProjectFormDialog open onOpenChange={() => {}} /> },
        { path: '/projects/:id', element: <p>detalhe</p> },
      ],
      { repositories: repos({ projects: { create } }), initialPath: '/projects' },
    )
    await userEvent.type(await screen.findByLabelText(/^Nome/), 'CRM Corporativo')
    const field = await screen.findByRole('combobox', { name: /^Empresa/ })
    await userEvent.click(screen.getByRole('button', { name: 'Novo projeto' }))
    expect(await screen.findByText('Campo obrigatório')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
    // sem a opção "Sem empresa" quando há empresa ativa
    await userEvent.click(field)
    expect(within(await screen.findByRole('listbox')).queryByRole('option', { name: 'Sem empresa' })).toBeNull()
    await userEvent.keyboard('{Escape}')
    await chooseOption(/^Empresa/, 'Agro SA')
    await userEvent.click(screen.getByRole('button', { name: 'Novo projeto' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]?.[0]).toMatchObject({ name: 'CRM Corporativo', companyId: 'c2' })
  })

  it('sem empresa cadastrada, o campo é opcional ("Sem empresa")', async () => {
    const create = vi.fn<ProjectRepository['create']>(() => Promise.resolve({ ...erp }))
    renderRoutes(
      [
        { path: '/projects', element: <ProjectFormDialog open onOpenChange={() => {}} /> },
        { path: '/projects/:id', element: <p>detalhe</p> },
      ],
      { repositories: repos({ projects: { create } }, []), initialPath: '/projects' },
    )
    await userEvent.type(await screen.findByLabelText(/^Nome/), 'ERP')
    expect(screen.getByRole('combobox', { name: /^Empresa/ })).toHaveTextContent('Sem empresa')
    await userEvent.click(screen.getByRole('button', { name: 'Novo projeto' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]?.[0].companyId).toBeUndefined()
  })
})

describe('Empresa na demanda interna e na tarefa de projeto (§46)', () => {
  it('Nova demanda interna: Empresa é o primeiro campo da direita, obrigatória, sem dica; vai no corpo', async () => {
    const create = vi.fn<DemandRepository['create']>(() => Promise.resolve(task({ id: 'd1', code: 'DEM-1', project: null, demand: { status: 'unassigned', owner: cesar, dueAt: null, openedAt: new Date() } })))
    renderRoutes([{ path: '/', element: <TaskFormDialog open initialKind="demand" onOpenChange={() => {}} /> }], {
      repositories: repos({ demands: { owners: () => Promise.resolve([cesar]), create } }),
      initialPath: '/',
    })
    const dialog = await screen.findByRole('dialog')
    const aside = within(dialog).getByRole('complementary', { name: 'Propriedades' })
    const first = within(aside).getAllByRole('combobox')[0]!
    expect(first).toHaveAccessibleName(/^Empresa/)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar demanda' }))
    expect(await within(dialog).findAllByText('Campo obrigatório')).toHaveLength(5)
    await chooseOption(/^Empresa/, 'Somax Paraguay')
    await chooseOption(/^Tipo/, 'Desenvolvimento')
    await userEvent.type(within(dialog).getByLabelText(/^Título/), 'Pedido')
    await chooseOption(/^Responsável/, /César/)
    await chooseOption(/^Departamento que pede/, 'Estratégia')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar demanda' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]?.[0]).toMatchObject({ companyId: 'c1', areaId: 'a1', ownerId: 'u2' })
  })

  it('Nova tarefa de projeto: Empresa só leitura, acompanha o projeto escolhido ("Sem empresa" no projeto sem empresa)', async () => {
    renderRoutes([{ path: '/', element: <TaskFormDialog open initialKind="project" onOpenChange={() => {}} /> }], {
      repositories: repos({ projects: { list: () => Promise.resolve(page([crm, erp])) } }),
      initialPath: '/',
    })
    const dialog = await screen.findByRole('dialog')
    const aside = within(dialog).getByRole('complementary', { name: 'Propriedades' })
    expect(within(aside).queryByRole('combobox', { name: /^Empresa/ })).toBeNull()
    expect(within(aside).getByText('Empresa')).toBeInTheDocument()
    await chooseOption(/^Projeto/, 'CRM · CRM')
    expect(await within(aside).findByText('Somax Paraguay')).toBeInTheDocument()
    await chooseOption(/^Projeto/, 'ERP · ERP')
    expect(await within(aside).findByText('Sem empresa')).toBeInTheDocument()
  })

  it('propriedades da tarefa mostram a Empresa (chip com o nome)', async () => {
    renderRoutes([{ path: '/', element: <TaskProperties task={task()} /> }], { repositories: repos(), initialPath: '/' })
    const label = await screen.findByText('Empresa')
    expect(label.closest('div')).toHaveTextContent('Somax Paraguay')
  })
})

describe('Listas: coluna e filtro Empresa (§46)', () => {
  it('Lista de tarefas: coluna Empresa visível (chip ou "—") e o filtro Empresa manda company', async () => {
    const list = vi.fn<TaskRepository['list']>(() => Promise.resolve(page<TaskSummary>([task(), task({ id: 'k2', code: 'ERP-1', title: 'Sem empresa aqui', project: { id: 'p2', key: 'ERP', name: 'ERP' }, company: null })])))
    renderRoutes([{ path: '/tasks', element: <TasksTable tableId="company-tasks" /> }], { repositories: repos({ tasks: { list } }), initialPath: '/tasks' })
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: /Empresa/ })).toBeInTheDocument()
    expect((await within(table).findByText('Tarefa do CRM')).closest('tr')).toHaveTextContent('Somax Paraguay')
    expect(within(table).getByText('Sem empresa aqui').closest('tr')).toHaveTextContent('—')
    await userEvent.click(screen.getByRole('combobox', { name: 'Empresa' }))
    await userEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Agro SA' }))
    await waitFor(() => expect(list.mock.calls.at(-1)?.[0].filters).toMatchObject({ company: 'c2' }))
  })

  it('Demandas → Todas: filtro Empresa ao lado de Responsável e Atribuída a', async () => {
    const list = vi.fn<DemandRepository['list']>(() => Promise.resolve(page<TaskSummary>([])))
    renderRoutes([{ path: '/tasks/demands', element: <DemandsPage /> }], {
      repositories: repos({
        demands: { list, owners: () => Promise.resolve([cesar]), overview: () => Promise.resolve({ counts: EMPTY_DEMAND_COUNTS, team: [], allTeam: [] }) },
      }),
      initialPath: '/tasks/demands?box=all',
    })
    const filters = await screen.findByRole('group', { name: 'Filtros das demandas' })
    expect(within(filters).getByRole('combobox', { name: 'Empresa' })).toHaveTextContent('Todas')
    await chooseOption('Empresa', 'Somax Paraguay')
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('all', { companyId: 'c1' }))
  })
})
