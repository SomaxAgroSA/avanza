import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { AppShell } from '@/presentation/layouts/AppShell'
import { LegacyProjectRedirect, SettingsIndexRedirect } from './legacy-redirects'
import { GuestOnly, PermissionGate, RequireAuth } from '@/features/auth/guards'
import { NotFoundPage, RouteErrorPage } from '@/features/errors/ErrorPages'
import { isChunkLoadError, reloadForNewVersion } from './chunk-reload'

/**
 * Páginas carregadas sob demanda (code splitting por rota). Se o arquivo da tela é de uma versão anterior
 * (houve publicação com a aba aberta), recarrega uma vez para pegar a nova em vez de mostrar o erro.
 */
const page = (loader: () => Promise<{ default: React.ComponentType }>): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => {
    try {
      return { Component: (await loader()).default }
    } catch (error) {
      // recarregando: a tela atual fica até a página nova chegar
      if (isChunkLoadError(error) && reloadForNewVersion()) return new Promise<never>(() => {})
      throw error
    }
  },
})

/** Visões por projeto que eram itens do menu lateral (e o antigo "Backlog"): agora são abas do projeto. */
const LEGACY_ROUTES: RouteObject[] = [
  { path: 'project-management', element: <Navigate to="/projects" replace /> },
  { path: 'project-management/:projectId', element: <LegacyProjectRedirect section="management" /> },
  { path: 'planning', element: <Navigate to="/projects" replace /> },
  { path: 'planning/:projectId', element: <LegacyProjectRedirect section="planning" /> },
  { path: 'backlog', element: <Navigate to="/projects" replace /> },
  { path: 'backlog/:projectId', element: <LegacyProjectRedirect section="planning" /> },
  { path: 'timeline', element: <Navigate to="/projects" replace /> },
  { path: 'timeline/:projectId', element: <LegacyProjectRedirect section="timeline" /> },
  { path: 'kanban/:projectId', element: <LegacyProjectRedirect section="kanban" /> },
]

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
          {
            // o projeto é o centro do trabalho: cada aba (e cada visão das tarefas) tem o seu endereço
            path: 'projects/:projectId',
            ...page(() => import('@/features/projects/ProjectDetailPage').then((m) => ({ default: m.ProjectDetailPage }))),
            children: [
              { index: true, ...page(() => import('@/features/projects/project-sections').then((m) => ({ default: m.ProjectOverviewTab }))) },
              // ficha do projeto: objetivos, funcionalidades, escopo e resultados (quem vê o projeto vê a ficha)
              { path: 'charter', ...page(() => import('@/features/projects/charter/ProjectCharterPanel').then((m) => ({ default: m.ProjectCharterTab }))) },
              {
                // quadro de gestão do projeto (à parte das tarefas)
                element: <PermissionGate permission="plan.view" />,
                children: [{ path: 'management', ...page(() => import('@/features/plan/ProjectManagementPage').then((m) => ({ default: m.ProjectManagementPage }))) }],
              },
              {
                element: <PermissionGate permission="tasks.view" />,
                children: [
                  { path: 'tasks', ...page(() => import('@/features/projects/project-sections').then((m) => ({ default: m.ProjectTasksTab }))) },
                  { path: 'planning', ...page(() => import('@/features/backlog/BacklogPage').then((m) => ({ default: m.ProjectPlanningPage }))) },
                  { path: 'timeline', ...page(() => import('@/features/timeline/TimelinePage').then((m) => ({ default: m.ProjectTimelinePage }))) },
                  // informe do projeto (PDF), montado com as tarefas escolhidas na Lista
                  { path: 'report', ...page(() => import('@/features/projects/report/ProjectReportPanel').then((m) => ({ default: m.ProjectReportTab }))) },
                ],
              },
              {
                element: <PermissionGate permission="kanban.view" />,
                children: [{ path: 'kanban', ...page(() => import('@/features/kanban/KanbanPage').then((m) => ({ default: m.ProjectKanbanPage }))) }],
              },
              { path: 'files', ...page(() => import('@/features/projects/project-sections').then((m) => ({ default: m.ProjectFilesTab }))) },
              { path: 'members', ...page(() => import('@/features/projects/project-sections').then((m) => ({ default: m.ProjectMembersTab }))) },
              { path: 'history', ...page(() => import('@/features/projects/project-sections').then((m) => ({ default: m.ProjectHistoryTab }))) },
              { path: 'settings', ...page(() => import('@/features/projects/project-sections').then((m) => ({ default: m.ProjectSettingsTab }))) },
            ],
          },
        ],
      },
      {
        element: <PermissionGate permission="tasks.view" />,
        children: [
          { path: 'tasks', ...page(() => import('@/features/tasks/TasksPage').then((m) => ({ default: m.TasksPage }))) },
          { path: 'tasks/:taskId', ...page(() => import('@/features/tasks/TaskDetailPage').then((m) => ({ default: m.TaskDetailPage }))) },
        ],
      },
      {
        // Kanban de todos os projetos (o de um projeto fica na aba Tarefas do projeto)
        element: <PermissionGate permission="kanban.view" />,
        children: [
          { path: 'kanban', ...page(() => import('@/features/kanban/KanbanPage').then((m) => ({ default: m.KanbanPage }))) },
          { path: 'kanban/all', ...page(() => import('@/features/kanban/KanbanPage').then((m) => ({ default: m.KanbanPage }))) },
        ],
      },
      // endereços antigos das visões por projeto (itens do menu que viraram abas do projeto): a query vai junto
      ...LEGACY_ROUTES,
      {
        element: <PermissionGate permission="reports.view" />,
        children: [{ path: 'reports', ...page(() => import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage }))) }],
      },
      {
        element: <PermissionGate permission="executive.view" />,
        children: [{ path: 'executive', ...page(() => import('@/features/executive/ExecutivePage').then((m) => ({ default: m.ExecutivePage }))) }],
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
              { path: 'icons', ...page(() => import('@/features/icons/IconLibraryPage').then((m) => ({ default: m.IconLibraryPage }))) },
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
              { path: 'roles', ...page(() => import('@/features/settings/RolesPage').then((m) => ({ default: m.RolesPage }))) },
              { path: 'permissions', ...page(() => import('@/features/settings/PermissionsPage').then((m) => ({ default: m.PermissionsPage }))) },
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
