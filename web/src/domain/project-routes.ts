/**
 * Página do projeto como centro do trabalho: as abas e as visões das tarefas, cada uma com o seu
 * endereço (`/projects/:id/<seção>`), e quem pode ver cada uma (as mesmas permissões dos antigos itens
 * do menu lateral). O menu global fica só com as visões de todos os projetos.
 */
import { can, type PermissionCode } from './permissions'

/** Abas da página do projeto, na ordem da tela. */
export const PROJECT_TABS = ['overview', 'management', 'tasks', 'files', 'members', 'history', 'settings'] as const
export type ProjectTab = (typeof PROJECT_TABS)[number]

/** Visões da aba Tarefas: lista, Kanban, planejamento (backlog e sprints) e cronograma (timeline). */
export const PROJECT_TASK_VIEWS = ['list', 'kanban', 'planning', 'timeline'] as const
export type ProjectTaskView = (typeof PROJECT_TASK_VIEWS)[number]

/** Seção com endereço próprio: cada aba e, dentro de Tarefas, cada visão. */
export type ProjectSection = Exclude<ProjectTab, 'tasks'> | ProjectTaskView

/** Trecho do endereço depois de `/projects/:id` (a visão geral é o próprio projeto). */
const SEGMENTS: Record<ProjectSection, string> = {
  overview: '',
  management: 'management',
  list: 'tasks',
  kanban: 'kanban',
  planning: 'planning',
  timeline: 'timeline',
  files: 'files',
  members: 'members',
  history: 'history',
  settings: 'settings',
}

const TASK_VIEW_PERMISSION: Record<ProjectTaskView, PermissionCode> = {
  list: 'tasks.view',
  kanban: 'kanban.view',
  planning: 'tasks.view',
  timeline: 'tasks.view',
}

/** Endereço de uma seção do projeto, com os parâmetros da tela (`?view=`, `?item=`…). */
export function projectPath(projectId: string, section: ProjectSection = 'overview', params?: URLSearchParams | Record<string, string> | string): string {
  const segment = SEGMENTS[section]
  const search = new URLSearchParams(params).toString()
  return `/projects/${encodeURIComponent(projectId)}${segment ? `/${segment}` : ''}${search ? `?${search}` : ''}`
}

/** Seção aberta no endereço (null = trecho desconhecido). */
export function sectionFromPath(pathname: string, projectId: string): ProjectSection | null {
  const base = `/projects/${encodeURIComponent(projectId)}`
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\/+|\/+$/g, '') : null
  if (rest === null) return null
  const found = (Object.keys(SEGMENTS) as ProjectSection[]).find((section) => SEGMENTS[section] === rest)
  return found ?? null
}

/** Aba de uma seção: as visões das tarefas ficam todas na aba Tarefas. */
export function tabOfSection(section: ProjectSection): ProjectTab {
  return (PROJECT_TASK_VIEWS as readonly string[]).includes(section) ? 'tasks' : (section as ProjectTab)
}

/** Endereços antigos com a aba na query (`/projects/:id?tab=…`, links e notificações antigos). */
export function legacyProjectTab(tab: string | null): { section: ProjectSection; params: Record<string, string> } | null {
  switch (tab) {
    case 'plan':
      return { section: 'management', params: {} }
    // o cronograma do quadro de gestão já foi uma aba do projeto
    case 'timeline':
      return { section: 'management', params: { view: 'timeline' } }
    case 'tasks':
      return { section: 'list', params: {} }
    case 'overview':
    case 'files':
    case 'members':
    case 'history':
    case 'settings':
      return { section: tab, params: {} }
    default:
      return null
  }
}

/** Visões da aba Tarefas que a pessoa pode abrir. */
export function visibleTaskViews(permissions: readonly string[]): ProjectTaskView[] {
  return PROJECT_TASK_VIEWS.filter((view) => can(permissions, TASK_VIEW_PERMISSION[view]))
}

export interface ProjectTabAccess {
  /** Pode transferir, arquivar ou excluir o projeto (aba Configurações). */
  manage: boolean
}

/** Abas que a pessoa vê: Gestão com `plan.view`, Tarefas com alguma visão, Configurações para quem administra. */
export function visibleProjectTabs(permissions: readonly string[], access: ProjectTabAccess): ProjectTab[] {
  return PROJECT_TABS.filter((tab) => {
    if (tab === 'management') return can(permissions, 'plan.view')
    if (tab === 'tasks') return visibleTaskViews(permissions).length > 0
    if (tab === 'settings') return access.manage
    return true
  })
}

/** A pessoa pode abrir a seção? */
export function canOpenSection(section: ProjectSection, permissions: readonly string[], access: ProjectTabAccess): boolean {
  const tab = tabOfSection(section)
  if (tab === 'tasks') return visibleTaskViews(permissions).includes(section as ProjectTaskView)
  return visibleProjectTabs(permissions, access).includes(tab)
}
