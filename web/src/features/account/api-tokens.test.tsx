import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { ApiToken } from '@/domain/api-tokens'
import type { ApiTokenRepository } from '@/domain/repositories'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { ApiTokensPage } from './ApiTokensPage'
import { IntegrationsPage } from '@/features/settings/IntegrationsPage'
import { notify } from '@/presentation/components'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
afterEach(() => vi.restoreAllMocks())

const TOKEN: ApiToken = {
  id: 't1',
  name: 'Power BI',
  prefix: 'kb_pat_ab12',
  state: 'active',
  createdAt: new Date('2026-09-01T10:00:00Z'),
  expiresAt: null,
  lastUsedAt: null,
  lastUsedIp: null,
  revokedAt: null,
  revealable: true,
  user: null,
}

function setup(permissions: Parameters<typeof makeCurrentUser>[0], apiTokens: Partial<ApiTokenRepository> = {}) {
  const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(permissions) }, apiTokens })
  renderRoutes([{ path: '/account/tokens', element: <ApiTokensPage /> }], { repositories, initialPath: '/account/tokens' })
}

describe('Minha conta — tokens de API', () => {
  it('criar: nome e prazo; o valor aparece uma vez, com cópia e exemplo; fechar some com ele', async () => {
    const create = vi.fn<ApiTokenRepository['create']>(() => Promise.resolve({ ...TOKEN, token: 'kb_pat_ab12' + 'x'.repeat(36) }))
    setup(['api_tokens.create'], { create })
    await userEvent.click(await screen.findByRole('button', { name: 'Novo token' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Novo token' }))
    expect(await within(dialog).findByText('Campo obrigatório')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
    await userEvent.type(within(dialog).getByLabelText(/^Nome/), 'Power BI')
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Vence em' }))
    await userEvent.click(await screen.findByRole('option', { name: '365 dias' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Novo token' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith('Power BI', 365))
    expect(await screen.findByText('Copie o seu token agora')).toBeInTheDocument()
    expect(screen.getByLabelText('Token')).toHaveValue('kb_pat_ab12' + 'x'.repeat(36))
    expect(screen.getByText(/curl -H "Authorization: Bearer kb_pat_ab12x+"/)).toBeInTheDocument()
    // conectar o Claude (MCP) com o mesmo token
    expect(screen.getByText('Conectar ao Claude (Claude Code)')).toBeInTheDocument()
    expect(screen.getByText(/claude mcp add --transport http avanza http:\/\/\S+\/api\/mcp --header "Authorization: Bearer kb_pat_ab12x+"/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copiar comando do Claude' })).toBeInTheDocument()
    // servidor da rede local sem HTTPS: não há navigator.clipboard — a cópia usa o método antigo e avisa
    const exec = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    const success = vi.spyOn(notify, 'success')
    await userEvent.click(screen.getByRole('button', { name: 'Copiar token' }))
    expect(exec).toHaveBeenCalledWith('copy')
    await waitFor(() => expect(success).toHaveBeenCalledWith('Copiado para a área de transferência'))
    await userEvent.click(screen.getByRole('button', { name: 'Já copiei' }))
    await waitFor(() => expect(screen.queryByText('Copie o seu token agora')).not.toBeInTheDocument())
    expect(screen.queryByDisplayValue('kb_pat_ab12' + 'x'.repeat(36))).not.toBeInTheDocument()
  })

  it('lista mostra o início, a situação e o uso; revogar pede confirmação', async () => {
    const revoke = vi.fn<ApiTokenRepository['revoke']>(() => Promise.resolve({ ...TOKEN, state: 'revoked' }))
    setup(['api_tokens.create'], { listMine: () => Promise.resolve([TOKEN]), revoke })
    expect(await screen.findByText('Power BI')).toBeInTheDocument()
    expect(screen.getByText('kb_pat_ab12…')).toBeInTheDocument()
    expect(screen.getByText('Nunca usado')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Revogar Power BI' }))
    const confirm = await screen.findByRole('alertdialog')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Revogar' }))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('t1'))
  })

  it('ver token: mostra de novo o valor e o comando do Claude para copiar; o antigo explica que não dá', async () => {
    const value = 'kb_pat_ab12' + 'y'.repeat(36)
    const reveal = vi.fn<ApiTokenRepository['reveal']>(() => Promise.resolve({ ...TOKEN, token: value }))
    const legacy = { ...TOKEN, id: 't2', name: 'Antigo', revealable: false }
    const info = vi.spyOn(notify, 'info')
    setup(['api_tokens.create'], { listMine: () => Promise.resolve([TOKEN, legacy]), reveal })
    const viewOf = (name: string) => within(screen.getByText(name).closest('tr') as HTMLElement).getByRole('button', { name: 'Visualizar' })
    await screen.findByText('Antigo')
    await userEvent.click(viewOf('Power BI'))
    await waitFor(() => expect(reveal).toHaveBeenCalledWith('t1'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Token "Power BI"')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Token')).toHaveValue(value)
    expect(within(dialog).getByText(new RegExp(`claude mcp add .* --header "Authorization: Bearer ${value}"`))).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Copiar comando do Claude' })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Já copiei' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await userEvent.click(viewOf('Antigo'))
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/não pode ser mostrado de novo/))
  })

  it('sem a permissão não há "Novo token"', async () => {
    setup([])
    expect(await screen.findByText('Seu perfil não permite criar tokens de API.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Novo token' })).not.toBeInTheDocument()
  })
})

describe('Integrações — tokens de todos', () => {
  it('Admin vê a pessoa de cada token e revoga', async () => {
    const revokeAny = vi.fn<ApiTokenRepository['revokeAny']>(() => Promise.resolve({ ...TOKEN, state: 'revoked' }))
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(['integrations.manage']) },
      email: { getSettings: () => new Promise(() => {}), outbox: () => new Promise(() => {}) },
      apiTokens: { listAll: () => Promise.resolve([{ ...TOKEN, user: { id: 'u2', name: 'Gil', email: 'gil@x.com', avatarUrl: null } }]), revokeAny },
    })
    renderRoutes([{ path: '/settings/integrations', element: <IntegrationsPage /> }], { repositories, initialPath: '/settings/integrations' })
    await userEvent.click(await screen.findByRole('tab', { name: 'Tokens de API' }))
    expect(await screen.findByText('Gil')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Revogar Power BI' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(/O token de Gil para de funcionar na hora/)).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole('button', { name: 'Revogar' }))
    await waitFor(() => expect(revokeAny).toHaveBeenCalledWith('t1'))
  })
})
