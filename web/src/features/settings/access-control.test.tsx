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

const role = (id: string, code: string, name: string, permissions: Role['permissions'], userCount: number): Role => ({ id, code, name, description: '', isSystem: false, ongoingView: '', permissions, userCount })
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

  it('§38: página de inicio de la persona, junto al perfil; solo pantallas que ella puede abrir', async () => {
    const { updateUser } = setup()
    const select = await screen.findByRole('combobox', { name: 'Página de inicio' })
    expect(select).toHaveTextContent('Automática (Proyectos › Todos mis proyectos)')
    await userEvent.click(select)
    // el perfil Miembro no ve Kanban ni Documentación: no se ofrecen
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
      'Automática (Proyectos › Todos mis proyectos)',
      'Panorama',
      'Proyectos › Todos mis proyectos',
      'Proyectos › En marcha',
      'Proyectos › Terminados',
      'Proyectos › Archivados',
    ])
    await userEvent.click(screen.getByRole('option', { name: 'Proyectos › En marcha' }))
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('u2', { homePage: '/projects/ongoing' }))
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

  it('§44: «Lista de tareas» es un módulo con interruptor propio, justo después de Tareas; prenderlo lleva también «ver tareas»', async () => {
    const { createRole } = setup()
    const list = await screen.findByRole('switch', { name: 'Ver Lista de tareas' })
    expect(list).not.toBeChecked()
    expect(screen.getByText(i18n.t('taskList.moduleHint'))).toBeInTheDocument()
    const switches = screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label'))
    expect(switches.indexOf('Ver Lista de tareas')).toBe(switches.indexOf('Ver Tareas') + 1)
    await userEvent.click(list)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Crear perfil propio para Douglas' }))
    await waitFor(() => expect(createRole).toHaveBeenCalledOnce())
    const [data] = createRole.mock.calls[0] as unknown as [{ permissions: string[] }]
    expect(data.permissions).toEqual(expect.arrayContaining(['tasks.list', 'tasks.view']))
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

describe('Control de acceso: vista de En marcha por perfil (§41)', () => {
  function setupRoles(initial: Role[], initialPath = '/settings/access?tab=roles') {
    let roles = initial
    const update = vi.fn((id: string, data: { name: string; description: string; ongoingView?: Role['ongoingView'] }) => {
      roles = roles.map((r) => (r.id === id ? { ...r, ...data } : r))
      return Promise.resolve(roles.find((r) => r.id === id)!)
    })
    const createRole = vi.fn(() => Promise.resolve(role('role-custom', 'USR_DOUGLAS_MARTINS', 'Douglas Martins (personalizado)', [], 0)))
    const updateUser = vi.fn(() => Promise.resolve(douglas))
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser([...PERMISSION_CODES]) },
      users: { list: () => Promise.resolve({ items: [douglas, makeUser()], page: 1, perPage: 100, total: 2, totalPages: 1 }), update: updateUser },
      roles: { list: () => Promise.resolve(roles), update, create: createRole },
      projects: { list: () => Promise.resolve({ items: [project('p1', 'GCS', 'Gestión Comercial')], page: 1, perPage: 100, total: 1, totalPages: 1 }), listMembers: () => Promise.resolve([owner]) },
    })
    renderRoutes([{ path: '/settings/access', element: <AccessControlPage /> }], { repositories, initialPath })
    return { update, createRole }
  }

  it('el perfil se edita con "Vista de En marcha" (Gestión por defecto): guarda y vuelve a leerse', async () => {
    const { update } = setupRoles([admin, memberRole])
    const row = (await screen.findByText('Miembro')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar perfil' })
    const select = within(dialog).getByRole('combobox', { name: 'Vista de En marcha' })
    expect(select).toHaveTextContent('Gestión')
    expect(within(dialog).getByText(/panel de consulta/)).toBeInTheDocument()
    await userEvent.click(select)
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Gestión', 'Dirección y gerencia'])
    await userEvent.click(screen.getByRole('option', { name: 'Dirección y gerencia' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('role-member', { name: 'Miembro', description: '', ongoingView: 'executive' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar perfil' })).toBeNull())
    // vuelve a leerse del servidor
    await userEvent.click(within((await screen.findByText('Miembro')).closest('tr')!).getByRole('button', { name: 'Editar' }))
    expect(await screen.findByRole('combobox', { name: 'Vista de En marcha' })).toHaveTextContent('Dirección y gerencia')
  })

  it('un perfil nuevo también elige la vista', async () => {
    const { createRole } = setupRoles([admin, memberRole])
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo perfil' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo perfil' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Código/ }), 'diretoria')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Nombre/ }), 'Dirección')
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Vista de En marcha' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Dirección y gerencia' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(createRole).toHaveBeenCalledWith({ code: 'DIRETORIA', name: 'Dirección', description: '', permissions: [], ongoingView: 'executive' }))
  })

  it('Por persona muestra la vista heredada del perfil (solo lectura; no hay opción por persona)', async () => {
    setup()
    expect(await screen.findByText('Vista de En marcha: Gestión (se cambia en el perfil)')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Vista de En marcha' })).toBeNull()
  })

  it('el perfil propio de una persona hereda la vista del perfil compartido', async () => {
    const { createRole } = setupRoles([admin, { ...memberRole, ongoingView: 'executive' }], '/settings/access')
    expect(await screen.findByText('Vista de En marcha: Dirección y gerencia (se cambia en el perfil)')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Ficha' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Crear perfil propio para Douglas' }))
    await waitFor(() => expect(createRole).toHaveBeenCalledOnce())
    const [data] = createRole.mock.calls[0] as unknown as [{ ongoingView: string }]
    expect(data.ongoingView).toBe('executive')
  })
})
