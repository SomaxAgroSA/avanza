import {
  BookOpen,
  CheckSquare,
  FolderKanban,
  Gauge,
  KanbanSquare,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { PlatformFeatures } from '@/domain/entities'
import { canAny, type PermissionCode } from '@/domain/permissions'
import { PROJECT_LIST_PATHS, type ProjectList } from '@/domain/project-lists'
import { shows, type ScreenKey, type ScreenSettings } from '@/domain/screens'

export interface NavItem {
  id: string
  /** Chave de i18n do rótulo. */
  labelKey: string
  /** Complemento do rótulo ("Projetos · Em andamento"): a única lista do grupo, quando o perfil mostra só uma (ajuste 25/11). */
  detailKey?: string
  to: string
  /** Para onde o clique leva, quando não é `to` (Tarefas abre onde o perfil escolheu, ajuste 23/11); `to` segue marcando o item. */
  entry?: string
  icon?: LucideIcon
  /** Exige ao menos uma destas permissões para aparecer. */
  anyOf?: PermissionCode[]
  /** Exige todas estas permissões para aparecer (ex.: Tarefas = Lista de tarefas + ver tarefas, §44). */
  allOf?: PermissionCode[]
  /** Fase do roadmap em que o módulo será entregue (página "em breve" até lá). */
  phase?: number
  children?: NavItem[]
  /** Considera ativo apenas com correspondência exata do caminho. */
  end?: boolean
  /** Fora do menu lateral; continua no breadcrumb e na paleta de comandos (a página segue existindo). */
  hidden?: boolean
  /** A própria página (caminho exato) não mostra a trilha no topo: o título dela já diz onde a pessoa está. */
  noBreadcrumb?: boolean
}

/** Estrutura de navegação (diretriz §36). Fonte única para sidebar, breadcrumb e command palette. */
export const NAV_ITEMS: NavItem[] = [
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
      // as quatro listas sem a trilha no topo (repetia o título; ajuste 18/11)
      { id: 'projects-all', labelKey: 'nav.projectsAll', to: '/projects', end: true, noBreadcrumb: true },
      { id: 'projects-ongoing', labelKey: 'nav.projectsOngoing', to: '/projects/ongoing', noBreadcrumb: true },
      { id: 'projects-finished', labelKey: 'nav.projectsFinished', to: '/projects/finished', noBreadcrumb: true },
      { id: 'projects-archived', labelKey: 'nav.projectsArchived', to: '/projects/archived', noBreadcrumb: true },
      { id: 'projects-mine', labelKey: 'nav.projectsMine', to: '/projects/mine', hidden: true },
    ],
  },
  // Lista de tarefas (§44): logo depois de Projetos, só para o perfil com o módulo (que depende de ver
  // tarefas); sem ele, as tarefas continuam dentro de cada projeto
  { id: 'tasks', labelKey: 'nav.tasks', to: '/tasks', icon: CheckSquare, allOf: ['tasks.list', 'tasks.view'] },
  // só visões de todos os projetos: as de um projeto (Gestão, Planejamento, Kanban do projeto, Cronograma)
  // ficam nas abas da página do projeto
  { id: 'kanban', labelKey: 'nav.kanban', to: '/kanban', icon: KanbanSquare, anyOf: ['kanban.view'] },
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
      { id: 'dependency-areas', labelKey: 'nav.dependencyAreas', to: '/settings/dependency-areas', anyOf: ['settings.manage'] },
      { id: 'companies', labelKey: 'nav.companies', to: '/settings/companies', anyOf: ['platform.manage'] },
      { id: 'tags', labelKey: 'nav.tags', to: '/settings/tags', anyOf: ['settings.manage'] },
      { id: 'icons', labelKey: 'nav.icons', to: '/settings/icons', anyOf: ['settings.manage'] },
      // num só lugar, por pessoa: perfil, módulos e projetos
      { id: 'access', labelKey: 'nav.access', to: '/settings/access', anyOf: ['permissions.manage'] },
      { id: 'audit', labelKey: 'nav.audit', to: '/settings/audit', anyOf: ['audit.view'] },
    ],
  },
]

/** O menu da plataforma: sem o Panorama quando ele está desligado para todos (§26.2; sem a informação, ligado). */
export function platformNavItems(features: PlatformFeatures | undefined, items: NavItem[] = NAV_ITEMS): NavItem[] {
  return features && !features.panoramaEnabled ? items.filter((item) => item.id !== 'tracking') : items
}

/** O item `id` passa a levar a `entry` (ex.: Tarefas → a Caixa de entrada do perfil); sem mudança quando é o `to`. */
export function withNavEntry(items: NavItem[], id: string, entry: string): NavItem[] {
  return items.map((item) => (item.id === id && item.to !== entry ? { ...item, entry } : item))
}

/**
 * Projetos por perfil (ajuste 25/11): o grupo Projetos só com as listas do perfil. Com uma só, vira um item sem
 * submenu que leva direto a ela ("Projetos · Em andamento") e segue marcado em todo /projects (o projeto aberto
 * inclusive). "Meus projetos" (fora do menu) fica no grupo enquanto há submenu.
 */
export function withProjectLists(items: NavItem[], lists: readonly ProjectList[]): NavItem[] {
  return items.map((item) => {
    if (item.id !== 'projects' || !item.children) return item
    const paths = lists.map((list) => PROJECT_LIST_PATHS[list])
    const children = item.children.filter((child) => child.hidden || paths.includes(child.to))
    const shown = children.filter((child) => !child.hidden)
    // várias: o grupo leva à lista de entrada ("Abre em", a primeira de `lists`, §48) quando não é a primeira do menu
    if (shown.length !== 1) return { ...item, children, ...(paths[0] && paths[0] !== shown[0]?.to ? { entry: paths[0] } : {}) }
    const only = shown[0]!
    const { children: _children, ...rest } = item
    return { ...rest, detailKey: only.labelKey, ...(only.to !== item.to ? { entry: only.to } : {}) }
  })
}

/**
 * "O que aparece" do perfil (§48): sem os submenus de Configurações que o perfil esconde (`settings.menu.<item>`,
 * o id do item com "_" no lugar de "-"). Só o menu: a tela segue abrindo pelo endereço para quem tem a permissão.
 */
export function withScreens(items: NavItem[], screens: ScreenSettings): NavItem[] {
  return items.map((item) =>
    item.id === 'settings' && item.children
      ? { ...item, children: item.children.filter((child) => shows(screens, `settings.menu.${child.id.replace(/-/g, '_')}` as ScreenKey)) }
      : item,
  )
}

/** Filtra a navegação pelas permissões do usuário (itens sem filhos visíveis somem). */
export function visibleNavItems(permissions: readonly string[], items: NavItem[] = NAV_ITEMS): NavItem[] {
  return items
    .filter((item) => !item.anyOf || canAny(permissions, item.anyOf))
    .filter((item) => !item.allOf || item.allOf.every((code) => permissions.includes(code)))
    .map((item) => (item.children ? { ...item, children: visibleNavItems(permissions, item.children) } : item))
    .filter((item) => !item.children || item.children.length > 0)
}

/** A página do caminho mostra a trilha no topo? Não nas marcadas `noBreadcrumb` (só no caminho exato delas). */
export function showsBreadcrumb(pathname: string, items: NavItem[] = NAV_ITEMS): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const hides = (list: NavItem[]): boolean => list.some((item) => (item.noBreadcrumb && item.to === path) || (!!item.children && hides(item.children)))
  return !hides(items)
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
