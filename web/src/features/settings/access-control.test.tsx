import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { Role } from '@/domain/entities'
import type { Project, ProjectMember } from '@/domain/projects'
import { PERMISSION_CODES } from '@/domain/permissions'
import { fakeRepositories, makeCurrentUser, makeUser, renderRoutes } from '@/test/utils'
import { AccessControlPage } from './AccessControlPage'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const role = (id: string, code: string, name: string, permissions: Role['permissions'], userCount: number): Role => ({ id, code, name, description: '', isSystem: false, permissions, userCount })
const admin = role('role-admin', 'ADMIN', 'Admin', [...PERMISSION_CODES], 1)
const memberRole = role('role-member', 'MEMBER', 'Miembro', ['projects.view', 'tasks.view', 'tasks.edit', 'reports.view'], 2)
const douglas = makeUser({ id: 'u2', name: 'Douglas Martins', email: 'douglas@x.test', roleId: 'role-member' })
const project = (id: string, key: string, name: string) => ({ id, key, name, archivedAt: null }) as unknown as Project
const owner: ProjectMember = { user: { id: 'u1', name: 'Ana Souza', email: 'ana@kamban.test', avatarUrl: null, status: 'active' }, role: 'manager', isOwner: true, joinedAt: null }

function setup(initialPath = '/settings/access') {
  const createRole = vi.fn(() => Promise.resolve(role('role-custom', 'USR_DOUGLAS_MARTINS', 'Douglas Martins (personalizado)', [], 0)))
  const updateUser = vi.fn(() => Promise.resolve(douglas))
  const updatePermissions = vi.fn(() => Promise.resolve(memberRole))
  const addMember = vi.fn(() => Promise.resolve([]))
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser([...PERMISSION_CODES]) },
    users: { list: () => Promise.resolve({ items: [douglas, makeUser()], page: 1, perPage: 100, total: 2, totalPages: 1 }), update: updateUser },
    roles: { list: () => Promise.resolve([admin, memberRole]), create: createRole, updatePermissions },
    projects: {
      list: () => Promise.resolve({ items: [project('p1', 'GCS', 'Gestión Comercial'), project('p2', 'ADP', 'Aplicación del productor')], page: 1, perPage: 100, total: 2, totalPages: 1 }),
      listMembers: (id: string) => Promise.resolve(id === 'p1' ? [owner, { ...owner, user: { ...owner.user, id: 'u2', name: 'Douglas Martins' }, role: 'member' as const, isOwner: false }] : [owner]),
      addMember,
    },
  })
  const utils = renderRoutes([{ path: '/settings/access', element: <AccessControlPage /> }], { repositories, initialPath })
  return { createRole, updateUser, updatePermissions, addMember, ...utils }
}

describe('Control de acceso', () => {
  it('muestra el resumen del usuario: módulos que ve y proyectos en los que entra', async () => {
    setup()
    expect(await screen.findByText('Douglas Martins')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument())
    expect(screen.getByText('Perfil compartido por 2 personas')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Ver Kanban' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Ver Tareas' })).toBeChecked()
  })

  it('perfil compartido: el cambio puede ir a un perfil propio de la persona', async () => {
    const { createRole, updateUser, updatePermissions } = setup()
    await userEvent.click(await screen.findByRole('switch', { name: 'Ver Kanban' }))
    const dialog = await screen.findByRole('dialog', { name: 'El perfil Miembro es compartido' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear perfil propio para Douglas' }))
    await waitFor(() => expect(createRole).toHaveBeenCalledOnce())
    const [data] = createRole.mock.calls[0] as unknown as [{ code: string; permissions: string[] }]
    expect(data.code).toBe('USR_DOUGLAS_MARTINS')
    expect(data.permissions).toContain('kanban.view')
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('u2', { roleId: 'role-custom' }))
    expect(updatePermissions).not.toHaveBeenCalled()
  })

  it('da acceso a un proyecto eligiendo el papel', async () => {
    const { addMember } = setup()
    const select = await screen.findByRole('combobox', { name: 'Acceso a Aplicación del productor' })
    await userEvent.click(select)
    await userEvent.click(await screen.findByRole('option', { name: 'Lector' }))
    await waitFor(() => expect(addMember).toHaveBeenCalledWith('p2', 'u2', 'viewer'))
  })

  it('qué ve dentro de cada proyecto (§35): las secciones son etiquetas; el Resumen siempre se ve', async () => {
    const { createRole } = setup()
    const charter = await screen.findByRole('button', { name: 'Ficha' })
    expect(charter).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Resumen' })).toBeDisabled()
    // Gestión, Tareas y Kanban no se repiten como etiquetas: ya son interruptores de módulo
    expect(screen.queryByRole('button', { name: 'Tareas' })).not.toBeInTheDocument()
    await userEvent.click(charter)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Crear perfil propio para Douglas' }))
    await waitFor(() => expect(createRole).toHaveBeenCalledOnce())
    const [data] = createRole.mock.calls[0] as unknown as [{ permissions: string[] }]
    expect(data.permissions).toContain('projects.charter')
  })

  it('el papel Responsable TI está entre los accesos al proyecto', async () => {
    const { addMember } = setup()
    await userEvent.click(await screen.findByRole('combobox', { name: 'Acceso a Aplicación del productor' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Responsable TI' }))
    await waitFor(() => expect(addMember).toHaveBeenCalledWith('p2', 'u2', 'it'))
  })

  it('reúne perfiles y permisos en pestañas con dirección propia (?tab=)', async () => {
    setup('/settings/access?tab=roles')
    const tabs = await screen.findByRole('navigation', { name: 'Control de acceso' })
    expect(within(tabs).getByRole('link', { name: 'Perfiles' })).toHaveAttribute('aria-current', 'page')
    // la matriz ya no es pestaña (repetía "Por persona"): se abre desde cada perfil
    expect(within(tabs).queryByRole('link', { name: 'Permisos por perfil' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: i18n.t('roles.create') })).toBeInTheDocument()
  })
})
