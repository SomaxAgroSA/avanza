import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { FolderOpen, FolderPlus, Languages, ListTodo, LogOut, Monitor, Moon, Plus, Search, Sun, UserSearch } from 'lucide-react'
import { SUPPORTED_LANGUAGES } from '@/core/i18n'
import { AppCommandPalette, modKey, type CommandGroup } from '@/presentation/components'
import { useHotkey } from '@/presentation/common/use-hotkey'
import { useUiStore } from '@/presentation/state/ui-store'
import { useLogout, useSession } from '@/features/auth/session'
import { usePreferences } from '@/features/preferences/use-preferences'
import { useProjects } from '@/features/projects/queries'
import { useTasksList } from '@/features/tasks/queries'
import { useDebouncedValue } from '@/presentation/common/use-debounced-value'
import { platformNavItems, visibleNavItems, withNavEntry, withProjectLists, type NavItem } from './nav-items'
import { useTaskViews } from '@/features/tasks/use-task-views'
import { useProjectLists } from '@/features/projects/use-project-lists'

function flatten(items: NavItem[]): NavItem[] {
  // Filhos herdam o ícone do grupo; itens com o mesmo destino aparecem uma vez só.
  return items
    .flatMap((item) => (item.children ? [item, ...item.children.map((child) => ({ ...child, icon: child.icon ?? item.icon }))] : [item]))
    .filter((item, i, all) => all.findIndex((x) => x.to === item.to) === i)
}

/** Command Palette global (Ctrl/⌘ + K): navegação, ações e preferências. */
export function CommandPalette() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const open = useUiStore((s) => s.commandPaletteOpen)
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const { current } = useSession()
  const logout = useLogout()
  const { changeTheme, changeLanguage } = usePreferences()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 250)
  const canViewProjects = !!current?.permissions.includes('projects.view')
  const projectResults = useProjects(
    { view: 'all', page: 1, perPage: 6, sort: { id: 'name', direction: 'asc' }, search: debouncedSearch, filters: {} },
    open && canViewProjects,
  )
  const projectItems = projectResults.data?.items
  // tarefas: só com busca (código ou título), em todos os projetos que a pessoa vê, abertas ou não
  const canViewTasks = !!current?.permissions.includes('tasks.view')
  const taskResults = useTasksList(
    { page: 1, perPage: 6, sort: { id: 'updated_at', direction: 'desc' }, search: debouncedSearch, filters: {} },
    undefined,
    open && canViewTasks && debouncedSearch.length >= 2,
  )
  const taskItems = debouncedSearch.length >= 2 ? taskResults.data?.items : undefined

  useHotkey('k', () => setOpen(!useUiStore.getState().commandPaletteOpen), { mod: true, allowInInputs: true })

  const permissions = current?.permissions
  const platform = current?.platform
  const tasksEntry = useTaskViews().entry
  const projectLists = useProjectLists()
  const groups = useMemo<CommandGroup[]>(() => {
    // o Panorama desligado na plataforma (§26.2) também não é oferecido aqui
    // Projetos só com as listas do perfil (ajuste 25/11)
    const nav = flatten(withProjectLists(withNavEntry(visibleNavItems(permissions ?? [], platformNavItems(platform)), 'tasks', tasksEntry), projectLists))
    const canViewUsers = permissions?.includes('users.view')
    // criar e buscar abrem a Lista de tarefas (/tasks): só com o módulo (§44); as tarefas encontradas abrem direto
    const canListTasks = canViewTasks && !!permissions?.includes('tasks.list')
    const canCreateTasks = canListTasks && permissions?.includes('tasks.create')
    const canCreateProjects = permissions?.includes('projects.create')
    const query = search.trim()

    return [
      {
        heading: t('commandPalette.actions'),
        items: [
          ...(canCreateProjects
            ? [{ id: 'create-project', label: t('commandPalette.createProject'), icon: <FolderPlus />, onSelect: () => navigate('/projects?new=1') }]
            : []),
          ...(canCreateTasks
            ? [{ id: 'create-task', label: t('commandPalette.createTask'), icon: <Plus />, keywords: ['tarefa', 'task', 'nova'], onSelect: () => navigate('/tasks?new=1') }]
            : []),
          ...(canListTasks
            ? [
                {
                  id: 'search-task',
                  label: query ? t('commandPalette.searchTaskFor', { query }) : t('commandPalette.searchTask'),
                  icon: <Search />,
                  keywords: ['tarefa', 'task', 'buscar', query],
                  // sempre em "Ver todas": a busca cobre todas as tarefas que a pessoa vê, não só as dela
                  onSelect: () => navigate(query ? `/tasks?scope=all&search=${encodeURIComponent(query)}` : '/tasks?scope=all'),
                },
              ]
            : []),
          ...(canViewUsers
            ? [
                {
                  id: 'search-user',
                  label: query ? t('commandPalette.searchUserFor', { query }) : t('commandPalette.searchUser'),
                  icon: <UserSearch />,
                  keywords: ['usuário', 'user', 'usuario', query],
                  onSelect: () => navigate(query ? `/users?search=${encodeURIComponent(query)}` : '/users'),
                },
              ]
            : []),
        ],
      },
      {
        heading: t('commandPalette.tasks'),
        items: (taskItems ?? []).map((task) => ({
          id: `task-${task.id}`,
          label: `${task.code} · ${task.title}`,
          icon: <ListTodo />,
          keywords: [task.code, task.title, query],
          onSelect: () => navigate(`/tasks/${task.id}`),
        })),
      },
      {
        heading: t('commandPalette.projects'),
        items: (projectItems ?? []).map((project) => ({
          id: `project-${project.id}`,
          label: `${project.key} · ${project.name}`,
          icon: <FolderOpen />,
          keywords: [project.key, project.name, query],
          onSelect: () => navigate(`/projects/${project.id}`),
        })),
      },
      {
        heading: t('commandPalette.navigation'),
        items: nav.map((item) => ({
          id: `nav-${item.id}`,
          label: item.detailKey ? `${t(item.labelKey)} · ${t(item.detailKey)}` : t(item.labelKey),
          icon: item.icon ? <item.icon /> : undefined,
          hint: item.phase ? t('nav.soon') : undefined,
          onSelect: () => navigate(item.entry ?? item.to),
        })),
      },
      {
        heading: t('commandPalette.preferences'),
        items: [
          { id: 'theme-light', label: t('theme.setLight'), icon: <Sun />, onSelect: () => changeTheme('light') },
          { id: 'theme-dark', label: t('theme.setDark'), icon: <Moon />, onSelect: () => changeTheme('dark') },
          { id: 'theme-system', label: t('theme.setSystem'), icon: <Monitor />, onSelect: () => changeTheme('system') },
          ...SUPPORTED_LANGUAGES.map((lng) => ({
            id: `lang-${lng}`,
            label: `${t('language.label')}: ${t(`language.${lng}`)}`,
            icon: <Languages />,
            onSelect: () => changeLanguage(lng),
          })),
          { id: 'logout', label: t('auth.logout'), icon: <LogOut />, onSelect: () => logout.mutate() },
        ],
      },
    ]
  }, [permissions, platform, tasksEntry, projectLists, search, projectItems, taskItems, canViewTasks, t, navigate, changeTheme, changeLanguage, logout])

  return (
    <AppCommandPalette
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (!value) setSearch('')
      }}
      groups={groups}
      search={search}
      onSearchChange={setSearch}
      placeholder={t('commandPalette.placeholderWithShortcut', { shortcut: `${modKey}+K` })}
    />
  )
}
