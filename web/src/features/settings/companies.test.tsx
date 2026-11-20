import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { CompanyRepository } from '@/domain/repositories'
import type { Company } from '@/domain/companies'
import { AppError } from '@/core/errors/app-error'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { CompaniesPage } from './CompaniesPage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const company = (id: string, name: string, extra: Partial<Company> = {}): Company => ({
  id,
  name,
  shortCode: '',
  active: true,
  projectCount: 0,
  demandCount: 0,
  usageCount: 0,
  createdAt: null,
  updatedAt: null,
  ...extra,
})

/** O botão ＋ Empresa do cabeçalho (o da coluna Empresa também se chama assim). */
const addButton = () => screen.getAllByRole('button', { name: 'Empresa' }).find((button) => !button.closest('table'))!

function setup(list: Company[]) {
  let current = list.slice()
  const listFn = vi.fn<CompanyRepository['list']>(() => Promise.resolve(current))
  const create = vi.fn<CompanyRepository['create']>((data) => {
    const created = company('new', data.name, { shortCode: data.shortCode ?? '' })
    current = [...current, created]
    return Promise.resolve(created)
  })
  const update = vi.fn<CompanyRepository['update']>((id, data) => {
    current = current.map((c) => (c.id === id ? { ...c, ...data } : c))
    return Promise.resolve(current.find((c) => c.id === id)!)
  })
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(['platform.manage']) },
    companies: { list: listFn, create, update },
  })
  renderRoutes([{ path: '/settings/companies', element: <CompaniesPage /> }], { repositories, initialPath: '/settings/companies' })
  return { listFn, create, update }
}

describe('Configurações → Empresas (§46)', () => {
  it('grade padrão: Empresa, Sigla, Projetos e demandas, Estado; pede as inativas com o uso; sem subtítulo', async () => {
    const { listFn } = setup([
      company('c1', 'Somax Paraguay', { shortCode: 'SMX', projectCount: 2, demandCount: 1, usageCount: 3 }),
      company('c2', 'Agro', { active: false }),
    ])
    expect(await screen.findByRole('heading', { level: 1, name: 'Empresas' })).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Empresas' })
    for (const header of ['Empresa', 'Sigla', 'Projetos e demandas', 'Estado']) expect(within(table).getByRole('columnheader', { name: new RegExp(header) })).toBeInTheDocument()
    const somax = (await within(table).findByText('Somax Paraguay')).closest('tr')!
    expect(within(somax).getByText('SMX')).toBeInTheDocument()
    expect(within(somax).getByText('3')).toBeInTheDocument()
    expect(within(somax).getByText('Ativa')).toBeInTheDocument()
    expect(within(within(table).getByText('Agro').closest('tr')!).getByText('Inativa')).toBeInTheDocument()
    expect(listFn).toHaveBeenCalledWith({ includeInactive: true })
    expect(addButton()).toBeInTheDocument()
  })

  it('＋ Empresa: nome e sigla (em maiúsculas); nome repetido mostra o erro no campo', async () => {
    const { create } = setup([])
    await screen.findByRole('table', { name: 'Empresas' })
    await userEvent.click(addButton())
    const dialog = await screen.findByRole('dialog', { name: 'Nova empresa' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    expect(create).not.toHaveBeenCalled()
    await userEvent.type(within(dialog).getByLabelText(/Nome/), 'Somax')
    await userEvent.type(within(dialog).getByLabelText(/Sigla/), 'smx')
    create.mockRejectedValueOnce(new AppError({ code: 'COMPANY_NAME_IN_USE', message: 'x', status: 409 }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    expect(await within(dialog).findByText('Já existe uma empresa com esse nome')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nova empresa' })).toBeNull())
    expect(create).toHaveBeenLastCalledWith({ name: 'Somax', shortCode: 'SMX' })
  })

  it('Desativar pede confirmação; a inativa volta com Ativar (sem excluir)', async () => {
    const { update } = setup([company('c1', 'Somax'), company('c2', 'Agro', { active: false })])
    const table = await screen.findByRole('table', { name: 'Empresas' })
    const somax = (await within(table).findByText('Somax')).closest('tr')!
    await userEvent.click(within(somax).getByRole('button', { name: /Desativar/ }))
    const confirm = await screen.findByRole('alertdialog')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('c1', { active: false }))
    const agro = within(table).getByText('Agro').closest('tr')!
    await userEvent.click(within(agro).getByRole('button', { name: /Ativar/ }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('c2', { active: true }))
    expect(screen.queryByRole('button', { name: /Excluir/ })).toBeNull()
  })
})
