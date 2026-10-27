import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { PlatformSettings } from '@/domain/platform'
import type { PlatformRepository } from '@/domain/repositories'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { BrandMark } from '@/presentation/navigation/Sidebar'
import { AccountPage } from '@/features/account/AccountPage'
import { GeneralSettingsPage } from './GeneralSettingsPage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const SETTINGS: PlatformSettings = {
  values: {
    auditRetentionMonths: 3,
    lockoutThreshold: 5,
    lockoutBaseMinutes: 5,
    lockoutMaxMinutes: 60,
    passwordMinLength: 10,
    passwordRequireMixedCase: false,
    passwordRequireSymbol: false,
    platformName: 'Avanza',
  },
  defaults: {
    auditRetentionMonths: 3,
    lockoutThreshold: 5,
    lockoutBaseMinutes: 5,
    lockoutMaxMinutes: 60,
    passwordMinLength: 10,
    passwordRequireMixedCase: false,
    passwordRequireSymbol: false,
    platformName: 'Avanza',
  },
  limits: {
    lockoutThreshold: { min: 3, max: 20 },
    lockoutBaseMinutes: { min: 1, max: 60 },
    lockoutMaxMinutes: { min: 1, max: 1440 },
    passwordMinLength: { min: 8, max: 64 },
    platformNameMax: 40,
  },
  retentionOptions: [1, 3, 6, 12, 24, 0],
  branding: { logo_light: null, logo_dark: null, favicon: null },
  updatedAt: null,
}

function setup(platform: Partial<PlatformRepository> = {}) {
  const updateSettings = vi.fn<PlatformRepository['updateSettings']>((patch) => Promise.resolve({ ...SETTINGS, values: { ...SETTINGS.values, ...patch } }))
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(['platform.manage']) },
    platform: { getSettings: () => Promise.resolve(SETTINGS), updateSettings, ...platform },
  })
  renderRoutes([{ path: '/settings/general', element: <GeneralSettingsPage /> }], { repositories, initialPath: '/settings/general' })
  return { updateSettings }
}

describe('Configurações gerais', () => {
  it('mostra os blocos com os valores e o resumo do bloqueio; salva só o que mudou', async () => {
    const { updateSettings } = setup()
    const name = await screen.findByLabelText(/^Nome da plataforma/)
    expect(name).toHaveValue('Avanza')
    expect(screen.getByText(/Depois de 5 tentativas erradas a conta fica bloqueada por 5 min/)).toBeInTheDocument()
    expect(screen.getByText('Letras e números são sempre exigidos.')).toBeInTheDocument()

    await userEvent.clear(name)
    await userEvent.type(name, 'Portal da Obra')
    await userEvent.click(screen.getByRole('switch', { name: 'Exigir um símbolo (ex.: ! @ # $)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ platformName: 'Portal da Obra', passwordRequireSymbol: true }))
  })

  it('valores fora dos limites não vão para o servidor; teto abaixo do tempo inicial também não', async () => {
    const { updateSettings } = setup()
    const threshold = await screen.findByLabelText(/^Tentativas erradas/)
    await userEvent.clear(threshold)
    await userEvent.type(threshold, '2')
    const max = screen.getByLabelText(/^Bloqueio máximo/)
    await userEvent.clear(max)
    await userEvent.type(max, '3')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    expect(await screen.findByText('Valor abaixo do mínimo')).toBeInTheDocument()
    expect(screen.getByText('Não pode ser menor que o tempo inicial')).toBeInTheDocument()
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('encurtar a retenção mostra quantos registros sairão e só salva depois de confirmar', async () => {
    const previewRetention = vi.fn<PlatformRepository['previewRetention']>(() => Promise.resolve({ auditToDelete: 42 }))
    const { updateSettings } = setup({ previewRetention })
    await userEvent.click(await screen.findByRole('combobox', { name: 'Guardar por' }))
    await userEvent.click(await screen.findByRole('option', { name: '1 mês' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(previewRetention).toHaveBeenCalledWith(1))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/42 registros do histórico ficam fora do novo prazo/)).toBeInTheDocument()
    expect(updateSettings).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Encurtar e salvar' }))
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ auditRetentionMonths: 1 }))
  })

  it('logo: arquivo de tipo não aceito é barrado na tela; PNG é enviado ao lugar certo', async () => {
    const uploadBranding = vi.fn<PlatformRepository['uploadBranding']>(() =>
      // o servidor devolve um objeto novo (como na API real)
      Promise.resolve({ ...SETTINGS, values: { ...SETTINGS.values }, branding: { ...SETTINGS.branding, logo_dark: { name: 'marca.png', mime: 'image/png', size: 2048 } } }),
    )
    setup({ uploadBranding })
    await screen.findByText('Logo (tema escuro)')
    // edição ainda não salva não se perde ao enviar a imagem
    const name = screen.getByLabelText(/^Nome da plataforma/)
    await userEvent.clear(name)
    await userEvent.type(name, 'Rascunho')
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type=file]')
    expect(inputs).toHaveLength(3)
    await userEvent.upload(inputs[1]!, new File(['GIF89a'], 'marca.gif', { type: 'image/gif' }), { applyAccept: false })
    expect(uploadBranding).not.toHaveBeenCalled()
    await userEvent.upload(inputs[1]!, new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'marca.png', { type: 'image/png' }))
    await waitFor(() => expect(uploadBranding).toHaveBeenCalledWith('logo_dark', expect.any(File)))
    expect(await screen.findByText('marca.png · 2 KB')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nome da plataforma/)).toHaveValue('Rascunho')
  })
})

describe('Identidade e política de senha nas outras telas', () => {
  it('menu mostra o nome e o logo configurados', async () => {
    const repositories = fakeRepositories({
      platform: { getInfo: () => Promise.resolve({ name: 'Portal da Obra', logoLightUrl: '/api/v1/platform/branding/logo_light?v=1', logoDarkUrl: null, faviconUrl: null, passwordReset: false }) },
    })
    renderRoutes([{ path: '/', element: <BrandMark /> }], { repositories, initialPath: '/' })
    expect(await screen.findByText('Portal da Obra')).toBeInTheDocument()
    expect(document.querySelector('img')).toHaveAttribute('src', '/api/v1/platform/branding/logo_light?v=1')
  })

  it('troca de senha mostra e aplica as exigências vigentes', async () => {
    const changePassword = vi.fn()
    const repositories = fakeRepositories({
      auth: {
        me: async () => makeCurrentUser([]),
        changePassword,
        passwordPolicy: () => Promise.resolve({ minLength: 12, maxLength: 72, requireLettersNumbers: true, requireMixedCase: false, requireSymbol: true }),
      },
    })
    renderRoutes([{ path: '/account', element: <AccountPage /> }], { repositories, initialPath: '/account' })
    expect(await screen.findByText('Mínimo de 12 caracteres, com letras e números e um símbolo.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/^Senha atual/), 'SenhaAtual123')
    await userEvent.type(screen.getByLabelText(/^Nova senha/), 'SemSimbolo1234')
    await userEvent.type(screen.getByLabelText(/^Confirme a nova senha/), 'SemSimbolo1234')
    await userEvent.click(screen.getByRole('button', { name: 'Trocar senha' }))
    expect(await screen.findByText('Inclua um símbolo (ex.: ! @ # $)')).toBeInTheDocument()
    expect(changePassword).not.toHaveBeenCalled()
  })
})
