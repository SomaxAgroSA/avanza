import { beforeAll, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { GuestOnly, RequireAuth } from '@/features/auth/guards'
import { env } from '@/core/config/env'
import { DEFAULT_PLATFORM_INFO } from '@/domain/platform'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import type { ProjectList } from '@/domain/project-lists'
import { ProjectListGate } from '@/features/projects/ProjectListGate'
import { AppShell } from './AppShell'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

describe('AppShell — sair', () => {
  it('"Sair" encerra a sessão e leva ao login (sem voltar para a página anterior)', async () => {
    let signedIn = true
    const repositories = fakeRepositories({
      auth: {
        me: async () => (signedIn ? makeCurrentUser(['tasks.view']) : null),
        logout: async () => {
          signedIn = false
        },
      },
    })
    const { router } = renderRoutes(
      [
        { path: '/login', element: <GuestOnly>Tela de login</GuestOnly> },
        {
          path: '/',
          element: (
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          ),
          children: [{ path: 'planning', element: <p>Planejamento aberto</p> }],
        },
      ],
      { repositories, initialPath: '/planning' },
    )
    expect(await screen.findByText('Planejamento aberto')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Menu da conta' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sair' }))
    expect(await screen.findByText('Tela de login')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toBe('')
  })
})

describe('AppShell — rodapé do menu', () => {
  it('mostra a versão do produto (package.json) e o copyright com o nome da plataforma', async () => {
    // gravada no build a partir do package.json (vite.config.ts)
    const version = env.appVersion
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(['tasks.view']) },
      platform: { getInfo: () => Promise.resolve({ ...DEFAULT_PLATFORM_INFO, name: 'Portal da Obra' }) },
    })
    renderRoutes([{ path: '/', element: <RequireAuth><AppShell /></RequireAuth>, children: [{ path: 'planning', element: <p>Planejamento aberto</p> }] }], {
      repositories,
      initialPath: '/planning',
    })
    expect(await screen.findByText(`Versão ${version}`)).toBeInTheDocument()
    expect(await screen.findByText(`© ${new Date().getFullYear()} Portal da Obra`)).toBeInTheDocument()
  })
})

describe('AppShell — listas de Projetos do perfil (ajuste 25/11)', () => {
  function setup(projectsLists: ProjectList[], initialPath: string) {
    const me = makeCurrentUser(['projects.view'])
    const repositories = fakeRepositories({ auth: { me: async () => ({ ...me, role: { ...me.role!, projectsLists } }) } })
    return renderRoutes(
      [
        {
          path: '/',
          element: (
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          ),
          children: [
            {
              element: <ProjectListGate />,
              children: [
                { path: 'projects', element: <p>Lista Todos</p> },
                { path: 'projects/ongoing', element: <p>Lista Em andamento</p> },
                { path: 'projects/finished', element: <p>Lista Concluídos</p> },
                { path: 'projects/archived', element: <p>Lista Arquivados</p> },
              ],
            },
            { path: 'projects/:projectId', element: <p>Projeto aberto</p> },
          ],
        },
      ],
      { repositories, initialPath },
    )
  }

  it('com uma só: "Projetos · Em andamento" leva direto a ela, sem submenu; a lista escondida pelo endereço leva a ela', async () => {
    const { router } = setup(['ongoing'], '/projects/finished')
    expect(await screen.findByText('Lista Em andamento')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/projects/ongoing')
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(within(nav).getByRole('link', { name: 'Projetos · Em andamento' })).toHaveAttribute('href', '/projects/ongoing')
    expect(within(nav).queryByRole('button', { name: 'Projetos' })).toBeNull()
    expect(within(nav).queryByRole('link', { name: 'Concluídos' })).toBeNull()
  })

  it('o projeto aberto por link direto continua abrindo (e o item segue marcado)', async () => {
    setup(['ongoing'], '/projects/p1')
    expect(await screen.findByText('Projeto aberto')).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Navegação principal' })).getByRole('link', { name: 'Projetos · Em andamento' })).toHaveClass('bg-primary-soft')
  })

  it('com duas ou mais: o submenu só com as do perfil; /projects leva à primeira visível', async () => {
    const { router } = setup(['ongoing', 'archived'], '/projects?new=1')
    expect(await screen.findByText('Lista Em andamento')).toBeInTheDocument()
    expect([router.state.location.pathname, router.state.location.search]).toEqual(['/projects/ongoing', '?new=1'])
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/projects/ongoing', '/projects/archived'])
  })
})
