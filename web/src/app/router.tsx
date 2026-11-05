import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { AppShell } from '@/presentation/layouts/AppShell'
import { LegacyBacklogRedirect, SettingsIndexRedirect } from './legacy-redirects'
import { GuestOnly, PermissionGate, RequireAuth } from '@/features/auth/guards'
import { NotFoundPage, RouteErrorPage } from '@/features/errors/ErrorPages'

/** Páginas carregadas sob demanda (code splitting por rota). */
const page = (loader: () => Promise<{ default: React.ComponentType }>): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await loader()).default }),
})

export const routes: RouteObject[] = [
  {
    path: '/login',
    element: <GuestOnly />,
    errorElement: <RouteErrorPage />,
    children: [{ index: true, ...page(() => import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage }))) }],
  },
  {
    path: '/forgot-password',
    element: <GuestOnly />,
    errorElement: <RouteErrorPage />,
    children: [{ index: true, ...page(() => import('@/features/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage }))) }],
  },
  // link do e-mail (redefinir senha ou convite): vale com ou sem sessão aberta
  { path: '/reset-password', errorElement: <RouteErrorPage />, ...page(() => import('@/features/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage }))) },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', ...page(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage }))) },
      { path: 'notifications', ...page(() => import('@/features/notifications/NotificationsPage').then((m) => ({ default: m.NotificationsPage }))) },
      { path: 'account', ...page(() => import('@/features/account/AccountPage').then((m) => ({ default: m.AccountPage }))) },
      { path: 'account/sessions', ...page(() => import('@/features/account/SessionsPage').then((m) => ({ default: m.SessionsPage }))) },
      { path: 'account/tokens', ...page(() => import('@/features/account/ApiTokensPage').then((m) => ({ default: m.ApiTokensPage }))) },
      {
        element: <PermissionGate permission="projects.view" />,
        children: [
          { path: 'projects', ...page(() => import('@/features/projects/ProjectsPage').then((m) => ({ default: m.AllProjectsPage }))) },
          { path: 'projects/mine', ...page(() => import('@/features/projects/ProjectsPage').then((m) => ({ default: m.MyProjectsPage }))) },
          { path: 'projects/archived', ...page(() => import('@/features/projects/ProjectsPage').then((m) => ({ default: m.ArchivedProjectsPage }))) },
          { path: 'projects/:projectId', ...page(() => import('@/features/projects/ProjectDetailPage').then((m) => ({ default: m.ProjectDetailPage }))) },
        ],
      },
      {
        element: <PermissionGate permission="tasks.view" />,
        children: [
          { path: 'planning', ...page(() => import('@/features/backlog/BacklogPage').then((m) => ({ default: m.BacklogPage }))) },
          { path: 'planning/:projectId', ...page(() => import('@/features/backlog/BacklogPage').then((m) => ({ default: m.BacklogPage }))) },
          { path: 'timeline', ...page(() => import('@/features/timeline/TimelinePage').then((m) => ({ default: m.TimelinePage }))) },
          { path: 'timeline/:projectId', ...page(() => import('@/features/timeline/TimelinePage').then((m) => ({ default: m.TimelinePage }))) },
          // endereços antigos (a tela se chamava Backlog)
          { path: 'backlog', element: <Navigate to="/planning" replace /> },
          { path: 'backlog/:projectId', element: <LegacyBacklogRedirect /> },
          { path: 'tasks', ...page(() => import('@/features/tasks/TasksPage').then((m) => ({ default: m.TasksPage }))) },
          { path: 'tasks/:taskId', ...page(() => import('@/features/tasks/TaskDetailPage').then((m) => ({ default: m.TaskDetailPage }))) },
        ],
      },
      {
        // Gestão de projetos: item próprio do menu (à parte das tarefas)
        element: <PermissionGate permission="plan.view" />,
        children: [
          { path: 'project-management', ...page(() => import('@/features/plan/ProjectManagementPage').then((m) => ({ default: m.ProjectManagementPage }))) },
          { path: 'project-management/:projectId', ...page(() => import('@/features/plan/ProjectManagementPage').then((m) => ({ default: m.ProjectManagementPage }))) },
        ],
      },
      {
        element: <PermissionGate permission="kanban.view" />,
        children: [
          { path: 'kanban', ...page(() => import('@/features/kanban/KanbanPage').then((m) => ({ default: m.KanbanPage }))) },
          { path: 'kanban/:projectId', ...page(() => import('@/features/kanban/KanbanPage').then((m) => ({ default: m.KanbanPage }))) },
        ],
      },
      {
        element: <PermissionGate permission="reports.view" />,
        children: [{ path: 'reports', ...page(() => import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage }))) }],
      },
      {
        element: <PermissionGate permission="docs.view" />,
        children: [
          { path: 'docs', ...page(() => import('@/features/docs/DocsHomePage').then((m) => ({ default: m.DocsHomePage }))) },
          { path: 'docs/:spaceKey', ...page(() => import('@/features/docs/DocSpacePage').then((m) => ({ default: m.DocSpacePage }))) },
          { path: 'docs/:spaceKey/:pageId', ...page(() => import('@/features/docs/DocSpacePage').then((m) => ({ default: m.DocSpacePage }))) },
          { path: 'docs/:spaceKey/:pageId/edit', ...page(() => import('@/features/docs/DocPageEditorPage').then((m) => ({ default: m.DocPageEditorPage }))) },
        ],
      },
      {
        element: <PermissionGate permission="users.view" />,
        children: [{ path: 'users', ...page(() => import('@/features/users/UsersPage').then((m) => ({ default: m.UsersPage }))) }],
      },
      {
        path: 'settings',
        element: <PermissionGate anyOf={['platform.manage', 'integrations.manage', 'settings.manage', 'permissions.manage', 'audit.view']} />,
        children: [
          { index: true, element: <SettingsIndexRedirect /> },
          {
            element: <PermissionGate permission="platform.manage" />,
            children: [{ path: 'general', ...page(() => import('@/features/settings/GeneralSettingsPage').then((m) => ({ default: m.GeneralSettingsPage }))) }],
          },
          {
            element: <PermissionGate permission="integrations.manage" />,
            children: [{ path: 'integrations', ...page(() => import('@/features/settings/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage }))) }],
          },
          {
            element: <PermissionGate permission="settings.manage" />,
            children: [
              { path: 'task-types', ...page(() => import('@/features/task-config/TaskTypesPage').then((m) => ({ default: m.TaskTypesPage }))) },
              {
                path: 'task-types/:typeId',
                ...page(() => import('@/features/task-config/TaskTypeDetailPage').then((m) => ({ default: m.TaskTypeDetailPage }))),
              },
              { path: 'custom-fields', ...page(() => import('@/features/task-config/CustomFieldsPage').then((m) => ({ default: m.CustomFieldsPage }))) },
              { path: 'statuses', ...page(() => import('@/features/workflow/LookupsPage').then((m) => ({ default: m.StatusesPage }))) },
              { path: 'priorities', ...page(() => import('@/features/workflow/LookupsPage').then((m) => ({ default: m.PrioritiesPage }))) },
              { path: 'areas', ...page(() => import('@/features/workflow/LookupsPage').then((m) => ({ default: m.AreasPage }))) },
              { path: 'tags', ...page(() => import('@/features/tags/TagsPage').then((m) => ({ default: m.TagsPage }))) },
            ],
          },
          {
            element: <PermissionGate permission="audit.view" />,
            children: [{ path: 'audit', ...page(() => import('@/features/audit/AuditPage').then((m) => ({ default: m.AuditPage }))) }],
          },
          {
            element: <PermissionGate permission="permissions.manage" />,
            children: [
              { path: 'access', ...page(() => import('@/features/settings/AccessControlPage').then((m) => ({ default: m.AccessControlPage }))) },
              // Perfis e Permissões viraram abas do Control de acceso
              { path: 'roles', element: <Navigate to="/settings/access?tab=roles" replace /> },
              { path: 'permissions', element: <Navigate to="/settings/access?tab=matrix" replace /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export function createAppRouter() {
  return createBrowserRouter(routes)
}
