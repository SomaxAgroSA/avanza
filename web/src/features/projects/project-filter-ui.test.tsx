import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { AppError } from '@/core/errors/app-error'
import { DEFAULT_PROJECT_FILTER, type ProjectFilterSettings } from '@/domain/project-filter'
import type { Project, ProjectRole, ProjectStatus } from '@/domain/projects'
import type { PreferenceRepository, ReportRepository } from '@/domain/repositories'
import { notify } from '@/presentation/components'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { TasksTable } from '@/features/tasks/TasksTable'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { ProjectFilterSettingsButton } from './ProjectFilterSettings'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

function project(id: string, key: string, status: ProjectStatus, myRole: ProjectRole | null): Project {
  return {
    id,
    key,
    name: `Projeto ${key}`,
    description: '',
    platformUrl: '',
    icon: 'folder',
    cover: 'blue',
    status,
    priority: 'medium',
    urgency: null,
    area: null,
    parent: null,
    childCount: 0,
    owner: null,
    startDate: null,
    dueDate: null,
    archivedAt: null,
    createdAt: null,
    updatedAt: null,
    memberCount: 1,
    myRole,
    capabilities: { edit: false, manageMembers: false, archive: false, delete: false, transfer: false, uploadFiles: false, sections: [] },
  }
}

// CRM: em andamento, participo · ERP: planejamento, não participo · OLD: concluído, participo
const projects = [project('p1', 'CRM', 'active', 'member'), project('p2', 'ERP', 'planning', null), project('p3', 'OLD', 'completed', 'owner')]

function setup(element: React.ReactNode, saved: ProjectFilterSettings = DEFAULT_PROJECT_FILTER, overrides: Partial<PreferenceRepository> = {}, path = '/') {
  const getProjectFilter = vi.fn<PreferenceRepository['getProjectFilter']>(() => Promise.resolve(saved))
  const saveProjectFilter = vi.fn<PreferenceRepository['saveProjectFilter']>((_screen, settings) => Promise.resolve(settings ?? DEFAULT_PROJECT_FILTER))
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(['projects.view', 'tasks.view', 'reports.view']) },
    projects: { list: () => Promise.resolve({ items: projects, page: 1, perPage: 100, total: projects.length, totalPages: 1 }) },
    preferences: { getProjectFilter, saveProjectFilter, ...overrides },
    reports: { get: vi.fn<ReportRepository['get']>(() => new Promise(() => {})) },
  })
  const utils = renderRoutes([{ path: '/', element }], { repositories, initialPath: path })
  return { ...utils, getProjectFilter, saveProjectFilter }
}

const gear = (active = false) => screen.findByRole('button', { name: active ? 'Configurar filtro de projetos (ativo nesta tela)' : 'Configurar filtro de projetos' })

describe('Configurador do filtro de projetos', () => {
  it('marca status e "só projetos de que participo", salvando a cada mudança na chave da tela', async () => {
    const { saveProjectFilter, getProjectFilter } = setup(<ProjectFilterSettingsButton screen="kanban" />)
    await userEvent.click(await gear())
    const dialog = await screen.findByRole('dialog', { name: 'Filtro de projetos desta tela' })
    expect(getProjectFilter).toHaveBeenCalledWith('kanban')
    expect(within(dialog).getByRole('checkbox', { name: 'Todos' })).toBeChecked()
    // a observação "só a lista" é das telas de um projeto por vez (Tarefas, Relatórios)
    expect(within(dialog).queryByText(/“Todos” continua mostrando/)).not.toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Em andamento' }))
    expect(saveProjectFilter).toHaveBeenLastCalledWith('kanban', { statuses: ['active'], membersOnly: false })
    expect(within(dialog).getByRole('checkbox', { name: 'Todos' })).not.toBeChecked()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Planejamento' }))
    expect(saveProjectFilter).toHaveBeenLastCalledWith('kanban', { statuses: ['planning', 'active'], membersOnly: false })
    await userEvent.click(within(dialog).getByRole('switch', { name: /Só projetos de que participo/ }))
    expect(saveProjectFilter).toHaveBeenLastCalledWith('kanban', { statuses: ['planning', 'active'], membersOnly: true })

    // configuração ativa: a engrenagem avisa (nome e marcador)
    expect(await gear(true)).toHaveAttribute('data-active', 'true')

    // "Todos" limpa os status; "Restaurar padrão" volta tudo (null na API)
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Todos' }))
    expect(saveProjectFilter).toHaveBeenLastCalledWith('kanban', { statuses: [], membersOnly: true })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restaurar padrão' }))
    expect(saveProjectFilter).toHaveBeenLastCalledWith('kanban', null)
    expect(within(dialog).getByRole('button', { name: 'Restaurar padrão' })).toBeDisabled()

    // Esc fecha e devolve o foco à engrenagem
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await gear()).toHaveFocus()
  })

  it('erro ao salvar: volta ao valor anterior e avisa', async () => {
    const error = vi.spyOn(notify, 'error').mockImplementation(() => 'id')
    setup(<ProjectFilterSettingsButton screen="tasks" />, DEFAULT_PROJECT_FILTER, {
      saveProjectFilter: () => Promise.reject(new AppError({ status: 500, code: 'INTERNAL_ERROR', message: 'x' })),
    })
    await userEvent.click(await gear())
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/“Todos” continua mostrando todos os projetos/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Pausado' }))
    await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: 'Pausado' })).not.toBeChecked())
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Não foi possível salvar o filtro de projetos.'))
  })

  it('Relatórios: a lista do filtro de projeto respeita a configuração da tela', async () => {
    const { getProjectFilter } = setup(<ReportsPage />, { statuses: ['planning'], membersOnly: false })
    await waitFor(() => expect(getProjectFilter).toHaveBeenCalledWith('reports'))
    await gear(true)
    await userEvent.click(screen.getByRole('combobox', { name: 'Projeto' }))
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Projeto: todos', 'ERP · Projeto ERP']))
  })

  it('Tarefas: a lista do filtro de projeto respeita a configuração da tela', async () => {
    const { getProjectFilter } = setup(<TasksTable tableId="tasks-filter-test" />, { statuses: [], membersOnly: true })
    await waitFor(() => expect(getProjectFilter).toHaveBeenCalledWith('tasks'))
    await gear(true)
    await userEvent.click(screen.getByRole('combobox', { name: 'Projeto' }))
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos', 'CRM · Projeto CRM', 'OLD · Projeto OLD']))
  })
})
