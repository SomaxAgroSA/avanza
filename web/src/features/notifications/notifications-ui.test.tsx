import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { AppNotification } from '@/domain/notifications'
import type { NotificationRepository } from '@/domain/repositories'
import { fakeRepositories, renderRoutes } from '@/test/utils'
import { NotificationBell } from './NotificationBell'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const mention: AppNotification = {
  id: 'n1',
  type: 'mention',
  task: { id: 'k1', code: 'CRM-7', title: 'Erro ao salvar pedido' },
  planItem: null,
  actor: { id: 'u2', name: 'Carla Mendes', email: 'c@x.com', avatarUrl: null },
  data: { comment: '@Ana pode revisar?' },
  read: false,
  createdAt: new Date('2026-09-29T10:00:00Z'),
}
const overdue: AppNotification = { ...mention, id: 'n2', type: 'overdue', actor: null, data: { due_date: '2026-09-27' }, read: true }

function setup(overrides: Partial<NotificationRepository> = {}) {
  const markRead = vi.fn<NotificationRepository['markRead']>(() => Promise.resolve())
  const markAllRead = vi.fn<NotificationRepository['markAllRead']>(() => Promise.resolve(1))
  const repositories = fakeRepositories({
    notifications: {
      unreadCount: () => Promise.resolve(1),
      list: () => Promise.resolve({ items: [mention, overdue], page: 1, perPage: 10, total: 2, totalPages: 1 }),
      markRead,
      markAllRead,
      ...overrides,
    },
  })
  const utils = renderRoutes(
    [
      { path: '/', element: <NotificationBell /> },
      { path: '/tasks/:taskId', element: <p>detalhe da tarefa</p> },
    ],
    { repositories, initialPath: '/' },
  )
  return { ...utils, markRead, markAllRead }
}

describe('NotificationBell', () => {
  it('mostra o número de não lidas e as notificações com texto legível', async () => {
    setup()
    const bell = await screen.findByRole('button', { name: 'Notificações: 1 não lida' })
    await userEvent.click(bell)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Carla Mendes mencionou você em CRM-7')).toBeInTheDocument()
    expect(within(dialog).getByText('@Ana pode revisar?')).toBeInTheDocument()
    expect(within(dialog).getByText('CRM-7 está com o prazo vencido')).toBeInTheDocument()
    expect(within(dialog).getByText('Prazo: 27 de set. de 2026')).toBeInTheDocument()
  })

  it('clicar na menção marca como lida e abre a tarefa nos comentários', async () => {
    const { markRead, router } = setup()
    await userEvent.click(await screen.findByRole('button', { name: /Notificações/ }))
    await userEvent.click(await screen.findByText('Carla Mendes mencionou você em CRM-7'))
    await waitFor(() => expect(markRead).toHaveBeenCalledWith('n1'))
    expect(router.state.location.pathname).toBe('/tasks/k1')
    expect(router.state.location.search).toBe('?tab=comments')
  })

  it('notificação do quadro: texto com o elemento e abre o painel dele no projeto', async () => {
    const planMention: AppNotification = { ...mention, id: 'n3', type: 'plan_mention', task: null, planItem: { id: 'i9', projectId: 'p1', name: 'Reunião de kickoff', projectName: 'Clover 6' }, data: { comment: 'Veja a pauta' } }
    const repositories = fakeRepositories({
      notifications: { unreadCount: () => Promise.resolve(1), list: () => Promise.resolve({ items: [planMention], page: 1, perPage: 10, total: 1, totalPages: 1 }), markRead: () => Promise.resolve(), markAllRead: () => Promise.resolve(0) },
    })
    const { router } = renderRoutes(
      [
        { path: '/', element: <NotificationBell /> },
        { path: '/projects/:projectId/management', element: <p>gestão</p> },
      ],
      { repositories, initialPath: '/' },
    )
    await userEvent.click(await screen.findByRole('button', { name: /Notificações/ }))
    expect(await screen.findByText('Quadro de Clover 6')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Carla Mendes mencionou você em “Reunião de kickoff”'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1/management'))
    expect(router.state.location.search).toBe('?item=i9')
  })

  it('marcar todas como lidas', async () => {
    const { markAllRead } = setup()
    await userEvent.click(await screen.findByRole('button', { name: /Notificações/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar todas como lidas' }))
    await waitFor(() => expect(markAllRead).toHaveBeenCalledOnce())
  })

  it('sem notificações: sino sem contador e mensagem de vazio', async () => {
    setup({ unreadCount: () => Promise.resolve(0), list: () => Promise.resolve({ items: [], page: 1, perPage: 10, total: 0, totalPages: 0 }) })
    await userEvent.click(await screen.findByRole('button', { name: 'Notificações' }))
    expect(await screen.findByText('Nenhuma notificação')).toBeInTheDocument()
  })
})
