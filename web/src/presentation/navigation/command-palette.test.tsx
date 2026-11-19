import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { TaskRepository } from '@/domain/repositories'
import type { TaskSummary } from '@/domain/tasks'
import { useUiStore } from '@/presentation/state/ui-store'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { CommandPalette } from './CommandPalette'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
beforeEach(() => {
  act(() => useUiStore.getState().setCommandPaletteOpen(false))
})

function setup(list: TaskRepository['list'], permissions: Parameters<typeof makeCurrentUser>[0] = ['tasks.view', 'tasks.create', 'tasks.list']) {
  const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(permissions) }, tasks: { list } })
  const view = renderRoutes(
    [
      { path: '/', element: <CommandPalette /> },
      { path: '/tasks', element: <p>lista de tarefas</p> },
      { path: '/tasks/:id', element: <p>tarefa</p> },
    ],
    { repositories, initialPath: '/' },
  )
  act(() => useUiStore.getState().setCommandPaletteOpen(true))
  return view
}

describe('Command palette — tarefas', () => {
  it('"Criar tarefa" abre o formulário de nova tarefa (não está mais "em breve")', async () => {
    const { router } = setup(vi.fn<TaskRepository['list']>(() => Promise.resolve({ items: [], page: 1, perPage: 6, total: 0, totalPages: 0 })))
    const create = await screen.findByRole('option', { name: /Criar tarefa/ })
    expect(create).not.toHaveAttribute('aria-disabled', 'true')
    expect(create).not.toHaveTextContent('Em breve')
    await userEvent.click(create)
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'))
    expect(router.state.location.search).toBe('?new=1')
  })

  it('buscar: mostra as tarefas encontradas (código e título) e "Buscar tarefas com…" leva à lista filtrada', async () => {
    const task = { id: 'k3', code: 'SB-3', title: 'Filtro por período no relatório de vendas' } as TaskSummary
    const list = vi.fn<TaskRepository['list']>(() => Promise.resolve({ items: [task], page: 1, perPage: 6, total: 1, totalPages: 1 }))
    const { router } = setup(list)
    await userEvent.type(await screen.findByRole('combobox'), 'filtro')
    const result = await screen.findByRole('option', { name: /SB-3 · Filtro por período/ })
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'filtro', filters: {} }), undefined)
    expect(screen.getByRole('option', { name: 'Buscar tarefas com “filtro”' })).toBeInTheDocument()
    await userEvent.click(result)
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks/k3'))
  })

  it('sem a Lista de tarefas (§44): nada leva a /tasks (nem o menu, nem criar, nem buscar), mas as tarefas encontradas continuam', async () => {
    const task = { id: 'k3', code: 'SB-3', title: 'Filtro por período no relatório de vendas' } as TaskSummary
    const list = vi.fn<TaskRepository['list']>(() => Promise.resolve({ items: [task], page: 1, perPage: 6, total: 1, totalPages: 1 }))
    setup(list, ['tasks.view', 'tasks.create'])
    const input = await screen.findByRole('combobox')
    await screen.findByRole('option', { name: /tema claro/ })
    expect(screen.queryByRole('option', { name: /^Tarefas$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Criar tarefa/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Buscar tarefas/ })).not.toBeInTheDocument()
    await userEvent.type(input, 'filtro')
    expect(await screen.findByRole('option', { name: /SB-3 · Filtro por período/ })).toBeInTheDocument()
  })
})
