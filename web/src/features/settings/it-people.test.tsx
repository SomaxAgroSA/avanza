import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { PlatformRepository } from '@/domain/repositories'
import type { ItPeople } from '@/domain/ti-dependencies'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { ItPeoplePage } from './ItPeoplePage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const victor = { id: 'u9', name: 'Equipo de Informática', email: 'victor@x.com', avatarUrl: null }
const douglas = { id: 'u2', name: 'Douglas Martins', email: 'douglas@x.com', avatarUrl: null }
const CURRENT: ItPeople = { userIds: ['u9'], users: [victor], candidates: [douglas, victor] }

function setup() {
  const updateItPeople = vi.fn<PlatformRepository['updateItPeople']>((ids) =>
    Promise.resolve({ userIds: ids, users: [victor, douglas].filter((u) => ids.includes(u.id)), candidates: [douglas, victor] }),
  )
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(['settings.manage']) },
    platform: { getItPeople: () => Promise.resolve(CURRENT), updateItPeople },
  })
  renderRoutes([{ path: '/settings/it-people', element: <ItPeoplePage /> }], { repositories, initialPath: '/settings/it-people' })
  return { updateItPeople }
}

describe('Configurações → Pessoas de TI (§42)', () => {
  it('mostra quem já é de TI, deixa escolher outra pessoa e salva a lista inteira', async () => {
    const { updateItPeople } = setup()
    expect(await screen.findByRole('heading', { level: 1, name: 'Pessoas de TI' })).toBeInTheDocument()
    expect(await screen.findByText('Equipo de Informática · victor@x.com')).toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Salvar' })
    expect(save).toBeDisabled()
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(within(await screen.findByRole('option', { name: /Douglas Martins/ })).getByRole('button'))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(save).toBeEnabled())
    await userEvent.click(save)
    await waitFor(() => expect(updateItPeople).toHaveBeenCalledWith(['u9', 'u2']))
  })
})
