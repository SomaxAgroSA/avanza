import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { JournalEntry } from '@/domain/plan-management'
import type { PermissionCode } from '@/domain/permissions'
import { PROJECT_PROFILE_SECTIONS, type Project } from '@/domain/projects'
import type { ProjectRepository, TaskRepository } from '@/domain/repositories'
import type { TaskSummary } from '@/domain/tasks'
import type { Milestone, Timeline } from '@/domain/timeline'
import { fakeRepositories, makeCurrentUser, renderRoutes, renderWithProviders } from '@/test/utils'
import { ProjectChronology } from './ProjectChronology'
import { AllProjectsPage } from './ProjectsPage'
import { ProjectReportPanel } from './report/ProjectReportPanel'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

const EDIT = { edit: true, manageMembers: true, archive: true, delete: false, transfer: true, uploadFiles: true, sections: [...PROJECT_PROFILE_SECTIONS] }

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1',
  key: 'CRM',
  name: 'CRM Corporativo',
  description: '',
  icon: 'folder',
  cover: 'blue',
  status: 'active',
  priority: 'medium',
  urgency: null,
  area: null,
  parent: null,
  childCount: 0,
  owner: null,
  startDate: new Date('2026-09-22T00:00:00.000Z'),
  dueDate: null,
  archivedAt: null,
  createdAt: null,
  updatedAt: null,
  memberCount: 1,
  myRole: 'manager',
  capabilities: EDIT,
  ...overrides,
})

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const task = (n: number, start: string | null, extra: Partial<TaskSummary> = {}) =>
  ({
    id: `t${n}`,
    number: n,
    code: `CRM-${n}`,
    title: `Tarefa ${n}`,
    status: { id: 's1', key: 'DOING', name: 'Fazendo', color: 'blue', category: 'in_progress' },
    assignee: null,
    startDate: start ? day(start) : null,
    dueDate: start ? day(start) : null,
    inReport: true,
    itVisible: false,
    urgency: null,
    area: null,
    ...extra,
  }) as TaskSummary
const milestone = (id: string, dueDate: string): Milestone => ({ id, projectId: 'p1', name: `Marco ${id}`, description: '', dueDate, state: 'done', createdAt: null, updatedAt: null })
const journal = (id: string, entryDate: string, content: string): JournalEntry => ({ id, entryDate, content, author: null, createdAt: null, updatedAt: null, capabilities: { edit: false, delete: false } })
const timeline = (tasks: TaskSummary[], milestones: Milestone[] = []) => ({ tasks, milestones }) as unknown as Timeline

describe('Projetos — urgência na lista', () => {
  it('coluna com semáforo: quem edita troca com um clique; o filtro pede urgency à API', async () => {
    const list = vi.fn<ProjectRepository['list']>(() => Promise.resolve({ items: [project()], page: 1, perPage: 20, total: 1, totalPages: 1 }))
    const update = vi.fn<ProjectRepository['update']>(() => Promise.resolve(project({ urgency: 'medium' })))
    const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(['projects.view', 'projects.edit']) }, projects: { list, update } })
    renderRoutes([{ path: '/', element: <AllProjectsPage /> }], { repositories, initialPath: '/' })
    await userEvent.click(await screen.findByRole('button', { name: 'Mudar urgência de CRM Corporativo (agora: Sem urgência)' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Média' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('p1', { urgency: 'medium' }))

    await userEvent.click(screen.getByRole('combobox', { name: 'Urgência' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Sem urgência' }))
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ filters: { urgency: 'none' } })))
  })

  it('quem não edita vê só o semáforo com o nome', async () => {
    const readOnly = project({ urgency: 'high', capabilities: { ...EDIT, edit: false } })
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(['projects.view']) },
      projects: { list: () => Promise.resolve({ items: [readOnly], page: 1, perPage: 20, total: 1, totalPages: 1 }) },
    })
    renderRoutes([{ path: '/', element: <AllProjectsPage /> }], { repositories, initialPath: '/' })
    const row = (await screen.findByRole('link', { name: 'CRM Corporativo' })).closest('tr') as HTMLElement
    expect(within(row).getByText('Alta')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /Mudar urgência/ })).not.toBeInTheDocument()
  })
})

describe('Projetos — área responsável na lista', () => {
  const ti = { id: 'a1', key: 'TI', name: 'Dpto. TI', description: '', color: 'blue' as const, order: 0, isActive: true, isDefault: false, createdAt: null, updatedAt: null }

  it('coluna com a área: quem edita troca com um clique; o filtro pede area_id à API', async () => {
    const list = vi.fn<ProjectRepository['list']>(() => Promise.resolve({ items: [project()], page: 1, perPage: 20, total: 1, totalPages: 1 }))
    const update = vi.fn<ProjectRepository['update']>(() => Promise.resolve(project({ area: { id: 'a1', key: 'TI', name: 'Dpto. TI', color: 'blue' } })))
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(['projects.view', 'projects.edit']) },
      projects: { list, update },
      areas: { list: () => Promise.resolve([ti]) },
    })
    renderRoutes([{ path: '/', element: <AllProjectsPage /> }], { repositories, initialPath: '/' })
    await userEvent.click(await screen.findByRole('button', { name: 'Mudar área de CRM Corporativo (agora: Sem área)' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Dpto. TI' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('p1', { areaId: 'a1' }))

    await userEvent.click(screen.getByRole('combobox', { name: 'Área' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Dpto. TI' }))
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ filters: { area: 'a1' } })))
  })

  it('quem não edita vê só o selo da área', async () => {
    const readOnly = project({ area: { id: 'a1', key: 'TI', name: 'Dpto. TI', color: 'blue' }, capabilities: { ...EDIT, edit: false } })
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(['projects.view']) },
      projects: { list: () => Promise.resolve({ items: [readOnly], page: 1, perPage: 20, total: 1, totalPages: 1 }) },
    })
    renderRoutes([{ path: '/', element: <AllProjectsPage /> }], { repositories, initialPath: '/' })
    const row = (await screen.findByRole('link', { name: 'CRM Corporativo' })).closest('tr') as HTMLElement
    expect(within(row).getByText('Dpto. TI')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /Mudar área/ })).not.toBeInTheDocument()
  })
})

describe('Projetos — projeto pai e subprojetos na lista (§34)', () => {
  const ref = { id: 'p9', key: 'PRG', name: 'Programa Comercial', icon: 'folder' as const, cover: 'blue' as const }

  it('a linha mostra o pai (↳) e a quantidade de subprojetos; o filtro "Projeto pai" pede parent_id à API', async () => {
    const list = vi.fn<ProjectRepository['list']>((query) =>
      Promise.resolve({
        items: query.filters.parent === 'none' ? [project({ id: 'p9', key: 'PRG', name: 'Programa Comercial', childCount: 2 })] : [project({ parent: ref }), project({ id: 'p9', key: 'PRG', name: 'Programa Comercial', childCount: 2 })],
        page: 1,
        perPage: 20,
        total: 2,
        totalPages: 1,
      }),
    )
    const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(['projects.view']) }, projects: { list } })
    renderRoutes([{ path: '/', element: <AllProjectsPage /> }], { repositories, initialPath: '/' })
    const row = (await screen.findByRole('link', { name: 'CRM Corporativo' })).closest('tr') as HTMLElement
    expect(within(row).getByText(/Programa Comercial/)).toHaveAttribute('title', 'Faz parte de Programa Comercial')
    const parentRow = screen.getByRole('link', { name: 'Programa Comercial' }).closest('tr') as HTMLElement
    expect(within(parentRow).getByText(/2 subprojetos/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Mais filtros' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Projeto pai' }))
    await userEvent.click(await screen.findByRole('option', { name: 'PRG · Programa Comercial' }))
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ filters: { parent: 'p9' } })))
  })
})

describe('Histórico — linha do tempo pela data dos fatos', () => {
  function setup(permissions: PermissionCode[]) {
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(permissions) },
      timeline: { get: () => Promise.resolve(timeline([task(1, '2026-10-20'), task(2, null)], [milestone('m', '2026-10-01')])) },
      plan: { listJournal: () => Promise.resolve({ entries: [journal('j', '2026-09-22', 'Kickoff com o cliente')], capabilities: { create: false } }) },
    })
    renderRoutes([{ path: '/', element: <ProjectChronology projectId="p1" /> }], { repositories, initialPath: '/' })
  }

  it('Diário, marcos e tarefas do mais antigo ao mais recente; tarefas sem data à parte', async () => {
    setup(['projects.view', 'tasks.view', 'plan.view'])
    expect(await screen.findByText('Kickoff com o cliente')).toBeInTheDocument()
    const days = screen.getAllByRole('time').map((el) => el.getAttribute('datetime'))
    expect(days).toEqual(['2026-09-22', '2026-10-01', '2026-10-20'])
    expect(screen.getByText('Marco m')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tarefas sem data (1)' })).toBeInTheDocument()
  })

  it('sem acesso à Gestão: mostra marcos e tarefas, sem o Diário', async () => {
    setup(['projects.view', 'tasks.view'])
    expect(await screen.findByText('Marco m')).toBeInTheDocument()
    expect(screen.queryByText('Kickoff com o cliente')).not.toBeInTheDocument()
  })
})

describe('Informe do projeto', () => {
  it('conta as tarefas do informe, monta a prévia A4 e leva à escolha das tarefas', async () => {
    const onChooseTasks = vi.fn()
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(['projects.view', 'tasks.view']) },
      timeline: { get: () => Promise.resolve(timeline([task(1, '2026-10-01'), task(2, '2026-10-02', { inReport: false })], [milestone('m', '2026-10-05')])) },
      tasks: { setInReport: vi.fn<TaskRepository['setInReport']>() },
    })
    renderWithProviders(<ProjectReportPanel project={project()} onChooseTasks={onChooseTasks} />, repositories)
    expect(await screen.findByText('1 de 2 tarefas entra no informe.')).toBeInTheDocument()
    const preview = await screen.findByTitle('Prévia')
    await waitFor(() => expect(preview.getAttribute('srcdoc')).toContain('CRM-1'))
    expect(preview.getAttribute('srcdoc')).not.toContain('CRM-2')
    // sem plan.view não há o seletor de fases
    expect(screen.queryByRole('combobox', { name: /Fases/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Escolher tarefas' }))
    expect(onChooseTasks).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Baixar PDF' })).toBeEnabled()
  })
})
