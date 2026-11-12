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
        cover: 'violet',
        status: 'planning',
        priority: 'medium',
        urgency: null,
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

  describe('projeto pai (§34)', () => {
    const main = (id: string, key: string, name: string, extra: Partial<Project> = {}) =>
      ({ id, key, name, parent: null, archivedAt: null, childCount: 0, capabilities: { edit: true }, ...extra }) as unknown as Project
    const list = vi.fn(() =>
      Promise.resolve({ items: [main('p9', 'PRG', 'Programa Comercial'), main('p8', 'RO', 'Só leitura', { capabilities: { edit: false } } as Partial<Project>)], page: 1, perPage: 100, total: 2, totalPages: 1 }),
    )

    it('"Novo subprojeto" já vem com o pai escolhido e envia parentId', async () => {
      const create = vi.fn().mockResolvedValue(created)
      const repositories = fakeRepositories({ projects: { create, list } })
      renderRoutes(
        [
          { path: '/projects', element: <ProjectFormDialog open onOpenChange={() => {}} parentId="p9" /> },
          { path: '/projects/:id', element: <p>detalhe</p> },
        ],
        { repositories, initialPath: '/projects' },
      )
      await waitFor(() => expect(screen.getByRole('combobox', { name: /^Projeto pai/ })).toHaveTextContent('PRG · Programa Comercial'))
      await userEvent.type(screen.getByLabelText(/^Nome/), 'Força de Vendas')
      await userEvent.click(screen.getByRole('button', { name: 'Novo projeto' }))
      await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ key: 'FDV', parentId: 'p9' })))
    })

    it('pais possíveis: só os que a pessoa edita; projeto com subprojetos não escolhe pai', async () => {
      const repositories = fakeRepositories({ projects: { list } })
      const withChildren = { ...main('p1', 'CRM', 'CRM'), description: '', icon: 'folder', cover: 'violet', status: 'active', priority: 'medium', urgency: null, area: null, childCount: 2 } as unknown as Project
      renderRoutes([{ path: '/', element: <ProjectFormDialog open onOpenChange={() => {}} project={withChildren} /> }], { repositories, initialPath: '/' })
      const select = await screen.findByRole('combobox', { name: /^Projeto pai/ })
      expect(select).toBeDisabled()
      expect(screen.getByText('Este projeto tem 2 subprojetos, por isso não pode ter um pai.')).toBeInTheDocument()
    })

    it('mostra no campo o erro do servidor (um só nível)', async () => {
      const create = vi.fn().mockRejectedValue(new AppError({ code: 'VALIDATION_ERROR', message: 'x', status: 422, details: { fields: { parent_id: 'parent_is_child' } } }))
      const repositories = fakeRepositories({ projects: { create, list } })
      renderRoutes([{ path: '/', element: <ProjectFormDialog open onOpenChange={() => {}} parentId="p9" /> }], { repositories, initialPath: '/' })
      await userEvent.type(await screen.findByLabelText(/^Nome/), 'Neto')
      await userEvent.click(screen.getByRole('button', { name: 'Novo projeto' }))
      expect(await screen.findByText('Esse projeto já é um subprojeto; escolha um projeto principal')).toBeInTheDocument()
    })
  })

  it('cor única: sugere a próxima livre e trava as que outros projetos já usam', async () => {
    const create = vi.fn().mockResolvedValue(created)
    const repositories = fakeRepositories({ projects: { create, covers: () => Promise.resolve({ used: ['violet', 'indigo'], suggested: 'blue' }) } })
    renderRoutes([{ path: '/projects', element: <ProjectFormDialog open onOpenChange={() => {}} /> }, { path: '/projects/:id', element: <p>detalhe</p> }], {
      repositories,
      initialPath: '/projects',
    })
    expect(await screen.findByRole('radio', { name: /Violeta: em uso/ })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Azul' })).toHaveAttribute('aria-checked', 'true'))
    await userEvent.type(screen.getByLabelText(/^Nome/), 'Portal')
    await userEvent.click(screen.getByRole('button', { name: 'Novo projeto' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ cover: 'blue' })))
  })

  it('subprojeto: usa a cor e o ícone do pai, sem os seletores', async () => {
    const parent = { id: 'pai', key: 'GCS', name: 'Gestão Comercial', icon: 'rocket', cover: '#1a5700', parent: null, archivedAt: null, capabilities: { edit: true } } as unknown as Project
    const repositories = fakeRepositories({ projects: { list: () => Promise.resolve({ items: [parent], page: 1, perPage: 100, total: 1, totalPages: 1 }) } })
    renderRoutes([{ path: '/projects', element: <ProjectFormDialog open onOpenChange={() => {}} parentId="pai" /> }], { repositories, initialPath: '/projects' })
    expect(await screen.findByTestId('project-inherits-parent')).toHaveTextContent('Gestão Comercial')
    expect(screen.queryByRole('radiogroup', { name: 'Capa' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Foguete' })).not.toBeInTheDocument()
  })
})
