import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { AppError } from '@/core/errors/app-error'
import type { Project } from '@/domain/projects'
import { fakeRepositories, renderRoutes } from '@/test/utils'
import { ProjectFormDialog } from './ProjectFormDialog'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const created = { id: 'p1', key: 'CRM', name: 'CRM Corporativo' } as Project

function setup(create = vi.fn().mockResolvedValue(created)) {
  const repositories = fakeRepositories({ projects: { create } })
  const utils = renderRoutes(
    [
      { path: '/projects', element: <ProjectFormDialog open onOpenChange={() => {}} /> },
      { path: '/projects/:id', element: <p>detalhe do projeto</p> },
    ],
    { repositories, initialPath: '/projects' },
  )
  return { create, ...utils }
}

describe('ProjectFormDialog', () => {
  it('sugere a chave a partir do nome até o usuário editá-la', async () => {
    setup()
    const name = await screen.findByLabelText(/^Nome/)
    const key = screen.getByLabelText(/^Chave/)

    await userEvent.type(name, 'Portal do Cliente')
    expect(key).toHaveValue('PDC')

    await userEvent.clear(key)
    await userEvent.type(key, 'PORTAL')
    await userEvent.type(name, ' B2B')
    expect(key).toHaveValue('PORTAL')
  })

  it('valida intervalo de datas antes de enviar', async () => {
    const { create } = setup()
    await userEvent.type(await screen.findByLabelText(/^Nome/), 'CRM Corporativo')
    await userEvent.type(screen.getByLabelText(/^Início/), '01092026')
    await userEvent.type(screen.getByLabelText(/^Entrega/), '01082026')
    await userEvent.click(screen.getByRole('button', { name: 'Novo projeto' }))
    expect(await screen.findByText('A entrega deve ser depois do início')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('cria o projeto com os dados normalizados e abre o detalhe', async () => {
    const { create, router } = setup()
    await userEvent.type(await screen.findByLabelText(/^Nome/), 'CRM Corporativo')
    await userEvent.click(screen.getByRole('radio', { name: 'Foguete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Novo projeto' }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'CRM Corporativo',
        key: 'CRM',
        description: '',
        icon: 'rocket',
        cover: 'green',
        status: 'planning',
        priority: 'medium',
        startDate: null,
        dueDate: null,
      }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1'))
  })

  it('mostra no campo o erro de chave já usada', async () => {
    setup(vi.fn().mockRejectedValue(new AppError({ code: 'PROJECT_KEY_IN_USE', message: 'x', status: 409 })))
    await userEvent.type(await screen.findByLabelText(/^Nome/), 'CRM Corporativo')
    await userEvent.click(screen.getByRole('button', { name: 'Novo projeto' }))
    expect(await screen.findByText('Esta chave já está em uso')).toBeInTheDocument()
  })
})
