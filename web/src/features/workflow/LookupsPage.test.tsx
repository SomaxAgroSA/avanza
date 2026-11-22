import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { LookupRepository } from '@/domain/repositories'
import type { Area, TaskPriority, TaskStatus } from '@/domain/workflow'
import { fakeRepositories, renderRoutes } from '@/test/utils'
import { AreasPage, PrioritiesPage, StatusesPage } from './LookupsPage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

function status(overrides: Partial<TaskStatus>): TaskStatus {
  return {
    id: 's1',
    key: 'BACKLOG',
    name: 'Backlog',
    description: '',
    color: 'gray',
    order: 0,
    isActive: true,
    isDefault: false,
    category: 'backlog',
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

const backlog = status({ isDefault: true })
const dev = status({ id: 's2', key: 'DEV', name: 'Desenvolvimento', category: 'in_progress', color: 'amber', order: 1 })

function setup(overrides: Partial<LookupRepository<TaskStatus>> = {}) {
  const update = vi.fn<LookupRepository<TaskStatus>['update']>(() => Promise.resolve(dev))
  const create = vi.fn<LookupRepository<TaskStatus>['create']>(() => Promise.resolve(dev))
  const repositories = fakeRepositories({ statuses: { list: () => Promise.resolve([backlog, dev]), update, create, ...overrides } })
  renderRoutes([{ path: '/settings/statuses', element: <StatusesPage /> }], { repositories, initialPath: '/settings/statuses' })
  return { update, create }
}

describe('StatusesPage', () => {
  it('lista com o padrão marcado e a categoria de cada status', async () => {
    setup()
    expect(await screen.findByText('Desenvolvimento')).toBeInTheDocument()
    expect(screen.getByText('Padrão')).toBeInTheDocument()
    expect(screen.getByText('Em andamento')).toBeInTheDocument()
  })

  it('o padrão não oferece desativar/excluir; outro item pode virar padrão', async () => {
    const { update } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Ações de Backlog' }))
    let menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Excluir' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Desativar' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('button', { name: 'Ações de Desenvolvimento' }))
    menu = await screen.findByRole('menu')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Tornar padrão' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('s2', { isDefault: true }))
  })

  it('cria status com chave derivada do nome e categoria', async () => {
    const { create } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Novo status' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/^Nome/), 'Em revisão')
    expect(within(dialog).getByLabelText(/^Chave/)).toHaveValue('EM_REVISAO')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]?.[0]).toMatchObject({ key: 'EM_REVISAO', name: 'Em revisão', category: 'todo', isActive: true, isDefault: false })
  })

  it('Kanban: limite WIP e destinos permitidos (sem o próprio status)', async () => {
    const { update } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Ações de Backlog' }))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Editar' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/^Limite WIP/), '3x')
    expect(within(dialog).getByLabelText(/^Limite WIP/)).toHaveValue('3')
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Pode ir para/ }))
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).queryByRole('option', { name: 'Backlog' })).not.toBeInTheDocument()
    await userEvent.click(within(within(listbox).getByRole('option', { name: 'Desenvolvimento' })).getByRole('button'))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(update.mock.calls[0]?.[1]).toMatchObject({ wipLimit: 3, allowedNext: ['s2'] })
  })

  it('marcar como padrão liga "Ativo" e trava o interruptor', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Novo status' }))
    const dialog = await screen.findByRole('dialog')
    const active = within(dialog).getByRole('switch', { name: /^Ativo/ })
    await userEvent.click(active)
    expect(active).not.toBeChecked()
    await userEvent.click(within(dialog).getByRole('switch', { name: /^Padrão/ }))
    expect(active).toBeChecked()
    expect(active).toBeDisabled()
  })
})

describe('AreasPage (áreas responsáveis, sem padrão)', () => {
  const area = (overrides: Partial<Area>): Area => ({
    id: 'a1',
    key: 'TI',
    name: 'Dpto. TI',
    description: '',
    color: 'blue',
    order: 0,
    isActive: true,
    isDefault: false,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  })
  const ti = area({})
  const comex = area({ id: 'a2', key: 'COMEX', name: 'Comex', color: 'teal', order: 1 })

  function setupAreas() {
    const update = vi.fn<LookupRepository<Area>['update']>(() => Promise.resolve(comex))
    const create = vi.fn<LookupRepository<Area>['create']>(() => Promise.resolve(comex))
    const repositories = fakeRepositories({ areas: { list: () => Promise.resolve([ti, comex]), update, create } })
    renderRoutes([{ path: '/settings/areas', element: <AreasPage /> }], { repositories, initialPath: '/settings/areas' })
    return { update, create }
  }

  it('lista as áreas sem "Padrão" e sem a ação "Tornar padrão"; desativar e excluir ficam', async () => {
    const { update } = setupAreas()
    expect(await screen.findByText('Comex')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Áreas' })).toBeInTheDocument()
    expect(screen.queryByText('Padrão')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Dpto. TI' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Tornar padrão' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Excluir' })).toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Desativar' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('a1', { isActive: false }))
  })

  it('cria área sem o interruptor de padrão (o campo nem vai)', async () => {
    const { create } = setupAreas()
    await userEvent.click(await screen.findByRole('button', { name: 'Nova área' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('switch', { name: /Padrão/ })).not.toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(/^Nome/), 'Jurídico')
    expect(within(dialog).getByLabelText(/^Chave/)).toHaveValue('JURIDICO')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]?.[0]).toMatchObject({ key: 'JURIDICO', name: 'Jurídico', isActive: true })
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('isDefault')
  })
})

describe('PrioritiesPage — nome por idioma', () => {
  // a API devolve `name` no idioma da tela (Accept-Language) e `translations` com o original e as traduções
  const media = (name: string): TaskPriority => ({
    id: 'p2',
    key: 'MEDIA',
    name,
    description: '',
    color: 'amber',
    order: 1,
    isActive: true,
    isDefault: true,
    translations: { 'pt-BR': { name: 'Média' }, es: { name: 'Media' }, en: { name: '' } },
    createdAt: null,
    updatedAt: null,
  })

  function setupPriorities(shown: string) {
    const update = vi.fn<LookupRepository<TaskPriority>['update']>(() => Promise.resolve(media(shown)))
    const create = vi.fn<LookupRepository<TaskPriority>['create']>(() => Promise.resolve(media(shown)))
    const repositories = fakeRepositories({ priorities: { list: () => Promise.resolve([media(shown)]), update, create } })
    renderRoutes([{ path: '/settings/priorities', element: <PrioritiesPage /> }], { repositories, initialPath: '/settings/priorities' })
    return { update, create }
  }

  it('em espanhol: a lista mostra o nome em espanhol; editar mostra o original (pt-BR) e as traduções e grava as traduções', async () => {
    await i18n.changeLanguage('es')
    try {
      const { update } = setupPriorities('Media')
      expect(await screen.findByText('Media')).toBeInTheDocument()
      expect(screen.queryByText('Média')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Acciones de Media' }))
      await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Editar' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByLabelText(/^Nombre · Português \(Brasil\)/)).toHaveValue('Média')
      expect(within(dialog).getByLabelText(/^Nombre · Español/)).toHaveValue('Media')
      const english = within(dialog).getByLabelText(/^Nombre · English/)
      expect(english).toHaveValue('')
      await userEvent.type(english, 'Medium')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
      await waitFor(() => expect(update).toHaveBeenCalledOnce())
      expect(update.mock.calls[0]?.[1]).toMatchObject({ name: 'Média', translations: { es: { name: 'Media' }, en: { name: 'Medium' } } })
    } finally {
      await i18n.changeLanguage('pt-BR')
    }
  })

  it('em português: a lista mostra o nome em português; nova prioridade já grava as traduções', async () => {
    const { create } = setupPriorities('Média')
    expect(await screen.findByText('Média')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Nova prioridade' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/^Nome · Português \(Brasil\)/), 'Urgente')
    expect(within(dialog).getByLabelText(/^Chave/)).toHaveValue('URGENTE')
    await userEvent.type(within(dialog).getByLabelText(/^Nome · English/), 'Urgent')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]?.[0]).toMatchObject({ key: 'URGENTE', name: 'Urgente', translations: { es: { name: '' }, en: { name: 'Urgent' } } })
  })

  it('status e áreas continuam com um nome só', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Novo status' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText(/English/)).not.toBeInTheDocument()
  })
})
