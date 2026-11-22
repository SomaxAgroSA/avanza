import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { Project } from '@/domain/projects'
import type { ProjectPage } from '@/domain/repositories'
import type { PermissionCode } from '@/domain/permissions'
import { fakeRepositories, makeCurrentUser, makeRole, makeUser, renderRoutes } from '@/test/utils'
import { ProjectsPage } from '@/features/projects/ProjectsPage'
import { UsersPage } from '@/features/users/UsersPage'
import { RolesPage } from './RolesPage'

/**
 * "Colunas e ações" e nomes das colunas em todos os módulos (§44): telas representativas — Projetos,
 * Usuários e Perfis. Excluir (Arquivar, Desativar) começa desligado e fica no ···; o nome de cada coluna
 * se edita no menu e quem tem platform.manage pode usá-lo para todos.
 */

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
beforeEach(() => {
  window.localStorage.clear()
})

const PROJECT = {
  id: 'p1',
  key: 'SB',
  name: 'Somax BR',
  description: '',
  status: 'active',
  priority: 'medium',
  urgency: null,
  area: null,
  icon: 'folder',
  cover: 'violet',
  owner: { id: 'u1', name: 'Ana Souza', email: 'ana@x.com', avatarUrl: null },
  lead: null,
  devLead: null,
  parent: null,
  childCount: 0,
  memberCount: 3,
  myRole: 'owner',
  startDate: null,
  dueDate: null,
  archivedAt: null,
  createdAt: null,
  capabilities: { edit: true, archive: true, delete: true, sections: [] },
} as unknown as Project

const PAGE = { items: [PROJECT], page: 1, perPage: 20, total: 1, totalPages: 1 } as unknown as ProjectPage

describe('Projetos — Colunas e ações', () => {
  function setup(permissions: PermissionCode[] = ['projects.view', 'projects.edit'], platform = {}) {
    const archive = vi.fn(() => Promise.resolve(PROJECT))
    const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(permissions) }, projects: { list: () => Promise.resolve(PAGE), archive }, platform })
    renderRoutes([{ path: '/projects', element: <ProjectsPage view="ongoing" /> }], { repositories, initialPath: '/projects' })
    return { archive }
  }

  it('Arquivar (o Excluir da lista) começa desligado e aparece uma vez só no ···; ligado, volta à linha', async () => {
    setup()
    const row = (await screen.findByText('Somax BR')).closest('tr')!
    expect(within(row).getByRole('button', { name: 'Visualizar' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Arquivar' })).not.toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Mais ações' }))
    expect(await screen.findAllByRole('menuitem', { name: 'Arquivar' })).toHaveLength(1)
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('button', { name: 'Colunas e ações' }))
    const menu = await screen.findByRole('dialog', { name: 'Colunas e ações' })
    const archiveOption = within(menu).getByRole('checkbox', { name: 'Arquivar' })
    expect(archiveOption).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(archiveOption)
    expect(within(row).getByRole('button', { name: 'Arquivar' })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('kamban.table.projects-ongoing') ?? '{}').rowActions).toMatchObject({ delete: true })
  })

  it('o nome da coluna muda no cabeçalho e vale para todas as visões de Projetos (id "projects")', async () => {
    setup()
    await screen.findByText('Somax BR')
    await userEvent.click(screen.getByRole('button', { name: 'Colunas e ações' }))
    const input = within(await screen.findByRole('dialog', { name: 'Colunas e ações' })).getByRole('textbox', { name: 'Nome da coluna Nome' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Projeto{Enter}')
    expect(screen.getByRole('button', { name: 'Projeto' })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('kamban.table.projects.labels') ?? '{}')).toEqual({ name: 'Projeto' })
  })

  it('nome definido para todos aparece para quem não é admin, sem a caixa "para todos"', async () => {
    setup(['projects.view'], { getTableColumnLabels: () => Promise.resolve({ projects: { name: 'Iniciativa' } }) })
    expect(await screen.findByRole('button', { name: 'Iniciativa' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Colunas e ações' }))
    const menu = await screen.findByRole('dialog', { name: 'Colunas e ações' })
    expect(within(menu).getByRole('textbox', { name: 'Nome da coluna Nome' })).toHaveValue('Iniciativa')
    expect(within(menu).queryByRole('checkbox', { name: 'Usar estes nomes para todos' })).not.toBeInTheDocument()
  })
})

describe('Usuários — Colunas e ações', () => {
  it('Desativar começa fora da linha (no ···, com esse nome no menu); admin grava o nome da coluna para todos', async () => {
    const updateTableColumnLabels = vi.fn((tableId: string, labels: Record<string, string>) => Promise.resolve({ [tableId]: labels }))
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(['users.view', 'users.edit', 'users.disable', 'platform.manage']) },
      users: { list: () => Promise.resolve({ items: [makeUser({ id: 'u2', name: 'Beto Lima', roleId: 'role-member' })], page: 1, perPage: 20, total: 1, totalPages: 1 }) },
      roles: { list: () => Promise.resolve([makeRole({ id: 'role-member', code: 'MEMBER', name: 'Membro' })]) },
      platform: { updateTableColumnLabels },
    })
    renderRoutes([{ path: '/users', element: <UsersPage /> }], { repositories, initialPath: '/users' })
    const row = (await screen.findByText('Beto Lima')).closest('tr')!
    expect(within(row).queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Colunas e ações' }))
    const menu = await screen.findByRole('dialog', { name: 'Colunas e ações' })
    expect(within(menu).getByRole('checkbox', { name: 'Desativar' })).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(await within(menu).findByRole('checkbox', { name: 'Usar estes nomes para todos' }))
    const input = within(menu).getByRole('textbox', { name: 'Nome da coluna Perfil' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Papel{Enter}')
    await waitFor(() => expect(updateTableColumnLabels).toHaveBeenLastCalledWith('users', { role_id: 'Papel' }))
    expect(screen.getByRole('columnheader', { name: /^Papel/ })).toBeInTheDocument()
  })
})

describe('Perfis — Colunas e ações', () => {
  it('Excluir desligado (no ···); a coluna Perfil, que identifica a linha, não se oculta; Restaurar nomes', async () => {
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(['permissions.manage']) },
      roles: { list: () => Promise.resolve([makeRole({ id: 'r1', code: 'AUDITOR', name: 'Auditor', isSystem: false })]) },
    })
    renderRoutes([{ path: '/settings/roles', element: <RolesPage /> }], { repositories, initialPath: '/settings/roles' })
    const row = (await screen.findByText('Auditor')).closest('tr')!
    expect(within(row).queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Mais ações' }))
    expect(await screen.findByRole('menuitem', { name: 'Excluir' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('button', { name: 'Colunas e ações' }))
    const menu = await screen.findByRole('dialog', { name: 'Colunas e ações' })
    const nameColumn = within(menu).getAllByRole('checkbox')[0]!
    expect(nameColumn).toBeDisabled()
    const input = within(menu).getByRole('textbox', { name: 'Nome da coluna Descrição' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Para que serve')
    await userEvent.tab()
    expect(screen.getByRole('columnheader', { name: /^Para que serve/ })).toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('button', { name: 'Restaurar nomes' }))
    expect(screen.getByRole('columnheader', { name: /^Descrição/ })).toBeInTheDocument()
    expect(within(menu).queryByRole('checkbox', { name: 'Usar estes nomes para todos' })).not.toBeInTheDocument()
  })
})
