import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import i18n from '@/core/i18n'
import type { Project, ProjectMember } from '@/domain/projects'
import { fakeRepositories, renderRoutes } from '@/test/utils'
import { ProjectPreviewDrawer } from './ProjectPreviewDrawer'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const project = {
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
  owner: { id: 'u1', name: 'Administrador', email: 'admin@x.com', avatarUrl: null },
  memberCount: 3,
  myRole: 'owner',
  startDate: null,
  dueDate: null,
  archivedAt: null,
  createdAt: null,
  capabilities: { edit: true, sections: ['charter', 'history', 'members', 'report'] },
} as unknown as Project

const member = (id: string, name: string, role: ProjectMember['role'], extra: Partial<ProjectMember> = {}): ProjectMember => ({
  user: { id, name, email: `${id}@x.com`, avatarUrl: null, status: 'active' },
  role,
  isOwner: false,
  joinedAt: null,
  ...extra,
})

describe('ProjectPreviewDrawer', () => {
  it('lista os membros com papel, dono em destaque e contas desativadas sinalizadas', async () => {
    const listMembers = vi.fn(() =>
      Promise.resolve([
        member('u1', 'Administrador', 'manager', { isOwner: true }),
        member('u2', 'Mário', 'member'),
        member('u3', 'Lia', 'viewer', { user: { id: 'u3', name: 'Lia', email: 'u3@x.com', avatarUrl: null, status: 'disabled' } }),
      ]),
    )
    renderRoutes([{ path: '/projects', element: <ProjectPreviewDrawer project={project} onOpenChange={() => {}} /> }], {
      repositories: fakeRepositories({ projects: { listMembers } }),
      initialPath: '/projects',
    })

    const list = await screen.findByRole('list', { name: /Membros/ })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Administrador')
    expect(rows[0]).toHaveTextContent('Dono')
    expect(rows[1]).toHaveTextContent('Membro')
    expect(rows[2]).toHaveTextContent('Leitor')
    expect(rows[2]).toHaveTextContent('Desativado')
    expect(listMembers).toHaveBeenCalledWith('p1')
  })
})
