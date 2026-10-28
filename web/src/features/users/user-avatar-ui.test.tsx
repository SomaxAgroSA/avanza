import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { AppError } from '@/core/errors/app-error'
import type { UserRepository } from '@/domain/repositories'
import { notify } from '@/presentation/components'
import { fakeRepositories, makeCurrentUser, makeRole, makeUser, renderRoutes } from '@/test/utils'
import { UserFormDialog } from './UserFormDialog'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
// o jsdom não cria endereços para a pré-visualização
beforeEach(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:previa'), revokeObjectURL: vi.fn() })
})
afterEach(() => vi.restoreAllMocks())

const ROLE = makeRole({ id: 'role-member', code: 'MEMBER', name: 'Membro' })
const png = (name = 'bia.png') => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' })

function setup(users: Partial<UserRepository>, user: ReturnType<typeof makeUser> | null = null) {
  const onOpenChange = vi.fn()
  const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(['users.create', 'users.edit']) }, users })
  renderRoutes([{ path: '/', element: <UserFormDialog open onOpenChange={onOpenChange} user={user} roles={[ROLE]} canChangeAccess /> }], { repositories, initialPath: '/' })
  return { onOpenChange, input: () => document.querySelector<HTMLInputElement>('input[type=file]')! }
}

async function fillNew() {
  await userEvent.type(await screen.findByLabelText(/^Nome/), 'Bia')
  await userEvent.type(screen.getByLabelText(/^E-mail/), 'bia@empresa.com')
  await userEvent.type(screen.getByLabelText(/^Senha/), 'SenhaForte123')
  await userEvent.click(screen.getByRole('combobox', { name: /^Perfil/ }))
  await userEvent.click(await screen.findByRole('option', { name: 'Membro' }))
}

describe('Cadastro de usuário — foto', () => {
  it('sem escolher foto, cria como antes e não envia nada', async () => {
    const create = vi.fn<UserRepository['create']>(() => Promise.resolve(makeUser({ id: 'u9' })))
    const uploadAvatar = vi.fn<UserRepository['uploadAvatar']>()
    const { onOpenChange } = setup({ create, uploadAvatar })
    expect(await screen.findByText('Opcional. PNG, JPG ou WebP até 2 MB; sem foto, ficam as iniciais.')).toBeInTheDocument()
    await fillNew()
    await userEvent.click(screen.getByRole('button', { name: 'Novo usuário' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(create).toHaveBeenCalled()
    expect(uploadAvatar).not.toHaveBeenCalled()
  })

  it('foto escolhida aparece na prévia e é enviada para o usuário criado; tipo errado é barrado na tela', async () => {
    const create = vi.fn<UserRepository['create']>(() => Promise.resolve(makeUser({ id: 'u9' })))
    const uploadAvatar = vi.fn<UserRepository['uploadAvatar']>(() => Promise.resolve(makeUser({ id: 'u9', avatarUrl: '/api/v1/users/u9/avatar?v=1' })))
    const error = vi.spyOn(notify, 'error')
    const { onOpenChange, input } = setup({ create, uploadAvatar })
    await fillNew()
    await userEvent.upload(input(), new File(['GIF89a'], 'bia.gif', { type: 'image/gif' }), { applyAccept: false })
    expect(error).toHaveBeenCalledWith('Use uma imagem PNG, JPG ou WebP.')
    expect(screen.queryByRole('button', { name: 'Remover foto' })).not.toBeInTheDocument()

    const photo = png()
    await userEvent.upload(input(), photo)
    expect(await screen.findByRole('button', { name: 'Trocar foto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remover foto' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Novo usuário' }))
    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledWith('u9', photo))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('na edição: remover a foto atual chama a remoção; se a foto falhar, o cadastro fica salvo e avisa', async () => {
    const current = makeUser({ id: 'u1', avatarUrl: '/api/v1/users/u1/avatar?v=1' })
    const update = vi.fn<UserRepository['update']>(() => Promise.resolve(current))
    const removeAvatar = vi.fn<UserRepository['removeAvatar']>(() => Promise.reject(new AppError({ code: 'NETWORK_ERROR', message: 'offline', status: 0 })))
    const warning = vi.spyOn(notify, 'warning')
    const { onOpenChange } = setup({ update, removeAvatar }, current)
    await userEvent.click(await screen.findByRole('button', { name: 'Remover foto' }))
    expect(screen.getByRole('button', { name: 'Escolher foto' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(removeAvatar).toHaveBeenCalledWith('u1'))
    await waitFor(() => expect(warning).toHaveBeenCalledWith(expect.stringMatching(/^Usuário salvo, mas a foto não foi enviada/)))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
