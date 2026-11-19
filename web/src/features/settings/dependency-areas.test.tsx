import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { PlatformRepository } from '@/domain/repositories'
import type { DependencyAreasConfig } from '@/domain/dependencies'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { DependencyAreasPage } from './DependencyAreasPage'
import { Navigate } from 'react-router'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const victor = { id: 'u9', name: 'Equipo de Informática', email: 'victor@x.com', avatarUrl: null }
const douglas = { id: 'u2', name: 'Douglas Martins', email: 'douglas@x.com', avatarUrl: null }
const lucia = { id: 'u3', name: 'Lúcia Ramos', email: 'lucia@x.com', avatarUrl: null }
// produção hoje: só a área TI, vinda das antigas Pessoas de TI
const CURRENT: DependencyAreasConfig = { areas: [{ key: 'ti', name: 'TI', userIds: ['u9'], users: [victor] }], candidates: [douglas, lucia, victor] }

function setup(initialPath = '/settings/dependency-areas') {
  const updateDependencyAreas = vi.fn<PlatformRepository['updateDependencyAreas']>((areas) =>
    Promise.resolve({
      areas: areas.map((a) => ({ key: a.key || 'financas', name: a.name, userIds: a.userIds, users: [victor, douglas, lucia].filter((u) => a.userIds.includes(u.id)) })),
      candidates: [douglas, lucia, victor],
    }),
  )
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(['settings.manage']) },
    platform: { getDependencyAreas: () => Promise.resolve(CURRENT), updateDependencyAreas },
  })
  renderRoutes(
    [
      { path: '/settings/dependency-areas', element: <DependencyAreasPage /> },
      { path: '/settings/it-people', element: <Navigate to="/settings/dependency-areas" replace /> },
    ],
    { repositories, initialPath },
  )
  return { updateDependencyAreas }
}

describe('Configurações → Dependências por área (§42)', () => {
  it('a TI vem das antigas Pessoas de TI, não se remove; adicionar uma área com pessoas e salvar a lista inteira', async () => {
    const { updateDependencyAreas } = setup()
    expect(await screen.findByRole('heading', { level: 1, name: 'Dependências por área' })).toBeInTheDocument()
    const [ti] = await screen.findAllByTestId('dependency-area')
    expect(within(ti!).getByLabelText(/Nome da área/)).toHaveValue('TI')
    expect(within(ti!).getByText('Equipo de Informática · victor@x.com')).toBeInTheDocument()
    expect(within(ti!).getByText(/Responsável TI de cada projeto/)).toBeInTheDocument()
    expect(within(ti!).queryByRole('button', { name: /Remover a área/ })).toBeNull()
    const save = screen.getByRole('button', { name: 'Salvar' })
    expect(save).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar área' }))
    const blocks = screen.getAllByTestId('dependency-area')
    const added = blocks[1]!
    expect(save).toBeDisabled() // sem nome ainda
    await userEvent.type(within(added).getByLabelText(/Nome da área/), 'Finanças')
    await userEvent.click(within(added).getByRole('combobox'))
    // quem já está na TI não aparece na outra área
    expect(screen.queryByRole('option', { name: /Equipo de Informática/ })).toBeNull()
    await userEvent.click(within(await screen.findByRole('option', { name: /Lúcia Ramos/ })).getByRole('button'))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(save).toBeEnabled())
    await userEvent.click(save)
    await waitFor(() =>
      expect(updateDependencyAreas).toHaveBeenCalledWith([
        { key: 'ti', name: 'TI', userIds: ['u9'] },
        { key: '', name: 'Finanças', userIds: ['u3'] },
      ]),
    )
  })

  it('a área nova pode ser removida antes de salvar', async () => {
    setup()
    await screen.findAllByTestId('dependency-area')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar área' }))
    expect(screen.getAllByTestId('dependency-area')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Remover a área Nova área' }))
    expect(screen.getAllByTestId('dependency-area')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('o endereço antigo /settings/it-people leva à tela nova', async () => {
    setup('/settings/it-people')
    expect(await screen.findByRole('heading', { level: 1, name: 'Dependências por área' })).toBeInTheDocument()
  })
})
