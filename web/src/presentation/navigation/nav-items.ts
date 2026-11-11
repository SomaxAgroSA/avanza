import {
  BookOpen,
  CheckSquare,
  FolderKanban,
  Gauge,
  KanbanSquare,
  LayoutDashboard,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { canAny, type PermissionCode } from '@/domain/permissions'

export interface NavItem {
  id: string
  /** Chave de i18n do rótulo. */
  labelKey: string
  to: string
  icon?: LucideIcon
  /** Exige ao menos uma destas permissões para aparecer. */
  anyOf?: PermissionCode[]
  /** Fase do roadmap em que o módulo será entregue (página "em breve" até lá). */
  phase?: number
  children?: NavItem[]
  /** Considera ativo apenas com correspondência exata do caminho. */
  end?: boolean
  /** Fora do menu lateral; continua no breadcrumb e na paleta de comandos (a página segue existindo). */
  hidden?: boolean
}

/** Estrutura de navegação (diretriz §36). Fonte única para sidebar, breadcrumb e command palette. */
export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', to: '/dashboard', icon: LayoutDashboard },
  // Seguimento de projetos: a tela única da gerência (juntou o Painel executivo e os Relatórios);
  // sem executive.view, leva aos Relatórios das tarefas
  { id: 'tracking', labelKey: 'nav.tracking', to: '/tracking', icon: Gauge, anyOf: ['executive.view', 'reports.view'] },
  {
    id: 'projects',
    labelKey: 'nav.projects',
    to: '/projects',
    icon: FolderKanban,
    anyOf: ['projects.view'],
    children: [
      // no menu: todos, em andamento, concluídos e arquivados; "Meus projetos" segue pelo card do Dashboard
      { id: 'projects-all', labelKey: 'nav.projectsAll', to: '/projects', end: true },
      { id: 'projects-ongoing', labelKey: 'nav.projectsOngoing', to: '/projects/ongoing' },
      { id: 'projects-finished', labelKey: 'nav.projectsFinished', to: '/projects/finished' },
      { id: 'projects-archived', labelKey: 'nav.projectsArchived', to: '/projects/archived' },
      { id: 'projects-mine', labelKey: 'nav.projectsMine', to: '/projects/mine', hidden: true },
    ],
  },
  // só visões de todos os projetos: as de um projeto (Gestão, Planejamento, Kanban do projeto, Cronograma)
  // ficam nas abas da página do projeto
  { id: 'kanban', labelKey: 'nav.kanban', to: '/kanban', icon: KanbanSquare, anyOf: ['kanban.view'] },
  { id: 'tasks', labelKey: 'nav.tasks', to: '/tasks', icon: CheckSquare, anyOf: ['tasks.view'] },
  { id: 'docs', labelKey: 'nav.docs', to: '/docs', icon: BookOpen, anyOf: ['docs.view'] },
  { id: 'users', labelKey: 'nav.users', to: '/users', icon: Users, anyOf: ['users.view'] },
  {
    id: 'settings',
    labelKey: 'nav.settings',
    to: '/settings',
    icon: Settings,
    anyOf: ['platform.manage', 'integrations.manage', 'settings.manage', 'permissions.manage', 'audit.view'],
    children: [
      { id: 'general', labelKey: 'nav.general', to: '/settings/general', anyOf: ['platform.manage'] },
      { id: 'integrations', labelKey: 'nav.integrations', to: '/settings/integrations', anyOf: ['integrations.manage'] },
      { id: 'task-types', labelKey: 'nav.taskTypes', to: '/settings/task-types', anyOf: ['settings.manage'] },
      { id: 'custom-fields', labelKey: 'nav.customFields', to: '/settings/custom-fields', anyOf: ['settings.manage'] },
      { id: 'statuses', labelKey: 'nav.statuses', to: '/settings/statuses', anyOf: ['settings.manage'] },
      { id: 'priorities', labelKey: 'nav.priorities', to: '/settings/priorities', anyOf: ['settings.manage'] },
      { id: 'areas', labelKey: 'nav.areas', to: '/settings/areas', anyOf: ['settings.manage'] },
      { id: 'tags', labelKey: 'nav.tags', to: '/settings/tags', anyOf: ['settings.manage'] },
      { id: 'icons', labelKey: 'nav.icons', to: '/settings/icons', anyOf: ['settings.manage'] },
      // num só lugar, por pessoa: perfil, módulos e projetos
      { id: 'access', labelKey: 'nav.access', to: '/settings/access', anyOf: ['permissions.manage'] },
      { id: 'audit', labelKey: 'nav.audit', to: '/settings/audit', anyOf: ['audit.view'] },
    ],
  },
]

/** Filtra a navegação pelas permissões do usuário (itens sem filhos visíveis somem). */
export function visibleNavItems(permissions: readonly string[], items: NavItem[] = NAV_ITEMS): NavItem[] {
  return items
    .filter((item) => !item.anyOf || canAny(permissions, item.anyOf))
    .map((item) => (item.children ? { ...item, children: visibleNavItems(permissions, item.children) } : item))
    .filter((item) => !item.children || item.children.length > 0)
}

/** Trilha de navegação para um caminho (usado no breadcrumb). Prefere a correspondência mais específica. */
export function findNavTrail(pathname: string, items: NavItem[] = NAV_ITEMS): NavItem[] {
  const item = items
    .filter((candidate) => pathname === candidate.to || pathname.startsWith(`${candidate.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0]
  if (!item) return []
  const childTrail = item.children ? findNavTrail(pathname, item.children) : []
  const deepest = childTrail[childTrail.length - 1]
  // Filho com o mesmo caminho do pai (ex.: "Todos" em /projects) não duplica o breadcrumb.
  return deepest && deepest.to !== item.to ? [item, ...childTrail] : [item]
}
