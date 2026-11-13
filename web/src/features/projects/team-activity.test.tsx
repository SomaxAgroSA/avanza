import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { Project, ProjectMember, TeamActivity } from '@/domain/projects'
import type { PermissionCode } from '@/domain/permissions'
import type { ProjectRepository } from '@/domain/repositories'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { ProjectsPage } from './ProjectsPage'
import { ProjectFormDialog } from './ProjectFormDialog'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})
beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

const ana = { id: 'u1', name: 'Angelica Davalos', email: 'a@x.com', avatarUrl: null }
const douglas = { id: 'u2', name: 'Douglas Martins', email: 'd@x.com', avatarUrl: null }
const edson = { id: 'u3', name: 'Edson Queiroz', email: 'e@x.com', avatarUrl: null }

function project(id: string, key: string, name: string, lead = ana): Project {
  return {
    id, key, name, description: '', platformUrl: '', icon: 'folder', cover: 'blue', status: 'active', priority: 'medium', urgency: null, area: null, parent: null,
    childCount: 0, owner: ana, lead, startDate: null, dueDate: null, archivedAt: null, createdAt: null, updatedAt: null, memberCount: 3, myRole: 'owner',
    capabilities: { edit: true, manageMembers: true, archive: true, delete: false, transfer: true, uploadFiles: true, sections: [] },
  }
}
const DS = project('ds', 'DS', 'DESIGN-SYSTEM', douglas)
const GCS = project('gcs', 'GCS', 'GESTIÓN COMERCIAL', douglas)
const ODF = project('odf', 'ODF', 'OPERATIVA DE FERTILIZANTES')
const today = new Date()
const daysAgo = (n: number) => new Date(today.getTime() - n * 864e5)
const ref = (p: Project) => ({ id: p.id, key: p.key, name: p.name, icon: p.icon, cover: p.cover })
const task = (id: string, code: string, title: string, status: string, inProgress: boolean, updatedAt: Date) => ({
  id, code, title, status: { id: status, name: status, color: 'blue', category: inProgress ? 'in_progress' : 'done' }, updatedAt, inProgress, moved: true,
})
const ACTIVITY: TeamActivity = {
  windowDays: 7,
  people: [
    {
      user: ana,
      projects: [{ project: ref(ODF), state: 'active', inProgress: 0, recent: 29, open: 19, stale: false, lastActivity: daysAgo(2), tasks: [task('t9', 'ODF-9', 'Simulador de precios', 'Concluido', false, daysAgo(2))] }],
    },
    {
      user: douglas,
      projects: [
        { project: ref(DS), state: 'working', inProgress: 35, recent: 69, open: 36, stale: false, lastActivity: today, tasks: [task('t1', 'DS-1', 'Íconos nuevos', 'Desarrollo', true, today)] },
        { project: ref(GCS), state: 'idle', inProgress: 13, recent: 0, open: 19, stale: true, lastActivity: daysAgo(14), tasks: [task('t2', 'GCS-4', 'Portal de pedidos', 'Desarrollo', true, daysAgo(14))] },
      ],
    },
  ],
}

function setup(permissions: PermissionCode[] = ['projects.view', 'tasks.view'], teamActivity = vi.fn<ProjectRepository['teamActivity']>(() => Promise.resolve(ACTIVITY))) {
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(permissions) },
    projects: { list: () => Promise.resolve({ items: [DS, GCS, ODF], page: 1, perPage: 20, total: 3, totalPages: 1 }), teamActivity },
  })
  renderRoutes([{ path: '/projects', element: <ProjectsPage view="ongoing" /> }], { repositories, initialPath: '/projects' })
  return { teamActivity }
}

describe('Proyectos: responsable y quién está trabajando', () => {
  it('la columna Responsable reemplaza al dueño y "Trabajando" marca quién está en cada proyecto', async () => {
    setup()
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: /Responsable/ })).toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: /Dueño/ })).toBeNull()
    const row = (name: string) => within(table).getByText(name).closest('tr') as HTMLElement
    await waitFor(() => expect(within(row('DESIGN-SYSTEM')).getByText('Douglas · 35 en curso')).toHaveAttribute('data-state', 'working'))
    expect(within(row('DESIGN-SYSTEM')).getByText('Douglas Martins')).toBeInTheDocument()
    // en curso, pero sin movimiento hace más de 7 días
    expect(within(row('GESTIÓN COMERCIAL')).getByText(/Douglas · 13 en curso, sin movimiento/)).toHaveAttribute('data-state', 'stale')
    expect(within(row('OPERATIVA DE FERTILIZANTES')).getByText(/Angelica · activo/)).toHaveAttribute('data-state', 'active')
  })

  it('"Equipo ahora": por persona, sin el código del proyecto, y el + muestra las tareas', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Equipo ahora' }))
    const panel = await screen.findByTestId('team-activity')
    const douglasBlock = within(panel).getByRole('region', { name: 'Douglas Martins' })
    expect(douglasBlock).toHaveTextContent('Trabajando ahora')
    expect(douglasBlock).toHaveTextContent('DESIGN-SYSTEM')
    expect(douglasBlock).not.toHaveTextContent('DS ·')
    expect(douglasBlock).toHaveTextContent('Con tareas abiertas, sin movimiento hace más de 7 días')
    expect(within(douglasBlock).queryByRole('link', { name: 'Íconos nuevos' })).toBeNull()
    await userEvent.click(within(douglasBlock).getByRole('button', { name: 'Ver las tareas de Douglas Martins en DESIGN-SYSTEM' }))
    const tasks = within(douglasBlock).getByRole('list', { name: 'Tareas de Douglas Martins en DESIGN-SYSTEM' })
    expect(within(tasks).getByRole('link', { name: 'Íconos nuevos' })).toHaveAttribute('href', '/tasks/t1')
    expect(tasks).toHaveTextContent('DS-1')
    expect(within(panel).getByRole('region', { name: 'Angelica Davalos' })).toHaveTextContent('Activo esta semana')
  })

  it('sin tasks.view no aparece la columna ni el botón (y no se consulta)', async () => {
    const { teamActivity } = setup(['projects.view'])
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'Equipo ahora' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: /Trabajando/ })).toBeNull()
    expect(teamActivity).not.toHaveBeenCalled()
  })
})

describe('Formulario: responsable del proyecto', () => {
  it('elige entre el dueño y los miembros que trabajan (no los lectores) y guarda solo si cambió', async () => {
    const update = vi.fn<ProjectRepository['update']>(() => Promise.resolve(DS))
    const members = [
      { user: ana, role: 'manager', isOwner: true },
      { user: douglas, role: 'member', isOwner: false },
      { user: edson, role: 'viewer', isOwner: false },
    ] as unknown as ProjectMember[]
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(['projects.view', 'projects.edit']) },
      projects: { listMembers: () => Promise.resolve(members), update, covers: () => Promise.resolve({ used: [], suggested: 'blue' }), list: () => Promise.resolve({ items: [], page: 1, perPage: 100, total: 0, totalPages: 0 }) },
    })
    renderRoutes([{ path: '/', element: <ProjectFormDialog open onOpenChange={() => {}} project={ODF} /> }], { repositories, initialPath: '/' })
    const dialog = await screen.findByRole('dialog')
    const select = within(dialog).getByRole('combobox', { name: /Responsable/ })
    await waitFor(() => expect(select).toHaveTextContent('Angelica Davalos'))
    await userEvent.click(select)
    const options = await screen.findAllByRole('option')
    // el lector (Edson) no aparece
    expect(options).toHaveLength(3)
    expect(options.map((o) => o.textContent).join(' | ')).toMatch(/Sin responsable | .*Angelica Davalos | .*Douglas Martins/)
    await userEvent.click(screen.getByRole('option', { name: /Douglas Martins/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('odf', expect.objectContaining({ leadId: 'u2' })))
  })
})
