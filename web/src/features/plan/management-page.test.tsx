import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import i18n from '@/core/i18n'
import type { Plan } from '@/domain/plan'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { ProjectManagementPage } from './ProjectManagementPage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
beforeEach(() => window.localStorage.clear())

const plan: Plan = {
  project: { id: 'p1', key: 'SB', name: 'Somax BR', archived: false },
  capabilities: { edit: true, manage: true },
  statuses: [],
  resources: [],
  groups: [],
  items: [],
  columns: [],
  links: [],
  settings: { dependencyRule: 'warn', baselineAt: null },
  summary: null,
  truncated: false,
}

function setup(initialPath: string) {
  const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(['plan.view', 'projects.view']) }, plan: { get: () => Promise.resolve(plan) } })
  const routes = [
    { path: '/projects/:projectId', element: <p>visão geral</p> },
    { path: '/projects/:projectId/management', element: <ProjectManagementPage /> },
  ]
  return renderRoutes(routes, { repositories, initialPath })
}

describe('Aba Gestão do projeto', () => {
  it('mostra o quadro com as visões Quadro, Cronograma e Diário e problemas, sem título próprio nem seletor de projeto', async () => {
    setup('/projects/p1/management')
    const views = await screen.findByRole('navigation', { name: 'Visões do quadro' })
    expect(within(views).getAllByRole('link').map((link) => link.textContent)).toEqual(['Quadro principal', 'Cronograma', 'Diário e problemas'])
    expect(within(views).getByRole('link', { name: 'Quadro principal' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Projeto' })).not.toBeInTheDocument()
  })

  it('?view=kanban (visão que saiu) abre o quadro principal; ?view=reports leva à visão geral, onde fica a saúde', async () => {
    const first = setup('/projects/p1/management?view=kanban')
    const views = await screen.findByRole('navigation', { name: 'Visões do quadro' })
    expect(within(views).getByRole('link', { name: 'Quadro principal' })).toHaveAttribute('aria-current', 'page')
    first.unmount()

    const { router } = setup('/projects/p1/management?view=reports')
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1'))
    expect(await screen.findByText('visão geral')).toBeInTheDocument()
  })
})
