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

const role = (id: string, code: string, name: string, permissions: Role['permissions'], userCount: number): Role => ({ id, code, name, description: '', isSystem: false, screens: { hidden: [], starts: {} }, permissions, userCount })
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

describe('Control de acceso: «Qué aparece» por perfil (§48)', () => {
  function setupRoles(initial: Role[], initialPath = '/settings/access?tab=roles') {
    let roles = initial
    const update = vi.fn((id: string, data: Partial<Role>) => {
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
  const SCREENS = '/settings/access?tab=roles&screens=role-member'
  const card = async (name: string) => screen.findByRole('region', { name })
  const group = async (name: RegExp) => screen.findByRole('group', { name })

  it('cada módulo con «Lo ve», «Qué puede hacer» y «Qué aparece»; Kanban y Usuarios solo «Lo ve»', async () => {
    setupRoles([admin, memberRole], SCREENS)
    const projects = await card('Proyectos')
    expect(within(projects).getByText('Lo ve')).toBeInTheDocument()
    expect(within(projects).getByRole('group', { name: 'Listas del menú' })).toBeInTheDocument()
    expect(within(await card('Kanban')).getByText('No lo ve')).toBeInTheDocument()
    expect(within(await card('Usuarios')).getByText(/Solo «Lo ve»/)).toBeInTheDocument()
    // la parte que exige un permiso que el perfil no tiene lo avisa
    const tabs = within(projects).getByRole('group', { name: 'Dentro del proyecto — pestañas' })
    expect(within(tabs).getByRole('checkbox', { name: 'Ficha' }).getAttribute('title')).toMatch(/^Sin el permiso «.+» no aparece, aunque esté marcado$/)
  })

  it('desmarcar deja al menos una; con una sola, abre directo; «Abre en» entre las marcadas; guarda solo la pantalla', async () => {
    const { update } = setupRoles([admin, memberRole], SCREENS)
    const lists = await group(/^Listas del menú$/)
    for (const name of ['Todos mis proyectos', 'Terminados', 'Archivados']) await userEvent.click(within(lists).getByRole('checkbox', { name }))
    const ongoing = within(lists).getByRole('checkbox', { name: 'En marcha' })
    expect(ongoing).toBeDisabled()
    expect(ongoing).toHaveAttribute('title', 'Tiene que quedar al menos una')
    expect(within(lists).getByText('Con una sola, no hay botones: abre directo en «En marcha».')).toBeInTheDocument()
    // la vista previa del menú lo muestra
    const menu = await screen.findByRole('region', { name: 'Menú lateral de este perfil' })
    expect(within(menu).getByText('Proyectos · En marcha')).toBeInTheDocument()
    // Caja de entrada abre en Todas
    const boxes = await group(/^Caja de entrada — cajas$/)
    await userEvent.click(within(boxes).getByRole('combobox', { name: 'Abre en' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Todas' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('role-member', {
        name: 'Miembro',
        description: '',
        screens: { hidden: ['projects.lists.all', 'projects.lists.finished', 'projects.lists.archived'], starts: { 'tasks.boxes': 'all' } },
      }),
    )
  })

  it('submenús de Configuración: el oculto sale de la vista previa del menú', async () => {
    setupRoles([admin, { ...memberRole, permissions: [...PERMISSION_CODES] }], SCREENS)
    const menu = await screen.findByRole('region', { name: 'Menú lateral de este perfil' })
    expect(within(menu).getByText('Íconos')).toBeInTheDocument()
    await userEvent.click(within(await group(/^Submenús$/)).getByRole('checkbox', { name: 'Íconos' }))
    expect(within(menu).queryByText('Íconos')).toBeNull()
  })

  it('el formulario del perfil queda solo con nombre y descripción', async () => {
    const { update } = setupRoles([admin, memberRole])
    await userEvent.click(within((await screen.findByText('Miembro')).closest('tr')!).getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar perfil' })
    expect(within(dialog).queryByRole('combobox')).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('role-member', { name: 'Miembro', description: '' }))
  })

  it('Por persona muestra el resumen heredado del perfil y el perfil propio lo hereda', async () => {
    const screens: Role['screens'] = { hidden: ['tasks.views.timeline'], starts: {} }
    const { createRole } = setupRoles([admin, { ...memberRole, screens }], '/settings/access')
    expect(await screen.findByText(/Qué aparece: 1 parte oculta/)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Ficha' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Crear perfil propio para Douglas' }))
    await waitFor(() => expect(createRole).toHaveBeenCalledOnce())
    const [data] = createRole.mock.calls[0] as unknown as [{ screens: Role['screens'] }]
    expect(data.screens).toEqual(screens)
  })
})
