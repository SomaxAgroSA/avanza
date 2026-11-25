import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { DocNotice, DocNoticeCandidate, DocPage, DocSpace, DocSpaceDetail, DocTreePage } from '@/domain/docs'
import { notificationLink, type AppNotification } from '@/domain/notifications'
import type { PermissionCode } from '@/domain/permissions'
import type { Repositories } from '@/domain/repositories'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { DocSpacePage } from './DocSpacePage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
afterEach(() => {
  vi.restoreAllMocks()
})

const ALL: PermissionCode[] = ['docs.view', 'docs.edit', 'docs.manage', 'projects.view', 'tasks.view']

const space = (extra: Partial<DocSpace> = {}): DocSpace => ({
  id: 'sp1',
  key: 'TDC',
  name: 'Tabla de costos',
  description: '',
  icon: 'book',
  color: 'green',
  visibility: 'project',
  project: { id: 'drepy', key: 'DREPY', name: 'DRE SOMAX PARAGUAY' },
  module: null,
  homePageId: 'home',
  pageCount: 2,
  createdAt: null,
  updatedAt: null,
  capabilities: { edit: true, manage: true },
  ...extra,
})
const tree = (id: string, title: string, parentId: string | null, extra: Partial<DocTreePage> = {}): DocTreePage => ({
  id,
  parentId,
  title,
  status: 'published',
  position: 1024,
  hasDraft: false,
  isHome: false,
  updatedAt: null,
  tasks: [],
  ...extra,
})
const PAGES = [tree('home', 'Tabla de costos', null, { isHome: true, position: 0 }), tree('spec', 'Propuesta: imputador de costos', 'home')]
const docPage = (id: string, title: string, extra: Partial<DocPage> = {}): DocPage => ({
  id,
  space: { id: 'sp1', key: 'TDC', name: 'Tabla de costos' },
  parentId: null,
  title,
  status: 'published',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Matriz producto × safra.' }] }] },
  version: 2,
  publishedAt: new Date(),
  publishedBy: null,
  createdBy: null,
  isHome: false,
  ancestors: [],
  children: [],
  draft: null,
  capabilities: { edit: true, manage: true },
  ...extra,
})
const person = (id: string, name: string, suggested = false): DocNoticeCandidate => ({ id, name, email: `${id}@x.com`, avatarUrl: null, suggested })
const notice = (id: string, name: string, openedAt: Date | null): DocNotice => ({
  id: `n-${id}`,
  user: { id, name, email: `${id}@x.com`, avatarUrl: null },
  actor: { id: 'a1', name: 'Angelica Davalos', email: 'a@x.com', avatarUrl: null },
  note: '',
  createdAt: new Date(),
  openedAt,
})

function setup(docs: Partial<Repositories['docs']>, page: Partial<DocPage> = {}) {
  const detail: DocSpaceDetail = { space: space(), pages: PAGES, capabilities: { edit: true, manage: true } }
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(ALL) },
    docs: { listSpaces: async () => [detail.space], getSpace: async () => detail, getPage: async (id) => docPage(id, 'Propuesta: imputador de costos', page), ...docs },
  })
  return renderRoutes([{ path: '/docs/:spaceKey/:pageId', element: <DocSpacePage /> }], { repositories, initialPath: '/docs/TDC/spec' })
}

describe('Documentação: avisar sobre a página (§47)', () => {
  it('"Avisar" abre a janela com o responsável de Desenvolvimento marcado e manda o aviso com o "O que olhar"', async () => {
    const notifyPage = vi.fn(async () => [notice('d1', 'Douglas Martins', null)])
    setup({ listNoticeCandidates: async () => [person('d1', 'Douglas Martins', true), person('l1', 'Lia')], notifyPage })
    await userEvent.click(await screen.findByRole('button', { name: 'Avisar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Avisar sobre esta página' })
    expect(dialog).toHaveTextContent('Propuesta: imputador de costos, no projeto DRE SOMAX PARAGUAY')
    expect(await within(dialog).findByRole('button', { name: /Douglas Martins/ })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Douglas Martins vem marcado porque é o responsável de Desenvolvimento do projeto.')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /O que olhar/ }), 'Veja a seção 2')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Avisar' }))
    await waitFor(() => expect(notifyPage).toHaveBeenCalledWith('spec', { userIds: ['d1'], note: 'Veja a seção 2' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Avisar sobre esta página' })).toBeNull())
  })

  it('ao chegar da publicação, a janela abre sozinha; "Agora não" fecha sem avisar', async () => {
    const notifyPage = vi.fn(async () => [])
    const { router } = setup({ listNoticeCandidates: async () => [person('d1', 'Douglas Martins', true)], notifyPage })
    await screen.findByRole('heading', { name: 'Propuesta: imputador de costos' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(() => router.navigate('/docs/TDC/spec', { state: { notify: true } }))
    const dialog = await screen.findByRole('dialog', { name: 'Avisar sobre esta página' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agora não' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(notifyPage).not.toHaveBeenCalled()
  })

  it('quem edita vê quem foi avisado e se já abriu a página', async () => {
    setup({ listNotices: async () => [notice('d1', 'Douglas Martins', new Date()), notice('l1', 'Lia', null)] })
    const line = await screen.findByTestId('page-notices')
    expect(line).toHaveTextContent('Avisada para:')
    await waitFor(() => expect(line).toHaveTextContent(/Douglas Martins\s*abriu/))
    expect(line).toHaveTextContent(/Lia\s*ainda não abriu/)
  })

  it('quem só lê não vê "Avisar" nem a lista de avisos; página nunca publicada também não', async () => {
    const listNotices = vi.fn(async () => [])
    setup({ listNotices }, { capabilities: { edit: false, manage: false } })
    await screen.findByRole('heading', { name: 'Propuesta: imputador de costos' })
    expect(screen.queryByRole('button', { name: 'Avisar' })).toBeNull()
    expect(listNotices).not.toHaveBeenCalled()
  })

  it('a notificação do aviso abre a página da documentação', () => {
    const item = {
      id: 'n1',
      type: 'doc_shared',
      task: null,
      planItem: null,
      docPage: { id: 'spec', spaceKey: 'TDC', spaceName: 'Tabla de costos', title: 'Propuesta', projectName: 'DRE SOMAX PARAGUAY' },
      actor: null,
      data: {},
      read: false,
      createdAt: null,
    } satisfies AppNotification
    expect(notificationLink(item)).toBe('/docs/TDC/spec')
  })
})
