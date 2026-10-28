import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { AppError } from '@/core/errors/app-error'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { GuestOnly, PermissionGate, RequireAuth } from './guards'
import { LoginPage } from './LoginPage'
import { safeRedirect } from './session'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const routes = [
  { path: '/login', element: <GuestOnly><LoginPage /></GuestOnly> },
  {
    path: '/',
    element: <RequireAuth><div>área autenticada</div></RequireAuth>,
  },
  {
    path: '/admin',
    element: <RequireAuth><PermissionGate permission="users.view" /></RequireAuth>,
    children: [{ index: true, element: <div>área de usuários</div> }],
  },
]

describe('fluxo de autenticação', () => {
  it('redireciona visitante para o login preservando o destino', async () => {
    const { router } = renderRoutes(routes, { repositories: fakeRepositories(), initialPath: '/admin' })
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/admin')}`)
  })

  it('a capa mostra a marca, a proposta e o rodapé com o nome da plataforma', async () => {
    renderRoutes(routes, { repositories: fakeRepositories(), initialPath: '/login' })
    expect(await screen.findByRole('heading', { name: 'Sincronize projetos, tarefas e equipes.' })).toBeInTheDocument()
    expect(screen.getByText('Kanban e backlog')).toBeInTheDocument()
    expect(screen.getByText(`© ${new Date().getFullYear()} Avanza · SomaxAgro`)).toBeInTheDocument()
  })

  it('a capa traz a prévia animada do quadro (decorativa, fora da leitura de tela)', async () => {
    renderRoutes(routes, { repositories: fakeRepositories(), initialPath: '/login' })
    const board = await screen.findByText('Quadro da equipe')
    const preview = board.closest('[aria-hidden="true"]')
    expect(preview).not.toBeNull()
    expect(preview).toHaveClass('motion-safe:animate-float')
    expect(screen.getByText('Ao vivo')).toBeInTheDocument()
    // na prévia (computador) e na versão compacta do celular, as duas animadas e fora da leitura de tela
    const moved = screen.getAllByText('Cartão movido para Concluído')
    expect(moved).toHaveLength(2)
    moved.forEach((el) => expect(el.closest('[aria-hidden="true"]')).toHaveClass('motion-safe:animate-float'))
  })

  it('valida os campos antes de chamar a API', async () => {
    const login = vi.fn()
    renderRoutes(routes, { repositories: fakeRepositories({ auth: { login } }), initialPath: '/login' })
    await userEvent.click(await screen.findByRole('button', { name: 'Entrar' }))
    expect(await screen.findAllByText('Campo obrigatório')).toHaveLength(2)
    expect(login).not.toHaveBeenCalled()
  })

  it('mostra erro traduzido quando as credenciais são inválidas', async () => {
    const login = vi.fn().mockRejectedValue(new AppError({ code: 'INVALID_CREDENTIALS', message: 'x', status: 401 }))
    renderRoutes(routes, { repositories: fakeRepositories({ auth: { login } }), initialPath: '/login' })
    await userEvent.type(await screen.findByLabelText(/E-mail/), 'ana@kamban.test')
    await userEvent.type(screen.getByLabelText(/^Senha/), 'SenhaErrada123')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.')
    expect(screen.getByLabelText(/^Senha/)).toHaveValue('')
  })

  it('após login bem-sucedido navega para o destino original', async () => {
    let authenticated = false
    const repositories = fakeRepositories({
      auth: {
        login: vi.fn(async () => {
          authenticated = true
        }),
        me: vi.fn(async () => (authenticated ? makeCurrentUser(['users.view']) : null)),
      },
    })
    const { router } = renderRoutes(routes, { repositories, initialPath: '/login?next=%2Fadmin' })
    await userEvent.type(await screen.findByLabelText(/E-mail/), 'ana@kamban.test')
    await userEvent.type(screen.getByLabelText(/^Senha/), 'SenhaCorreta123')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('área de usuários')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin')
    expect(repositories.auth.login).toHaveBeenCalledWith({ email: 'ana@kamban.test', password: 'SenhaCorreta123', remember: false })
  })

  it('usuário autenticado sem permissão vê acesso restrito', async () => {
    const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(['tasks.view']) } })
    renderRoutes(routes, { repositories, initialPath: '/admin' })
    expect(await screen.findByText('Acesso restrito')).toBeInTheDocument()
    expect(screen.queryByText('área de usuários')).not.toBeInTheDocument()
  })

  it('usuário autenticado não vê a tela de login', async () => {
    const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser([]) } })
    renderRoutes(routes, { repositories, initialPath: '/login?next=%2F' })
    await waitFor(() => expect(screen.getByText('área autenticada')).toBeInTheDocument())
  })
})

describe('safeRedirect', () => {
  it('aceita apenas caminhos internos (evita open redirect)', () => {
    expect(safeRedirect('%2Fusers%3Fpage%3D2')).toBe('/users?page=2')
    expect(safeRedirect('https://evil.com')).toBe('/dashboard')
    expect(safeRedirect('//evil.com')).toBe('/dashboard')
    expect(safeRedirect('/\\evil.com')).toBe('/dashboard')
    expect(safeRedirect(null)).toBe('/dashboard')
  })
})
