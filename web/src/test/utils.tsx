import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import { render } from '@testing-library/react'
import type { CurrentUser, Role, User } from '@/domain/entities'
import type { Page } from '@/domain/pagination'
import type { PermissionCode } from '@/domain/permissions'
import type { Repositories } from '@/domain/repositories'
import type { ContentLocale, TypeTexts } from '@/domain/task-config'
import { DEFAULT_PASSWORD_POLICY, DEFAULT_PLATFORM_INFO } from '@/domain/platform'
import { RepositoriesContext } from '@/presentation/common/repositories-context'
import { AppTooltipProvider } from '@/presentation/components'

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    name: 'Ana Souza',
    email: 'ana@kamban.test',
    avatarUrl: null,
    status: 'active',
    roleId: 'role-admin',
    locale: 'pt-BR',
    theme: 'system',
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-01T10:00:00Z'),
    lastLoginAt: null,
    emailNotifications: true,
    ...overrides,
  }
}

export function makeCurrentUser(permissions: PermissionCode[], roleCode = 'ADMIN'): CurrentUser {
  return {
    user: makeUser(),
    role: { id: `role-${roleCode.toLowerCase()}`, code: roleCode, name: roleCode, description: '', isSystem: true },
    permissions,
    session: null,
  }
}

/** Versões de um tipo sem traduções (só o original em pt-BR). */
export function typeTexts(name: string, description = ''): Record<ContentLocale, TypeTexts> {
  return { 'pt-BR': { name, description }, en: { name: '', description: '' }, es: { name: '', description: '' } }
}

export function makeRole(overrides: Partial<Role> = {}): Role {
  return { id: 'role-member', code: 'MEMBER', name: 'Member', description: '', isSystem: true, permissions: [], userCount: 0, ...overrides }
}

const notImplemented = () => Promise.reject(new Error('não usado neste teste'))

/** Repositórios falsos com padrões seguros; sobrescreva só o necessário em cada teste. */
export function fakeRepositories(overrides: {
  auth?: Partial<Repositories['auth']>
  users?: Partial<Repositories['users']>
  roles?: Partial<Repositories['roles']>
  audit?: Partial<Repositories['audit']>
  projects?: Partial<Repositories['projects']>
  customFields?: Partial<Repositories['customFields']>
  taskTypes?: Partial<Repositories['taskTypes']>
  statuses?: Partial<Repositories['statuses']>
  priorities?: Partial<Repositories['priorities']>
  areas?: Partial<Repositories['areas']>
  tasks?: Partial<Repositories['tasks']>
  tags?: Partial<Repositories['tags']>
  comments?: Partial<Repositories['comments']>
  attachments?: Partial<Repositories['attachments']>
  notifications?: Partial<Repositories['notifications']>
  board?: Partial<Repositories['board']>
  backlog?: Partial<Repositories['backlog']>
  relations?: Partial<Repositories['relations']>
  reports?: Partial<Repositories['reports']>
  sprints?: Partial<Repositories['sprints']>
  timeline?: Partial<Repositories['timeline']>
  milestones?: Partial<Repositories['milestones']>
  charter?: Partial<Repositories['charter']>
  plan?: Partial<Repositories['plan']>
  docs?: Partial<Repositories['docs']>
  platform?: Partial<Repositories['platform']>
  email?: Partial<Repositories['email']>
  apiTokens?: Partial<Repositories['apiTokens']>
  webhooks?: Partial<Repositories['webhooks']>
} = {}): Repositories {
  const emptyPage: Page<User> = { items: [], page: 1, perPage: 20, total: 0, totalPages: 0 }
  return {
    auth: {
      login: notImplemented,
      logout: () => Promise.resolve(),
      me: () => Promise.resolve(null),
      listSessions: () => Promise.resolve([]),
      revokeSession: notImplemented,
      revokeOtherSessions: notImplemented,
      changePassword: notImplemented,
      passwordPolicy: () => Promise.resolve(DEFAULT_PASSWORD_POLICY),
      requestPasswordReset: notImplemented,
      checkResetToken: notImplemented,
      confirmPasswordReset: notImplemented,
      ...overrides.auth,
    },
    users: {
      list: () => Promise.resolve(emptyPage),
      get: notImplemented,
      create: notImplemented,
      update: notImplemented,
      setStatus: notImplemented,
      resetPassword: notImplemented,
      resendInvite: notImplemented,
      history: notImplemented,
      ...overrides.users,
    },
    roles: {
      list: () => Promise.resolve([]),
      listPermissions: () => Promise.resolve([]),
      create: notImplemented,
      update: notImplemented,
      updatePermissions: notImplemented,
      remove: notImplemented,
      ...overrides.roles,
    },
    audit: {
      list: notImplemented,
      ...overrides.audit,
    },
    projects: {
      list: () => Promise.resolve({ items: [], page: 1, perPage: 20, total: 0, totalPages: 0 }),
      get: notImplemented,
      create: notImplemented,
      update: notImplemented,
      archive: notImplemented,
      unarchive: notImplemented,
      remove: notImplemented,
      transferOwnership: notImplemented,
      listMembers: () => Promise.resolve([]),
      addMember: notImplemented,
      updateMemberRole: notImplemented,
      removeMember: notImplemented,
      memberCandidates: () => Promise.resolve([]),
      history: notImplemented,
      ...overrides.projects,
    },
    customFields: {
      list: () => Promise.resolve([]),
      get: notImplemented,
      create: notImplemented,
      update: notImplemented,
      remove: notImplemented,
      ...overrides.customFields,
    },
    taskTypes: {
      list: () => Promise.resolve([]),
      get: notImplemented,
      create: notImplemented,
      update: notImplemented,
      remove: notImplemented,
      reorder: notImplemented,
      setFields: notImplemented,
      history: notImplemented,
      ...overrides.taskTypes,
    },
    statuses: {
      list: () => Promise.resolve([]),
      create: notImplemented,
      update: notImplemented,
      remove: notImplemented,
      reorder: notImplemented,
      ...overrides.statuses,
    },
    priorities: {
      list: () => Promise.resolve([]),
      create: notImplemented,
      update: notImplemented,
      remove: notImplemented,
      reorder: notImplemented,
      ...overrides.priorities,
    },
    areas: {
      list: () => Promise.resolve([]),
      create: notImplemented,
      update: notImplemented,
      remove: notImplemented,
      reorder: notImplemented,
      ...overrides.areas,
    },
    tasks: {
      list: () => Promise.resolve({ items: [], page: 1, perPage: 20, total: 0, totalPages: 0 }),
      get: notImplemented,
      create: notImplemented,
      update: notImplemented,
      setInReport: notImplemented,
      setUrgency: notImplemented,
      setArea: notImplemented,
      remove: notImplemented,
      history: () => Promise.resolve({ items: [], page: 1, perPage: 100, total: 0, totalPages: 0 }),
      ...overrides.tasks,
    },
    tags: {
      list: () => Promise.resolve([]),
      create: notImplemented,
      update: notImplemented,
      remove: notImplemented,
      ...overrides.tags,
    },
    comments: {
      list: () => Promise.resolve([]),
      create: notImplemented,
      update: notImplemented,
      remove: notImplemented,
      mentionCandidates: () => Promise.resolve([]),
      ...overrides.comments,
    },
    attachments: {
      list: () => Promise.resolve([]),
      upload: notImplemented,
      remove: notImplemented,
      ...overrides.attachments,
    },
    notifications: {
      list: () => Promise.resolve({ items: [], page: 1, perPage: 20, total: 0, totalPages: 0 }),
      unreadCount: () => Promise.resolve(0),
      markRead: () => Promise.resolve(),
      markAllRead: () => Promise.resolve(0),
      ...overrides.notifications,
    },
    board: {
      get: notImplemented,
      move: notImplemented,
      ...overrides.board,
    },
    timeline: {
      get: notImplemented,
      ...overrides.timeline,
    },
    milestones: {
      list: () => Promise.resolve([]),
      create: notImplemented,
      update: notImplemented,
      remove: notImplemented,
      ...overrides.milestones,
    },
    charter: {
      get: notImplemented,
      brief: notImplemented,
      saveObjective: notImplemented,
      createItem: notImplemented,
      updateItem: notImplemented,
      removeItem: notImplemented,
      reorder: notImplemented,
      measurements: () => Promise.resolve([]),
      addMeasurement: notImplemented,
      ...overrides.charter,
    },
    plan: {
      get: notImplemented,
      createGroup: notImplemented,
      updateGroup: notImplemented,
      moveGroup: notImplemented,
      duplicateGroup: notImplemented,
      deleteGroup: notImplemented,
      createItem: notImplemented,
      updateItem: notImplemented,
      deleteItem: notImplemented,
      createStatus: notImplemented,
      updateStatus: notImplemented,
      deleteStatus: notImplemented,
      createResource: notImplemented,
      updateResource: notImplemented,
      deleteResource: notImplemented,
      moveItem: notImplemented,
      duplicateItem: notImplemented,
      bulk: notImplemented,
      createLink: notImplemented,
      deleteLink: notImplemented,
      updateSettings: notImplemented,
      importItems: notImplemented,
      listUpdates: () => Promise.resolve({ updates: [], capabilities: { post: true } }),
      createUpdate: notImplemented,
      editUpdate: notImplemented,
      deleteUpdate: notImplemented,
      mentionCandidates: () => Promise.resolve([]),
      addUpdateFiles: notImplemented,
      deleteFile: notImplemented,
      history: () => Promise.resolve({ items: [], page: 1, perPage: 100, total: 0, totalPages: 0 }),
      saveBaseline: notImplemented,
      clearBaseline: notImplemented,
      listJournal: () => Promise.resolve({ entries: [], capabilities: { create: true } }),
      createJournalEntry: notImplemented,
      updateJournalEntry: notImplemented,
      deleteJournalEntry: notImplemented,
      listIssues: () => Promise.resolve({ issues: [], capabilities: { create: true } }),
      createIssue: notImplemented,
      updateIssue: notImplemented,
      deleteIssue: notImplemented,
      report: notImplemented,
      createColumn: notImplemented,
      updateColumn: notImplemented,
      previewColumnType: notImplemented,
      changeColumnType: notImplemented,
      duplicateColumn: notImplemented,
      deleteColumn: notImplemented,
      ...overrides.plan,
    },
    docs: {
      listSpaces: () => Promise.resolve([]),
      getSpace: notImplemented,
      createSpace: notImplemented,
      updateSpace: notImplemented,
      deleteSpace: notImplemented,
      createPage: notImplemented,
      getPage: notImplemented,
      deletePage: notImplemented,
      getDraft: notImplemented,
      saveDraft: notImplemented,
      discardDraft: notImplemented,
      publish: notImplemented,
      move: notImplemented,
      listVersions: () => Promise.resolve([]),
      getVersion: notImplemented,
      restoreVersion: notImplemented,
      uploadFiles: notImplemented,
      search: () => Promise.resolve([]),
      recent: () => Promise.resolve([]),
      ...overrides.docs,
    },
    reports: {
      get: notImplemented,
      listTasks: notImplemented,
      ...overrides.reports,
    },
    relations: {
      list: () => Promise.resolve({ parent: null, children: [], subtaskProgress: { done: 0, total: 0 }, forkedFrom: null, forks: [], relations: [], capabilities: { link: false, fork: false, createSubtask: false, edit: false } }),
      create: notImplemented,
      remove: notImplemented,
      fork: notImplemented,
      ...overrides.relations,
    },
    backlog: {
      get: notImplemented,
      rank: notImplemented,
      ...overrides.backlog,
    },
    sprints: {
      list: () => Promise.resolve([]),
      create: notImplemented,
      update: notImplemented,
      remove: notImplemented,
      reorder: notImplemented,
      ...overrides.sprints,
    },
    platform: {
      getInfo: () => Promise.resolve(DEFAULT_PLATFORM_INFO),
      getSettings: notImplemented,
      updateSettings: notImplemented,
      previewRetention: notImplemented,
      uploadBranding: notImplemented,
      removeBranding: notImplemented,
      runRetention: notImplemented,
      ...overrides.platform,
    },
    email: {
      getSettings: notImplemented,
      updateSettings: notImplemented,
      sendTest: notImplemented,
      outbox: notImplemented,
      flush: notImplemented,
      ...overrides.email,
    },
    apiTokens: {
      listMine: () => Promise.resolve([]),
      create: notImplemented,
      revoke: notImplemented,
      listAll: () => Promise.resolve([]),
      revokeAny: notImplemented,
      ...overrides.apiTokens,
    },
    webhooks: {
      list: () => Promise.resolve([]),
      catalog: () => Promise.resolve({ events: [], groups: [] }),
      create: notImplemented,
      update: notImplemented,
      remove: notImplemented,
      rotateSecret: notImplemented,
      test: notImplemented,
      deliveries: () => Promise.resolve([]),
      redeliver: notImplemented,
      ...overrides.webhooks,
    },
  }
}

export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
}

export function Providers({ repositories, queryClient, children }: { repositories: Repositories; queryClient?: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient ?? createTestQueryClient()}>
      <RepositoriesContext.Provider value={repositories}>
        <AppTooltipProvider>{children}</AppTooltipProvider>
      </RepositoriesContext.Provider>
    </QueryClientProvider>
  )
}

/** Renderiza rotas em memória com provedores de teste. */
export function renderRoutes(routes: RouteObject[], options: { repositories: Repositories; initialPath: string }) {
  const router = createMemoryRouter(routes, { initialEntries: [options.initialPath] })
  const utils = render(
    <Providers repositories={options.repositories}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return { ...utils, router }
}

export function renderWithProviders(ui: ReactElement, repositories: Repositories = fakeRepositories()) {
  return render(<Providers repositories={repositories}>{ui}</Providers>)
}
